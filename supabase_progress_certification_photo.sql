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

-- 4a. Distance (m) from a point to an FMR project's road: the nearest of its
-- mapped route points and its start/end pins. Null when the project has no
-- location at all (then the distance check is skipped).
create or replace function public._fmr_project_distance_m(p_project_id bigint, p_lat double precision, p_lng double precision)
returns double precision
language sql
stable
set search_path to 'public'
as $$
  select min(d) from (
    select public._public_report_distance_m((pt->>'lat')::double precision, (pt->>'lng')::double precision, p_lat, p_lng) as d
      from public.project_routes r, jsonb_array_elements(coalesce(r.route_points, '[]'::jsonb)) pt
     where r.project_id = p_project_id and pt ? 'lat' and pt ? 'lng'
    union all
    select public._public_report_distance_m(r.start_latitude, r.start_longitude, p_lat, p_lng)
      from public.project_routes r where r.project_id = p_project_id and r.start_latitude is not null
    union all
    select public._public_report_distance_m(r.end_latitude, r.end_longitude, p_lat, p_lng)
      from public.project_routes r where r.project_id = p_project_id and r.end_latitude is not null
    union all
    select public._public_report_distance_m(p.start_latitude, p.start_longitude, p_lat, p_lng)
      from public.fmr_projects p where p.id = p_project_id and p.start_latitude is not null
    union all
    select public._public_report_distance_m(p.end_latitude, p.end_longitude, p_lat, p_lng)
      from public.fmr_projects p where p.id = p_project_id and p.end_latitude is not null
  ) x;
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
