-- ============================================================
-- KalsaTrack – Engineer certification of contractor progress
-- Department of Agriculture - RAED Region VI
-- Run this SQL in your Supabase SQL Editor.
--
-- WHY THIS EXISTS
-- ---------------
-- DA Region VI (WVSU-CICT Questionnaire, items 2 and 5):
--
--   "The contractor reports the accomplishment, but it must be measured and
--    verified/certified by the supervising or implementing engineer BEFORE it
--    is recognized for payment."
--
--   "Payments are generally based on verified actual physical accomplishment
--    ... Progress billings may be submitted periodically, subject to
--    verification and certification."
--
-- Today the system has ONE accomplishment number, moved by a single admin
-- signature (approve_progress_update_admin). There is no separate record of
-- what an engineer actually measured on site.
--
-- DESIGN — deliberately non-breaking
-- ----------------------------------
-- `reported_accomplishment` keeps its existing meaning: the contractor's own
-- figure. A NEW nullable `certified_accomplishment` records what the engineer
-- measured. Nothing is rewritten and no existing row changes behaviour:
--   * legacy rows simply have certified_accomplishment IS NULL
--   * the app prefers the certified figure and falls back to the reported one
--     with a visible "Uncertified" badge
-- This mirrors the proven public_reports pattern (assigned -> inspected ->
-- validated/rejected, with a required reason on rejection).
-- ============================================================

-- 1. Certification columns on progress_updates -----------------------------

ALTER TABLE public.progress_updates
  ADD COLUMN IF NOT EXISTS certified_accomplishment NUMERIC,
  ADD COLUMN IF NOT EXISTS certified_by             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS certified_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS certification_remarks    TEXT,
  ADD COLUMN IF NOT EXISTS certification_status     TEXT;

-- Constraint added separately so re-running the file is safe (ADD COLUMN IF
-- NOT EXISTS cannot carry a CHECK that may already exist).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'progress_updates_certification_status_check'
  ) THEN
    ALTER TABLE public.progress_updates
      ADD CONSTRAINT progress_updates_certification_status_check
      CHECK (certification_status IS NULL OR certification_status IN
        ('pending_certification', 'certified', 'disputed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_progress_updates_certification
  ON public.progress_updates(certification_status, fmr_project_id);

-- 2. RPC: engineer certifies (or disputes) a progress update ---------------
--
-- Sits ALONGSIDE approve_progress_update_admin -- it does not replace it and
-- does not block it. An engineer records the measured figure; the admin still
-- performs the approval that moves fmr_projects.accomplishment.
--
-- p_certified_accomplishment is ignored when disputing.
-- Remarks are REQUIRED on dispute, matching rejectFieldFinding's rule that a
-- rejection must always carry a reason.

CREATE OR REPLACE FUNCTION public.certify_progress_update_engineer(
  progress_update_id        uuid,
  p_certified_accomplishment numeric DEFAULT NULL,
  p_remarks                  text    DEFAULT NULL,
  p_dispute                  boolean DEFAULT false
)
RETURNS void AS $$
DECLARE
  upd record;
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

  IF COALESCE(v_role, '') NOT IN ('field_engineer', 'admin') THEN
    RAISE EXCEPTION 'Only field engineers or admins can certify progress updates';
  END IF;

  SELECT * INTO upd
  FROM public.progress_updates
  WHERE id = progress_update_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Progress update not found';
  END IF;

  IF p_dispute THEN
    IF COALESCE(btrim(p_remarks), '') = '' THEN
      RAISE EXCEPTION 'Remarks are required when disputing a reported accomplishment';
    END IF;

    UPDATE public.progress_updates
    SET certification_status  = 'disputed',
        certification_remarks = p_remarks,
        certified_by          = auth.uid(),
        certified_at          = now(),
        -- a disputed figure must not be treated as verified
        certified_accomplishment = NULL
    WHERE id = progress_update_id;

  ELSE
    IF p_certified_accomplishment IS NULL THEN
      RAISE EXCEPTION 'A certified accomplishment value is required';
    END IF;

    IF p_certified_accomplishment < 0 OR p_certified_accomplishment > 100 THEN
      RAISE EXCEPTION 'Certified accomplishment must be between 0 and 100';
    END IF;

    UPDATE public.progress_updates
    SET certification_status     = 'certified',
        certified_accomplishment = p_certified_accomplishment,
        certification_remarks    = p_remarks,
        certified_by             = auth.uid(),
        certified_at             = now()
    WHERE id = progress_update_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public
   SET row_security = off;

GRANT EXECUTE ON FUNCTION public.certify_progress_update_engineer(uuid, numeric, text, boolean) TO authenticated;

-- 3. Backfill: mark existing pending submissions as awaiting certification --
--
-- Only touches rows that are still pending review, so historical approved and
-- rejected rows are left exactly as they are.

UPDATE public.progress_updates
SET certification_status = 'pending_certification'
WHERE certification_status IS NULL
  AND status = 'pending';

-- ============================================================
-- Done. Safe to re-run.
--
-- NOTE: this migration intentionally does NOT make admin approval depend on
-- certification. DA requires certification before payment is *recognised*,
-- and the app enforces that at the payment/valuation layer by preferring the
-- certified figure and badging uncertified ones. Hard-blocking approval here
-- would strand every already-seeded project.
-- ============================================================
