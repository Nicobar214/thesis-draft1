-- ============================================================
-- SQL Migration: Farmer Auth Accounts & Harvest Logging
-- Run this in your Supabase SQL Editor.
-- ============================================================

-- 1. Update public.profiles role constraint to include 'farmer'
DO $$
BEGIN
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IS NULL OR role IN ('user', 'admin', 'field_engineer', 'contractor', 'lgu', 'farmer'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not update role constraint: %', SQLERRM;
END $$;

-- 2. Link farmer_beneficiaries to public.profiles via user_id
ALTER TABLE public.farmer_beneficiaries 
  ADD COLUMN IF NOT EXISTS user_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 3. Create harvest logs table for historical analytics
CREATE TABLE IF NOT EXISTS public.farmer_harvest_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  crop TEXT NOT NULL,
  quantity_kg NUMERIC(12,2) NOT NULL,
  harvest_date DATE NOT NULL DEFAULT CURRENT_DATE,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS for farmer_harvest_logs
ALTER TABLE public.farmer_harvest_logs ENABLE ROW LEVEL SECURITY;

-- 4. Set up RLS Policies for farmer_harvest_logs
-- Select: Any authenticated user (farmers, LGUs, Admins) can read logs
CREATE POLICY farmer_harvest_logs_select_all
  ON public.farmer_harvest_logs FOR SELECT
  TO authenticated
  USING (true);

-- Insert: Farmers can log their own harvest, or LGUs/Admins can log on their behalf
CREATE POLICY farmer_harvest_logs_insert_auth
  ON public.farmer_harvest_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    farmer_id = auth.uid()
    OR public.current_profile_role() IN ('lgu', 'admin')
  );

-- Update: Farmers can edit their own logs, or LGUs/Admins can edit
CREATE POLICY farmer_harvest_logs_update_auth
  ON public.farmer_harvest_logs FOR UPDATE
  TO authenticated
  USING (
    farmer_id = auth.uid()
    OR public.current_profile_role() IN ('lgu', 'admin')
  )
  WITH CHECK (
    farmer_id = auth.uid()
    OR public.current_profile_role() IN ('lgu', 'admin')
  );

-- Delete: Farmers, LGUs, and Admins can delete logs
CREATE POLICY farmer_harvest_logs_delete_auth
  ON public.farmer_harvest_logs FOR DELETE
  TO authenticated
  USING (
    farmer_id = auth.uid()
    OR public.current_profile_role() IN ('lgu', 'admin')
  );

-- 5. Set up RLS Policies update for farmer_beneficiaries to allow the linked farmer to read/edit their contact number
CREATE POLICY farmer_beneficiaries_select_self
  ON public.farmer_beneficiaries FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_profile_role() IN ('lgu', 'admin')
  );

CREATE POLICY farmer_beneficiaries_update_self
  ON public.farmer_beneficiaries FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_profile_role() IN ('lgu', 'admin')
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.current_profile_role() IN ('lgu', 'admin')
  );

-- Enable Realtime for farmer_harvest_logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'farmer_harvest_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.farmer_harvest_logs;
  END IF;
END $$;
