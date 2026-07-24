-- ============================================================
-- Supabase Migration: Farmer username login
-- Department of Agriculture - RAED Region VI
--
-- Adds a username column to profiles so farmer portal accounts can be
-- provisioned/logged into with a username + password instead of a real
-- email address (not all farmers have one). Supabase Auth itself stays
-- email-based under the hood -- the app derives a deterministic synthetic
-- email from the username (see src/lib/farmerAuth.js) so this needs no
-- change to auth.users or the sign-in/sign-up mechanism, only this column.
--
-- Run this SQL in your Supabase SQL Editor.
-- ============================================================

-- 1. Add the column (nullable -- only farmer accounts use it; every other
--    role keeps logging in with email as before).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT;

-- 2. Format constraint: lowercase letters, digits, underscore, 3-30 chars.
--    Matches normalizeUsername() in src/lib/farmerAuth.js exactly, so the
--    DB and the app never disagree about what a "valid" username looks like.
DO $$
BEGIN
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_username_format_check;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_username_format_check
    CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,30}$');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add username format constraint: %', SQLERRM;
END $$;

-- 3. Partial unique index -- allows unlimited NULLs (every non-farmer
--    profile), enforces uniqueness only where a username is actually set.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique_idx
  ON public.profiles (username)
  WHERE username IS NOT NULL;

-- ============================================================
-- Done. No RLS changes needed -- the existing "Authenticated can view
-- profiles" SELECT policy (USING (true) for authenticated) already lets
-- an LGU-authenticated session pre-check username availability before
-- calling supabase.auth.signUp().
-- ============================================================
