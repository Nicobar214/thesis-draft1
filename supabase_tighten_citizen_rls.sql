-- Tighten two over-broad RLS policies found in the citizen-isolation review.
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- 1) feedbacks: "Authenticated users can update feedbacks" was USING (true), so any
--    signed-in citizen could edit anyone's feedback. Now only the author or an admin
--    (the admin portal changes feedback status) can update.
-- 2) profiles: "Authenticated can view profiles" was USING (true), so a citizen could
--    read every user's name, email and phone. Now a user sees their own row; staff
--    roles still see all rows (they look up engineers, LGUs and contractors); and admin
--    rows stay visible to everyone because several screens look up admins to notify them.

-- ---------------------------------------------------------------- feedbacks
DROP POLICY IF EXISTS "Authenticated users can update feedbacks" ON public.feedbacks;
DROP POLICY IF EXISTS "feedbacks_update_owner_or_admin" ON public.feedbacks;

CREATE POLICY "feedbacks_update_owner_or_admin"
  ON public.feedbacks
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR public.current_profile_role() = 'admin' OR public.is_admin_jwt())
  WITH CHECK (auth.uid() = user_id OR public.current_profile_role() = 'admin' OR public.is_admin_jwt());

-- ----------------------------------------------------------------- profiles
DROP POLICY IF EXISTS "Authenticated can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_scoped" ON public.profiles;

CREATE POLICY "profiles_select_scoped"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR role = 'admin'
    OR public.is_admin_jwt()
    OR public.current_profile_role() IN ('admin', 'lgu', 'field_engineer', 'contractor')
  );

-- Verify (expected: a citizen sees 1 row + the admins; staff see all):
--   select policyname, cmd, qual from pg_policies
--   where schemaname = 'public' and tablename in ('feedbacks', 'profiles');

-- Rollback:
--   DROP POLICY "feedbacks_update_owner_or_admin" ON public.feedbacks;
--   CREATE POLICY "Authenticated users can update feedbacks" ON public.feedbacks FOR UPDATE TO authenticated USING (true);
--   DROP POLICY "profiles_select_scoped" ON public.profiles;
--   CREATE POLICY "Authenticated can view profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
