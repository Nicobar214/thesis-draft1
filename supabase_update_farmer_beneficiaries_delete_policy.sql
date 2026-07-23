-- ============================================================
-- Supabase Migration: Update Farmer Beneficiaries Delete Policy
-- Allows LGU users to delete their own records and Admins to delete any.
-- ============================================================

-- Drop the admin-only delete policy
DROP POLICY IF EXISTS farmer_beneficiaries_delete_admin_only ON public.farmer_beneficiaries;
DROP POLICY IF EXISTS farmer_beneficiaries_delete_own_or_admin ON public.farmer_beneficiaries;

-- Create a new policy that allows creators and admins to delete records
CREATE POLICY farmer_beneficiaries_delete_own_or_admin
  ON public.farmer_beneficiaries FOR DELETE
  TO authenticated
  USING (
    created_by_user_id = auth.uid()
    OR public.current_profile_role() = 'admin'
  );
