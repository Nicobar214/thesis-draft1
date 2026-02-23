-- Allow anonymous (public / unauthenticated) users to read public_reports
-- AND projects (needed for the report form's location → project lookup).
-- Run this in Supabase SQL Editor so the /reports page can fetch data.

-- 1. Anon can view public reports
CREATE POLICY "Anon users can view public reports"
  ON public.public_reports
  FOR SELECT
  TO anon
  USING (true);

-- 2. Anon can view projects (so the report form can list matching projects)
CREATE POLICY "Anon users can view projects"
  ON public.projects
  FOR SELECT
  TO anon
  USING (true);
