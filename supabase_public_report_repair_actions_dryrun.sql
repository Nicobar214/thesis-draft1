-- ============================================================
-- DRY RUN for supabase_public_report_repair_actions.sql
--
-- GENERATED FILE - do not edit by hand. It embeds the real migration, so what
-- is tested here is exactly what would be applied.
--
-- HOW TO USE: paste this whole file into the Supabase SQL editor and run it.
--
-- WHAT IT DOES: applies the migration, creates test reports, then exercises
-- every RPC while impersonating a citizen, two engineers and two admins.
-- It ends with a deliberate error, which ROLLS BACK EVERYTHING - the table,
-- the functions, the fixtures. Nothing is saved. The error text is the report.
--
-- The editor will warn about destructive operations; that is expected.
-- Every line of the report should start with PASS (or INFO). Any FAIL is a bug.
-- ============================================================

do $dry$
declare
  r text := '';
  adm_a uuid; adm_b uuid; eng_1 uuid; eng_2 uuid; cit uuid;
  rep1 uuid; rep2 uuid; rep3 uuid; rep4 uuid;
  act1 uuid; act4 uuid; actx uuid;
  n int; st text; dist double precision; rstat text;
begin
  select id into adm_a from public.profiles where role = 'admin' order by id limit 1;
  select id into adm_b from public.profiles where role = 'admin' order by id desc limit 1;
  select id into eng_1 from public.profiles where lower(replace(replace(coalesce(role,''),'-','_'),' ','_')) = 'field_engineer' order by id limit 1;
  select id into eng_2 from public.profiles where lower(replace(replace(coalesce(role,''),'-','_'),' ','_')) = 'field_engineer' order by id desc limit 1;
  select id into cit from public.profiles where role = 'user' limit 1;
  if adm_a = adm_b or eng_1 = eng_2 then raise exception 'this test needs two admins and two engineers'; end if;

  execute $mig$
-- ============================================================
-- Public Report Repair Actions  (Tier 1: repair tracking)
--
-- Problem: public_reports.status = 'resolved' records that an admin MADE A
-- DECISION. It says nothing about whether the road was actually fixed. The
-- resolution type ('scheduled_for_repair', 'referred_to_contractor', ...) was
-- stored but nothing ever followed it up, so "resolved" and "repaired" were
-- indistinguishable, and the one 'repaired' resolution on record has no
-- evidence behind it.
--
-- Design: a SEPARATE record next to the report, not new report statuses.
--
--     Report (unchanged):   pending -> reviewed -> ... -> resolved
--                                                            |
--     Repair action (new):                  planned -> completed -> verified
--                                              \--------> cancelled
--
-- * public_reports, its state-invariant trigger, the citizen view's CASE, and
--   all nine existing workflow RPCs are NOT touched. This migration is purely
--   additive and is rolled back by supabase_public_report_repair_actions_rollback.sql.
-- * Every transition is an RPC with a server-side role guard, a row lock and an
--   audit entry. There are no INSERT/UPDATE/DELETE policies, so direct writes
--   from any client are denied.
--
-- Separation of duties:
--   * An admin records the work as 'completed' (on behalf of the responsible
--     office). A repair is NOT done until someone else verifies it.
--   * Verification is by the field engineer assigned to the report (or a
--     different admin), and can never be by whoever marked it completed.
--   * Verification needs an after-photo AND GPS, and the GPS must be within
--     500 m of the original report location -- the evidence is checked by the
--     server, not trusted from the client.
--
-- Run after: supabase_public_report_workflow_rpcs.sql and
--            supabase_public_report_workflow_rls_hardening.sql
-- Safe to re-run.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Table
-- ------------------------------------------------------------

create table if not exists public.public_report_repair_actions (
  id                      uuid primary key default gen_random_uuid(),

  -- One follow-up per report keeps the model (and the demo) simple.
  report_id               uuid not null unique
                            references public.public_reports(id) on delete cascade,
  resolution_id           uuid
                            references public.public_report_resolutions(id) on delete set null,

  kind                    text not null check (kind in ('repair', 'monitoring')),
  status                  text not null default 'planned'
                            check (status in ('planned', 'completed', 'verified', 'cancelled')),
  responsible_party       text not null
                            check (responsible_party in ('da', 'lgu', 'contractor')),
  target_date             date,

  planned_by              uuid references public.profiles(id) on delete set null,
  planned_at              timestamptz not null default now(),
  planning_note           text,

  completed_by            uuid references public.profiles(id) on delete set null,
  completed_at            timestamptz,
  completion_note         text,

  verified_by             uuid references public.profiles(id) on delete set null,
  verified_at             timestamptz,
  verification_photo_url  text,
  verification_latitude   double precision,
  verification_longitude  double precision,
  verification_accuracy_m double precision,
  verification_distance_m double precision,
  verification_note       text,

  cancelled_by            uuid references public.profiles(id) on delete set null,
  cancelled_at            timestamptz,
  cancel_reason           text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- Structural guarantees the RPCs also enforce, kept here as a second wall.
  constraint repair_verified_needs_evidence check (
    status <> 'verified'
    or (verified_by is not null
        and verified_at is not null
        and verification_photo_url is not null
        and verification_latitude is not null
        and verification_longitude is not null)
  ),
  constraint repair_verifier_not_completer check (
    verified_by is null or completed_by is null or verified_by <> completed_by
  )
);

create index if not exists idx_repair_actions_status
  on public.public_report_repair_actions(status);
create index if not exists idx_repair_actions_open_target
  on public.public_report_repair_actions(target_date)
  where status in ('planned', 'completed');

create or replace function public._public_report_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_repair_actions_touch on public.public_report_repair_actions;
create trigger trg_repair_actions_touch
before update on public.public_report_repair_actions
for each row execute function public._public_report_touch_updated_at();

-- Trigger-only helper: no client needs to be able to execute it.
revoke execute on function public._public_report_touch_updated_at() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Row-level security: read-only for staff, nothing writable directly
-- ------------------------------------------------------------

alter table public.public_report_repair_actions enable row level security;

-- Supabase grants new public tables to anon/authenticated by default. Remove
-- that, then grant back only what the policies below will further restrict.
revoke all on table public.public_report_repair_actions from public, anon, authenticated;
grant select on table public.public_report_repair_actions to authenticated;

drop policy if exists repair_actions_select_admin on public.public_report_repair_actions;
create policy repair_actions_select_admin
  on public.public_report_repair_actions for select to authenticated
  using (public.public_report_current_role() = 'admin');

drop policy if exists repair_actions_select_assigned_engineer on public.public_report_repair_actions;
create policy repair_actions_select_assigned_engineer
  on public.public_report_repair_actions for select to authenticated
  using (
    public.public_report_current_role() = 'field_engineer'
    and exists (
      select 1
      from public.public_reports pr
      where pr.id = public_report_repair_actions.report_id
        and pr.assigned_engineer_id = auth.uid()
    )
  );

-- Deliberately NO insert / update / delete policies.

-- ------------------------------------------------------------
-- 3. Citizen-safe view (same shape and predicate as the other citizen views)
--    Exposes WHAT is happening and WHEN, never who did it or any internal note.
-- ------------------------------------------------------------

create or replace view public.public_report_repair_actions_citizen_view
with (security_barrier = true)
as
select
  a.id,
  a.report_id,
  a.kind,
  a.status,
  a.responsible_party,
  a.target_date,
  a.completed_at,
  a.verified_at,
  a.verification_photo_url,
  a.created_at
from public.public_report_repair_actions a
join public.public_reports pr on pr.id = a.report_id
where a.status <> 'cancelled'
  and (pr.status <> 'dismissed' or pr.user_id = auth.uid());

grant select on public.public_report_repair_actions_citizen_view to anon, authenticated;

-- ------------------------------------------------------------
-- 4. Internal helper: great-circle distance in metres
-- ------------------------------------------------------------

create or replace function public._public_report_distance_m(
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision
)
returns double precision
language sql
immutable
set search_path = public
as $function$
  select 6371000.0 * 2 * asin(least(1.0, sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2))
      * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  )));
$function$;

revoke execute on function public._public_report_distance_m(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- 5. RPC: admin plans the follow-up for a resolved report
-- ------------------------------------------------------------

create or replace function public.plan_public_report_repair(
  p_report_id uuid,
  p_responsible_party text,
  p_target_date date default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_report public.public_reports%rowtype;
  v_res record;
  v_party text := lower(btrim(coalesce(p_responsible_party, '')));
  v_kind text;
  v_status text;
  v_action_id uuid;
begin
  perform public._public_report_require_admin();

  if v_party not in ('da', 'lgu', 'contractor') then
    raise exception 'Responsible party must be DA, LGU or contractor';
  end if;

  select * into v_report
  from public.public_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report does not exist';
  end if;

  if v_report.status <> 'resolved' then
    raise exception 'A repair can only be planned for a resolved report';
  end if;

  select r.id, r.resolution_type into v_res
  from public.public_report_resolutions r
  where r.report_id = p_report_id
  order by r.resolved_at desc nulls last, r.created_at desc nulls last
  limit 1;

  if not found then
    raise exception 'A resolution record is required before planning a repair';
  end if;

  if v_res.resolution_type not in
     ('repaired', 'scheduled_for_repair', 'referred_to_contractor', 'monitoring_required') then
    raise exception 'This resolution outcome does not call for follow-up work';
  end if;

  if exists (select 1 from public.public_report_repair_actions where report_id = p_report_id) then
    raise exception 'A follow-up already exists for this report';
  end if;

  if v_res.resolution_type = 'referred_to_contractor' and v_party <> 'contractor' then
    raise exception 'A report referred to a contractor must be assigned to the contractor';
  end if;

  v_kind := case when v_res.resolution_type = 'monitoring_required' then 'monitoring' else 'repair' end;

  if v_res.resolution_type = 'repaired' then
    -- Already claimed done at resolution: it still needs independent verification.
    v_status := 'completed';
  else
    v_status := 'planned';
    if p_target_date is null then
      raise exception 'A target date is required';
    end if;
    if p_target_date < current_date then
      raise exception 'The target date cannot be in the past';
    end if;
  end if;

  insert into public.public_report_repair_actions (
    report_id, resolution_id, kind, status, responsible_party, target_date,
    planned_by, planning_note,
    completed_by, completed_at, completion_note
  )
  values (
    p_report_id, v_res.id, v_kind, v_status, v_party, p_target_date,
    auth.uid(), nullif(btrim(coalesce(p_note, '')), ''),
    case when v_status = 'completed' then auth.uid() end,
    case when v_status = 'completed' then now() end,
    case when v_status = 'completed' then 'Recorded as repaired at resolution.' end
  )
  returning id into v_action_id;

  perform public._public_report_add_audit(
    p_report_id,
    'REPAIR_PLANNED',
    jsonb_build_object('repair_status', null),
    jsonb_build_object('repair_status', v_status, 'kind', v_kind, 'responsible_party', v_party, 'target_date', p_target_date),
    nullif(btrim(coalesce(p_note, '')), ''),
    jsonb_build_object('repair_action_id', v_action_id, 'resolution_type', v_res.resolution_type)
  );

  if v_report.user_id is not null then
    insert into public.notifications (user_id, type, title, message, report_id, is_read)
    values (
      v_report.user_id,
      'public_report_repair_planned',
      case when v_status = 'completed' then 'Repair awaiting verification' else 'Repair scheduled' end,
      case when v_status = 'completed'
           then 'Staff recorded your reported issue as repaired. An engineer will confirm it on site.'
           else 'Follow-up work has been scheduled for your report.' end,
      p_report_id,
      false
    );
  end if;

  -- A repaired claim starts as 'completed', so the engineer who inspected the
  -- site is the one who has to confirm it. Tell them, server-side, rather than
  -- relying on the client to remember.
  if v_status = 'completed' and v_report.assigned_engineer_id is not null then
    insert into public.notifications (user_id, type, title, message, report_id, is_read)
    values (
      v_report.assigned_engineer_id,
      'public_report_repair_ready_to_verify',
      'Repair ready to verify',
      'Follow-up work on a report you inspected was recorded as done. Please confirm it on site.',
      p_report_id,
      false
    );
  end if;

  return v_action_id;
end;
$function$;

-- ------------------------------------------------------------
-- 6. RPC: admin records the work as completed
-- ------------------------------------------------------------

create or replace function public.complete_public_report_repair(
  p_action_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_action public.public_report_repair_actions%rowtype;
  v_eng uuid;
begin
  perform public._public_report_require_admin();

  if coalesce(btrim(p_note), '') = '' then
    raise exception 'A note describing the work done is required';
  end if;

  select * into v_action
  from public.public_report_repair_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'Repair action does not exist';
  end if;

  if v_action.status <> 'planned' then
    raise exception 'Only a planned repair can be marked completed';
  end if;

  update public.public_report_repair_actions
  set status = 'completed',
      completed_by = auth.uid(),
      completed_at = now(),
      completion_note = btrim(p_note)
  where id = p_action_id;

  perform public._public_report_add_audit(
    v_action.report_id,
    'REPAIR_COMPLETED',
    jsonb_build_object('repair_status', 'planned'),
    jsonb_build_object('repair_status', 'completed'),
    btrim(p_note),
    jsonb_build_object('repair_action_id', p_action_id)
  );

  select assigned_engineer_id into v_eng
  from public.public_reports
  where id = v_action.report_id;

  if v_eng is not null then
    insert into public.notifications (user_id, type, title, message, report_id, is_read)
    values (
      v_eng,
      'public_report_repair_ready_to_verify',
      'Repair ready to verify',
      'Follow-up work on a report you inspected was recorded as done. Please confirm it on site.',
      v_action.report_id,
      false
    );
  end if;
end;
$function$;

-- ------------------------------------------------------------
-- 7. RPC: independent verification, with evidence checked server-side
-- ------------------------------------------------------------

create or replace function public.verify_public_report_repair(
  p_action_id uuid,
  p_photo_url text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  c_max_distance_m constant double precision := 500;
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
  if p_accuracy_m is not null and p_accuracy_m < 0 then
    raise exception 'GPS accuracy must not be negative';
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
      verification_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_action_id;

  perform public._public_report_add_audit(
    v_action.report_id,
    'REPAIR_VERIFIED',
    jsonb_build_object('repair_status', 'completed'),
    jsonb_build_object('repair_status', 'verified'),
    nullif(btrim(coalesce(p_note, '')), ''),
    jsonb_build_object('repair_action_id', p_action_id, 'distance_m', round(coalesce(v_dist, 0)), 'verifier_role', v_role)
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

-- ------------------------------------------------------------
-- 8. RPC: admin cancels a mistaken or abandoned follow-up
-- ------------------------------------------------------------

create or replace function public.cancel_public_report_repair(
  p_action_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_action public.public_report_repair_actions%rowtype;
begin
  perform public._public_report_require_admin();

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A cancellation reason is required';
  end if;

  select * into v_action
  from public.public_report_repair_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'Repair action does not exist';
  end if;

  if v_action.status not in ('planned', 'completed') then
    raise exception 'Only a planned or completed repair can be cancelled';
  end if;

  update public.public_report_repair_actions
  set status = 'cancelled',
      cancelled_by = auth.uid(),
      cancelled_at = now(),
      cancel_reason = btrim(p_reason)
  where id = p_action_id;

  perform public._public_report_add_audit(
    v_action.report_id,
    'REPAIR_CANCELLED',
    jsonb_build_object('repair_status', v_action.status),
    jsonb_build_object('repair_status', 'cancelled'),
    btrim(p_reason),
    jsonb_build_object('repair_action_id', p_action_id)
  );
end;
$function$;

-- ------------------------------------------------------------
-- 9. Grants: authenticated only; the role guards live inside each function
-- ------------------------------------------------------------

revoke execute on function public.plan_public_report_repair(uuid, text, date, text) from public, anon;
revoke execute on function public.complete_public_report_repair(uuid, text) from public, anon;
revoke execute on function public.verify_public_report_repair(uuid, text, double precision, double precision, double precision, text) from public, anon;
revoke execute on function public.cancel_public_report_repair(uuid, text) from public, anon;

grant execute on function public.plan_public_report_repair(uuid, text, date, text) to authenticated;
grant execute on function public.complete_public_report_repair(uuid, text) to authenticated;
grant execute on function public.verify_public_report_repair(uuid, text, double precision, double precision, double precision, text) to authenticated;
grant execute on function public.cancel_public_report_repair(uuid, text) to authenticated;

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

  execute $f$ create function pg_temp.mk(rtype text, eng uuid, cit uuid) returns uuid language plpgsql as $b$
    declare rid uuid;
    begin
      insert into public.public_reports (municipality, barangay, project_name, description, status, engineer_status, verification, user_id, assigned_engineer_id, latitude, longitude, photo_url)
      values ('TEST', 'TEST', 'REPAIR TEST', 'fixture', 'resolved', 'validated', 'Needs Review', cit, eng, 10.78, 122.40, 'x') returning id into rid;
      insert into public.public_report_resolutions (report_id, resolution_type, summary, resolved_at, created_at) values (rid, rtype, 'fixture', now(), now());
      return rid;
    end $b$ $f$;

  -- fixtures, created as an admin so the citizen-insert trigger does not normalise them
  perform pg_temp.as_user(adm_a);
  rep1 := pg_temp.mk('scheduled_for_repair', eng_1, cit);
  rep2 := pg_temp.mk('referred_to_contractor', eng_1, cit);
  rep3 := pg_temp.mk('no_action_required', eng_1, cit);
  rep4 := pg_temp.mk('repaired', eng_1, cit);

  r := r || E'--- planning ---\n';
  perform pg_temp.as_user(cit);
  r := r || pg_temp.attempt('citizen cannot plan a repair', format('select public.plan_public_report_repair(%L,%L,%L)', rep1, 'da', (current_date + 3)::text), 'Admin role required') || E'\n';
  perform pg_temp.as_user(eng_1);
  r := r || pg_temp.attempt('engineer cannot plan a repair', format('select public.plan_public_report_repair(%L,%L,%L)', rep1, 'da', (current_date + 3)::text), 'Admin role required') || E'\n';
  perform pg_temp.as_user(adm_a);
  r := r || pg_temp.attempt('no target date is rejected', format('select public.plan_public_report_repair(%L,%L)', rep1, 'da'), 'target date is required') || E'\n';
  r := r || pg_temp.attempt('past target date is rejected', format('select public.plan_public_report_repair(%L,%L,%L)', rep1, 'da', (current_date - 1)::text), 'cannot be in the past') || E'\n';
  r := r || pg_temp.attempt('bad responsible party is rejected', format('select public.plan_public_report_repair(%L,%L,%L)', rep1, 'mayor', (current_date + 3)::text), 'Responsible party') || E'\n';
  r := r || pg_temp.attempt('no_action_required has no follow-up', format('select public.plan_public_report_repair(%L,%L,%L)', rep3, 'da', (current_date + 3)::text), 'does not call for follow-up') || E'\n';
  r := r || pg_temp.attempt('contractor referral must go to the contractor', format('select public.plan_public_report_repair(%L,%L,%L)', rep2, 'da', (current_date + 3)::text), 'must be assigned to the contractor') || E'\n';
  r := r || pg_temp.attempt('contractor referral accepted with contractor', format('select public.plan_public_report_repair(%L,%L,%L)', rep2, 'contractor', (current_date + 3)::text), null) || E'\n';
  r := r || pg_temp.attempt('admin plans a scheduled repair', format('select public.plan_public_report_repair(%L,%L,%L,%L)', rep1, 'da', (current_date + 3)::text, 'pave 40 m'), null) || E'\n';
  r := r || pg_temp.attempt('second plan for the same report is rejected', format('select public.plan_public_report_repair(%L,%L,%L)', rep1, 'da', (current_date + 3)::text), 'already exists') || E'\n';
  select id into act1 from public.public_report_repair_actions where report_id = rep1;

  r := r || E'--- completion ---\n';
  perform pg_temp.as_user(eng_1);
  r := r || pg_temp.attempt('engineer cannot mark complete', format('select public.complete_public_report_repair(%L,%L)', act1, 'done'), 'Admin role required') || E'\n';
  perform pg_temp.as_user(adm_a);
  r := r || pg_temp.attempt('verify before completion is rejected', format('select public.verify_public_report_repair(%L,%L,%s,%s)', act1, 'https://x/a.jpg', 10.7801, 122.4001), 'Only a completed repair') || E'\n';
  r := r || pg_temp.attempt('complete without a note is rejected', format('select public.complete_public_report_repair(%L,%L)', act1, ' '), 'note describing the work') || E'\n';
  r := r || pg_temp.attempt('admin marks it complete', format('select public.complete_public_report_repair(%L,%L)', act1, 'paved'), null) || E'\n';
  r := r || pg_temp.attempt('complete twice is rejected', format('select public.complete_public_report_repair(%L,%L)', act1, 'again'), 'Only a planned repair') || E'\n';

  r := r || E'--- verification: separation of duties + evidence ---\n';
  perform pg_temp.as_user(adm_a);
  r := r || pg_temp.attempt('the completer cannot verify their own work', format('select public.verify_public_report_repair(%L,%L,%s,%s)', act1, 'https://x/a.jpg', 10.7801, 122.4001), 'cannot also verify') || E'\n';
  perform pg_temp.as_user(cit);
  r := r || pg_temp.attempt('a citizen cannot verify', format('select public.verify_public_report_repair(%L,%L,%s,%s)', act1, 'https://x/a.jpg', 10.7801, 122.4001), 'Only a field engineer or admin') || E'\n';
  perform pg_temp.as_user(eng_2);
  r := r || pg_temp.attempt('an unassigned engineer cannot verify', format('select public.verify_public_report_repair(%L,%L,%s,%s)', act1, 'https://x/a.jpg', 10.7801, 122.4001), 'Only the engineer assigned') || E'\n';
  perform pg_temp.as_user(eng_1);
  r := r || pg_temp.attempt('a missing photo is rejected', format('select public.verify_public_report_repair(%L,%L,%s,%s)', act1, ' ', 10.7801, 122.4001), 'after-photo is required') || E'\n';
  r := r || pg_temp.attempt('missing GPS is rejected', format('select public.verify_public_report_repair(%L,%L,null,null)', act1, 'https://x/a.jpg'), 'GPS coordinates are required') || E'\n';
  r := r || pg_temp.attempt('verification from about 11 km away is rejected', format('select public.verify_public_report_repair(%L,%L,%s,%s)', act1, 'https://x/a.jpg', 10.88, 122.40), 'from the reported site') || E'\n';
  r := r || pg_temp.attempt('assigned engineer verifies with photo + GPS on site', format('select public.verify_public_report_repair(%L,%L,%s,%s,%s,%L)', act1, 'https://x/after.jpg', 10.7801, 122.4001, 8, 'looks good'), null) || E'\n';
  r := r || pg_temp.attempt('verifying twice is rejected', format('select public.verify_public_report_repair(%L,%L,%s,%s)', act1, 'https://x/a.jpg', 10.7801, 122.4001), 'Only a completed repair') || E'\n';
  perform pg_temp.as_user(adm_a);
  r := r || pg_temp.attempt('a verified repair cannot be cancelled', format('select public.cancel_public_report_repair(%L,%L)', act1, 'oops'), 'Only a planned or completed') || E'\n';

  r := r || E'--- a "repaired" claim is verified, not trusted ---\n';
  perform pg_temp.as_user(adm_a);
  r := r || pg_temp.attempt('admin records a repaired outcome', format('select public.plan_public_report_repair(%L,%L)', rep4, 'da'), null) || E'\n';
  select id into act4 from public.public_report_repair_actions where report_id = rep4;
  select status into st from public.public_report_repair_actions where id = act4;
  r := r || case when st = 'completed' then 'PASS  a repaired claim starts as completed, not verified' else 'FAIL  repaired claim status = ' || coalesce(st, 'null') end || E'\n';
  r := r || pg_temp.attempt('the admin who claimed it cannot verify it', format('select public.verify_public_report_repair(%L,%L,%s,%s)', act4, 'https://x/a.jpg', 10.7801, 122.4001), 'cannot also verify') || E'\n';
  perform pg_temp.as_user(adm_b);
  r := r || pg_temp.attempt('a different admin can verify it', format('select public.verify_public_report_repair(%L,%L,%s,%s)', act4, 'https://x/a.jpg', 10.7801, 122.4001), null) || E'\n';

  r := r || E'--- cancellation ---\n';
  select id into actx from public.public_report_repair_actions where report_id = rep2;
  perform pg_temp.as_user(eng_1);
  r := r || pg_temp.attempt('an engineer cannot cancel', format('select public.cancel_public_report_repair(%L,%L)', actx, 'x'), 'Admin role required') || E'\n';
  perform pg_temp.as_user(adm_a);
  r := r || pg_temp.attempt('cancelling needs a reason', format('select public.cancel_public_report_repair(%L,%L)', actx, ' '), 'reason is required') || E'\n';

  r := r || E'--- second wall: the table itself ---\n';
  r := r || pg_temp.attempt('table refuses "verified" without evidence', format('update public.public_report_repair_actions set status=%L where id=%L', 'verified', actx), 'repair_verified_needs_evidence') || E'\n';
  r := r || pg_temp.attempt('admin cancels a planned repair', format('select public.cancel_public_report_repair(%L,%L)', actx, 'wrong party'), null) || E'\n';

  r := r || E'--- overall ---\n';
  select count(*) into n from public.public_report_activity_logs where report_id in (rep1, rep4) and action like 'REPAIR_%';
  r := r || case when n = 5 then 'PASS' else 'FAIL' end || '  audit entries for the two repairs: ' || n || ' (expect 5: plan+complete+verify, plan+verify)' || E'\n';
  select count(*) into n from public.notifications where report_id in (rep1, rep4) and user_id = cit and type like 'public_report_repair_%';
  r := r || case when n = 4 then 'PASS' else 'FAIL' end || '  citizen notifications created: ' || n || ' (expect 4: planned+verified for each)' || E'\n';
  select count(*) into n from public.notifications where report_id in (rep1, rep4) and user_id = eng_1 and type = 'public_report_repair_ready_to_verify';
  r := r || case when n = 2 then 'PASS' else 'FAIL' end || '  assigned engineer told a repair is ready to verify: ' || n || ' (expect 2: one per repair)' || E'\n';
  select count(*) into n from public.notifications where report_id in (rep1, rep4) and user_id = eng_2;
  r := r || case when n = 0 then 'PASS' else 'FAIL' end || '  the OTHER engineer is not notified: ' || n || E'\n';
  select verification_distance_m into dist from public.public_report_repair_actions where id = act1;
  r := r || 'INFO  recorded verification distance (m): ' || round(coalesce(dist, -1)::numeric, 1) || E'\n';
  select status into rstat from public.public_reports where id = rep1;
  r := r || case when rstat = 'resolved' then 'PASS' else 'FAIL' end || '  the REPORT itself is still "resolved" and untouched: ' || rstat || E'\n';
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'public_report_repair_actions_citizen_view' and (column_name like '%note%' or column_name like '%\_by' or column_name like '%reason%');
  r := r || case when n = 0 then 'PASS' else 'FAIL' end || '  citizen view exposes no notes, actor ids or reasons (' || n || ' such columns)' || E'\n';
  r := r || case when not has_table_privilege('anon', 'public.public_report_repair_actions', 'select')
                  and not has_table_privilege('authenticated', 'public.public_report_repair_actions', 'insert')
                  and not has_table_privilege('authenticated', 'public.public_report_repair_actions', 'update')
                  and not has_table_privilege('authenticated', 'public.public_report_repair_actions', 'delete')
             then 'PASS' else 'FAIL' end || '  clients have no direct write access, and anon cannot read the table' || E'\n';
  r := r || case when not has_function_privilege('anon', 'public.verify_public_report_repair(uuid,text,double precision,double precision,double precision,text)', 'execute')
                  and has_function_privilege('authenticated', 'public.verify_public_report_repair(uuid,text,double precision,double precision,double precision,text)', 'execute')
             then 'PASS' else 'FAIL' end || '  RPC execute: anon denied, authenticated allowed' || E'\n';

  raise exception E'REPAIR-ACTIONS MIGRATION: DRY RUN + BEHAVIOUR (rolled back, nothing saved)\n%', r;
end $dry$;
