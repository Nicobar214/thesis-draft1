-- ============================================================
-- KalsaTrack – Contractor Profile Fix
-- Run this in the Supabase SQL Editor, then re-register contractors
-- ============================================================

-- 1. Add 'contractor' to the role CHECK constraint
DO $$
BEGIN
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('user', 'admin', 'field_engineer', 'contractor'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not update role constraint: %', SQLERRM;
END $$;

-- 2. create_contractor_profile RPC (SECURITY DEFINER + row_security off)
--    Same pattern as create_field_engineer_profile in supabase_complete_fe_setup.sql
CREATE OR REPLACE FUNCTION public.create_contractor_profile(
  user_id    uuid,
  user_email text,
  user_name  text DEFAULT '',
  user_phone text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone, role, created_at)
  VALUES (user_id, user_email, user_name, user_phone, 'contractor', now())
  ON CONFLICT (id) DO UPDATE
    SET email      = EXCLUDED.email,
        full_name  = EXCLUDED.full_name,
        phone      = EXCLUDED.phone,
        role       = 'contractor',
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_contractor_profile(uuid, text, text, text) TO authenticated;

-- 3. Fix any existing contractors stuck with role = 'user'
--    Updates profiles where the auth.users metadata says role = 'contractor'
UPDATE public.profiles p
SET role = 'contractor', updated_at = now()
FROM auth.users u
WHERE p.id = u.id
  AND u.raw_user_meta_data->>'role' = 'contractor'
  AND p.role != 'contractor';
