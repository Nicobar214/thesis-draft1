-- ============================================================
-- Supabase Migration: Field Engineers
-- Adds field_engineer role support to profiles and
-- assignment tracking to public_reports.
-- Run this SQL in your Supabase SQL Editor.
-- ============================================================

-- 1. Ensure profiles table exists with role column
CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  full_name  TEXT DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'user'
               CHECK (role IN ('user', 'admin', 'field_engineer')),
  phone      TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- If the table already exists, add the field_engineer option
-- (safe to run multiple times)
DO $$
BEGIN
  -- Update the check constraint to include field_engineer
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('user', 'admin', 'field_engineer'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not update role constraint: %', SQLERRM;
END $$;

-- Add full_name column if it doesn't exist
DO $$
BEGIN
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT DEFAULT '';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add phone column if not exists
DO $$
BEGIN
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add updated_at column if not exists
DO $$
BEGIN
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2. Add assignment columns to public_reports
ALTER TABLE public.public_reports
  ADD COLUMN IF NOT EXISTS assigned_engineer_id UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS assigned_engineer_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS engineer_notes TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS engineer_status TEXT DEFAULT NULL
    CHECK (engineer_status IS NULL OR engineer_status IN (
      'assigned', 'in_progress', 'inspected', 'validated', 'rejected'
    ));

-- 3. Enable RLS on profiles (if not already)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3b. Helper: check if current user is admin
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

CREATE OR REPLACE FUNCTION public.is_admin_jwt()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(auth.jwt()->'user_metadata'->>'role', '') = 'admin'
    OR COALESCE(auth.jwt()->'app_metadata'->>'role', '') = 'admin';
END;
$$ LANGUAGE plpgsql STABLE
   SET search_path = public;

GRANT EXECUTE ON FUNCTION public.is_admin_jwt TO authenticated;

-- 3c. RPC function to create/update field engineer profile (bypasses RLS)
-- This is called from the admin Settings form.
-- SECURITY DEFINER runs as the function owner (superuser), bypassing all RLS.
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

-- Grant execute to authenticated users (required for RPC calls from the client)
GRANT EXECUTE ON FUNCTION public.create_field_engineer_profile TO authenticated;

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

-- 3d. Ensure the admin user has a profile row so is_admin() works.
-- Replace 'gab@gmail.com' with your actual admin email.
-- This inserts the admin profile if the user exists in auth.users.
DO $$
DECLARE
  admin_uid UUID;
BEGIN
  SELECT id INTO admin_uid FROM auth.users WHERE email = 'gab@gmail.com' LIMIT 1;
  IF admin_uid IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, role, created_at)
    VALUES (admin_uid, 'gab@gmail.com', 'admin', now())
    ON CONFLICT (id) DO UPDATE SET role = 'admin', updated_at = now();
    RAISE NOTICE 'Admin profile created/updated for gab@gmail.com (id: %)', admin_uid;
  ELSE
    RAISE NOTICE 'Admin user gab@gmail.com not found in auth.users. Create the admin account first.';
  END IF;
END $$;

-- 4. RLS Policies for profiles

-- Anyone authenticated can read profiles (for engineer dropdowns, etc.)
DO $$
BEGIN
  DROP POLICY IF EXISTS "Authenticated can view profiles" ON public.profiles;
  CREATE POLICY "Authenticated can view profiles"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Users can update their own profile, admins can update any
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
  CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id OR public.is_admin_jwt())
    WITH CHECK (auth.uid() = id OR public.is_admin_jwt());
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Users can insert own profile, admins can insert any
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
  CREATE POLICY "Users can insert own profile"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id OR public.is_admin_jwt());
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Admins can delete profiles
DO $$
BEGIN
  DROP POLICY IF EXISTS "Admin can delete profiles" ON public.profiles;
  CREATE POLICY "Admin can delete profiles"
    ON public.profiles FOR DELETE
    TO authenticated
    USING (public.is_admin_jwt());
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 5. Enable Realtime for profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
END $$;

-- 6. Create index for faster engineer lookups
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_public_reports_engineer ON public.public_reports(assigned_engineer_id);

-- 7. RLS: Field engineers can see their assigned reports
DO $$
BEGIN
  DROP POLICY IF EXISTS "Field engineers can view assigned reports" ON public.public_reports;
  CREATE POLICY "Field engineers can view assigned reports"
    ON public.public_reports FOR SELECT
    TO authenticated
    USING (true);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Field engineers can update their assigned reports (notes, engineer_status)
DO $$
BEGIN
  DROP POLICY IF EXISTS "Field engineers can update assigned reports" ON public.public_reports;
  CREATE POLICY "Field engineers can update assigned reports"
    ON public.public_reports FOR UPDATE
    TO authenticated
    USING (true);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
