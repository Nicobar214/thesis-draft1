-- Migration: Link feedbacks to public_reports for status syncing
-- Run this in Supabase SQL Editor

-- Add columns to feedbacks table (if they don't exist)
ALTER TABLE public.feedbacks
  ADD COLUMN IF NOT EXISTS public_report_id UUID REFERENCES public.public_reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'user_feedback';

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_feedbacks_public_report_id ON public.feedbacks(public_report_id);
CREATE INDEX IF NOT EXISTS idx_feedbacks_user_id ON public.feedbacks(user_id);
CREATE INDEX IF NOT EXISTS idx_public_reports_user_id ON public.public_reports(user_id);

-- Allow RLS policies on feedbacks for the new columns
-- (adjust according to your existing RLS setup)
