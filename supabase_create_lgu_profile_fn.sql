-- ============================================================
-- KalsaTrack - LGU Profile Setup + Repair Script
-- Run this in Supabase SQL Editor, then register LGU again
-- ============================================================

-- 0) Ensure municipality column exists (safe/additive)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS municipality text;

-- 1) Normalize current role values
UPDATE public.profiles
SET role = lower(replace(trim(role), '-', '_'))
WHERE role IS NOT NULL;

-- 2) Prevent bad legacy values from breaking the new check
UPDATE public.profiles
SET role = 'user'
WHERE role IS NOT NULL
  AND role NOT IN ('user', 'admin', 'field_engineer', 'contractor', 'lgu');

-- 3) Rebuild role check to include lgu
DO $$
BEGIN
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IS NULL OR role IN ('user', 'admin', 'field_engineer', 'contractor', 'lgu'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not update profiles_role_check: %', SQLERRM;
END $$;

-- 4) create_lgu_profile RPC (SECURITY DEFINER + row_security off)
CREATE OR REPLACE FUNCTION public.create_lgu_profile(
  user_id uuid,
  user_email text,
  user_name text DEFAULT '',
  user_phone text DEFAULT '',
  user_municipality text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  has_municipality boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'municipality'
  ) INTO has_municipality;

  IF has_municipality THEN
    INSERT INTO public.profiles (id, email, full_name, phone, role, municipality, created_at)
    VALUES (
      user_id,
      user_email,
      user_name,
      user_phone,
      'lgu',
      NULLIF(trim(coalesce(user_municipality, '')), ''),
      now()
    )
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email,
          full_name = EXCLUDED.full_name,
          phone = EXCLUDED.phone,
          role = 'lgu',
          municipality = COALESCE(EXCLUDED.municipality, public.profiles.municipality);
  ELSE
    INSERT INTO public.profiles (id, email, full_name, phone, role, created_at)
    VALUES (
      user_id,
      user_email,
      user_name,
      user_phone,
      'lgu',
      now()
    )
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email,
          full_name = EXCLUDED.full_name,
          phone = EXCLUDED.phone,
          role = 'lgu';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_lgu_profile(uuid, text, text, text, text) TO authenticated;

-- 5) Optional repair: sync existing auth users with metadata role=lgu into profiles
UPDATE public.profiles p
SET role = 'lgu'
FROM auth.users u
WHERE p.id = u.id
  AND lower(coalesce(u.raw_user_meta_data->>'role', '')) = 'lgu'
  AND p.role <> 'lgu';
