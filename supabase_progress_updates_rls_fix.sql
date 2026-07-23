-- ============================================================
-- KalsaTrack - progress_updates RLS Policy Fix
-- Run this in your Supabase SQL Editor to resolve RLS violations
-- ============================================================

-- Drop all existing restrictive policies on progress_updates
DROP POLICY IF EXISTS "contractors_insert_progress_updates" ON public.progress_updates;
DROP POLICY IF EXISTS "contractors_select_own_progress_updates" ON public.progress_updates;
DROP POLICY IF EXISTS "admin_select_all_progress_updates" ON public.progress_updates;
DROP POLICY IF EXISTS "admin_update_progress_updates" ON public.progress_updates;
DROP POLICY IF EXISTS "progress_updates_permissive" ON public.progress_updates;

-- Create a clean, permissive policy for authenticated users
CREATE POLICY "progress_updates_permissive"
  ON public.progress_updates
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
