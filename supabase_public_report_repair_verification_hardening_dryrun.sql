-- ============================================================
-- DRY RUN for supabase_public_report_repair_verification_hardening.sql
--
-- GENERATED FILE - do not edit by hand. It embeds the real migration, so what is
-- tested here is exactly what would be applied.
--
-- HOW TO USE: paste this whole file into the Supabase SQL editor and run it.
-- It applies the migration, creates a test report + repair, exercises the new
-- checks while impersonating an engineer and admins, then ends with a deliberate
-- error that ROLLS BACK EVERYTHING. The error text is the report.
-- Every line should start with PASS (or INFO). Any FAIL is a bug.
-- ============================================================

do $dry$
declare
  r text := '';
  adm_a uuid; eng_1 uuid; eng_2 uuid; cit uuid;
  rep1 uuid; act1 uuid;
  n int; ts timestamptz; acc double precision; stat text;
begin
  select id into adm_a from public.profiles where role = 'admin' order by id limit 1;
  select id into eng_1 from public.profiles where lower(replace(replace(coalesce(role,''),'-','_'),' ','_')) = 'field_engineer' order by id limit 1;
  select id into eng_2 from public.profiles where lower(replace(replace(coalesce(role,''),'-','_'),' ','_')) = 'field_engineer' order by id desc limit 1;
  select id into cit from public.profiles where role = 'user' limit 1;
  if eng_1 = eng_2 then raise exception 'this test needs two engineers'; end if;

  execute $mig$
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


  $mig$;

  execute $f$ create function pg_temp.as_user(u uuid) returns void language plpgsql as $b$
    begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
          perform set_config('request.jwt.claim.sub', u::text, true); end $b$ $f$;

  execute $f$ create function pg_temp.attempt(label text, stmt text, expect text) returns text language plpgsql as $b$
    declare msg text;
    begin
      begin
        execute stmt;
        if expect is null then return 'PASS  ' || label; end if;
        return 'FAIL  ' || label || '  (expected an error containing "' || expect || '" but it succeeded)';
      exception when others then
        msg := sqlerrm;
        if expect is null then return 'FAIL  ' || label || '  (unexpected error: ' || msg || ')'; end if;
        if position(lower(expect) in lower(msg)) > 0 then return 'PASS  ' || label; end if;
        return 'FAIL  ' || label || '  (got: ' || msg || ')';
      end;
    end $b$ $f$;

  -- fixture: a resolved report with a repair planned and recorded as done by an admin
  perform pg_temp.as_user(adm_a);
  insert into public.public_reports (municipality, barangay, project_name, description, status, engineer_status, verification, user_id, assigned_engineer_id, latitude, longitude, photo_url)
  values ('TEST', 'TEST', 'VERIFY HARDENING TEST', 'fixture', 'resolved', 'validated', 'Needs Review', cit, eng_1, 10.78, 122.40, 'x') returning id into rep1;
  insert into public.public_report_resolutions (report_id, resolution_type, summary, resolved_at, created_at) values (rep1, 'scheduled_for_repair', 'fixture', now(), now());
  perform public.plan_public_report_repair(rep1, 'da', (current_date + 3)::text::date, 'fixture');
  select id into act1 from public.public_report_repair_actions where report_id = rep1;
  perform public.complete_public_report_repair(act1, 'fixture work');
  -- pretend the work was recorded 1 hour ago
  update public.public_report_repair_actions set completed_at = now() - interval '1 hour' where id = act1;

  r := r || E'--- new evidence rules ---\n';
  perform pg_temp.as_user(eng_1);
  r := r || pg_temp.attempt('missing capture time is rejected', format('select public.verify_public_report_repair(%L,%L,%s,%s,%s)', act1, 'https://x/a.jpg', 10.7801, 122.4001, 8), 'time the photo was taken is required') || E'\n';
  r := r || pg_temp.attempt('missing accuracy is rejected', format('select public.verify_public_report_repair(%L,%L,%s,%s,null,null,%L)', act1, 'https://x/a.jpg', 10.7801, 122.4001, now()::text), 'accuracy reading is required') || E'\n';
  r := r || pg_temp.attempt('accuracy of 150 m is rejected', format('select public.verify_public_report_repair(%L,%L,%s,%s,%s,null,%L)', act1, 'https://x/a.jpg', 10.7801, 122.4001, 150, now()::text), 'accuracy is too low') || E'\n';
  r := r || pg_temp.attempt('capture time in the future is rejected', format('select public.verify_public_report_repair(%L,%L,%s,%s,%s,null,%L)', act1, 'https://x/a.jpg', 10.7801, 122.4001, 8, (now() + interval '1 hour')::text), 'in the future') || E'\n';
  r := r || pg_temp.attempt('1 minute of clock skew is tolerated (then fails only on the next rule)', format('select public.verify_public_report_repair(%L,%L,%s,%s,%s,null,%L)', act1, 'https://x/a.jpg', 10.88, 122.40, 8, (now() + interval '1 minute')::text), 'from the reported site') || E'\n';
  r := r || pg_temp.attempt('photo older than 48 h is rejected', format('select public.verify_public_report_repair(%L,%L,%s,%s,%s,null,%L)', act1, 'https://x/a.jpg', 10.7801, 122.4001, 8, (now() - interval '3 days')::text), 'more than 48 hours ago') || E'\n';
  r := r || pg_temp.attempt('photo taken before the work was recorded is rejected', format('select public.verify_public_report_repair(%L,%L,%s,%s,%s,null,%L)', act1, 'https://x/a.jpg', 10.7801, 122.4001, 8, (now() - interval '3 hours')::text), 'before the work was recorded') || E'\n';
  r := r || pg_temp.attempt('far-away verification is still rejected', format('select public.verify_public_report_repair(%L,%L,%s,%s,%s,null,%L)', act1, 'https://x/a.jpg', 10.88, 122.40, 8, now()::text), 'from the reported site') || E'\n';
  perform pg_temp.as_user(eng_2);
  r := r || pg_temp.attempt('an unassigned engineer is still rejected', format('select public.verify_public_report_repair(%L,%L,%s,%s,%s,null,%L)', act1, 'https://x/a.jpg', 10.7801, 122.4001, 8, now()::text), 'Only the engineer assigned') || E'\n';
  perform pg_temp.as_user(adm_a);
  r := r || pg_temp.attempt('the admin who recorded the work still cannot verify it', format('select public.verify_public_report_repair(%L,%L,%s,%s,%s,null,%L)', act1, 'https://x/a.jpg', 10.7801, 122.4001, 8, now()::text), 'cannot also verify') || E'\n';

  r := r || E'--- a valid capture, uploaded later (the offline case) ---\n';
  update public.public_report_repair_actions set completed_at = now() - interval '1 day' where id = act1;
  perform pg_temp.as_user(eng_1);
  r := r || pg_temp.attempt('capture 2 h ago, after the work was recorded, accepted', format('select public.verify_public_report_repair(%L,%L,%s,%s,%s,%L,%L)', act1, 'https://x/after.jpg', 10.7801, 122.4001, 12, 'offline capture', (now() - interval '2 hours')::text), null) || E'\n';
  select status, verification_captured_at, verification_accuracy_m into stat, ts, acc from public.public_report_repair_actions where id = act1;
  r := r || case when stat = 'verified' then 'PASS' else 'FAIL' end || '  repair is verified: ' || stat || E'\n';
  r := r || case when ts is not null and ts < now() - interval '1 hour' then 'PASS' else 'FAIL' end || '  capture time is stored and is the shutter time, not the upload time: ' || coalesce(ts::text, 'null') || E'\n';
  r := r || case when acc = 12 then 'PASS' else 'FAIL' end || '  accuracy is stored: ' || coalesce(acc::text, 'null') || E'\n';
  select count(*) into n from public.public_report_activity_logs where report_id = rep1 and action = 'REPAIR_VERIFIED' and metadata ? 'captured_at' and metadata ? 'received_at' and metadata ? 'capture_delay_seconds';
  r := r || case when n = 1 then 'PASS' else 'FAIL' end || '  audit entry records captured_at, received_at and capture_delay_seconds (' || n || ' matching)' || E'\n';
  r := r || pg_temp.attempt('verifying twice is still rejected', format('select public.verify_public_report_repair(%L,%L,%s,%s,%s,null,%L)', act1, 'https://x/a.jpg', 10.7801, 122.4001, 8, now()::text), 'Only a completed repair') || E'\n';
  select status into stat from public.public_reports where id = rep1;
  r := r || case when stat = 'resolved' then 'PASS' else 'FAIL' end || '  the REPORT itself is still "resolved": ' || stat || E'\n';

  r := r || E'--- signature + grants ---\n';
  r := r || case when to_regprocedure('public.verify_public_report_repair(uuid,text,double precision,double precision,double precision,text)') is null then 'PASS' else 'FAIL' end || '  the old 6-argument overload is gone (no ambiguous RPC)' || E'\n';
  r := r || case when not has_function_privilege('anon', 'public.verify_public_report_repair(uuid,text,double precision,double precision,double precision,text,timestamptz)', 'execute')
                  and has_function_privilege('authenticated', 'public.verify_public_report_repair(uuid,text,double precision,double precision,double precision,text,timestamptz)', 'execute')
             then 'PASS' else 'FAIL' end || '  new signature: anon denied, authenticated allowed' || E'\n';

  raise exception E'REPAIR VERIFICATION HARDENING: DRY RUN (rolled back, nothing saved)\n%', r;
end $dry$;
