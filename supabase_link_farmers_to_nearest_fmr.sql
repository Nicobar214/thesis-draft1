-- ============================================================
-- Link every farmer beneficiary to an FMR road, and replace the made-up
-- "distance to FMR" with a measured one.
--
-- Why
--   * 112 of 502 farmers had no linked FMR project. The one-off import
--     (scripts/geocode_leon_farmers.cjs) only matched a barangay against some
--     project text fields, so roads named after the barangay
--     (e.g. "Pandan-Buenavista Rd." for Buenavista) were missed.
--   * distance_to_fmr_km was a RANDOM number between 0.1 and 1.5 km (the
--     script itself says "not a measured figure"), and service_area was
--     derived from it.
--
-- What this does (Leon farmers, Leon FMR projects with a mapped route)
--   1. Measures, for each farmer, the distance from the farm point to every
--      FMR route (nearest point on the polyline, not just the endpoints).
--   2. Links each UNLINKED farmer to:
--        a. a road in their own barangay (project barangay / barangay_end, or
--           the barangay named in the project name or location), nearest one
--           first -- unless it is more than 1 km farther than the nearest
--           road overall; otherwise
--        b. among roads within 0.5 km of the nearest one, the road that gives
--           the shortest trip farm -> road -> Leon Public Market.
--   3. Sets distance_to_fmr_km for EVERY farmer to the measured distance to
--      their linked road (or, if that road has no mapped route yet -- e.g. a
--      Proposed project -- to the nearest mapped FMR road they can use today).
--   4. Refreshes linked_project_status from fmr_projects and re-derives
--      service_area from the measured distance (same thresholds as before:
--      <= 0.6 km primary, <= 1.2 km secondary, else proximity verification).
--   5. Rewrites benefit_reason only for the newly linked farmers (their old
--      text said no road was on record).
--
-- Accuracy note: farm points are barangay-level locations (no parcel GPS in
-- the RSBSA source), so distances are approximate -- but measured, not random.
--
-- Existing links are NOT changed. A backup of every changed column is kept in
-- public.farmer_fmr_link_backup; undo with
-- supabase_link_farmers_to_nearest_fmr_rollback.sql. Safe to re-run.
-- ============================================================

begin;

-- 0. Backup (first run only)
create table if not exists public.farmer_fmr_link_backup (
  id uuid primary key,
  linked_project_id text,
  linked_project_name text,
  linked_project_status text,
  distance_to_fmr_km numeric,
  service_area text,
  benefit_reason text,
  backed_up_at timestamptz not null default now()
);
alter table public.farmer_fmr_link_backup enable row level security; -- no policies: admin/service role only

insert into public.farmer_fmr_link_backup (id, linked_project_id, linked_project_name, linked_project_status, distance_to_fmr_km, service_area, benefit_reason)
select id, linked_project_id, linked_project_name, linked_project_status, distance_to_fmr_km, service_area, benefit_reason
from public.farmer_beneficiaries
on conflict (id) do nothing;

-- Working tables are plain session temp tables (not "on commit drop"): the
-- Supabase SQL Editor may commit statement by statement, which would drop an
-- "on commit drop" table before the next step can read it.

-- 1. Route segments in km (local flat projection around Leon, ~10.8 N).
drop table if exists seg;
create temp table seg as
select p.id as pid,
       (a.v->>0)::float8 * 110.574 as y1, (a.v->>1)::float8 * 109.35 as x1,
       (b.v->>0)::float8 * 110.574 as y2, (b.v->>1)::float8 * 109.35 as x2
from public.fmr_projects p
join public.project_routes r on r.project_id = p.id
cross join lateral jsonb_array_elements(r.route_points) with ordinality a(v, i)
join lateral jsonb_array_elements(r.route_points) with ordinality b(v, j) on b.j = a.i + 1
where p.municipality ilike 'leon';

drop table if exists farm;
create temp table farm as
select id,
       lower(trim(barangay)) as brgy,
       farm_latitude * 110.574 as y,
       farm_longitude * 109.35 as x,
       nullif(trim(coalesce(linked_project_id, '')), '') as linked_id,
       (coalesce(trim(linked_project_id), '') = '' and coalesce(trim(linked_project_name), '') = '') as unlinked
from public.farmer_beneficiaries
where municipality ilike 'leon' and farm_latitude is not null and farm_longitude is not null;

-- Farm -> road distance (km), only for roads within ~6 km.
drop table if exists dist;
create temp table dist as
select f.id as fid, s.pid,
       min(sqrt((s.x1 + t * (s.x2 - s.x1) - f.x)^2 + (s.y1 + t * (s.y2 - s.y1) - f.y)^2)) as km
from farm f
join seg s on abs(s.x1 - f.x) < 6 and abs(s.y1 - f.y) < 6
cross join lateral (
  select greatest(0, least(1, case when (s.x2 - s.x1)^2 + (s.y2 - s.y1)^2 = 0 then 0
    else ((f.x - s.x1) * (s.x2 - s.x1) + (f.y - s.y1) * (s.y2 - s.y1)) / ((s.x2 - s.x1)^2 + (s.y2 - s.y1)^2) end)) as t
) tt
group by f.id, s.pid;

-- Road -> Leon Public Market distance (km).
drop table if exists road_market;
create temp table road_market as
select s.pid, min(sqrt((s.x1 + t * (s.x2 - s.x1) - m.x)^2 + (s.y1 + t * (s.y2 - s.y1) - m.y)^2)) as km
from seg s
cross join (select latitude * 110.574 as y, longitude * 109.35 as x
            from public.market_locations where market_name = 'Leon Public Market' limit 1) m
cross join lateral (
  select greatest(0, least(1, case when (s.x2 - s.x1)^2 + (s.y2 - s.y1)^2 = 0 then 0
    else ((m.x - s.x1) * (s.x2 - s.x1) + (m.y - s.y1) * (s.y2 - s.y1)) / ((s.x2 - s.x1)^2 + (s.y2 - s.y1)^2) end)) as t
) tt
group by s.pid;

-- 2. Pick a road for each unlinked farmer.
drop table if exists pick;
create temp table pick as
with cand as (
  select d.fid, d.pid, d.km, f.brgy, coalesce(rm.km, 99) as road_to_market_km,
         (lower(coalesce(p.barangay, '')) = f.brgy
          or lower(coalesce(p.barangay_end, '')) = f.brgy
          or lower(p.project_name || ' ' || coalesce(p.location, ''))
             ~ ('\m' || regexp_replace(f.brgy, '([.*+?^${}()|\[\]\\-])', '\\\1', 'g') || '\M')) as same_brgy,
         min(d.km) over (partition by d.fid) as nearest_km
  from dist d
  join farm f on f.id = d.fid and f.unlinked
  join public.fmr_projects p on p.id = d.pid
  left join road_market rm on rm.pid = d.pid
)
select distinct on (fid) fid, pid, km, same_brgy
from cand
where (same_brgy and km <= nearest_km + 1) or km <= nearest_km + 0.5
order by fid,
         (same_brgy and km <= nearest_km + 1) desc,
         case when same_brgy and km <= nearest_km + 1 then km else km + road_to_market_km end;

update public.farmer_beneficiaries fb
set linked_project_id = p.id::text,
    linked_project_name = p.project_name,
    benefit_reason = format(
      'Nearest farm-to-market road: "%s" (%s), about %s km from this farm. Linked %s. Distance is approximate (barangay-level farm location).',
      p.project_name, p.status, round(pk.km::numeric, 2),
      case when pk.same_brgy then 'as the FMR road serving Brgy. ' || fb.barangay
           else 'as the nearby road with the shortest route to Leon Public Market' end),
    last_updated = now()
from pick pk
join public.fmr_projects p on p.id = pk.pid
where fb.id = pk.fid;

-- 3. Measured distance for every farmer: to the linked road, else nearest mapped road.
update public.farmer_beneficiaries fb
set distance_to_fmr_km = round(coalesce(linked.km, nearest.km)::numeric, 2)
from farm f
left join lateral (select d.km from dist d where d.fid = f.id and d.pid::text = (
                     select nullif(trim(linked_project_id), '') from public.farmer_beneficiaries x where x.id = f.id)) linked on true
left join lateral (select min(d.km) as km from dist d where d.fid = f.id) nearest on true
where fb.id = f.id and coalesce(linked.km, nearest.km) is not null;

-- 4. Status from the project; service area from the measured distance.
update public.farmer_beneficiaries fb
set linked_project_status = p.status
from public.fmr_projects p
where p.id::text = nullif(trim(fb.linked_project_id), '') and fb.municipality ilike 'leon';

update public.farmer_beneficiaries
set service_area = case
      when distance_to_fmr_km <= 0.6 then 'Within primary service area'
      when distance_to_fmr_km <= 1.2 then 'Within secondary service area'
      else 'For proximity verification' end
where municipality ilike 'leon' and distance_to_fmr_km > 0;

drop table if exists pick, road_market, dist, farm, seg;

commit;

-- Check (expect unlinked = 0):
-- select count(*) filter (where coalesce(linked_project_id,'') = '') as unlinked,
--        round(avg(distance_to_fmr_km), 2) as avg_km, max(distance_to_fmr_km) as max_km
-- from public.farmer_beneficiaries where municipality ilike 'leon';
