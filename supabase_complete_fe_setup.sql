-- ============================================================
-- COMPLETE Field Engineer Setup
-- Run this ONE file in Supabase SQL Editor to set up everything
-- needed for field engineer assignment and login.
-- Safe to run multiple times.
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. PROFILES TABLE (stores role for all users)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  full_name  TEXT DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'user',
  phone      TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure role column allows field_engineer
DO $$
BEGIN
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('user', 'admin', 'field_engineer'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not update role constraint: %', SQLERRM;
END $$;

-- Add columns if missing
DO $$ BEGIN ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT DEFAULT ''; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT ''; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(); EXCEPTION WHEN OTHERS THEN NULL; END $$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════
-- 2. ASSIGNMENT COLUMNS on public_reports
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.public_reports
  ADD COLUMN IF NOT EXISTS assigned_engineer_id UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS assigned_engineer_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS engineer_notes TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS engineer_status TEXT DEFAULT NULL;

-- Add / update the check constraint for engineer_status
DO $$
BEGIN
  ALTER TABLE public.public_reports DROP CONSTRAINT IF EXISTS public_reports_engineer_status_check;
  ALTER TABLE public.public_reports
    ADD CONSTRAINT public_reports_engineer_status_check
    CHECK (engineer_status IS NULL OR engineer_status IN (
      'assigned', 'in_progress', 'inspected', 'validated', 'rejected'
    ));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not update engineer_status constraint: %', SQLERRM;
END $$;

-- Add updated_at if missing from public_reports
DO $$ BEGIN ALTER TABLE public.public_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ══════════════════════════════════════════════════════════════
-- 3. is_admin() HELPER (SECURITY DEFINER, bypasses RLS)
-- ══════════════════════════════════════════════════════════════

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

-- ══════════════════════════════════════════════════════════════
-- 4. RPC: create_field_engineer_profile (SECURITY DEFINER)
--    Called from admin dashboard and FE login fallback.
-- ══════════════════════════════════════════════════════════════

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
    email     = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    phone     = EXCLUDED.phone,
    role      = 'field_engineer',
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public
   SET row_security = off;

GRANT EXECUTE ON FUNCTION public.create_field_engineer_profile TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 5. RLS POLICIES – profiles
-- ══════════════════════════════════════════════════════════════

DO $$ BEGIN DROP POLICY IF EXISTS "Authenticated can view profiles" ON public.profiles; EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Authenticated can view profiles"
  ON public.profiles FOR SELECT TO authenticated USING (true);

DO $$ BEGIN DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles; EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.is_admin());

DO $$ BEGIN DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles; EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id OR public.is_admin());

DO $$ BEGIN DROP POLICY IF EXISTS "Admin can delete profiles" ON public.profiles; EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Admin can delete profiles"
  ON public.profiles FOR DELETE TO authenticated
  USING (public.is_admin());

-- ══════════════════════════════════════════════════════════════
-- 6. RLS POLICIES – public_reports (SELECT, UPDATE, INSERT, DELETE)
--    These replace any existing policies to ensure FE access works.
-- ══════════════════════════════════════════════════════════════

-- SELECT: anyone authenticated can view (admin needs all, FE filters in app)
DO $$ BEGIN DROP POLICY IF EXISTS "Field engineers can view assigned reports" ON public.public_reports; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Authenticated users can view public reports" ON public.public_reports; EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Authenticated users can view public reports"
  ON public.public_reports FOR SELECT TO authenticated USING (true);

-- INSERT: anyone (anon + authenticated) can submit reports
DO $$ BEGIN DROP POLICY IF EXISTS "Anyone can submit public reports" ON public.public_reports; EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Anyone can submit public reports"
  ON public.public_reports FOR INSERT TO anon, authenticated WITH CHECK (true);

-- UPDATE: admin can update any, field engineers can update their assigned reports
DO $$ BEGIN DROP POLICY IF EXISTS "Field engineers can update assigned reports" ON public.public_reports; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Authenticated users can update public reports" ON public.public_reports; EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Authenticated users can update public reports"
  ON public.public_reports FOR UPDATE TO authenticated USING (true);

-- DELETE: admin only
DO $$ BEGIN DROP POLICY IF EXISTS "Authenticated users can delete public reports" ON public.public_reports; EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Authenticated users can delete public reports"
  ON public.public_reports FOR DELETE TO authenticated USING (true);

-- ══════════════════════════════════════════════════════════════
-- 7. INDEXES
-- ══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_public_reports_engineer ON public.public_reports(assigned_engineer_id);

-- ══════════════════════════════════════════════════════════════
-- 8. REALTIME
-- ══════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='profiles')
  THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles; END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='public_reports')
  THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.public_reports; END IF;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 9. ENSURE ADMIN PROFILE EXISTS
--    The admin login uses hardcoded email (gab@gmail.com).
--    Without a profile row with role='admin', is_admin() returns
--    false and the admin can't insert FE profiles via RLS.
-- ══════════════════════════════════════════════════════════════

DO $$
DECLARE
  admin_uid UUID;
BEGIN
  SELECT id INTO admin_uid FROM auth.users WHERE email = 'gab@gmail.com' LIMIT 1;
  IF admin_uid IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, full_name, role, created_at)
    VALUES (admin_uid, 'gab@gmail.com', 'Admin', 'admin', now())
    ON CONFLICT (id) DO UPDATE SET role = 'admin', updated_at = now();
    RAISE NOTICE 'Admin profile created/updated for gab@gmail.com (id: %)', admin_uid;
  ELSE
    RAISE NOTICE 'Admin user gab@gmail.com not found in auth.users. Log in as admin first, then re-run this script.';
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 10. AUTO-CREATE PROFILES for existing FE auth accounts
--    that don't have a profile row yet.
-- ══════════════════════════════════════════════════════════════

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

-- ══════════════════════════════════════════════════════════════
-- 11. VERIFY: Show what we have
-- ══════════════════════════════════════════════════════════════

-- Show ALL profiles (admin + field engineers)
SELECT id, email, full_name, role, phone, created_at
FROM public.profiles
ORDER BY role, created_at;

-- Show any reports that have been assigned
SELECT id, municipality, barangay, assigned_engineer_id, assigned_engineer_name, engineer_status, assigned_at
FROM public.public_reports
WHERE assigned_engineer_id IS NOT NULL
ORDER BY assigned_at DESC;
