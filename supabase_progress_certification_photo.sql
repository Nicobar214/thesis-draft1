-- Field engineer's geotagged site photo as evidence when certifying (or
-- disputing) a contractor's progress claim. Run once in the Supabase SQL editor.
--
-- Flow: the app uploads the stamped photo to progress-photos under
-- certifications/<engineer id>/..., links it with
-- attach_progress_certification_photo, then calls the existing certify RPC.
-- A trigger makes the photo mandatory for field engineers on both certify
-- paths (percentage and Work Plan quantities) without touching those RPCs.

-- 1. Where the photo and its geotag are kept
alter table public.progress_updates
  add column if not exists certification_photo_url text,
  add column if not exists certification_photo_path text,
  add column if not exists certification_photo_lat double precision,
  add column if not exists certification_photo_lng double precision,
  add column if not exists certification_photo_accuracy_m double precision,
  add column if not exists certification_photo_captured_at timestamptz,
  add column if not exists certification_photo_code text;

-- 2. Photo verification page knows the new kind
alter table public.photo_attestations drop constraint if exists photo_attestations_kind_check;
alter table public.photo_attestations add constraint photo_attestations_kind_check
  check (kind = any (array['citizen_report', 'field_inspection', 'repair_verification', 'contractor_progress', 'progress_certification']));

-- 3. Engineers may upload (and clean up) only in their own certifications folder
drop policy if exists progress_photos_insert_certification on storage.objects;
create policy progress_photos_insert_certification on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'progress-photos'
    and public.current_profile_role() in ('field_engineer', 'admin')
    and (storage.foldername(name))[1] = 'certifications'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists progress_photos_delete_certification on storage.objects;
create policy progress_photos_delete_certification on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'progress-photos'
    and public.current_profile_role() in ('field_engineer', 'admin')
    and (storage.foldername(name))[1] = 'certifications'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

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

-- 4b. Link the photo to a progress update that is still waiting for review
create or replace function public.attach_progress_certification_photo(
  p_progress_update_id uuid,
  p_photo_url text,
  p_photo_path text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision default null,
  p_captured_at timestamptz default null,
  p_attestation_code text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
  upd record;
  v_dist double precision;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('field_engineer', 'admin') then
    raise exception 'Only field engineers or admins can attach a certification photo';
  end if;

  select * into upd from public.progress_updates where id = p_progress_update_id for update;
  if not found then
    raise exception 'Progress update not found';
  end if;
  if coalesce(upd.status, '') <> 'pending' then
    raise exception 'This progress update is already % and can no longer be certified', upd.status;
  end if;
  if upd.contractor_id = auth.uid() then
    raise exception 'You cannot certify your own progress submission';
  end if;

  if coalesce(btrim(p_photo_url), '') = '' or p_photo_path is null
     or split_part(p_photo_path, '/', 1) <> 'certifications'
     or split_part(p_photo_path, '/', 2) <> auth.uid()::text then
    raise exception 'The certification photo must be uploaded from your own account';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'The certification photo must be geotagged';
  end if;
  -- On site, with a usable fix: same limits as the repair check.
  if p_accuracy_m is null or p_accuracy_m > 100 then
    raise exception 'GPS accuracy is too low (% m, maximum 100 m). Move to open sky and retake the photo', round(coalesce(p_accuracy_m, -1));
  end if;
  v_dist := public._fmr_project_distance_m(upd.fmr_project_id, p_latitude, p_longitude);
  if v_dist is not null and v_dist > 500 then
    raise exception 'The photo was taken % m from the project road (maximum 500 m). Take it at the project site', round(v_dist);
  end if;

  update public.progress_updates
     set certification_photo_url = p_photo_url,
         certification_photo_path = p_photo_path,
         certification_photo_lat = p_latitude,
         certification_photo_lng = p_longitude,
         certification_photo_accuracy_m = p_accuracy_m,
         certification_photo_captured_at = coalesce(p_captured_at, now()),
         certification_photo_code = upper(p_attestation_code)
   where id = p_progress_update_id;
end;
$$;

revoke all on function public.attach_progress_certification_photo(uuid, text, text, double precision, double precision, double precision, timestamptz, text) from public, anon;
grant execute on function public.attach_progress_certification_photo(uuid, text, text, double precision, double precision, double precision, timestamptz, text) to authenticated;

-- 5. A field engineer cannot certify or dispute without the photo
create or replace function public.require_progress_certification_photo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.certification_status in ('certified', 'disputed')
     and new.certification_status is distinct from old.certification_status
     and new.certification_photo_url is null
     and exists (select 1 from public.profiles where id = auth.uid() and role = 'field_engineer') then
    raise exception 'Take a geotagged site photo before certifying this progress update';
  end if;
  return new;
end;
$$;

drop trigger if exists progress_updates_require_certification_photo on public.progress_updates;
create trigger progress_updates_require_certification_photo
  before update of certification_status on public.progress_updates
  for each row execute function public.require_progress_certification_photo();
