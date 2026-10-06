-- ============================================================
-- Fix farmer locations that fell outside Leon
--
-- Some farmer beneficiaries were plotted outside Leon, several of them in the
-- sea off Guimbal and Tigbauan. Cause: when the one-off geocoder
-- (scripts/geocode_leon_farmers.cjs) could not find a barangay on
-- OpenStreetMap it silently used a placeholder spot, and 4 barangays fell back
-- to it. One manually registered farmer also carries a bad GPS reading.
--
-- Corrected barangay locations (scripts/barangay_geocode_cache.json):
--   Talacuan  10.7744, 122.3894   OSM place node 'Talacu-an'
--   Salngan   10.7824, 122.3646   OSM place node 'Salngan' (the other node is outside Leon)
--   Tunguan   10.8708, 122.3339   nearest OSM 'Tunguan' node; matches its road names
--   Baje      10.7853, 122.3406   NO OSM place exists. Estimated from the end point of
--                                 Avanzada-Baje Road. Treat as approximate.
-- Farmers keep the same small per-farmer offset (about 250 m) as before, so they do
-- not stack on one point. Only coordinates and the market-distance text change.
--
-- 19 CSV-imported farmers (Talacuan 9, Baje 6, Salngan 3, Tunguan 1) plus 1 manual
-- registration in Agboy Norte (RSBSA-06-119145, was at 9.62N 123.49E, 173 km away).
-- Safe to re-run. Roll back with supabase_fix_leon_farmer_locations_rollback.sql
-- ============================================================

begin;

update public.farmer_beneficiaries f
set farm_latitude = v.lat,
    farm_longitude = v.lng,
    benefit_reason = v.reason
from (values
  ('06-30-28-080-000029', 10.772168::double precision, 122.390151::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 0.77 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-080-000073', 10.774562::double precision, 122.391969::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 0.59 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-080-000089', 10.772318::double precision, 122.390588::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 0.76 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-080-000087', 10.773626::double precision, 122.388695::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 0.60 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-080-000085', 10.774938::double precision, 122.387697::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 0.48 km to Leon Public Market -- recommended route for hauling mung bean produce.$br$),
  ('06-30-28-080-000034', 10.773077::double precision, 122.387454::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 0.69 km to Leon Public Market -- recommended route for hauling mango produce.$br$),
  ('06-30-28-080-000189', 10.772214::double precision, 122.390757::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 0.78 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-080-000037', 10.77322::double precision, 122.38893::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 0.65 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-080-000041', 10.775613::double precision, 122.389107::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 0.38 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-012-000070', 10.785816::double precision, 122.341387::double precision, $br$No FMR road project is on record yet for Brgy. Baje. Straight-line distance to Leon Public Market is approx. 5.26 km; recommend a road inventory survey and FMR funding proposal for this barangay to secure a reliable route for hauling rice.$br$),
  ('06-30-28-012-000009', 10.786592::double precision, 122.341923::double precision, $br$No FMR road project is on record yet for Brgy. Baje. Straight-line distance to Leon Public Market is approx. 5.22 km; recommend a road inventory survey and FMR funding proposal for this barangay to secure a reliable route for hauling rice.$br$),
  ('06-30-28-012-000080', 10.785215::double precision, 122.341842::double precision, $br$No FMR road project is on record yet for Brgy. Baje. Straight-line distance to Leon Public Market is approx. 5.21 km; recommend a road inventory survey and FMR funding proposal for this barangay to secure a reliable route for hauling rice.$br$),
  ('06-30-28-012-000060', 10.783057::double precision, 122.341429::double precision, $br$No FMR road project is on record yet for Brgy. Baje. Straight-line distance to Leon Public Market is approx. 5.22 km; recommend a road inventory survey and FMR funding proposal for this barangay to secure a reliable route for hauling rice.$br$),
  ('06-30-28-012-000067', 10.783736::double precision, 122.341102::double precision, $br$No FMR road project is on record yet for Brgy. Baje. Straight-line distance to Leon Public Market is approx. 5.27 km; recommend a road inventory survey and FMR funding proposal for this barangay to secure a reliable route for hauling rice.$br$),
  ('06-30-28-012-000081', 10.783883::double precision, 122.341965::double precision, $br$No FMR road project is on record yet for Brgy. Baje. Straight-line distance to Leon Public Market is approx. 5.18 km; recommend a road inventory survey and FMR funding proposal for this barangay to secure a reliable route for hauling rice.$br$),
  ('06-30-28-073-000013', 10.78086::double precision, 122.364033::double precision, $br$Nearest farm-to-market road: "Salngan Road" (Brgy. Salngan, 1.12 km, Completed). This route is paved and market-ready, approx. 2.74 km to Leon Public Market -- recommended route for hauling other leafy vegetables produce.$br$),
  ('06-30-28-073-000009', 10.782493::double precision, 122.362195::double precision, $br$Nearest farm-to-market road: "Salngan Road" (Brgy. Salngan, 1.12 km, Completed). This route is paved and market-ready, approx. 2.96 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-073-000121', 10.783134::double precision, 122.366365::double precision, $br$Nearest farm-to-market road: "Salngan Road" (Brgy. Salngan, 1.12 km, Completed). This route is paved and market-ready, approx. 2.52 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-084-000121', 10.869373::double precision, 122.33407::double precision, $br$Nearest farm-to-market road: "Tunguan-Lampaya Road" (Brgy. Tunguan, 1.5 km, Completed). This route is paved and market-ready, approx. 11.71 km to Leon Public Market -- recommended route for hauling corn produce.$br$)
) as v(rsbsa, lat, lng, reason)
where f.rsbsa_number = v.rsbsa
  and f.municipality ilike 'leon';

update public.farmer_beneficiaries
set farm_latitude = 10.775264,
    farm_longitude = 122.419194,
    distance_to_fmr_km = 0.15,
    service_area = 'Within primary service area',
    benefit_reason = 'Within primary service area; farm access depends on linked FMR route.'
where id = '7201a3ae-627c-4f68-810a-fd7599e14aa7'
  and rsbsa_number = 'RSBSA-06-119145';

do $$
declare n integer;
begin
  select count(*) into n from public.farmer_beneficiaries
  where municipality ilike 'leon'
    and (farm_latitude not between 10.70 and 10.95 or farm_longitude not between 122.25 and 122.45);
  if n > 0 then
    raise exception '% Leon farmers are still outside the Leon bounding box; rolling back', n;
  end if;
end $$;

commit;
