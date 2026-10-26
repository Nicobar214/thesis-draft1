-- Prioritization: road gaps measured on their own road, and live updates.
--
-- Run AFTER supabase_server_location_verdict.sql (it reads both route-point
-- formats in _fmr_project_distance_m). Safe to run more than once.
--
-- 1. A road gap is the unpaved part of one surveyed road (from_project_id).
--    The app now draws and scores a gap on that road's mapped route
--    (src/lib/gapGeometry.js) instead of the generated gap_points line, which
--    in many cases ran onto other roads. The site-photo geofence for a gap
--    must agree, or an engineer standing on the real road would be told the
--    photo is too far away. It now accepts the nearer of the two: the road
--    itself, or the stored gap line (kept as it was; nothing is deleted).
--
-- 2. road_network_gaps and priority_decisions join the realtime publication,
--    so the Priority tab updates by itself when a gap row changes, or when a
--    field engineer validates or another admin takes a step.

-- 1. Distance (m) from a point to a road gap: its own road, or the stored line.
create or replace function public._road_gap_distance_m(p_gap_id text, p_lat double precision, p_lng double precision)
returns double precision
language plpgsql
stable
set search_path to 'public'
as $$
declare
  lats double precision[];
  lngs double precision[];
  kx double precision := 111320 * cos(radians(p_lat));
  ky constant double precision := 110540;
  best double precision := null;
  ax double precision; ay double precision; bx double precision; by_ double precision;
  dx double precision; dy double precision; t double precision; d double precision;
  i int;
  v_parent bigint;
  v_road double precision;
begin
  -- The surveyed road the gap belongs to.
  select g.from_project_id into v_parent from public.road_network_gaps g where g.id::text = p_gap_id;
  if v_parent is not null then
    v_road := public._fmr_project_distance_m(v_parent, p_lat, p_lng);
  end if;

  -- The stored gap line, unchanged from before.
  select array_agg((pt->>0)::double precision order by ord), array_agg((pt->>1)::double precision order by ord)
    into lats, lngs
    from public.road_network_gaps g,
         jsonb_array_elements(case when jsonb_typeof(g.gap_points) = 'array' then g.gap_points else '[]'::jsonb end) with ordinality as e(pt, ord)
   where g.id::text = p_gap_id and jsonb_typeof(pt) = 'array';

  if coalesce(array_length(lats, 1), 0) < 2 then
    select array_remove(array[g.start_latitude, g.end_latitude], null), array_remove(array[g.start_longitude, g.end_longitude], null)
      into lats, lngs
      from public.road_network_gaps g where g.id::text = p_gap_id;
  end if;

  if coalesce(array_length(lats, 1), 0) = 1 then
    best := public._public_report_distance_m(lats[1], lngs[1], p_lat, p_lng);
  elsif coalesce(array_length(lats, 1), 0) >= 2 then
    for i in 1 .. array_length(lats, 1) - 1 loop
      ax := (lngs[i] - p_lng) * kx;      ay := (lats[i] - p_lat) * ky;
      bx := (lngs[i + 1] - p_lng) * kx;  by_ := (lats[i + 1] - p_lat) * ky;
      dx := bx - ax; dy := by_ - ay;
      t := case when dx * dx + dy * dy > 0 then greatest(0, least(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) else 0 end;
      d := sqrt((ax + t * dx) ^ 2 + (ay + t * dy) ^ 2);
      if best is null or d < best then best := d; end if;
    end loop;
  end if;

  -- least() ignores nulls: whichever line exists, the nearer one counts.
  return least(v_road, best);
end;
$$;

-- 2. Live updates for the Priority tab.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'road_network_gaps') then
    alter publication supabase_realtime add table public.road_network_gaps;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'priority_decisions') then
    alter publication supabase_realtime add table public.priority_decisions;
  end if;
end;
$$;
