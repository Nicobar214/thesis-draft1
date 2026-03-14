-- ============================================================
-- KalsaTrack – Contractor Role Migration
-- Run this in the Supabase SQL Editor (single execution)
-- ============================================================

-- 1. Add contractor_id to fmr_projects
ALTER TABLE fmr_projects
  ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES auth.users(id) NULL;

-- 2. Add contractor remark columns to public_reports
ALTER TABLE public_reports
  ADD COLUMN IF NOT EXISTS contractor_remark text NULL,
  ADD COLUMN IF NOT EXISTS contractor_remark_at timestamptz NULL;

-- 3. Create progress_updates table
CREATE TABLE IF NOT EXISTS progress_updates (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  fmr_project_id          bigint NOT NULL REFERENCES fmr_projects(id) ON DELETE CASCADE,
  contractor_id           uuid NOT NULL REFERENCES auth.users(id),
  reported_accomplishment numeric NOT NULL,
  remarks                 text,
  photo_url               text,
  status                  text NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  submitted_at            timestamptz NOT NULL DEFAULT now(),
  reviewed_at             timestamptz,
  reviewed_by             uuid REFERENCES auth.users(id)
);

-- 4. Enable RLS
ALTER TABLE progress_updates ENABLE ROW LEVEL SECURITY;

-- ── RLS: fmr_projects ──────────────────────────────────────

-- Contractors can SELECT their assigned projects
DROP POLICY IF EXISTS "contractors_select_own_fmr_projects" ON fmr_projects;
CREATE POLICY "contractors_select_own_fmr_projects"
  ON fmr_projects
  FOR SELECT
  TO authenticated
  USING (contractor_id = auth.uid());

-- ── RLS: progress_updates ──────────────────────────────────

-- Contractors can INSERT their own progress updates
DROP POLICY IF EXISTS "contractors_insert_progress_updates" ON progress_updates;
CREATE POLICY "contractors_insert_progress_updates"
  ON progress_updates
  FOR INSERT
  TO authenticated
  WITH CHECK (contractor_id = auth.uid());

-- Contractors can SELECT their own progress updates
DROP POLICY IF EXISTS "contractors_select_own_progress_updates" ON progress_updates;
CREATE POLICY "contractors_select_own_progress_updates"
  ON progress_updates
  FOR SELECT
  TO authenticated
  USING (contractor_id = auth.uid());

-- Admin can SELECT all progress updates
DROP POLICY IF EXISTS "admin_select_all_progress_updates" ON progress_updates;
CREATE POLICY "admin_select_all_progress_updates"
  ON progress_updates
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- Admin can UPDATE progress updates (approve / reject)
DROP POLICY IF EXISTS "admin_update_progress_updates" ON progress_updates;
CREATE POLICY "admin_update_progress_updates"
  ON progress_updates
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- ── RLS: public_reports (contractor policies) ───────────────

-- Contractors can SELECT public_reports for their projects
DROP POLICY IF EXISTS "contractors_select_own_public_reports" ON public_reports;
CREATE POLICY "contractors_select_own_public_reports"
  ON public_reports
  FOR SELECT
  TO authenticated
  USING (
    project_id::text IN (
      SELECT 'fmr-' || id::text
      FROM fmr_projects
      WHERE contractor_id = auth.uid()
    )
  );

-- Contractors can UPDATE contractor_remark / contractor_remark_at only
DROP POLICY IF EXISTS "contractors_update_remark_public_reports" ON public_reports;
CREATE POLICY "contractors_update_remark_public_reports"
  ON public_reports
  FOR UPDATE
  TO authenticated
  USING (
    project_id::text IN (
      SELECT 'fmr-' || id::text
      FROM fmr_projects
      WHERE contractor_id = auth.uid()
    )
  )
  WITH CHECK (
    project_id::text IN (
      SELECT 'fmr-' || id::text
      FROM fmr_projects
      WHERE contractor_id = auth.uid()
    )
  );

-- ── Storage bucket for progress photos ────────────────────
-- Run this if the bucket doesn't exist yet:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('progress-photos', 'progress-photos', true)
-- ON CONFLICT (id) DO NOTHING;
