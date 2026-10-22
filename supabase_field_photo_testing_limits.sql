-- TEMPORARY (testing): wider on-site limits for KalsaTrack camera photos
-- (progress certification and Priority Tasks), so they can be tested away
-- from the actual roads. Matches FIELD_PHOTO_TEST_LIMITS in
-- src/lib/onSiteLocation.js.
--
-- Run AFTER supabase_progress_certification_photo.sql and
-- supabase_priority_photos.sql.
--
-- TO GO BACK TO THE REAL LIMITS (before the defense / go-live), run only:
--   create or replace function public._field_photo_limits(out max_accuracy_m double precision, out max_distance_m double precision)
--   language sql immutable as $$ select 100::double precision, 500::double precision $$;
-- and set FIELD_PHOTO_TEST_LIMITS = null in src/lib/onSiteLocation.js.
--
-- The citizen report, damage-report inspection and repair checks are NOT changed.

-- The limits, in one place. Testing: GPS ±1000 m, up to 50 km from the road.
-- Normal: 100 m and 500 m.
create or replace function public._field_photo_limits(out max_accuracy_m double precision, out max_distance_m double precision)
language sql
immutable
as $$ select 1000::double precision, 50000::double precision $$;

-- Certification photo: same function, reading the limits above.
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
  lim record;
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
  -- On site, with a usable fix (limits from _field_photo_limits()).
  select * into lim from public._field_photo_limits();
  if p_accuracy_m is null or p_accuracy_m > lim.max_accuracy_m then
    raise exception 'GPS accuracy is too low (% m, maximum % m). Move to open sky and retake the photo', round(coalesce(p_accuracy_m, -1)), round(lim.max_accuracy_m);
  end if;
  v_dist := public._fmr_project_distance_m(upd.fmr_project_id, p_latitude, p_longitude);
  if v_dist is not null and v_dist > lim.max_distance_m then
    raise exception 'The photo was taken % m from the project road (maximum % m). Take it at the project site', round(v_dist), round(lim.max_distance_m);
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

-- Priority Tasks photos: same check, reading the limits above.
create or replace function public._check_priority_photos(p_photos jsonb, p_kind text, p_candidate_id text)
returns void
language plpgsql
stable
set search_path to 'public'
as $$
declare
  ph jsonb;
  v_dist double precision;
  lim record;
  n int := coalesce(jsonb_array_length(case when jsonb_typeof(p_photos) = 'array' then p_photos else '[]'::jsonb end), 0);
begin
  select * into lim from public._field_photo_limits();
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
    if (ph->>'accuracy_m') is null or (ph->>'accuracy_m')::double precision > lim.max_accuracy_m then
      raise exception 'A photo has weak GPS (% m, maximum % m). Retake it in the open', round(coalesce((ph->>'accuracy_m')::double precision, -1)), round(lim.max_accuracy_m);
    end if;
    v_dist := case when p_kind = 'gap'
      then public._road_gap_distance_m(p_candidate_id, (ph->>'latitude')::double precision, (ph->>'longitude')::double precision)
      else public._fmr_project_distance_m(p_candidate_id::bigint, (ph->>'latitude')::double precision, (ph->>'longitude')::double precision)
    end;
    if v_dist is not null and v_dist > lim.max_distance_m then
      raise exception 'A photo was taken % m from the road (maximum % m). Take it on site', round(v_dist), round(lim.max_distance_m);
    end if;
  end loop;
end;
$$;
