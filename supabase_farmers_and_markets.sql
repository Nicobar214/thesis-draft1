-- SQL Migration: Farmer Beneficiaries Enhancements and Market Locations
-- Run this in your Supabase SQL Editor to apply database changes.

-- 1. Create market_locations table
CREATE TABLE IF NOT EXISTS public.market_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_name TEXT NOT NULL,
  market_type TEXT CHECK (market_type IN ('Public Market', 'Trading Post', 'Collection Center', 'Warehouse', 'Others')),
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  municipality TEXT NOT NULL,
  barangay TEXT,
  province TEXT DEFAULT 'Iloilo',
  operating_days TEXT,
  operating_hours TEXT,
  commodities_accepted TEXT[] DEFAULT '{}'::TEXT[],
  contact_person TEXT,
  contact_number TEXT,
  remarks TEXT,
  created_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_role TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS for market_locations
ALTER TABLE public.market_locations ENABLE ROW LEVEL SECURITY;

-- Set up RLS Policies for market_locations
-- Select: authenticated users can read all market locations (citizens, LGUs, and admins need to see them on maps)
CREATE POLICY market_locations_select_all
  ON public.market_locations FOR SELECT
  TO authenticated, anon
  USING (true);

-- Insert: LGU and Admin users can create market locations
CREATE POLICY market_locations_insert_auth
  ON public.market_locations FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_profile_role() IN ('lgu', 'admin')
  );

-- Update: LGUs can update markets they created or admins can update any
CREATE POLICY market_locations_update_auth
  ON public.market_locations FOR UPDATE
  TO authenticated
  USING (
    created_by_user_id = auth.uid()
    OR public.current_profile_role() = 'admin'
  )
  WITH CHECK (
    created_by_user_id = auth.uid()
    OR public.current_profile_role() = 'admin'
  );

-- Delete: Admins only can delete markets
CREATE POLICY market_locations_delete_admin
  ON public.market_locations FOR DELETE
  TO authenticated
  USING (
    public.current_profile_role() = 'admin'
  );

-- Enable Realtime for market_locations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'market_locations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_locations;
  END IF;
END $$;


-- 2. Alter farmer_beneficiaries to add missing RSBSA and spatial/linkage fields
ALTER TABLE public.farmer_beneficiaries 
  ADD COLUMN IF NOT EXISTS control_no TEXT,
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS middle_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS ext_name TEXT,
  ADD COLUMN IF NOT EXISTS birthday DATE,
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS agency TEXT DEFAULT 'DA',
  ADD COLUMN IF NOT EXISTS farm_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS farm_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS nearest_market_id UUID REFERENCES public.market_locations(id) ON DELETE SET NULL;

-- Create spatial search indexes for performance
CREATE INDEX IF NOT EXISTS idx_farmer_beneficiaries_farm_coords ON public.farmer_beneficiaries(farm_latitude, farm_longitude);
CREATE INDEX IF NOT EXISTS idx_market_locations_coords ON public.market_locations(latitude, longitude);
