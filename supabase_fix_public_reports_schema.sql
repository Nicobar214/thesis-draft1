-- ============================================================
-- KalsaTrack – Fix public_reports schema for live report submission
-- Run this in the Supabase SQL Editor on existing databases
-- ============================================================

-- The frontend stores project IDs in the format fmr-<id> and submits a
-- structured category field. Older databases may still have project_id as
-- BIGINT and may be missing the category column entirely.

DO $$
BEGIN
  ALTER TABLE public.public_reports
    ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add category column: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE public.public_reports DROP CONSTRAINT IF EXISTS public_reports_category_check;
  ALTER TABLE public.public_reports
    ADD CONSTRAINT public_reports_category_check
    CHECK (category IN ('issue', 'safety', 'flood', 'general'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not update category constraint: %', SQLERRM;
END $$;

DO $$
DECLARE
  project_id_type text;
BEGIN
  SELECT data_type INTO project_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'public_reports'
    AND column_name = 'project_id';

  IF project_id_type IS NOT NULL AND project_id_type <> 'text' THEN
    -- Drop ALL RLS policies that reference project_id so the type change is allowed
    DROP POLICY IF EXISTS "contractors_select_own_public_reports" ON public.public_reports;
    DROP POLICY IF EXISTS "contractors_update_remark_public_reports" ON public.public_reports;

    ALTER TABLE public.public_reports
      ALTER COLUMN project_id TYPE TEXT
      USING CASE
        WHEN project_id IS NULL THEN ''
        ELSE 'fmr-' || project_id::text
      END;

    -- Recreate both policies using the new TEXT column (no ::text cast required)
    CREATE POLICY "contractors_select_own_public_reports"
      ON public.public_reports
      FOR SELECT
      TO authenticated
      USING (
        project_id IN (
          SELECT 'fmr-' || id::text
          FROM public.fmr_projects
          WHERE contractor_id = auth.uid()
        )
      );

    CREATE POLICY "contractors_update_remark_public_reports"
      ON public.public_reports
      FOR UPDATE
      TO authenticated
      USING (
        project_id IN (
          SELECT 'fmr-' || id::text
          FROM public.fmr_projects
          WHERE contractor_id = auth.uid()
        )
      )
      WITH CHECK (
        project_id IN (
          SELECT 'fmr-' || id::text
          FROM public.fmr_projects
          WHERE contractor_id = auth.uid()
        )
      );
  END IF;
END $$;

UPDATE public.public_reports
SET category = CASE
  WHEN lower(description) ~ '(flood|baha|drainage|tubig)' THEN 'flood'
  WHEN lower(description) ~ '(safety|aksidente|danger|peligro)' THEN 'safety'
  WHEN lower(description) ~ '(issue|damage|lubak|sira|road|daan|infrastructure)' THEN 'issue'
  ELSE 'general'
END
WHERE category IS NULL
   OR category NOT IN ('issue', 'safety', 'flood', 'general');

DO $$ BEGIN
  ALTER TABLE public.public_reports ALTER COLUMN project_id SET DEFAULT '';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;