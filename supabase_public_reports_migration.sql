-- ============================================================
-- Supabase Migration: public_reports – Location-Verified Reports
-- Region VI → Iloilo only. Supports anonymous GPS-verified
-- camera-captured submissions from the landing page.
-- Run this SQL in your Supabase SQL Editor.
-- ============================================================

-- Drop existing table to rebuild with new schema
DROP TABLE IF EXISTS public.public_reports CASCADE;

-- 1. Create the public_reports table
CREATE TABLE public.public_reports (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Submitter info (optional for anonymity)
  full_name         TEXT DEFAULT 'Anonymous',
  contact_info      TEXT DEFAULT '',

  -- Structured location (Region VI / Iloilo only)
  region            TEXT NOT NULL DEFAULT 'Region VI – Western Visayas',
  province          TEXT NOT NULL DEFAULT 'Iloilo',
  municipality      TEXT NOT NULL,
  barangay          TEXT NOT NULL,
  street            TEXT DEFAULT '',

  -- Linked project
  project_id        BIGINT,                   -- FK to projects.id (nullable in case project is deleted)
  project_name      TEXT NOT NULL DEFAULT '',

  -- Captured photo URL (camera-only, stored in bucket)
  photo_url         TEXT DEFAULT '',

  -- GPS data captured from device
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  geo_accuracy      DOUBLE PRECISION,          -- device accuracy in meters
  photo_timestamp   TIMESTAMPTZ,               -- when photo was taken

  -- Verification (auto-computed on insert)
  verification      TEXT NOT NULL DEFAULT 'Needs Review'
                      CHECK (verification IN (
                        'Verified On-Site',
                        'Needs Review',
                        'Location Mismatch'
                      )),

  -- Feedback content
  description       TEXT NOT NULL,

  -- Submission metadata
  source            TEXT NOT NULL DEFAULT 'Anonymous Public Report',
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'reviewed', 'resolved')),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- 2. Enable Row Level Security
ALTER TABLE public.public_reports ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies --------------------------------------------------

-- Allow ANYONE (including anonymous/anon) to INSERT
CREATE POLICY "Anyone can submit public reports"
  ON public.public_reports
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Authenticated users (admins) can view all
CREATE POLICY "Authenticated users can view public reports"
  ON public.public_reports
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users (admins) can update status / verification
CREATE POLICY "Authenticated users can update public reports"
  ON public.public_reports
  FOR UPDATE
  TO authenticated
  USING (true);

-- Authenticated users can delete
CREATE POLICY "Authenticated users can delete public reports"
  ON public.public_reports
  FOR DELETE
  TO authenticated
  USING (true);

-- 4. Enable Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'public_reports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.public_reports;
  END IF;
END $$;

-- 5. Storage bucket for camera-captured report photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('public-report-photos', 'public-report-photos', true)
ON CONFLICT (id) DO NOTHING;

-- 6. Storage policies
DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone can upload public report photos" ON storage.objects;
  DROP POLICY IF EXISTS "Public read access for report photos" ON storage.objects;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Anonymous + authenticated can upload photos
CREATE POLICY "Anyone can upload public report photos"
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'public-report-photos');

-- Public read access
CREATE POLICY "Public read access for report photos"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'public-report-photos');
