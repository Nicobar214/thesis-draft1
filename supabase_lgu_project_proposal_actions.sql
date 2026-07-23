-- ============================================================
-- KalsaTrack – DA admin actions for LGU project proposals
-- Run this in the Supabase SQL Editor AFTER
-- supabase_lgu_project_proposals_migration.sql
-- ============================================================

-- Superseded: the original version of this file auto-created the
-- fmr_projects row on approval. That's been replaced by a manual
-- "validate, then log it into Add New Project yourself" flow (see
-- validate_lgu_project_proposal below), so drop the old function if it
-- exists from a previous run of this file.
DROP FUNCTION IF EXISTS public.approve_lgu_project_proposal(uuid, text, text);

-- Validate: marks the proposal as feasibility-approved by DA. Deliberately
-- does NOT create the fmr_projects row -- the DA officer's real process is
-- to log the validated details into the standard "Add New Project" form
-- themselves (so official fields like FMR code, budget source, and
-- contractor go through the same manual entry point as any other project).
-- The app redirects to that form pre-filled right after this call succeeds;
-- fmr_project_id stays NULL until the officer actually submits it there.
CREATE OR REPLACE FUNCTION public.validate_lgu_project_proposal(
  p_proposal_id uuid,
  p_reviewer_notes text DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_actor_name  text;
  v_actor_email text;
BEGIN
  SELECT full_name, email INTO v_actor_name, v_actor_email
  FROM public.profiles WHERE id = auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can validate project proposals';
  END IF;

  UPDATE public.lgu_project_proposals
  SET status = 'Approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = p_reviewer_notes,
      updated_at = now()
  WHERE id = p_proposal_id
    AND status IN ('Submitted', 'Under Validation');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found or already decided';
  END IF;

  INSERT INTO public.lgu_project_proposal_activity_logs (proposal_id, action_type, description, actor_name, actor_email)
  VALUES (p_proposal_id, 'validated', p_reviewer_notes, v_actor_name, v_actor_email);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public
   SET row_security = off;

GRANT EXECUTE ON FUNCTION public.validate_lgu_project_proposal(uuid, text) TO authenticated;

-- Reject: single-table write, plain RPC (kept server-side too so the
-- admin-only check can't be bypassed by an authenticated non-admin
-- calling supabase.from(...).update() directly).
CREATE OR REPLACE FUNCTION public.reject_lgu_project_proposal(
  p_proposal_id uuid,
  p_reviewer_notes text DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_actor_name  text;
  v_actor_email text;
BEGIN
  SELECT full_name, email INTO v_actor_name, v_actor_email
  FROM public.profiles WHERE id = auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can reject project proposals';
  END IF;

  UPDATE public.lgu_project_proposals
  SET status = 'Rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = p_reviewer_notes,
      updated_at = now()
  WHERE id = p_proposal_id
    AND status IN ('Submitted', 'Under Validation');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found or already decided';
  END IF;

  INSERT INTO public.lgu_project_proposal_activity_logs (proposal_id, action_type, description, actor_name, actor_email)
  VALUES (p_proposal_id, 'rejected', p_reviewer_notes, v_actor_name, v_actor_email);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public
   SET row_security = off;

GRANT EXECUTE ON FUNCTION public.reject_lgu_project_proposal(uuid, text) TO authenticated;

-- Request Revision: sends the proposal back to the LGU with comments;
-- the LGU edits and resubmits the SAME proposal (see revision_count).
CREATE OR REPLACE FUNCTION public.request_lgu_project_proposal_revision(
  p_proposal_id uuid,
  p_reviewer_notes text
)
RETURNS void AS $$
DECLARE
  v_actor_name  text;
  v_actor_email text;
BEGIN
  SELECT full_name, email INTO v_actor_name, v_actor_email
  FROM public.profiles WHERE id = auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can request revisions on project proposals';
  END IF;

  IF COALESCE(p_reviewer_notes, '') = '' THEN
    RAISE EXCEPTION 'Revision notes are required';
  END IF;

  UPDATE public.lgu_project_proposals
  SET status = 'Needs Revision',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = p_reviewer_notes,
      updated_at = now()
  WHERE id = p_proposal_id
    AND status IN ('Submitted', 'Under Validation');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found or already decided';
  END IF;

  INSERT INTO public.lgu_project_proposal_activity_logs (proposal_id, action_type, description, actor_name, actor_email)
  VALUES (p_proposal_id, 'revision_requested', p_reviewer_notes, v_actor_name, v_actor_email);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public
   SET row_security = off;

GRANT EXECUTE ON FUNCTION public.request_lgu_project_proposal_revision(uuid, text) TO authenticated;
