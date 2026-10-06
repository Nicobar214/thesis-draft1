-- ============================================================
-- ROLLBACK: restore the previous farmer locations (puts them back in the sea)
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

-- Safe to re-run. Roll back with supabase_fix_leon_farmer_locations_rollback.sql
-- ============================================================

begin;

update public.farmer_beneficiaries f
set farm_latitude = v.lat,
    farm_longitude = v.lng,
    benefit_reason = v.reason
from (values
  ('06-30-28-080-000029', 10.944873::double precision, 122.37621::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 18.49 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-080-000073', 10.947266::double precision, 122.378028::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 18.75 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-080-000089', 10.945023::double precision, 122.376647::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 18.51 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-080-000087', 10.946331::double precision, 122.374754::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 18.67 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-080-000085', 10.947643::double precision, 122.373756::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 18.82 km to Leon Public Market -- recommended route for hauling mung bean produce.$br$),
  ('06-30-28-080-000034', 10.945782::double precision, 122.373513::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 18.62 km to Leon Public Market -- recommended route for hauling mango produce.$br$),
  ('06-30-28-080-000189', 10.944919::double precision, 122.376816::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 18.49 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-080-000037', 10.945925::double precision, 122.374989::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 18.62 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-080-000041', 10.948318::double precision, 122.375166::double precision, $br$Nearest farm-to-market road: "Talacu-an-Takasi-Panginman Road" (Brgy. Talacuan, 0.81 km, Completed). This route is paved and market-ready, approx. 18.89 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-012-000070', 10.655261::double precision, 122.275063::double precision, $br$No FMR road project is on record yet for Brgy. Baje. Straight-line distance to Leon Public Market is approx. 18.56 km; recommend a road inventory survey and FMR funding proposal for this barangay to secure a reliable route for hauling rice.$br$),
  ('06-30-28-012-000009', 10.656036::double precision, 122.275599::double precision, $br$No FMR road project is on record yet for Brgy. Baje. Straight-line distance to Leon Public Market is approx. 18.46 km; recommend a road inventory survey and FMR funding proposal for this barangay to secure a reliable route for hauling rice.$br$),
  ('06-30-28-012-000080', 10.65466::double precision, 122.275517::double precision, $br$No FMR road project is on record yet for Brgy. Baje. Straight-line distance to Leon Public Market is approx. 18.58 km; recommend a road inventory survey and FMR funding proposal for this barangay to secure a reliable route for hauling rice.$br$),
  ('06-30-28-012-000060', 10.652502::double precision, 122.275104::double precision, $br$No FMR road project is on record yet for Brgy. Baje. Straight-line distance to Leon Public Market is approx. 18.79 km; recommend a road inventory survey and FMR funding proposal for this barangay to secure a reliable route for hauling rice.$br$),
  ('06-30-28-012-000067', 10.65318::double precision, 122.274777::double precision, $br$No FMR road project is on record yet for Brgy. Baje. Straight-line distance to Leon Public Market is approx. 18.76 km; recommend a road inventory survey and FMR funding proposal for this barangay to secure a reliable route for hauling rice.$br$),
  ('06-30-28-012-000081', 10.653327::double precision, 122.27564::double precision, $br$No FMR road project is on record yet for Brgy. Baje. Straight-line distance to Leon Public Market is approx. 18.68 km; recommend a road inventory survey and FMR funding proposal for this barangay to secure a reliable route for hauling rice.$br$),
  ('06-30-28-073-000013', 10.6125::double precision, 122.366287::double precision, $br$Nearest farm-to-market road: "Salngan Road" (Brgy. Salngan, 1.12 km, Completed). This route is paved and market-ready, approx. 18.68 km to Leon Public Market -- recommended route for hauling other leafy vegetables produce.$br$),
  ('06-30-28-073-000009', 10.614133::double precision, 122.364449::double precision, $br$Nearest farm-to-market road: "Salngan Road" (Brgy. Salngan, 1.12 km, Completed). This route is paved and market-ready, approx. 18.53 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-073-000121', 10.614775::double precision, 122.36862::double precision, $br$Nearest farm-to-market road: "Salngan Road" (Brgy. Salngan, 1.12 km, Completed). This route is paved and market-ready, approx. 18.40 km to Leon Public Market -- recommended route for hauling rice produce.$br$),
  ('06-30-28-084-000121', 10.612643::double precision, 122.367008::double precision, $br$Nearest farm-to-market road: "Tunguan-Lampaya Road" (Brgy. Tunguan, 1.5 km, Completed). This route is paved and market-ready, approx. 18.66 km to Leon Public Market -- recommended route for hauling corn produce.$br$)
) as v(rsbsa, lat, lng, reason)
where f.rsbsa_number = v.rsbsa
  and f.municipality ilike 'leon';

update public.farmer_beneficiaries
set farm_latitude = 9.62241414292481,
    farm_longitude = 123.487648329182,
    distance_to_fmr_km = 173.35,
    service_area = 'For proximity verification',
    benefit_reason = 'For proximity verification; farm access depends on linked FMR route.'
where id = '7201a3ae-627c-4f68-810a-fd7599e14aa7'
  and rsbsa_number = 'RSBSA-06-119145';

commit;
