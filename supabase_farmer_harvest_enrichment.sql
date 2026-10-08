-- ============================================================
-- Farmer My Harvest — enrich farmer_harvest_logs
--
-- Adds the fields needed for a real per-harvest record (area, grade,
-- photo) and closes a data-integrity gap: quantity_kg and the new area_ha
-- were only ever validated client-side. No RLS changes — the existing
-- farmer_harvest_logs_insert_auth / update_auth / delete_auth policies
-- (farmer_id = auth.uid(), or lgu/admin) already cover these new columns.
-- ============================================================

ALTER TABLE public.farmer_harvest_logs
  ADD COLUMN IF NOT EXISTS area_ha numeric(8,2),
  ADD COLUMN IF NOT EXISTS quality_grade text,
  ADD COLUMN IF NOT EXISTS photo_path text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.farmer_harvest_logs.area_ha IS
  'Hectares actually covered by this harvest event. Defaults in the UI to '
  'farmer_beneficiaries.farm_area_ha but is editable, since one harvest '
  'may not cover the whole farm. Nullable: yield is simply not shown when absent.';
COMMENT ON COLUMN public.farmer_harvest_logs.quality_grade IS
  'Optional self-reported grade (Grade A / Grade B / Grade C / Ungraded).';
COMMENT ON COLUMN public.farmer_harvest_logs.photo_path IS
  'Object path in the private farmer-harvest-photos bucket (not a URL --'
  'the bucket is not public, so the app resolves this to a short-lived '
  'signed URL at render time). See supabase_farmer_harvest_photos_storage.sql.';

-- Was only checked client-side (`if (!qty || qty <= 0)` in FarmerHarvest.jsx).
ALTER TABLE public.farmer_harvest_logs
  ADD CONSTRAINT farmer_harvest_logs_quantity_positive CHECK (quantity_kg > 0),
  ADD CONSTRAINT farmer_harvest_logs_area_positive CHECK (area_ha IS NULL OR area_ha > 0);

-- Verification (run after applying):
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='farmer_harvest_logs' ORDER BY ordinal_position;
-- SELECT conname FROM pg_constraint WHERE conrelid = 'public.farmer_harvest_logs'::regclass;
