-- Phase 3: progress_updates RLS hardening
-- Deploy this in coordination with the Phase 3 contractor frontend, which uses
-- submit_progress_update_with_quantities() instead of a direct table INSERT.

BEGIN;

ALTER TABLE public.progress_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS progress_updates_permissive
  ON public.progress_updates;
DROP POLICY IF EXISTS progress_updates_select_authorized
  ON public.progress_updates;

CREATE POLICY progress_updates_select_authorized
  ON public.progress_updates
  FOR SELECT
  TO authenticated
  USING (
    public.current_profile_role() IN ('admin', 'field_engineer')
    OR (
      public.current_profile_role() = 'contractor'
      AND contractor_id = auth.uid()
    )
  );

-- No authenticated INSERT, UPDATE, or DELETE policies are intentionally
-- defined. Contractor submission and privileged workflow changes continue
-- through role-checked SECURITY DEFINER RPCs.

COMMIT;
