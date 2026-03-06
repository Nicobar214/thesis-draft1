-- ============================================================
-- Quick Fix: Create missing profiles for field engineer accounts
-- Run this in Supabase SQL Editor to fix "Access Denied" on FE login.
-- ============================================================

-- This finds all auth.users whose metadata says role='field_engineer'
-- but who do NOT have a row in public.profiles, and inserts one.
INSERT INTO public.profiles (id, email, full_name, role, created_at)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', ''),
  'field_engineer',
  u.created_at
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
  AND u.raw_user_meta_data->>'role' = 'field_engineer'
ON CONFLICT (id) DO UPDATE SET
  role = 'field_engineer',
  updated_at = now();

-- Fix infinite recursion: is_admin() queries profiles but RLS policies call is_admin()
-- Adding SET row_security = off makes the function bypass RLS internally
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE
   SET search_path = public
   SET row_security = off;

-- Also ensure the RPC function exists (in case migration wasn't run)
CREATE OR REPLACE FUNCTION public.create_field_engineer_profile(
  user_id UUID,
  user_email TEXT,
  user_name TEXT DEFAULT '',
  user_phone TEXT DEFAULT ''
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone, role, created_at)
  VALUES (user_id, user_email, user_name, user_phone, 'field_engineer', now())
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    role = 'field_engineer',
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public
   SET row_security = off;

GRANT EXECUTE ON FUNCTION public.create_field_engineer_profile TO authenticated;
