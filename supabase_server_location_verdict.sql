-- The location badge (public_reports.verification) is decided by the server.
--
-- Why: reports a few metres from their road, with GPS of ±2-8 m, were saved as
-- "Location Mismatch" or "Needs Review" while their credibility score (measured
-- to the road) said they were on site. Three causes:
--   1. The insert trigger stored whatever badge the phone sent (an older app
--      build, a cached project list or an offline queue could send a wrong one),
--      and it turned every "Verified On-Site" into "Needs Review".
--   2. _fmr_project_distance_m only read route points stored as {"lat","lng"};
--      120 of the 163 mapped routes store them as [lat, lng], so for those the
--      road was measured as a straight line from its start to its end.
--   3. Nothing re-checked the badges already saved.
--
-- Now: one rule, on the server, for every citizen/farmer report (the same rule
-- as lib/publicReportTriage.js locationVerdict):
--   within 150 m of the road and GPS ±100 m or better -> Verified On-Site
--   more than 1 km from the road                      -> Location Mismatch
--   anything else, or no road to compare with         -> Needs Review
-- The engineer's inspection steps still set the badge once an inspection
-- starts (start / submit / validate / reject are unchanged).
--
-- Run once in the Supabase SQL editor. Safe to run again.

-- 1. Distance (m) from a point to a project's road: nearest point on its mapped
--    route (either point format), else the straight line start -> end.
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
  select array_agg(lat order by ord), array_agg(lng order by ord)
    into lats, lngs
    from (
      select ord,
             case when jsonb_typeof(pt) = 'array' then (pt->>0)::double precision
                  else coalesce(pt->>'lat', pt->>'latitude')::double precision end as lat,
             case when jsonb_typeof(pt) = 'array' then (pt->>1)::double precision
                  else coalesce(pt->>'lng', pt->>'lon', pt->>'longitude')::double precision end as lng
        from public.project_routes r,
             jsonb_array_elements(case when jsonb_typeof(r.route_points) = 'array' then r.route_points else '[]'::jsonb end)
               with ordinality as e(pt, ord)
       where r.project_id = p_project_id
         and jsonb_typeof(pt) in ('array', 'object')
    ) pts
   where lat is not null and lng is not null;

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

-- 2. The badge for a report position (project_id is 'fmr-<id>' or '<id>').
create or replace function public._report_location_verdict(p_project_id text, p_lat double precision, p_lng double precision, p_accuracy double precision)
returns text
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_id bigint;
  v_m double precision;
begin
  if p_lat is null or p_lng is null then
    return 'Needs Review';
  end if;
  v_id := nullif(substring(coalesce(p_project_id, '') from '^(?:fmr-)?([0-9]+)$'), '')::bigint;
  if v_id is null then
    return 'Needs Review';
  end if;
  v_m := public._fmr_project_distance_m(v_id, p_lat, p_lng);
  if v_m is null then
    return 'Needs Review';
  elsif v_m > 1000 then
    return 'Location Mismatch';
  elsif v_m <= 150 and coalesce(p_accuracy, 0) <= 100 then
    return 'Verified On-Site';
  end if;
  return 'Needs Review';
end;
$$;

-- 3. New citizen/farmer reports: same as before, except the badge is computed
--    here from the report's GPS instead of trusting the one the app sent.
create or replace function public.public_report_prepare_citizen_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
set row_security to 'off'
as $function$
begin
  if public.public_report_current_role() <> 'admin' then
    new.status := 'pending';
    new.engineer_status := null;
    new.assigned_engineer_id := null;
    new.assigned_engineer_name := '';
    new.assigned_at := null;
    new.engineer_notes := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.dismissed_at := null;
    new.dismissed_by := null;
    new.dismissal_reason := null;
    new.resolved_at := null;
    new.resolved_by := null;
    new.legacy_resolved_without_engineer_validation := false;

    new.verification := public._report_location_verdict(new.project_id, new.latitude, new.longitude, new.geo_accuracy);

    if auth.uid() is null then
      new.user_id := null;
    elsif new.user_id is distinct from auth.uid() then
      new.user_id := auth.uid();
    end if;
  end if;

  new.updated_at := coalesce(new.updated_at, now());
  return new;
end;
$function$;

-- 4. Re-check the badges already saved, for reports no engineer has taken up
--    yet (once an inspection starts, its own steps set the badge).
--
-- Preview first (optional):
-- select left(id::text, 8) as id, project_id, verification as old_badge,
--        public._report_location_verdict(project_id, latitude, longitude, geo_accuracy) as new_badge
--   from public.public_reports
--  where engineer_status is null
--    and verification is distinct from public._report_location_verdict(project_id, latitude, longitude, geo_accuracy);

update public.public_reports
   set verification = public._report_location_verdict(project_id, latitude, longitude, geo_accuracy)
 where engineer_status is null
   and verification is distinct from public._report_location_verdict(project_id, latitude, longitude, geo_accuracy);
