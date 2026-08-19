-- ============================================================
-- KalsaTrack – Progress workflow integrity
-- Department of Agriculture - RAED Region VI
-- Run this SQL in your Supabase SQL Editor.
--
-- PURPOSE
-- -------
-- Enforce, in the database, that a contractor's reported figure is only ever a
-- CLAIM, and that official project accomplishment comes from the engineer's
-- CERTIFIED measurement after an administrator approves it:
--
--     pending  ->  certified (engineer)  ->  approved (admin)  ->  official
--
-- Before this migration:
--   * approve_progress_update_admin copied reported_accomplishment (the
--     contractor's own claim) straight into fmr_projects.accomplishment
--   * an admin could approve an update no engineer had ever certified, or one
--     the engineer had explicitly DISPUTED
--   * a disputed update kept status='pending', which collided with the
--     contractor's "one pending update at a time" guard and left the project
--     deadlocked: nobody could approve it and the contractor could not replace
--     it
--   * approved rows could still be edited afterwards
--
-- Everything here is additive and safe on existing data. New CHECK constraints
-- are added NOT VALID so historical rows are never rejected retroactively,
-- while all new writes are validated.
-- ============================================================

-- 1. Audit column: the admin's note when approving/rejecting ---------------
-- submitted_at/contractor_id, certified_by/certified_at/certification_remarks
-- and reviewed_by/reviewed_at already exist and are reused rather than
-- duplicated.

ALTER TABLE public.progress_updates
  ADD COLUMN IF NOT EXISTS approval_remarks TEXT;

-- 2. Value constraints ------------------------------------------------------
-- NOT VALID: enforced for every new INSERT/UPDATE, but existing rows are left
-- alone so seeded/legacy data cannot break. Run the VALIDATE statements at the
-- bottom once you have confirmed historical data is clean.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'progress_updates_reported_range') THEN
    ALTER TABLE public.progress_updates
      ADD CONSTRAINT progress_updates_reported_range
      CHECK (reported_accomplishment IS NULL
             OR (reported_accomplishment >= 0 AND reported_accomplishment <= 100))
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'progress_updates_certified_range') THEN
    ALTER TABLE public.progress_updates
      ADD CONSTRAINT progress_updates_certified_range
      CHECK (certified_accomplishment IS NULL
             OR (certified_accomplishment >= 0 AND certified_accomplishment <= 100))
      NOT VALID;
  END IF;
END $$;

-- 3. Immutability of approved records --------------------------------------
-- Once an update is approved, its claim/certification/approval facts are the
-- audit record and must not be quietly edited. Operational fields that legally
-- change AFTER approval (billing_hold, hold_reason, held_by, held_at,
-- released_hold_at, linked_report_id) are deliberately NOT frozen.

CREATE OR REPLACE FUNCTION public.protect_approved_progress_update()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    IF NEW.reported_accomplishment  IS DISTINCT FROM OLD.reported_accomplishment
       OR NEW.certified_accomplishment IS DISTINCT FROM OLD.certified_accomplishment
       OR NEW.certification_status  IS DISTINCT FROM OLD.certification_status
       OR NEW.certification_remarks IS DISTINCT FROM OLD.certification_remarks
       OR NEW.certified_by          IS DISTINCT FROM OLD.certified_by
       OR NEW.certified_at          IS DISTINCT FROM OLD.certified_at
       OR NEW.reviewed_by           IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_at           IS DISTINCT FROM OLD.reviewed_at
       OR NEW.approval_remarks      IS DISTINCT FROM OLD.approval_remarks
       OR NEW.status                IS DISTINCT FROM OLD.status
       OR NEW.contractor_id         IS DISTINCT FROM OLD.contractor_id
       OR NEW.fmr_project_id        IS DISTINCT FROM OLD.fmr_project_id
    THEN
      RAISE EXCEPTION
        'This progress update has already been approved; its audit record cannot be modified. Submit a new progress update instead.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_approved_progress_update ON public.progress_updates;
CREATE TRIGGER trg_protect_approved_progress_update
  BEFORE UPDATE ON public.progress_updates
  FOR EACH ROW EXECUTE FUNCTION public.protect_approved_progress_update();

-- 4. Engineer certification -------------------------------------------------
-- Replaces the earlier version. Two changes:
--   (a) only an update that is still 'pending' may be certified or disputed --
--       an already approved/rejected record is closed
--   (b) a DISPUTE now closes the update (status='rejected'). Previously it left
--       status='pending', which deadlocked the project: the admin could not
--       approve it and the contractor's "one pending at a time" guard blocked a
--       corrected submission. The disputed record is preserved in full.

CREATE OR REPLACE FUNCTION public.certify_progress_update_engineer(
  progress_update_id         uuid,
  p_certified_accomplishment numeric DEFAULT NULL,
  p_remarks                  text    DEFAULT NULL,
  p_dispute                  boolean DEFAULT false
)
RETURNS void AS $$
DECLARE
  upd    record;
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

  IF COALESCE(upd.status, '') <> 'pending' THEN
    RAISE EXCEPTION 'This progress update is already % and can no longer be certified', upd.status;
  END IF;

  -- A contractor must never certify their own work, even if their profile were
  -- somehow given another role.
  IF upd.contractor_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot certify your own progress submission';
  END IF;

  IF p_dispute THEN
    IF COALESCE(btrim(p_remarks), '') = '' THEN
      RAISE EXCEPTION 'Remarks are required when disputing a reported accomplishment';
    END IF;

    UPDATE public.progress_updates
    SET certification_status     = 'disputed',
        certification_remarks    = p_remarks,
        certified_by             = auth.uid(),
        certified_at             = now(),
        certified_accomplishment = NULL,
        -- close the record so the contractor can submit a corrected update
        status                   = 'rejected',
        reviewed_at              = now()
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

-- 5. Admin approval — the hard gate ----------------------------------------
-- The whole function body is one transaction: if any check raises, nothing is
-- written and the database is never left half-updated.
--
-- CRITICAL — the old one-argument versions are dropped first.
--
-- The app calls these with a single named argument:
--     supabase.rpc('approve_progress_update_admin', { progress_update_id })
--
-- If the previous one-argument function were left in place alongside a new
-- two-argument version with a DEFAULT, a one-argument call would be ambiguous
-- ("function ... is not unique") -- or worse, could still resolve to the OLD
-- body, which copied the contractor's reported figure and bypassed this entire
-- gate. Dropping them guarantees exactly one definition exists, and the DEFAULT
-- keeps the existing single-argument call working unchanged.

DROP FUNCTION IF EXISTS public.approve_progress_update_admin(uuid);
DROP FUNCTION IF EXISTS public.approve_progress_update_admin(uuid, text);
DROP FUNCTION IF EXISTS public.reject_progress_update_admin(uuid);
DROP FUNCTION IF EXISTS public.reject_progress_update_admin(uuid, text);

CREATE OR REPLACE FUNCTION public.approve_progress_update_admin(
  progress_update_id uuid,
  p_approval_remarks text DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  upd             record;
  v_current       NUMERIC;
  v_official      NUMERIC;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can approve progress updates';
  END IF;

  SELECT * INTO upd
  FROM public.progress_updates
  WHERE id = progress_update_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Progress update not found';
  END IF;

  -- Duplicate / closed record protection
  IF COALESCE(upd.status, '') = 'approved' THEN
    RAISE EXCEPTION 'This progress update has already been approved';
  END IF;

  IF COALESCE(upd.status, '') <> 'pending' THEN
    RAISE EXCEPTION 'This progress update is % and can no longer be approved', upd.status;
  END IF;

  -- THE GATE: engineer certification is mandatory.
  IF COALESCE(upd.certification_status, '') = 'disputed' THEN
    RAISE EXCEPTION 'The supervising engineer disputed this accomplishment. It cannot be approved.';
  END IF;

  IF COALESCE(upd.certification_status, '') <> 'certified' THEN
    RAISE EXCEPTION 'This accomplishment has not been certified by a supervising engineer yet.';
  END IF;

  IF upd.certified_accomplishment IS NULL THEN
    RAISE EXCEPTION 'No certified accomplishment value is recorded for this update.';
  END IF;

  IF upd.certified_accomplishment < 0 OR upd.certified_accomplishment > 100 THEN
    RAISE EXCEPTION 'Certified accomplishment must be between 0 and 100';
  END IF;

  -- The engineer-certified figure is the official one, NOT the contractor's
  -- reported claim. Both values stay on the row for traceability.
  v_official := upd.certified_accomplishment;

  SELECT COALESCE(accomplishment, 0) INTO v_current
  FROM public.fmr_projects WHERE id = upd.fmr_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The project for this progress update no longer exists';
  END IF;

  -- Official accomplishment is monotonic; an unexpected decrease means
  -- something is wrong and should be investigated, not silently applied.
  IF v_official < v_current THEN
    -- NOTE: in PL/pgSQL RAISE, '%' is the placeholder and '%%' is a literal
    -- percent sign. Percent signs are spelled out here to keep it unambiguous.
    RAISE EXCEPTION
      'Certified accomplishment of % percent is lower than the project''s current official accomplishment of % percent. Resolve this with the engineer before approving.',
      v_official, v_current;
  END IF;

  UPDATE public.fmr_projects
  SET accomplishment = v_official,
      status = CASE WHEN v_official >= 100 THEN 'Completed' ELSE status END,
      updated_at = now()
  WHERE id = upd.fmr_project_id;

  UPDATE public.progress_updates
  SET status           = 'approved',
      reviewed_at      = now(),
      reviewed_by      = auth.uid(),
      approval_remarks = p_approval_remarks
  WHERE id = progress_update_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public
   SET row_security = off;

-- The DEFAULT on p_approval_remarks means the app's existing single-argument
-- call still works, with exactly one function definition in the database.
GRANT EXECUTE ON FUNCTION public.approve_progress_update_admin(uuid, text) TO authenticated;

-- 6. Admin rejection — record the reason -----------------------------------

CREATE OR REPLACE FUNCTION public.reject_progress_update_admin(
  progress_update_id uuid,
  p_approval_remarks text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can reject progress updates';
  END IF;

  UPDATE public.progress_updates
  SET status           = 'rejected',
      reviewed_at      = now(),
      reviewed_by      = auth.uid(),
      approval_remarks = p_approval_remarks
  WHERE id = progress_update_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending progress update not found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public
   SET row_security = off;

GRANT EXECUTE ON FUNCTION public.reject_progress_update_admin(uuid, text) TO authenticated;

-- 7. Billing guard ----------------------------------------------------------
-- release_project_tranche already gates on fmr_projects.accomplishment, which
-- is now the engineer-certified/admin-approved figure -- so a contractor's
-- unverified claim can no longer make a tranche eligible. The only addition
-- here is a sanity check on the amount, to stop a mistyped or negative release.

CREATE OR REPLACE FUNCTION public.release_project_tranche(
  p_tranche_id BIGINT,
  p_released_amount NUMERIC,
  p_released_date DATE,
  p_notes TEXT DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_actor_name text;
  v_project_id BIGINT;
  v_required_progress NUMERIC;
  v_status TEXT;
  v_accomplishment NUMERIC;
BEGIN
  IF public.current_profile_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can release a tranche';
  END IF;

  IF p_released_amount IS NULL OR p_released_amount <= 0 THEN
    RAISE EXCEPTION 'Released amount must be greater than zero';
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();

  SELECT project_id, required_progress, status
    INTO v_project_id, v_required_progress, v_status
  FROM public.project_tranches WHERE id = p_tranche_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tranche not found';
  END IF;

  IF v_status <> 'Pending' THEN
    RAISE EXCEPTION 'Tranche has already been released';
  END IF;

  -- Authoritative (engineer-certified, admin-approved) accomplishment.
  SELECT accomplishment INTO v_accomplishment
  FROM public.fmr_projects WHERE id = v_project_id;

  IF COALESCE(v_accomplishment, 0) < v_required_progress THEN
    RAISE EXCEPTION 'Project has not yet reached the % percent verified progress required for this tranche', v_required_progress;
  END IF;

  UPDATE public.project_tranches
  SET status = 'Released',
      released_amount = p_released_amount,
      released_date = p_released_date,
      released_by = auth.uid(),
      released_by_name = v_actor_name,
      notes = p_notes,
      updated_at = now()
  WHERE id = p_tranche_id;

  UPDATE public.fmr_projects
  SET funds_released = COALESCE(funds_released, 0) + p_released_amount,
      updated_at = now()
  WHERE id = v_project_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public
   SET row_security = off;

GRANT EXECUTE ON FUNCTION public.release_project_tranche(BIGINT, NUMERIC, DATE, TEXT) TO authenticated;

-- ============================================================
-- Done. Safe to re-run.
--
-- OPTIONAL, once you have confirmed no historical row violates the ranges:
--   ALTER TABLE public.progress_updates VALIDATE CONSTRAINT progress_updates_reported_range;
--   ALTER TABLE public.progress_updates VALIDATE CONSTRAINT progress_updates_certified_range;
--
-- To find offenders first:
--   SELECT id, reported_accomplishment, certified_accomplishment
--   FROM public.progress_updates
--   WHERE reported_accomplishment  NOT BETWEEN 0 AND 100
--      OR certified_accomplishment NOT BETWEEN 0 AND 100;
-- ============================================================
