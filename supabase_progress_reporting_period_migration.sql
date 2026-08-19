-- ============================================================
-- KalsaTrack – Monthly progress reporting: period, scope and cost
-- Department of Agriculture - RAED Region VI
-- Run this SQL in your Supabase SQL Editor.
--
-- WHY THIS EXISTS
-- ---------------
-- DA Region VI (WVSU-CICT Questionnaire, items 1-5) states that:
--   * "Formal progress reporting is generally monthly"
--   * DA "compares the verified physical accomplishment (%) with the
--      financial disbursement/payment (%) through progress reports,
--      billing documents, S-curves, and site validation"
--   * "Payments are generally based on verified actual physical
--      accomplishment, not merely the passage of time"
--
-- Today `progress_updates` records a single accomplishment % with NO
-- reporting period and NO peso amount, so a monthly series cannot be
-- built and physical progress cannot be compared against money at all.
-- `project_tasks` has planned_start/planned_end (the time axis) but no
-- weight, so there is no planned curve to compare actuals against.
--
-- Every change here is ADDITIVE and nullable. Existing rows keep working
-- untouched; the app treats NULL as "not reported in this format yet"
-- rather than as zero.
-- ============================================================

-- 1. progress_updates: reporting period, billed amount, scope of work ------
--
-- period_start/period_end are proper DATE columns (note: the legacy
-- fmr_projects.target_completion_date/date_completed are TEXT -- that
-- quirk is NOT replicated here).
--
-- work_items holds the adviser's "actual scope of work" as a small array of
-- { item, unit, planned_qty, accomplished_qty } objects. JSONB keeps this
-- flexible while the DA pay-item taxonomy is still being confirmed, and
-- matches the existing precedent of supporting_documents/validation_history
-- on farmer_beneficiaries.

ALTER TABLE public.progress_updates
  ADD COLUMN IF NOT EXISTS period_start        DATE,
  ADD COLUMN IF NOT EXISTS period_end          DATE,
  ADD COLUMN IF NOT EXISTS amount_this_billing NUMERIC,
  ADD COLUMN IF NOT EXISTS work_items          JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS remaining_scope     TEXT;

-- Index the period so the monthly series and "overdue submission" checks
-- (DA item 3: the implementing office enforces the required submission)
-- do not table-scan.
CREATE INDEX IF NOT EXISTS idx_progress_updates_period
  ON public.progress_updates(fmr_project_id, period_end DESC);

-- 2. project_tasks: planned weight -----------------------------------------
--
-- The missing piece for a PLANNED S-curve. planned_start/planned_end already
-- give the time axis; planned_weight_pct gives each task its share of the
-- overall physical target, so cumulative planned % can be interpolated over
-- time. Nullable: a project whose tasks carry no weights simply has no
-- planned curve, and the UI says so rather than inventing one.

ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS planned_weight_pct NUMERIC;

-- 3. fmr_projects: contract baseline ---------------------------------------
--
-- Both baselines are currently guessed:
--   * the schedule baseline falls back to created_at (budgetEstimate.js:34)
--   * the money baseline falls back to project_length_km * PHP 15M/km
-- date_started (Notice to Proceed) and contract_amount make them real.
-- total_budget is retained as-is; contract_amount is the awarded contract
-- figure, which is the correct denominator for financial accomplishment %.

ALTER TABLE public.fmr_projects
  ADD COLUMN IF NOT EXISTS date_started    DATE,
  ADD COLUMN IF NOT EXISTS contract_amount NUMERIC;

-- ============================================================
-- Done.
--
-- No RLS changes are needed: progress_updates, project_tasks and
-- fmr_projects already have policies, and adding columns does not alter
-- them. Writes to progress_updates continue to go through the existing
-- SECURITY DEFINER RPCs (approve_progress_update_admin / reject), which is
-- where the real enforcement lives.
--
-- Safe to re-run: every statement is IF NOT EXISTS.
-- ============================================================
