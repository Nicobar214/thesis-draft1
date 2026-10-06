-- Site Engineer Validation: route every contractor progress submission to the project's
-- assigned site engineer, and let only that engineer see and certify it.
--
-- Before this, fmr_projects had a contractor but no site engineer, so every field engineer
-- could read and certify every contractor's submission on every project, and admins could
-- certify too. Run once in the Supabase SQL editor. Safe to re-run.
--
-- What it does
--   1. fmr_projects.site_engineer_id        who supervises the project on site
--   2. progress_updates.site_engineer_id    stamped at submission = the routing
--   3. BEFORE INSERT trigger                refuses a submission when no site engineer is assigned,
--                                           and stamps the assigned one
--   4. BEFORE UPDATE trigger                only the stamped engineer can set/change certification
--   5. RLS on progress_updates / items      an engineer sees only the submissions routed to them
--   6. assign_project_site_engineer()       admin-only way to (re)assign; re-routes pending updates
--
-- Admins keep full read access and still do the final approval, but no longer certify.

-- ------------------------------------------------------------------ columns
ALTER TABLE public.fmr_projects
  ADD COLUMN IF NOT EXISTS site_engineer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.progress_updates
  ADD COLUMN IF NOT EXISTS site_engineer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fmr_projects_site_engineer ON public.fmr_projects (site_engineer_id);
CREATE INDEX IF NOT EXISTS idx_progress_updates_site_engineer ON public.progress_updates (site_engineer_id, status);

-- Pending submissions made before this migration take their project's engineer, if one is set.
UPDATE public.progress_updates pu
SET site_engineer_id = fp.site_engineer_id
FROM public.fmr_projects fp
WHERE fp.id = pu.fmr_project_id
  AND pu.status = 'pending'
  AND pu.site_engineer_id IS NULL
  AND fp.site_engineer_id IS NOT NULL;

-- ---------------------------------------------------- 3) route on submission
CREATE OR REPLACE FUNCTION public.route_progress_update_to_site_engineer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $$
DECLARE
  v_engineer uuid;
BEGIN
  SELECT site_engineer_id INTO v_engineer
  FROM public.fmr_projects
  WHERE id = NEW.fmr_project_id;

  IF v_engineer IS NULL THEN
    RAISE EXCEPTION 'No site engineer is assigned to this project yet. Ask the DA office to assign one before submitting progress.';
  END IF;

  NEW.site_engineer_id := v_engineer;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_route_progress_update ON public.progress_updates;
CREATE TRIGGER trg_route_progress_update
  BEFORE INSERT ON public.progress_updates
  FOR EACH ROW EXECUTE FUNCTION public.route_progress_update_to_site_engineer();

-- ------------------------------------------- 4) only the routed engineer certifies
CREATE OR REPLACE FUNCTION public.enforce_site_engineer_certification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $$
BEGIN
  -- Maintenance from the SQL editor / service role has no signed-in user; leave it alone.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.certification_status IS DISTINCT FROM OLD.certification_status
     OR NEW.certified_by IS DISTINCT FROM OLD.certified_by
     OR NEW.certified_accomplishment IS DISTINCT FROM OLD.certified_accomplishment THEN

    IF public.current_profile_role() IS DISTINCT FROM 'field_engineer' THEN
      RAISE EXCEPTION 'Only the assigned site engineer can validate and certify a progress submission';
    END IF;

    IF OLD.site_engineer_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'This submission is routed to a different site engineer';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_site_engineer_certification ON public.progress_updates;
CREATE TRIGGER trg_enforce_site_engineer_certification
  BEFORE UPDATE ON public.progress_updates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_site_engineer_certification();

-- ------------------------------------------------------------------- 5) RLS
DROP POLICY IF EXISTS "progress_updates_select_authorized" ON public.progress_updates;
CREATE POLICY "progress_updates_select_authorized"
  ON public.progress_updates
  FOR SELECT
  TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (public.current_profile_role() = 'contractor' AND contractor_id = auth.uid())
    OR (public.current_profile_role() = 'field_engineer'
        AND (site_engineer_id = auth.uid() OR certified_by = auth.uid()))
  );

DROP POLICY IF EXISTS "progress_update_items_select_authorized" ON public.progress_update_items;
CREATE POLICY "progress_update_items_select_authorized"
  ON public.progress_update_items
  FOR SELECT
  TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR EXISTS (
      SELECT 1
      FROM public.progress_updates pu
      WHERE pu.id = progress_update_items.progress_update_id
        AND (pu.contractor_id = auth.uid()
             OR pu.site_engineer_id = auth.uid()
             OR pu.certified_by = auth.uid())
    )
  );

-- --------------------------------------------------------------- 6) assigning
CREATE OR REPLACE FUNCTION public.assign_project_site_engineer(p_project_id bigint, p_engineer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $$
BEGIN
  IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can assign a site engineer';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.fmr_projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  IF p_engineer_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.progress_updates
      WHERE fmr_project_id = p_project_id AND status = 'pending'
    ) THEN
      RAISE EXCEPTION 'This project has a progress submission waiting for its site engineer. Reassign it to another engineer instead of removing the assignment.';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_engineer_id AND role = 'field_engineer'
  ) THEN
    RAISE EXCEPTION 'The selected user is not a field engineer';
  END IF;

  UPDATE public.fmr_projects
  SET site_engineer_id = p_engineer_id, updated_at = now()
  WHERE id = p_project_id;

  -- A submission still waiting for certification follows the new engineer.
  UPDATE public.progress_updates
  SET site_engineer_id = p_engineer_id
  WHERE fmr_project_id = p_project_id AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.assign_project_site_engineer(bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_project_site_engineer(bigint, uuid) TO authenticated;

-- Verify (as admin): every project that has a contractor should also have a site engineer.
--   select id, project_name from public.fmr_projects
--   where contractor_id is not null and site_engineer_id is null;

-- Rollback:
--   DROP TRIGGER IF EXISTS trg_route_progress_update ON public.progress_updates;
--   DROP TRIGGER IF EXISTS trg_enforce_site_engineer_certification ON public.progress_updates;
--   DROP FUNCTION IF EXISTS public.route_progress_update_to_site_engineer();
--   DROP FUNCTION IF EXISTS public.enforce_site_engineer_certification();
--   DROP FUNCTION IF EXISTS public.assign_project_site_engineer(bigint, uuid);
--   DROP POLICY "progress_updates_select_authorized" ON public.progress_updates;
--   CREATE POLICY "progress_updates_select_authorized" ON public.progress_updates FOR SELECT TO authenticated
--     USING (current_profile_role() IN ('admin','field_engineer') OR (current_profile_role()='contractor' AND contractor_id = auth.uid()));
--   DROP POLICY "progress_update_items_select_authorized" ON public.progress_update_items;
--   CREATE POLICY "progress_update_items_select_authorized" ON public.progress_update_items FOR SELECT TO authenticated
--     USING (current_profile_role() IN ('admin','field_engineer') OR EXISTS (SELECT 1 FROM public.progress_updates pu
--            WHERE pu.id = progress_update_items.progress_update_id AND pu.contractor_id = auth.uid()));
