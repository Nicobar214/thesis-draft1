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

-- Non-recursive admin helper for RLS policies on public.profiles.
-- Uses JWT metadata and does not query public.profiles.
CREATE OR REPLACE FUNCTION public.is_admin_jwt()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(auth.jwt()->'user_metadata'->>'role', '') = 'admin'
    OR COALESCE(auth.jwt()->'app_metadata'->>'role', '') = 'admin';
END;
$$ LANGUAGE plpgsql STABLE
   SET search_path = public;

GRANT EXECUTE ON FUNCTION public.is_admin_jwt TO authenticated;

-- Recreate profiles policies without any profiles self-query to avoid recursion.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop ALL existing profiles policies first, including legacy/custom names.
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Authenticated can view profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id OR public.is_admin_jwt())
  WITH CHECK (auth.uid() = id OR public.is_admin_jwt());

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id OR public.is_admin_jwt());

CREATE POLICY "Admin can delete profiles"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (public.is_admin_jwt());

-- SECURITY DEFINER RPC for dashboard engineer dropdown.
-- Bypasses RLS recursion and returns only field engineers.
CREATE OR REPLACE FUNCTION public.get_field_engineers_secure()
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  phone TEXT,
  role TEXT,
  created_at TIMESTAMPTZ
) AS $$
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.phone,
    p.role,
    p.created_at
  FROM public.profiles p
  WHERE lower(replace(replace(COALESCE(p.role, ''), '-', '_'), ' ', '_')) = 'field_engineer'
  ORDER BY lower(COALESCE(p.full_name, p.email, ''));
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public
   SET row_security = off;

GRANT EXECUTE ON FUNCTION public.get_field_engineers_secure() TO authenticated;

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
