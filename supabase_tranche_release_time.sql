-- =============================================================================
-- Budget release date = the moment the admin releases it. MODIFIES ONE FUNCTION.
--
-- Why: release_project_tranche saved whatever date the admin typed in the form
-- (p_released_date), so a release could be dated days before or after it really
-- happened, and only the day was kept, never the time.
--
-- Now:
--   * project_tranches.released_at (timestamptz) records the exact moment;
--   * released_date is set by the server to that moment's Manila date;
--   * p_released_date is still accepted (older app builds send it) but ignored.
-- Existing releases are back-filled from updated_at, which is when the release
-- was saved (checked 2026-10-27: all 6 match their released_date).
--
-- This is the live definition (copied 2026-10-27) with the changes marked "CHANGED".
-- Run once in the Supabase SQL editor. Safe to run again.
-- =============================================================================

alter table public.project_tranches add column if not exists released_at timestamptz;

update public.project_tranches
   set released_at = updated_at
 where status = 'Released' and released_at is null;

CREATE OR REPLACE FUNCTION public.release_project_tranche(p_tranche_id bigint, p_released_amount numeric, p_released_date date, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
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
      -- CHANGED: the server's clock, not the date typed in the form.
      released_date = (now() AT TIME ZONE 'Asia/Manila')::date,
      released_at = now(),
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
$function$;

-- Check (read-only): every released tranche has a moment, matching its date.
-- select id, released_date, released_at at time zone 'Asia/Manila' from public.project_tranches where status = 'Released';
