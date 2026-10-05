-- ============================================================
-- Repair verification hardening  (Tier 1, part B)
--
-- Part A made the engineer prove presence in the app: the camera is locked until
-- the device is within 500 m, and the photo is stamped at the shutter. This part
-- makes the SERVER hold the same line, and records WHEN the photo was taken so
-- that a photo captured offline (part C) can be uploaded later and still be
-- judged fairly.
--
-- What changes
--   * New column  verification_captured_at  (when the shutter was pressed).
--   * verify_public_report_repair gains a 7th argument p_captured_at and now
--     rejects a verification when
--       - the capture time is missing,
--       - it is in the future (5 min of clock skew allowed),
--       - it is BEFORE the work was recorded as done,
--       - it is more than 48 hours old when it arrives,
--       - the GPS accuracy is missing or worse than 100 m.
--     The existing 500 m distance check, role guard, separation of duties and
--     notifications are unchanged.
--   * The audit entry records capture time, upload time, accuracy and the
--     delay between them.
--
-- The 6-argument version is dropped (a second overload would make RPC calls
-- ambiguous). Grants are re-applied for the new signature.
--
-- Honest limit: the capture time and coordinates still come from the device, so
-- this proves plausibility, not presence. The server can only bound how stale
-- or inconsistent the evidence is.
--
-- Run after: supabase_public_report_repair_actions.sql
-- Safe to re-run. Roll back with supabase_public_report_repair_verification_hardening_rollback.sql
-- ============================================================

begin;

alter table public.public_report_repair_actions
  add column if not exists verification_captured_at timestamptz;

drop function if exists public.verify_public_report_repair(uuid, text, double precision, double precision, double precision, text);

create or replace function public.verify_public_report_repair(
  p_action_id uuid,
  p_photo_url text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision default null,
  p_note text default null,
  p_captured_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  c_max_distance_m constant double precision := 500;
  c_max_accuracy_m constant double precision := 100;
  c_max_age        constant interval := interval '48 hours';
  c_clock_skew     constant interval := interval '5 minutes';
  v_role text;
  v_action public.public_report_repair_actions%rowtype;
  v_report public.public_reports%rowtype;
  v_dist double precision;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_role := public._public_report_actor_role();
  if v_role not in ('field_engineer', 'admin') then
    raise exception 'Only a field engineer or admin can verify a repair';
  end if;

  if coalesce(btrim(p_photo_url), '') = '' then
    raise exception 'An after-photo is required to verify a repair';
  end if;
  if p_latitude is null or p_longitude is null then
    raise exception 'GPS coordinates are required to verify a repair';
  end if;
  if p_latitude < -90 or p_latitude > 90 then
    raise exception 'Latitude must be between -90 and 90';
  end if;
  if p_longitude < -180 or p_longitude > 180 then
    raise exception 'Longitude must be between -180 and 180';
  end if;
  if p_accuracy_m is null or p_accuracy_m < 0 then
    raise exception 'A GPS accuracy reading is required to verify a repair';
  end if;
  if p_accuracy_m > c_max_accuracy_m then
    raise exception 'GPS accuracy is too low (% m, maximum % m)',
      round(p_accuracy_m), round(c_max_accuracy_m);
  end if;
  if p_captured_at is null then
    raise exception 'The time the photo was taken is required to verify a repair';
  end if;
  if p_captured_at > now() + c_clock_skew then
    raise exception 'The photo capture time is in the future';
  end if;
  if now() - p_captured_at > c_max_age then
    raise exception 'The photo was taken more than 48 hours ago; take a new one on site';
  end if;

  select * into v_action
  from public.public_report_repair_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'Repair action does not exist';
  end if;

  select * into v_report from public.public_reports where id = v_action.report_id;

  if v_action.status <> 'completed' then
    raise exception 'Only a completed repair can be verified';
  end if;

  if v_action.completed_at is not null and p_captured_at < v_action.completed_at - c_clock_skew then
    raise exception 'The photo was taken before the work was recorded as done';
  end if;

  if v_role = 'field_engineer' and v_report.assigned_engineer_id is distinct from auth.uid() then
    raise exception 'Only the engineer assigned to this report can verify its repair';
  end if;

  if v_action.completed_by is not distinct from auth.uid() then
    raise exception 'The person who recorded the work as complete cannot also verify it';
  end if;

  if v_report.latitude is not null and v_report.longitude is not null then
    v_dist := public._public_report_distance_m(
      v_report.latitude, v_report.longitude, p_latitude, p_longitude
    );
    if v_dist > c_max_distance_m then
      raise exception 'Verification location is % m from the reported site (maximum % m)',
        round(v_dist), round(c_max_distance_m);
    end if;
  end if;

  update public.public_report_repair_actions
  set status = 'verified',
      verified_by = auth.uid(),
      verified_at = now(),
      verification_photo_url = btrim(p_photo_url),
      verification_latitude = p_latitude,
      verification_longitude = p_longitude,
      verification_accuracy_m = p_accuracy_m,
      verification_distance_m = v_dist,
      verification_captured_at = p_captured_at,
      verification_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_action_id;

  perform public._public_report_add_audit(
    v_action.report_id,
    'REPAIR_VERIFIED',
    jsonb_build_object('repair_status', 'completed'),
    jsonb_build_object('repair_status', 'verified'),
    nullif(btrim(coalesce(p_note, '')), ''),
    jsonb_build_object(
      'repair_action_id', p_action_id,
      'distance_m', round(coalesce(v_dist, 0)),
      'accuracy_m', round(p_accuracy_m),
      'captured_at', p_captured_at,
      'received_at', now(),
      'capture_delay_seconds', round(extract(epoch from (now() - p_captured_at))),
      'verifier_role', v_role
    )
  );

  if v_report.user_id is not null then
    insert into public.notifications (user_id, type, title, message, report_id, is_read)
    values (
      v_report.user_id,
      'public_report_repair_verified',
      'Repair confirmed on site',
      'An engineer visited the location and confirmed the follow-up work on your report.',
      v_action.report_id,
      false
    );
  end if;
end;
$function$;

revoke execute on function public.verify_public_report_repair(uuid, text, double precision, double precision, double precision, text, timestamptz) from public, anon;
grant execute on function public.verify_public_report_repair(uuid, text, double precision, double precision, double precision, text, timestamptz) to authenticated;

commit;
