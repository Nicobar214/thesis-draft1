-- Re-check the location badge (public_reports.verification) of existing
-- citizen reports. Run once in the Supabase SQL editor.
--
-- The badge used to compare the reporter's GPS with the project's START point
-- only, so a citizen standing on a long road far from where it starts got
-- "Location Mismatch" while the credibility score (which measures to the
-- nearest point on the road) said 100/100. The app now uses one rule
-- everywhere (lib/publicReportTriage.js locationVerdict):
--   within 150 m of the road (and GPS ±100 m or better) -> Verified On-Site
--   more than 1 km from the road                         -> Location Mismatch
--   anything in between, or no road to compare with      -> Needs Review
-- This applies the same rule to reports already saved. Reports an engineer has
-- validated on site keep their badge.

-- Distance (m) from a point to a project's road, measured to the nearest point
-- on the line (each segment of its mapped route, or the straight line from its
-- start to its end when no route is mapped), like nearestPointOnRoute() in the
-- app. Null when the project has no location at all.
create or replace function public._fmr_project_distance_m(p_project_id bigint, p_lat double precision, p_lng double precision)
returns double precision
language plpgsql
stable
set search_path to 'public'
as $$
declare
  lats double precision[];
  lngs double precision[];
  kx double precision := 111320 * cos(radians(p_lat)); -- metres per degree of longitude here
  ky constant double precision := 110540;              -- metres per degree of latitude
  best double precision := null;
  ax double precision; ay double precision; bx double precision; by_ double precision;
  dx double precision; dy double precision; t double precision; d double precision;
  i int;
begin
  select array_agg((pt->>'lat')::double precision order by ord), array_agg((pt->>'lng')::double precision order by ord)
    into lats, lngs
    from public.project_routes r,
         jsonb_array_elements(coalesce(r.route_points, '[]'::jsonb)) with ordinality as e(pt, ord)
   where r.project_id = p_project_id and pt ? 'lat' and pt ? 'lng';

  if coalesce(array_length(lats, 1), 0) < 2 then
    select array_remove(array[coalesce(r.start_latitude, p.start_latitude), coalesce(r.end_latitude, p.end_latitude)], null),
           array_remove(array[coalesce(r.start_longitude, p.start_longitude), coalesce(r.end_longitude, p.end_longitude)], null)
      into lats, lngs
      from public.fmr_projects p
      left join public.project_routes r on r.project_id = p.id
     where p.id = p_project_id;
  end if;

  if coalesce(array_length(lats, 1), 0) = 0 then
    return null;
  end if;
  if array_length(lats, 1) = 1 then
    return public._public_report_distance_m(lats[1], lngs[1], p_lat, p_lng);
  end if;

  -- Local flat projection around the reported point (fine at road scale).
  for i in 1 .. array_length(lats, 1) - 1 loop
    ax := (lngs[i] - p_lng) * kx;      ay := (lats[i] - p_lat) * ky;
    bx := (lngs[i + 1] - p_lng) * kx;  by_ := (lats[i + 1] - p_lat) * ky;
    dx := bx - ax; dy := by_ - ay;
    t := case when dx * dx + dy * dy > 0 then greatest(0, least(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) else 0 end;
    d := sqrt((ax + t * dx) ^ 2 + (ay + t * dy) ^ 2);
    if best is null or d < best then best := d; end if;
  end loop;
  return best;
end;
$$;

-- Preview what changes (optional):
-- with c as (
--   select id, verification as old_badge,
--          public._fmr_project_distance_m(substring(project_id from 5)::bigint, latitude, longitude) as m,
--          geo_accuracy
--     from public.public_reports
--    where project_id ~ '^fmr-[0-9]+$' and latitude is not null
--      and coalesce(engineer_status, '') <> 'validated')
-- select id, old_badge, round(m) as meters,
--        case when m is null then 'Needs Review'
--             when m > 1000 then 'Location Mismatch'
--             when m <= 150 and coalesce(geo_accuracy, 0) <= 100 then 'Verified On-Site'
--             else 'Needs Review' end as new_badge
--   from c order by m desc nulls last;

with c as (
  select id,
         public._fmr_project_distance_m(substring(project_id from 5)::bigint, latitude, longitude) as m,
         geo_accuracy
    from public.public_reports
   where project_id ~ '^fmr-[0-9]+$'
     and latitude is not null and longitude is not null
     and coalesce(engineer_status, '') <> 'validated'
)
update public.public_reports r
   set verification = case
         when c.m is null then 'Needs Review'
         when c.m > 1000 then 'Location Mismatch'
         when c.m <= 150 and coalesce(c.geo_accuracy, 0) <= 100 then 'Verified On-Site'
         else 'Needs Review'
       end
  from c
 where r.id = c.id
   and r.verification is distinct from case
         when c.m is null then 'Needs Review'
         when c.m > 1000 then 'Location Mismatch'
         when c.m <= 150 and coalesce(c.geo_accuracy, 0) <= 100 then 'Verified On-Site'
         else 'Needs Review'
       end;
