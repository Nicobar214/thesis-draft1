-- ============================================================
-- Citizen reports: the LGU fixes minor issues, the contractor major ones,
-- and the admin resolves only after their on-site after-photo.
--
--   Minor (LGU):  admin sends it straight to the LGU -> LGU accepts (work
--                 date) -> starts -> sends after-photo -> admin resolves.
--   Major (contractor): admin assigns a field engineer -> engineer inspects
--                 -> admin validates -> admin sends it to the contractor ->
--                 contractor accepts -> starts -> sends after-photo ->
--                 (optional: engineer confirms on site) -> admin resolves.
--
-- The work order is the existing public_report_repair_actions row, now made
-- before the report is resolved. Either handler can return a job that is not
-- theirs; the admin can send finished work back.
--
-- The issue type -> handler map repeats SEVERITY_TAXONOMY in
-- src/lib/publicReportStatus.js: keep the two in sync.
-- Safe to re-run.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Issue types: allow the new keys in the legacy category column too
-- ------------------------------------------------------------

alter table public.public_reports drop constraint if exists public_reports_category_check;
alter table public.public_reports add constraint public_reports_category_check
  check (category is null or category in (
    'issue', 'safety', 'flood', 'general',
    'road_damage', 'structural', 'obstruction', 'roadside'
  ));

-- ------------------------------------------------------------
-- 2. Who handles the report
-- ------------------------------------------------------------

create or replace function public.public_report_handler_for(p_type text, p_problem text)
returns text
language sql
immutable
set search_path = public
as $function$
  select case
    when lower(coalesce(p_type, '')) in ('road_damage', 'structural') then 'contractor'
    when lower(coalesce(p_type, '')) in ('obstruction', 'roadside') then 'lgu'
    -- Older rows: decide by the specific problem.
    when lower(coalesce(p_problem, '')) in (
      'fallen_tree', 'landslide', 'sharp_debris', 'vegetation', 'road_flooded', 'partial_flood',
      'no_signage', 'poor_lighting', 'items_on_road', 'accident_site', 'other'
    ) then 'lgu'
    when coalesce(p_problem, '') <> '' then 'contractor'
    when lower(coalesce(p_type, '')) in ('safety', 'flood', 'general') then 'lgu'
    else 'contractor'
  end;
$function$;

alter table public.public_reports
  add column if not exists handled_by text;

alter table public.public_reports drop constraint if exists public_reports_handled_by_check;
alter table public.public_reports add constraint public_reports_handled_by_check
  check (handled_by is null or handled_by in ('lgu', 'contractor'));

-- Set from the issue type on insert. Only an admin may choose it directly.
create or replace function public._public_report_set_handler()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
begin
  if new.handled_by is null or coalesce(public.public_report_current_role(), '') <> 'admin' then
    new.handled_by := public.public_report_handler_for(coalesce(new.severity_category, new.category), new.specific_problem);
  end if;
  return new;
end;
$function$;

drop trigger if exists public_reports_set_handler on public.public_reports;
create trigger public_reports_set_handler
  before insert on public.public_reports
  for each row execute function public._public_report_set_handler();

update public.public_reports
set handled_by = public.public_report_handler_for(coalesce(severity_category, category), specific_problem)
where handled_by is null;

-- ------------------------------------------------------------
-- 3. Work order columns
-- ------------------------------------------------------------

alter table public.public_report_repair_actions
  add column if not exists accepted_by uuid references auth.users(id),
  add column if not exists accepted_at timestamptz,
  add column if not exists work_date date,
  add column if not exists started_at timestamptz,
  add column if not exists start_note text,
  add column if not exists returned_at timestamptz,
  add column if not exists sent_back_at timestamptz,
  add column if not exists engineer_check_requested_at timestamptz,
  add column if not exists work_submitted_by uuid references auth.users(id),
  add column if not exists work_submitted_at timestamptz,
  add column if not exists work_photo_url text,
  add column if not exists work_latitude double precision,
  add column if not exists work_longitude double precision,
  add column if not exists work_accuracy_m double precision,
  add column if not exists work_distance_m double precision,
  add column if not exists work_captured_at timestamptz,
  add column if not exists work_note text;

-- ------------------------------------------------------------
-- 4. Helpers: the handler's people
-- ------------------------------------------------------------

-- LGU accounts of the report's municipality, or the project's contractor.
create or replace function public._public_report_handler_users(p_report_id uuid, p_party text)
returns setof uuid
language sql
stable
security definer
set search_path = public
set row_security = off
as $function$
  select p.id
  from public.profiles p
  join public.public_reports pr on pr.id = p_report_id
  where p_party = 'lgu'
    and p.role = 'lgu'
    and lower(btrim(coalesce(p.municipality, ''))) = lower(btrim(coalesce(pr.municipality, '')))
  union
  select fp.contractor_id
  from public.fmr_projects fp
  join public.public_reports pr on pr.id = p_report_id
  where p_party = 'contractor'
    and fp.contractor_id is not null
    and pr.project_id = 'fmr-' || fp.id::text;
$function$;

revoke execute on function public._public_report_handler_users(uuid, text) from public, anon, authenticated;

create or replace function public._public_report_is_handler(p_report_id uuid, p_party text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $function$
  select auth.uid() in (select public._public_report_handler_users(p_report_id, p_party));
$function$;

revoke execute on function public._public_report_is_handler(uuid, text) from public, anon;
grant execute on function public._public_report_is_handler(uuid, text) to authenticated;

-- Notify everyone in a set (admins, handler users).
create or replace function public._public_report_notify_admins(p_report_id uuid, p_type text, p_title text, p_message text)
returns void
language sql
security definer
set search_path = public
set row_security = off
as $function$
  insert into public.notifications (user_id, type, title, message, report_id, is_read)
  select p.id, p_type, p_title, p_message, p_report_id, false
  from public.profiles p where p.role = 'admin';
$function$;

revoke execute on function public._public_report_notify_admins(uuid, text, text, text) from public, anon, authenticated;

create or replace function public._public_report_notify_citizen(p_report_id uuid, p_type text, p_title text, p_message text)
returns void
language sql
security definer
set search_path = public
set row_security = off
as $function$
  insert into public.notifications (user_id, type, title, message, report_id, is_read)
  select pr.user_id, p_type, p_title, p_message, pr.id, false
  from public.public_reports pr where pr.id = p_report_id and pr.user_id is not null;
$function$;

revoke execute on function public._public_report_notify_citizen(uuid, text, text, text) from public, anon, authenticated;

-- Loads a work order for the handler and checks it is theirs.
create or replace function public._public_report_handler_action(p_action_id uuid)
returns public.public_report_repair_actions
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_action public.public_report_repair_actions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  select * into v_action from public.public_report_repair_actions where id = p_action_id for update;
  if not found then
    raise exception 'Repair action does not exist';
  end if;
  if v_action.responsible_party not in ('lgu', 'contractor')
     or not public._public_report_is_handler(v_action.report_id, v_action.responsible_party) then
    raise exception 'Only the assigned LGU or contractor can update this job';
  end if;
  return v_action;
end;
$function$;

revoke execute on function public._public_report_handler_action(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 5. Admin: change the handler
-- ------------------------------------------------------------

create or replace function public.set_public_report_handler(p_report_id uuid, p_handler text)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_handler text := lower(btrim(coalesce(p_handler, '')));
  v_old text;
begin
  perform public._public_report_require_admin();

  if v_handler not in ('lgu', 'contractor') then
    raise exception 'Handler must be LGU or contractor';
  end if;

  select handled_by into v_old from public.public_reports where id = p_report_id for update;
  if not found then
    raise exception 'Report does not exist';
  end if;

  if exists (
    select 1 from public.public_report_repair_actions
    where report_id = p_report_id and status <> 'cancelled'
  ) then
    raise exception 'The handler cannot change while a job is open; cancel it first';
  end if;

  update public.public_reports set handled_by = v_handler where id = p_report_id;

  perform public._public_report_add_audit(
    p_report_id, 'HANDLER_CHANGED',
    jsonb_build_object('handled_by', v_old),
    jsonb_build_object('handled_by', v_handler),
    null, '{}'::jsonb
  );
end;
$function$;

-- ------------------------------------------------------------
-- 6. Admin: send the job to the LGU or the contractor
-- ------------------------------------------------------------

create or replace function public.assign_public_report_work(
  p_report_id uuid,
  p_party text,
  p_target_date date,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_party text := lower(btrim(coalesce(p_party, '')));
  v_report public.public_reports%rowtype;
  v_existing public.public_report_repair_actions%rowtype;
  v_action_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public._public_report_require_admin();

  if v_party not in ('lgu', 'contractor') then
    raise exception 'The job must go to the LGU or the contractor';
  end if;
  if p_target_date is null then
    raise exception 'A target date is required';
  end if;
  if p_target_date < current_date then
    raise exception 'The target date cannot be in the past';
  end if;

  select * into v_report from public.public_reports where id = p_report_id for update;
  if not found then
    raise exception 'Report does not exist';
  end if;
  if v_report.status in ('resolved', 'dismissed') then
    raise exception 'This report is already closed';
  end if;

  if v_party = 'contractor' then
    -- Major repairs need a field engineer to confirm the problem first.
    if v_report.engineer_status is distinct from 'validated' then
      raise exception 'A contractor job needs a validated field inspection first';
    end if;
  else
    -- Minor jobs go straight to the LGU, unless an engineer visit is still open.
    if v_report.engineer_status is not null and v_report.engineer_status <> 'validated' then
      raise exception 'Finish or remove the field inspection before sending this to the LGU';
    end if;
  end if;

  select * into v_existing from public.public_report_repair_actions where report_id = p_report_id for update;
  if found and v_existing.status <> 'cancelled' then
    raise exception 'A job is already open for this report';
  end if;

  if v_report.status = 'pending' then
    update public.public_reports
    set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where id = p_report_id;
    perform public._public_report_add_audit(
      p_report_id, 'REPORT_REVIEWED',
      jsonb_build_object('status', 'pending'),
      jsonb_build_object('status', 'reviewed'),
      'Admin reviewed the report and sent it to the LGU.', '{}'::jsonb
    );
  end if;

  update public.public_reports set handled_by = v_party where id = p_report_id;

  if v_existing.id is not null then
    -- One work order per report: reuse a cancelled or returned one.
    update public.public_report_repair_actions
    set status = 'planned', kind = 'repair', responsible_party = v_party, target_date = p_target_date,
        resolution_id = null, planned_by = auth.uid(), planned_at = now(), planning_note = v_note,
        accepted_by = null, accepted_at = null, work_date = null, started_at = null, start_note = null,
        returned_at = null, sent_back_at = null, engineer_check_requested_at = null,
        completed_by = null, completed_at = null, completion_note = null,
        verified_by = null, verified_at = null, verification_photo_url = null,
        verification_latitude = null, verification_longitude = null, verification_accuracy_m = null,
        verification_distance_m = null, verification_captured_at = null, verification_note = null,
        work_submitted_by = null, work_submitted_at = null, work_photo_url = null,
        work_latitude = null, work_longitude = null, work_accuracy_m = null, work_distance_m = null,
        work_captured_at = null, work_note = null,
        cancelled_by = null, cancelled_at = null, cancel_reason = null
    where id = v_existing.id
    returning id into v_action_id;
  else
    insert into public.public_report_repair_actions (
      report_id, resolution_id, kind, status, responsible_party, target_date, planned_by, planning_note
    )
    values (p_report_id, null, 'repair', 'planned', v_party, p_target_date, auth.uid(), v_note)
    returning id into v_action_id;
  end if;

  perform public._public_report_add_audit(
    p_report_id, 'WORK_ASSIGNED',
    jsonb_build_object('repair_status', null),
    jsonb_build_object('repair_status', 'planned', 'responsible_party', v_party, 'target_date', p_target_date),
    v_note,
    jsonb_build_object('repair_action_id', v_action_id)
  );

  perform public._public_report_notify_citizen(
    p_report_id, 'public_report_work_assigned', 'Repair assigned',
    case when v_party = 'lgu' then 'Your LGU has been asked to fix the problem you reported.'
         else 'The project contractor has been asked to repair the problem you reported.' end
  );

  return v_action_id;
end;
$function$;

-- ------------------------------------------------------------
-- 7. Handler: accept, start, send the after-photo, or return
-- ------------------------------------------------------------

create or replace function public.accept_public_report_work(p_action_id uuid, p_work_date date)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_action public.public_report_repair_actions%rowtype;
begin
  v_action := public._public_report_handler_action(p_action_id);
  if v_action.status <> 'planned' or v_action.accepted_at is not null then
    raise exception 'This job was already accepted or is no longer open';
  end if;
  if p_work_date is null then
    raise exception 'Choose the date the work will be done';
  end if;
  if p_work_date < current_date then
    raise exception 'The work date cannot be in the past';
  end if;

  update public.public_report_repair_actions
  set accepted_by = auth.uid(), accepted_at = now(), work_date = p_work_date
  where id = p_action_id;

  perform public._public_report_add_audit(
    v_action.report_id, 'WORK_ACCEPTED', '{}'::jsonb,
    jsonb_build_object('work_date', p_work_date), null,
    jsonb_build_object('repair_action_id', p_action_id, 'party', v_action.responsible_party)
  );
  perform public._public_report_notify_admins(
    v_action.report_id, 'public_report_work_accepted', 'Job accepted',
    (case when v_action.responsible_party = 'lgu' then 'The LGU' else 'The contractor' end)
      || ' accepted the job. Work date: ' || to_char(p_work_date, 'Mon DD, YYYY') || '.'
  );
end;
$function$;

create or replace function public.start_public_report_work(p_action_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_action public.public_report_repair_actions%rowtype;
begin
  v_action := public._public_report_handler_action(p_action_id);
  if v_action.status <> 'planned' then
    raise exception 'This job is no longer open';
  end if;
  if v_action.accepted_at is null then
    raise exception 'Accept the job before starting work';
  end if;
  if v_action.started_at is not null then
    raise exception 'Work on this job has already started';
  end if;

  update public.public_report_repair_actions
  set started_at = now(), start_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_action_id;

  perform public._public_report_add_audit(
    v_action.report_id, 'WORK_STARTED', '{}'::jsonb, '{}'::jsonb,
    nullif(btrim(coalesce(p_note, '')), ''),
    jsonb_build_object('repair_action_id', p_action_id, 'party', v_action.responsible_party)
  );
  perform public._public_report_notify_citizen(
    v_action.report_id, 'public_report_work_started', 'Repair in progress',
    'Work has started on the problem you reported.'
  );
end;
$function$;

create or replace function public.submit_public_report_repair_work(
  p_action_id uuid,
  p_photo_url text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_captured_at timestamptz,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  -- Same evidence rules as verify_public_report_repair.
  c_max_distance_m constant double precision := 500;
  c_max_accuracy_m constant double precision := 100;
  c_max_age        constant interval := interval '48 hours';
  c_clock_skew     constant interval := interval '5 minutes';
  v_action public.public_report_repair_actions%rowtype;
  v_report public.public_reports%rowtype;
  v_dist double precision;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_who text;
begin
  if coalesce(btrim(p_photo_url), '') = '' then
    raise exception 'An after-photo is required';
  end if;
  if p_latitude is null or p_longitude is null then
    raise exception 'GPS coordinates are required';
  end if;
  if p_accuracy_m is null or p_accuracy_m < 0 then
    raise exception 'A GPS accuracy reading is required';
  end if;
  if p_accuracy_m > c_max_accuracy_m then
    raise exception 'GPS accuracy is too low (% m, maximum % m)', round(p_accuracy_m), round(c_max_accuracy_m);
  end if;
  if p_captured_at is null then
    raise exception 'The time the photo was taken is required';
  end if;
  if p_captured_at > now() + c_clock_skew then
    raise exception 'The photo capture time is in the future';
  end if;
  if now() - p_captured_at > c_max_age then
    raise exception 'The photo was taken more than 48 hours ago; take a new one on site';
  end if;

  v_action := public._public_report_handler_action(p_action_id);
  if v_action.status <> 'planned' then
    raise exception 'Only a planned repair can be sent as done';
  end if;
  if v_action.started_at is null then
    raise exception 'Start the work before sending the after-photo';
  end if;
  if p_captured_at < v_action.started_at - c_clock_skew then
    raise exception 'The photo was taken before the work started';
  end if;

  select * into v_report from public.public_reports where id = v_action.report_id;

  if v_report.latitude is not null and v_report.longitude is not null then
    v_dist := public._public_report_distance_m(v_report.latitude, v_report.longitude, p_latitude, p_longitude);
    if v_dist > c_max_distance_m then
      raise exception 'Verification location is % m from the reported site (maximum % m)',
        round(v_dist), round(c_max_distance_m);
    end if;
  end if;

  v_who := case when v_action.responsible_party = 'lgu' then 'The LGU' else 'The contractor' end;

  update public.public_report_repair_actions
  set status = 'completed',
      work_submitted_by = auth.uid(), work_submitted_at = now(),
      work_photo_url = btrim(p_photo_url), work_latitude = p_latitude, work_longitude = p_longitude,
      work_accuracy_m = p_accuracy_m, work_distance_m = v_dist, work_captured_at = p_captured_at, work_note = v_note,
      completed_by = auth.uid(), completed_at = now(),
      completion_note = coalesce(v_note, case when v_action.responsible_party = 'lgu' then 'Fixed by the LGU.' else 'Repaired by the contractor.' end)
  where id = p_action_id;

  perform public._public_report_add_audit(
    v_action.report_id, 'WORK_DONE',
    jsonb_build_object('repair_status', 'planned'),
    jsonb_build_object('repair_status', 'completed'),
    v_note,
    jsonb_build_object(
      'repair_action_id', p_action_id, 'party', v_action.responsible_party,
      'distance_m', round(coalesce(v_dist, 0)), 'accuracy_m', round(p_accuracy_m), 'captured_at', p_captured_at
    )
  );
  perform public._public_report_notify_admins(
    v_action.report_id, 'public_report_work_done', 'Work done — review the after-photo',
    v_who || ' sent an after-photo for ' || coalesce(v_report.project_name, 'a report') || '.'
  );
  perform public._public_report_notify_citizen(
    v_action.report_id, 'public_report_work_done', 'Repair recorded as done',
    v_who || ' sent a photo of the finished work. The DA is checking it.'
  );

  return 'completed';
end;
$function$;

create or replace function public.return_public_report_work(p_action_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_action public.public_report_repair_actions%rowtype;
  v_who text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why the job is being returned';
  end if;
  v_action := public._public_report_handler_action(p_action_id);
  if v_action.status <> 'planned' or v_action.started_at is not null then
    raise exception 'Only a job that has not started can be returned';
  end if;
  v_who := case when v_action.responsible_party = 'lgu' then 'LGU' else 'contractor' end;

  update public.public_report_repair_actions
  set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), returned_at = now(),
      cancel_reason = 'Returned by the ' || v_who || ': ' || btrim(p_reason)
  where id = p_action_id;

  perform public._public_report_add_audit(
    v_action.report_id, 'WORK_RETURNED',
    jsonb_build_object('repair_status', 'planned'),
    jsonb_build_object('repair_status', 'cancelled'),
    btrim(p_reason),
    jsonb_build_object('repair_action_id', p_action_id, 'party', v_action.responsible_party)
  );
  perform public._public_report_notify_admins(
    v_action.report_id, 'public_report_work_returned', 'Job returned by the ' || v_who,
    btrim(p_reason)
  );
end;
$function$;

-- ------------------------------------------------------------
-- 8. Admin: send finished work back, or ask the engineer to check it
-- ------------------------------------------------------------

create or replace function public.reopen_public_report_repair(p_action_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_action public.public_report_repair_actions%rowtype;
  v_status text;
  v_user uuid;
begin
  perform public._public_report_require_admin();

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason for reopening is required';
  end if;

  select * into v_action from public.public_report_repair_actions where id = p_action_id for update;
  if not found then
    raise exception 'Repair action does not exist';
  end if;
  select status into v_status from public.public_reports where id = v_action.report_id;
  if v_action.work_submitted_by is null or v_action.status not in ('completed', 'verified') or v_status = 'resolved' then
    raise exception 'Only work sent by the LGU or contractor can be reopened';
  end if;

  -- Back to "started": the handler only re-sends the after-photo.
  update public.public_report_repair_actions
  set status = 'planned',
      target_date = greatest(coalesce(target_date, current_date), current_date + 3),
      engineer_check_requested_at = null,
      sent_back_at = now(),
      completed_by = null, completed_at = null, completion_note = null,
      verified_by = null, verified_at = null, verification_photo_url = null,
      verification_latitude = null, verification_longitude = null, verification_accuracy_m = null,
      verification_distance_m = null, verification_captured_at = null, verification_note = null,
      work_submitted_by = null, work_submitted_at = null, work_photo_url = null,
      work_latitude = null, work_longitude = null, work_accuracy_m = null, work_distance_m = null,
      work_captured_at = null, work_note = null,
      planning_note = btrim(p_reason)
  where id = p_action_id;

  perform public._public_report_add_audit(
    v_action.report_id, 'WORK_SENT_BACK',
    jsonb_build_object('repair_status', v_action.status),
    jsonb_build_object('repair_status', 'planned'),
    btrim(p_reason),
    jsonb_build_object('repair_action_id', p_action_id)
  );

  for v_user in select public._public_report_handler_users(v_action.report_id, v_action.responsible_party) loop
    insert into public.notifications (user_id, type, title, message, report_id, is_read)
    values (v_user, 'public_report_repair_reopened', 'The DA sent the job back',
            btrim(p_reason), v_action.report_id, false);
  end loop;
end;
$function$;

create or replace function public.request_public_report_work_check(p_action_id uuid)
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

  select * into v_action from public.public_report_repair_actions where id = p_action_id for update;
  if not found then
    raise exception 'Repair action does not exist';
  end if;
  if v_action.status <> 'completed' or v_action.responsible_party <> 'contractor' then
    raise exception 'Only finished contractor work can be checked by an engineer';
  end if;

  select assigned_engineer_id into v_eng from public.public_reports where id = v_action.report_id;
  if v_eng is null then
    raise exception 'This report has no assigned field engineer';
  end if;

  update public.public_report_repair_actions set engineer_check_requested_at = now() where id = p_action_id;

  insert into public.notifications (user_id, type, title, message, report_id, is_read)
  values (v_eng, 'public_report_repair_ready_to_verify', 'Confirm the contractor''s repair',
          'The DA asks you to check the repair on site before the report is resolved.', v_action.report_id, false);
end;
$function$;

-- ------------------------------------------------------------
-- 9. Resolve: after the inspection (as before), and/or after the work order
-- ------------------------------------------------------------

create or replace function public.resolve_public_report(
  p_report_id uuid,
  p_resolution_type text,
  p_resolution_summary text
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_report public.public_reports%rowtype;
  v_inspection public.public_report_field_findings%rowtype;
  v_action public.public_report_repair_actions%rowtype;
  v_has_action boolean := false;
  v_latest_id uuid;
  v_resolution_id uuid;
  v_actor record;
  v_resolution_type text := coalesce(nullif(btrim(p_resolution_type), ''), 'other');
  v_old_state jsonb;
begin
  perform public._public_report_require_admin();

  if coalesce(btrim(p_resolution_summary), '') = '' then
    raise exception 'Resolution summary is required';
  end if;

  if v_resolution_type not in (
    'repaired', 'scheduled_for_repair', 'referred_to_contractor', 'monitoring_required',
    'no_action_required', 'outside_project_scope', 'duplicate_case', 'other'
  ) then
    raise exception 'Invalid resolution type';
  end if;

  select * into v_report from public.public_reports where id = p_report_id for update;
  if not found then
    raise exception 'Report does not exist';
  end if;
  if v_report.status <> 'reviewed' then
    raise exception 'Report cannot be resolved before inspection validation';
  end if;

  select * into v_action
  from public.public_report_repair_actions
  where report_id = p_report_id and status <> 'cancelled'
  for update;
  v_has_action := found;

  if v_has_action and v_action.status = 'planned' then
    raise exception 'The LGU or contractor has not sent the after-photo yet';
  end if;

  if v_report.engineer_status = 'validated' then
    v_latest_id := public._public_report_latest_inspection_id(p_report_id);
    select * into v_inspection
    from public.public_report_field_findings
    where id = v_latest_id and report_id = p_report_id
    for update;
    if not found or v_inspection.status <> 'validated' then
      raise exception 'A validated latest inspection is required before resolution';
    end if;
  elsif not (v_report.handled_by = 'lgu' and v_report.engineer_status is null and v_has_action) then
    -- Minor LGU jobs skip the engineer; everything else needs the inspection.
    raise exception 'Report cannot be resolved before inspection validation';
  end if;

  select full_name, email into v_actor from public.profiles where id = auth.uid();

  v_old_state := jsonb_build_object(
    'status', v_report.status,
    'engineer_status', v_report.engineer_status,
    'inspection_id', v_inspection.id,
    'repair_status', v_action.status
  );

  insert into public.public_report_resolutions (
    report_id, resolution_type, summary, resolved_by, resolved_by_name, resolved_by_email, resolved_at, created_at
  )
  values (
    p_report_id, v_resolution_type, btrim(p_resolution_summary), auth.uid(),
    coalesce(nullif(v_actor.full_name, ''), v_actor.email, 'Administrator'), v_actor.email, now(), now()
  )
  returning id into v_resolution_id;

  -- The admin's resolution accepts the handler's work (unless an engineer
  -- already verified it). Done before the report update so the state
  -- invariant sees a verified work order.
  if v_has_action then
    if v_action.status = 'completed' then
      update public.public_report_repair_actions
      set status = 'verified', resolution_id = v_resolution_id,
          verified_by = auth.uid(), verified_at = now(),
          verification_photo_url = work_photo_url,
          verification_latitude = work_latitude, verification_longitude = work_longitude,
          verification_accuracy_m = work_accuracy_m, verification_distance_m = work_distance_m,
          verification_captured_at = work_captured_at,
          verification_note = 'Accepted by the DA from the after-photo.'
      where id = v_action.id;
    else
      update public.public_report_repair_actions set resolution_id = v_resolution_id where id = v_action.id;
    end if;
  end if;

  update public.public_reports
  set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), updated_at = now()
  where id = p_report_id;

  perform public._public_report_add_audit(
    p_report_id, 'REPORT_RESOLVED', v_old_state,
    jsonb_build_object('status', 'resolved', 'resolution_id', v_resolution_id, 'resolution_type', v_resolution_type),
    btrim(p_resolution_summary),
    jsonb_build_object(
      'inspection_id', v_inspection.id,
      'inspection_number', v_inspection.inspection_number,
      'resolution_id', v_resolution_id,
      'resolution_type', v_resolution_type,
      'repair_action_id', v_action.id
    )
  );

  return v_resolution_id;
end;
$function$;

-- A resolved report needs a validated inspection, or (minor LGU job) an
-- accepted LGU work order.
create or replace function public.public_report_enforce_state_invariant()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
begin
  if new.status = 'pending' and new.engineer_status is not null then
    raise exception 'Invalid public report state: pending reports cannot have engineer workflow status';
  end if;

  if new.status = 'dismissed' and new.engineer_status is not null then
    raise exception 'Invalid public report state: dismissed reports cannot have engineer workflow status';
  end if;

  if new.status = 'resolved'
     and new.engineer_status is distinct from 'validated'
     and coalesce(new.legacy_resolved_without_engineer_validation, false) is not true
     and not (
       new.handled_by = 'lgu'
       and exists (
         select 1 from public.public_report_repair_actions a
         where a.report_id = new.id and a.responsible_party = 'lgu' and a.status = 'verified'
       )
     ) then
    raise exception 'Invalid public report state: resolved reports require validated engineer status unless legacy-grandfathered';
  end if;

  if new.status = 'reviewed'
     and not (
       new.engineer_status is null
       or new.engineer_status in ('assigned', 'in_progress', 'inspected', 'rejected', 'validated')
     ) then
    raise exception 'Invalid public report state';
  end if;

  return new;
end;
$function$;

-- ------------------------------------------------------------
-- 10. Tell the handler when a job is assigned to them
-- ------------------------------------------------------------

create or replace function public._public_report_notify_handler()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_user uuid;
  v_report public.public_reports%rowtype;
begin
  if new.status <> 'planned' or new.responsible_party not in ('lgu', 'contractor') then
    return new;
  end if;
  -- New job, a returned job given out again, or moved to another party.
  if tg_op = 'UPDATE'
     and old.status is distinct from 'cancelled'
     and old.responsible_party is not distinct from new.responsible_party then
    return new;
  end if;

  select * into v_report from public.public_reports where id = new.report_id;

  for v_user in select public._public_report_handler_users(new.report_id, new.responsible_party) loop
    insert into public.notifications (user_id, type, title, message, report_id, is_read)
    values (
      v_user,
      'public_report_repair_assigned',
      case when new.responsible_party = 'lgu' then 'New job from a citizen report' else 'Repair assigned to you' end,
      coalesce(v_report.project_name, 'A road') || ': accept the job and set a work date'
        || case when new.target_date is not null then ' (target ' || to_char(new.target_date, 'Mon DD') || ').' else '.' end,
      new.report_id,
      false
    );
  end loop;
  return new;
end;
$function$;

drop trigger if exists repair_actions_notify_handler on public.public_report_repair_actions;
create trigger repair_actions_notify_handler
  after insert or update of responsible_party, status on public.public_report_repair_actions
  for each row execute function public._public_report_notify_handler();

-- ------------------------------------------------------------
-- 11. Read access for the handler
-- ------------------------------------------------------------

drop policy if exists repair_actions_select_handler on public.public_report_repair_actions;
create policy repair_actions_select_handler
  on public.public_report_repair_actions for select to authenticated
  using (
    public.public_report_current_role() in ('lgu', 'contractor')
    and responsible_party = public.public_report_current_role()
    and public._public_report_is_handler(report_id, responsible_party)
  );

drop policy if exists public_report_field_findings_select_handler on public.public_report_field_findings;
create policy public_report_field_findings_select_handler
  on public.public_report_field_findings for select to authenticated
  using (
    public.public_report_current_role() in ('lgu', 'contractor')
    and exists (
      select 1 from public.public_reports pr
      where pr.id = public_report_field_findings.report_id
        and pr.handled_by = public.public_report_current_role()
        and public._public_report_is_handler(pr.id, pr.handled_by)
    )
  );

-- ------------------------------------------------------------
-- 12. Citizen views: the repair stages
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
  a.created_at,
  a.work_photo_url,
  a.work_submitted_at,
  a.accepted_at,
  a.work_date,
  a.started_at
from public.public_report_repair_actions a
join public.public_reports pr on pr.id = a.report_id
where a.status <> 'cancelled'
  and (pr.status <> 'dismissed' or pr.user_id = auth.uid());

grant select on public.public_report_repair_actions_citizen_view to anon, authenticated;

create or replace view public.public_reports_citizen_view
with (security_barrier = true)
as
select
  pr.id,
  pr.created_at,
  pr.updated_at,
  pr.region,
  pr.province,
  pr.municipality,
  pr.barangay,
  pr.street,
  pr.project_id,
  pr.project_name,
  pr.photo_url,
  pr.latitude,
  pr.longitude,
  pr.geo_accuracy,
  pr.photo_timestamp,
  pr.verification,
  pr.category,
  pr.description,
  pr.status,
  pr.severity_category,
  pr.specific_problem,
  pr.resolved_at,
  pr.dismissed_at,
  pr.user_id = auth.uid() as is_current_user_report,
  pr.reviewed_at as citizen_reviewed_at,
  pr.assigned_at as citizen_field_dispatched_at,
  latest_finding.inspection_started_at as citizen_inspection_started_at,
  latest_finding.submitted_at as citizen_assessment_submitted_at,
  case
    when pr.engineer_status = any (array['validated'::text, 'rejected'::text]) then latest_finding.updated_at
    else null::timestamptz
  end as citizen_admin_decision_at,
  case
    when pr.status = 'resolved' then 'resolved'
    when pr.status = 'dismissed' then 'closed'
    when work.status in ('completed', 'verified') then 'repair_done'
    when work.status = 'planned' and work.started_at is not null then 'repair_in_progress'
    when work.status = 'planned' then 'repair_assigned'
    when pr.engineer_status = 'validated' then 'validated'
    when pr.engineer_status = 'rejected' then 'reinspection_needed'
    when pr.engineer_status = 'inspected' then 'assessment_submitted'
    when pr.engineer_status = 'in_progress' then 'inspection_in_progress'
    when pr.engineer_status = 'assigned' then 'field_engineer_dispatched'
    when pr.status = 'reviewed' then 'under_review'
    else 'submitted'
  end as citizen_workflow_stage,
  case
    when pr.status = 'resolved' then 'Resolved'
    when pr.status = 'dismissed' then 'Closed'
    when work.status in ('completed', 'verified') then 'Under Verification'
    when work.status = 'planned' and work.started_at is not null then 'Repair in Progress'
    when work.status = 'planned' then 'Assigned for Repair'
    when pr.engineer_status = any (array['assigned'::text, 'in_progress'::text]) then 'Site Inspection Scheduled'
    when pr.engineer_status = any (array['inspected'::text, 'validated'::text]) then 'Under Verification'
    when pr.engineer_status = 'rejected' then 'Under Review'
    when pr.status = 'reviewed' then 'Under Review'
    else 'Submitted'
  end as citizen_status,
  case
    when pr.status <> 'dismissed' or pr.user_id is distinct from auth.uid() then null::text
    when pr.dismissal_reason ilike 'Automated location check%' or pr.dismissal_reason ilike 'Location mismatch%' then 'location_mismatch'
    else 'other'
  end as citizen_closed_category,
  case
    when pr.status = 'dismissed' and pr.user_id = auth.uid() then pr.dismissal_reason
    else null::text
  end as citizen_closed_reason,
  pr.handled_by as citizen_handled_by,
  work.started_at as citizen_repair_started_at,
  work.work_submitted_at as citizen_repair_done_at
from public.public_reports pr
left join lateral (
  select f.inspection_started_at, f.submitted_at, f.updated_at
  from public.public_report_field_findings f
  where f.report_id = pr.id
  order by f.inspection_number desc nulls last, f.created_at desc nulls last
  limit 1
) latest_finding on true
left join lateral (
  select a.status, a.started_at, a.work_submitted_at
  from public.public_report_repair_actions a
  where a.report_id = pr.id and a.status <> 'cancelled'
  limit 1
) work on true
where pr.status <> 'dismissed' or pr.user_id = auth.uid();

-- ------------------------------------------------------------
-- 13. Grants
-- ------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.set_public_report_handler(uuid, text)',
    'public.assign_public_report_work(uuid, text, date, text)',
    'public.accept_public_report_work(uuid, date)',
    'public.start_public_report_work(uuid, text)',
    'public.submit_public_report_repair_work(uuid, text, double precision, double precision, double precision, timestamptz, text)',
    'public.return_public_report_work(uuid, text)',
    'public.reopen_public_report_repair(uuid, text)',
    'public.request_public_report_work_check(uuid)',
    'public.resolve_public_report(uuid, text, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;

-- Check:
--   select handled_by, count(*) from public.public_reports group by 1;
--   select proname from pg_proc where proname in ('assign_public_report_work', 'accept_public_report_work', 'start_public_report_work', 'return_public_report_work', 'request_public_report_work_check');
