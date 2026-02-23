-- ============================================================
-- Migration: Add user_id column to public_reports
-- Links reports to authenticated user accounts so registered
-- users can see their own reports in /user/reports.
-- Run this SQL in your Supabase SQL Editor.
-- ============================================================

-- 1. Add user_id column (nullable – anonymous reports won't have it)
ALTER TABLE public.public_reports
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Create index for faster user-specific queries
CREATE INDEX IF NOT EXISTS idx_public_reports_user_id
  ON public.public_reports (user_id);

-- 3. Add RLS policy so users can read their own reports
-- (existing policies already let authenticated users read all,
--  but this makes the intent explicit)
CREATE POLICY "Users can view their own reports"
  ON public.public_reports
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
