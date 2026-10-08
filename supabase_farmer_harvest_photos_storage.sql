-- ============================================================
-- Farmer My Harvest — private storage bucket for harvest photos
--
-- Modeled on the `progress-photos` bucket/policies
-- (supabase_final_workflow_security_hardening.sql), NOT on
-- `public-report-photos`: harvest photos are private production
-- records, not public safety evidence, so the bucket is not public and
-- every policy is scoped by path-encoded ownership rather than USING (true).
--
-- Path convention: harvests/<farmer_user_id>/<timestamp>-<rand>.jpg
-- Read back with a SIGNED url (the bucket is private), not getPublicUrl.
--
-- Depends on public.current_profile_role(), already defined in
-- supabase_farmer_beneficiaries_migration.sql.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('farmer-harvest-photos', 'farmer-harvest-photos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS farmer_harvest_photos_insert_own ON storage.objects;
DROP POLICY IF EXISTS farmer_harvest_photos_select_own_or_staff ON storage.objects;
DROP POLICY IF EXISTS farmer_harvest_photos_delete_own ON storage.objects;

CREATE POLICY farmer_harvest_photos_insert_own
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'farmer-harvest-photos'
    AND public.current_profile_role() = 'farmer'
    AND (storage.foldername(name))[1] = 'harvests'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY farmer_harvest_photos_select_own_or_staff
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'farmer-harvest-photos'
    AND (
      public.current_profile_role() IN ('admin', 'lgu')
      OR (storage.foldername(name))[2] = auth.uid()::text
    )
  );

CREATE POLICY farmer_harvest_photos_delete_own
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'farmer-harvest-photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Verification (run after applying, as the farmer_user_id you're testing with):
-- SELECT name FROM storage.objects WHERE bucket_id = 'farmer-harvest-photos';
-- SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE 'farmer_harvest_photos%';
