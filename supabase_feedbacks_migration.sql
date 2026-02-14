-- ============================================================
-- Supabase Migration: Feedbacks table + Storage bucket
-- Run this SQL in your Supabase SQL Editor
-- ============================================================

-- 1. Create the feedbacks table
CREATE TABLE IF NOT EXISTS public.feedbacks (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email    TEXT,
  project_id    BIGINT,
  project_name  TEXT,
  type          TEXT NOT NULL DEFAULT 'issue'
                  CHECK (type IN ('issue', 'suggestion', 'compliment', 'concern')),
  message       TEXT NOT NULL,
  photo_urls    TEXT[] DEFAULT '{}',
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  geo_accuracy  DOUBLE PRECISION,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'reviewed', 'resolved')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- 2. Enable Row Level Security
ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
-- Anyone authenticated can insert their own feedback
CREATE POLICY "Users can insert own feedback"
  ON public.feedbacks
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Anyone authenticated can view all feedbacks (public transparency)
CREATE POLICY "Anyone can view feedbacks"
  ON public.feedbacks
  FOR SELECT
  TO authenticated
  USING (true);

-- Users can update only their own feedback
CREATE POLICY "Users can update own feedback"
  ON public.feedbacks
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can delete only their own feedback
CREATE POLICY "Users can delete own feedback"
  ON public.feedbacks
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 4. Enable Realtime for the feedbacks table
ALTER PUBLICATION supabase_realtime ADD TABLE public.feedbacks;

-- 5. Create the storage bucket for feedback photos
INSERT INTO storage.buckets (id, name, public) 
VALUES ('feedback-photos', 'feedback-photos', true)
ON CONFLICT (id) DO NOTHING;

-- 6. Storage policies - allow authenticated users to upload
CREATE POLICY "Authenticated users can upload feedback photos"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'feedback-photos');

-- Allow public read access to feedback photos
CREATE POLICY "Public read access for feedback photos"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'feedback-photos');
