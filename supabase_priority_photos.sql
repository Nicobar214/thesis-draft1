-- Supporting photos for the field engineer's priority answers, taken with the
-- KalsaTrack camera (live camera, geotagged, stamped with a verification QR).
-- Run once in the Supabase SQL editor, after supabase_priority_roles.sql.
--
--   Site validation of a road gap: 1 to 3 photos, each within 500 m of the gap.
--   Site inspection reply (site engineer): 1 to 3 photos, within 500 m of the
--   project road. Contractor replies stay text-only.
--   Every photo needs GPS of +-100 m or better (same limits as the repair and
--   inspection checks).

-- 1. Where the photos are kept
alter table public.priority_decisions
  add column if not exists validation_photos jsonb not null default '[]'::jsonb,
  add column if not exists response_photos jsonb not null default '[]'::jsonb;

-- 2. Photo verification page knows the new kinds
alter table public.photo_attestations drop constraint if exists photo_attestations_kind_check;
alter table public.photo_attestations add constraint photo_attestations_kind_check
  check (kind = any (array['citizen_report', 'field_inspection', 'repair_verification', 'contractor_progress',
                           'progress_certification', 'priority_validation', 'priority_inspection']));

-- 3. Field engineers upload (and clean up) only in their own priority folder
drop policy if exists progress_photos_insert_priority on storage.objects;
create policy progress_photos_insert_priority on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'progress-photos'
    and public.current_profile_role() = 'field_engineer'
    and (storage.foldername(name))[1] = 'priority'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists progress_photos_delete_priority on storage.objects;
create policy progress_photos_delete_priority on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'progress-photos'
    and public.current_profile_role() = 'field_engineer'
    and (storage.foldername(name))[1] = 'priority'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- 4. Distance (m) from a point to a road gap's line (nearest point on it)
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
begin
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
  if coalesce(array_length(lats, 1), 0) = 0 then return null; end if;
  if array_length(lats, 1) = 1 then
    return public._public_report_distance_m(lats[1], lngs[1], p_lat, p_lng);
  end if;
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

-- 5. Check a set of photos: 1-3, uploaded by this user, precise and on site.
--    p_kind 'gap' measures to the gap line, 'project' to the project road.
create or replace function public._check_priority_photos(p_photos jsonb, p_kind text, p_candidate_id text)
returns void
language plpgsql
stable
set search_path to 'public'
as $$
declare
  ph jsonb;
  v_dist double precision;
  n int := coalesce(jsonb_array_length(case when jsonb_typeof(p_photos) = 'array' then p_photos else '[]'::jsonb end), 0);
begin
  if n < 1 then
    raise exception 'Take at least one site photo with the KalsaTrack camera';
  end if;
  if n > 3 then
    raise exception 'Attach up to 3 photos';
  end if;
  for ph in select * from jsonb_array_elements(p_photos) loop
    if coalesce(ph->>'url', '') = '' or split_part(coalesce(ph->>'path', ''), '/', 1) <> 'priority'
       or split_part(ph->>'path', '/', 2) <> auth.uid()::text then
      raise exception 'Photos must be taken and uploaded from your own account';
    end if;
    if (ph->>'latitude') is null or (ph->>'longitude') is null then
      raise exception 'Every photo must be geotagged';
    end if;
    if (ph->>'accuracy_m') is null or (ph->>'accuracy_m')::double precision > 100 then
      raise exception 'A photo has weak GPS (% m, maximum 100 m). Retake it in the open', round(coalesce((ph->>'accuracy_m')::double precision, -1));
    end if;
    v_dist := case when p_kind = 'gap'
      then public._road_gap_distance_m(p_candidate_id, (ph->>'latitude')::double precision, (ph->>'longitude')::double precision)
      else public._fmr_project_distance_m(p_candidate_id::bigint, (ph->>'latitude')::double precision, (ph->>'longitude')::double precision)
    end;
    if v_dist is not null and v_dist > 500 then
      raise exception 'A photo was taken % m from the road (maximum 500 m). Take it on site', round(v_dist);
    end if;
  end loop;
end;
$$;

-- 6. The engineer answers a site validation, with photos
drop function if exists public.submit_priority_validation(uuid, text, text);
create or replace function public.submit_priority_validation(p_decision_id uuid, p_result text, p_note text, p_photos jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d public.priority_decisions%rowtype;
begin
  select * into d from public.priority_decisions where id = p_decision_id for update;
  if not found then raise exception 'Request not found'; end if;
  if d.assigned_engineer_id is distinct from auth.uid() then
    raise exception 'Only the engineer asked to validate this road can answer';
  end if;
  if d.status <> 'for_validation' then
    raise exception 'This road is no longer waiting for site validation';
  end if;
  if p_result not in ('confirmed', 'not_confirmed') then
    raise exception 'Answer Confirmed or Not as described';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'Add a short note on what you found on site';
  end if;
  perform public._check_priority_photos(p_photos, 'gap', d.candidate_id);
  update public.priority_decisions
     set validation_result = p_result, validation_note = btrim(p_note), validated_at = now(),
         validation_photos = p_photos
   where id = p_decision_id;
end;
$$;

-- 7. The contractor or site engineer replies; the site engineer's inspection needs photos
drop function if exists public.respond_priority_action(uuid, text);
create or replace function public.respond_priority_action(p_decision_id uuid, p_note text, p_photos jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d public.priority_decisions%rowtype;
  p public.fmr_projects%rowtype;
  v_inspection boolean;
begin
  select * into d from public.priority_decisions where id = p_decision_id for update;
  if not found then raise exception 'Request not found'; end if;
  if d.candidate_kind <> 'project' or d.status <> 'action_recorded' then
    raise exception 'This project is not waiting for a reply';
  end if;
  select * into p from public.fmr_projects where id::text = d.candidate_id;
  v_inspection := d.action = 'Schedule site inspection';
  if not (
    (v_inspection and p.site_engineer_id = auth.uid())
    or (not v_inspection and p.contractor_id = auth.uid())
  ) then
    raise exception 'This action is for someone else';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'Write a short reply';
  end if;
  if v_inspection then
    perform public._check_priority_photos(p_photos, 'project', d.candidate_id);
  end if;
  update public.priority_decisions
     set response_note = btrim(p_note), responded_by = auth.uid(), responded_at = now(),
         response_photos = case when v_inspection then p_photos else '[]'::jsonb end
   where id = p_decision_id;
end;
$$;

-- Starting a fresh validation / action also clears the previous photos.
create or replace function public.priority_decisions_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.candidate_kind = 'gap' and new.status = 'for_validation' and new.assigned_engineer_id is null then
    raise exception 'Choose the field engineer who will validate this road on site';
  end if;
  if new.candidate_kind = 'gap' and new.status = 'endorsed'
     and new.validation_result is distinct from 'confirmed' then
    raise exception 'A road can only be endorsed after the site validation confirms it';
  end if;
  if new.status = 'for_validation' and (tg_op = 'INSERT' or old.status is distinct from 'for_validation') then
    new.validation_result := null;
    new.validation_note := null;
    new.validated_at := null;
    new.validation_photos := '[]'::jsonb;
  end if;
  if new.status = 'action_recorded' and (tg_op = 'INSERT' or old.status is distinct from 'action_recorded') then
    new.response_note := null;
    new.responded_by := null;
    new.responded_at := null;
    new.response_photos := '[]'::jsonb;
  end if;
  return new;
end;
$$;

revoke all on function public.submit_priority_validation(uuid, text, text, jsonb) from public, anon;
grant execute on function public.submit_priority_validation(uuid, text, text, jsonb) to authenticated;
revoke all on function public.respond_priority_action(uuid, text, jsonb) from public, anon;
grant execute on function public.respond_priority_action(uuid, text, jsonb) to authenticated;
