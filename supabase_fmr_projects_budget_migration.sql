-- ============================================================
-- KalsaTrack – Add real budget tracking to fmr_projects
-- Run this in the Supabase SQL Editor on existing projects
-- ============================================================

-- fmr_projects previously had no structured budget data — the admin "Add
-- Project" form collected Total Budget / Funding Source / Disbursed Amount
-- but only ever wrote them into the free-text `remarks` column. These columns
-- make that data real and queryable. All nullable: when an admin hasn't
-- entered a confirmed figure yet, the app computes a labeled estimate instead
-- (see src/lib/budgetEstimate.js) rather than treating blank as zero.

ALTER TABLE public.fmr_projects
  ADD COLUMN IF NOT EXISTS total_budget NUMERIC,
  ADD COLUMN IF NOT EXISTS funds_released NUMERIC,
  ADD COLUMN IF NOT EXISTS funding_source TEXT;
