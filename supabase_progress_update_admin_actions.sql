-- ============================================================
-- KalsaTrack – Admin actions for contractor progress updates
-- Run this in the Supabase SQL Editor
-- ============================================================

CREATE OR REPLACE FUNCTION public.approve_progress_update_admin(
  progress_update_id uuid
)
RETURNS void AS $$
DECLARE
  upd record;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
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

  IF COALESCE(upd.status, '') <> 'pending' THEN
    RAISE EXCEPTION 'Progress update is already %', upd.status;
  END IF;

  UPDATE public.fmr_projects
  SET accomplishment = upd.reported_accomplishment,
      status = CASE WHEN upd.reported_accomplishment >= 100 THEN 'Completed' ELSE status END,
      updated_at = now()
  WHERE id = upd.fmr_project_id;

  UPDATE public.progress_updates
  SET status = 'approved',
      reviewed_at = now(),
      reviewed_by = auth.uid()
  WHERE id = progress_update_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public
   SET row_security = off;

GRANT EXECUTE ON FUNCTION public.approve_progress_update_admin(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_progress_update_admin(
  progress_update_id uuid
)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can reject progress updates';
  END IF;

  UPDATE public.progress_updates
  SET status = 'rejected',
      reviewed_at = now(),
      reviewed_by = auth.uid()
  WHERE id = progress_update_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending progress update not found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public
   SET row_security = off;

GRANT EXECUTE ON FUNCTION public.reject_progress_update_admin(uuid) TO authenticated;