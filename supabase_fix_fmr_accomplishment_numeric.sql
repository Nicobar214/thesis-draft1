-- ============================================================
-- KalsaTrack – Fix FMR accomplishment type
-- Run this in the Supabase SQL Editor on existing projects
-- ============================================================

-- Contractor updates allow decimal percentages such as 1.2 or 37.5.
-- The original fmr_projects schema used INTEGER, which causes admin approval
-- to fail when writing approved decimal values back to the project record.

ALTER TABLE public.fmr_projects
  ALTER COLUMN accomplishment TYPE NUMERIC(5,2)
  USING accomplishment::NUMERIC(5,2);

ALTER TABLE public.fmr_projects
  ALTER COLUMN accomplishment SET DEFAULT 0;