-- ============================================================
-- Public Report Workflow RPC Layer
-- Run after:
--   1. supabase_public_report_workflow_foundation.sql
--   2. supabase_public_report_legacy_state_cleanup.sql
--
-- This migration creates controlled workflow transitions beside the existing
-- permissive legacy table access. It does NOT tighten RLS and does NOT require
-- React changes yet.
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- Refuse to install the strict transition layer while known legacy state
-- violations still exist. Clean with the legacy cleanup migration first.
do $$
begin
  if exists (select 1 from public.public_report_state_violations) then
    raise exception 'Resolve rows in public.public_report_state_violations before installing public report workflow RPCs';
  end if;
end $$;

-- ------------------------------------------------------------
-- Additive columns used by the RPC layer
-- ------------------------------------------------------------

alter table public.public_report_field_findings
  add column if not exists site_rating integer;

alter table public.public_report_field_findings
  alter column submitted_at drop not null;

do $$
begin
  alter table public.public_report_field_findings
    drop constraint if exists public_report_field_findings_site_rating_check;

  alter table public.public_report_field_findings
    add constraint public_report_field_findings_site_rating_check
    check (site_rating is null or site_rating between 1 and 5)
    not valid;
exception when others then
  raise notice 'Could not update public_report_field_findings_site_rating_check: %', sqlerrm;
end $$;

alter table public.public_report_resolutions
  add column if not exists resolution_type text not null default 'other',
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null;

do $$
begin
  alter table public.public_report_resolutions
    drop constraint if exists public_report_resolutions_resolution_type_check;

  alter table public.public_report_resolutions
    add constraint public_report_resolutions_resolution_type_check
    check (resolution_type in (
      'repaired',
      'scheduled_for_repair',
      'referred_to_contractor',
      'monitoring_required',
      'no_action_required',
      'outside_project_scope',
      'duplicate_case',
      'other'
    ))
    not valid;
exception when others then
  raise notice 'Could not update public_report_resolutions_resolution_type_check: %', sqlerrm;
end $$;

create index if not exists idx_public_report_resolutions_report_resolved_at
  on public.public_report_resolutions(report_id, resolved_at desc);

-- ------------------------------------------------------------
-- Internal helpers
-- ------------------------------------------------------------

create or replace function public._public_report_actor_role()
returns text
language sql
stable
security definer
set search_path = public
set row_security = off
as $function$
  select coalesce(
    (select lower(replace(replace(role, '-', '_'), ' ', '_'))
     from public.profiles
     where id = auth.uid()),
    ''
  );
$function$;

create or replace function public._public_report_require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public._public_report_actor_role() <> 'admin' then
    raise exception 'Admin role required';
  end if;
end;
$function$;

create or replace function public._public_report_require_field_engineer()
returns void
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public._public_report_actor_role() <> 'field_engineer' then
    raise exception 'Field Engineer role required';
  end if;
end;
$function$;

create or replace function public._public_report_add_audit(
  p_report_id uuid,
  p_action text,
  p_old_state jsonb,
  p_new_state jsonb,
  p_remarks text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_actor record;
  v_action text := upper(coalesce(nullif(btrim(p_action), ''), 'UNKNOWN_ACTION'));
begin
  select
    p.id,
    lower(replace(replace(coalesce(p.role, ''), '-', '_'), ' ', '_')) as role,
    p.full_name,
    p.email
  into v_actor
  from public.profiles p
  where p.id = auth.uid();

  insert into public.public_report_activity_logs (
    report_id,
    actor_id,
    actor_role,
    action,
    action_type,
    old_state,
    new_state,
    remarks,
    description,
    metadata,
    actor_name,
    actor_email,
    created_at
  )
  values (
    p_report_id,
    auth.uid(),
    coalesce(v_actor.role, ''),
    v_action,
    lower(v_action),
    p_old_state,
    p_new_state,
    p_remarks,
    p_remarks,
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(nullif(v_actor.full_name, ''), v_actor.email, 'System'),
    v_actor.email,
    now()
  );
end;
$function$;

create or replace function public._public_report_latest_inspection_id(p_report_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
set row_security = off
as $function$
  select f.id
  from public.public_report_field_findings f
  where f.report_id = p_report_id
  order by f.inspection_number desc nulls last,
           f.submitted_at desc nulls last,
           f.inspection_started_at desc nulls last,
           f.created_at desc nulls last,
           f.id desc
  limit 1;
$function$;

revoke execute on function public._public_report_actor_role() from public, anon, authenticated;
revoke execute on function public._public_report_require_admin() from public, anon, authenticated;
revoke execute on function public._public_report_require_field_engineer() from public, anon, authenticated;
revoke execute on function public._public_report_add_audit(uuid, text, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke execute on function public._public_report_latest_inspection_id(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- RPC 1: Admin reviews a pending report
-- ------------------------------------------------------------

create or replace function public.review_public_report(
  p_report_id uuid,
  p_priority text default null,
  p_inspection_target_date date default null
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_report public.public_reports%rowtype;
  v_old_state jsonb;
begin
  perform public._public_report_require_admin();

  if p_priority is not null and p_priority not in ('low', 'medium', 'urgent') then
    raise exception 'Invalid priority level';
  end if;

  select * into v_report
  from public.public_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report does not exist';
  end if;

  if v_report.status <> 'pending' or v_report.engineer_status is not null then
    raise exception 'Report is not pending or already has an active engineer workflow';
  end if;

  v_old_state := jsonb_build_object(
    'status', v_report.status,
    'engineer_status', v_report.engineer_status,
    'assigned_engineer_id', v_report.assigned_engineer_id
  );

  update public.public_reports
  set status = 'reviewed',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  where id = p_report_id;

  if p_priority is not null or p_inspection_target_date is not null then
    insert into public.public_report_workflow_meta (
      report_id,
      priority_level,
      visit_deadline,
      updated_at
    )
    values (
      p_report_id,
      coalesce(p_priority, 'medium'),
      p_inspection_target_date,
      now()
    )
    on conflict (report_id) do update
      set priority_level = coalesce(excluded.priority_level, public.public_report_workflow_meta.priority_level),
          visit_deadline = coalesce(excluded.visit_deadline, public.public_report_workflow_meta.visit_deadline),
          updated_at = now();
  end if;

  perform public._public_report_add_audit(
    p_report_id,
    'REPORT_REVIEWED',
    v_old_state,
    jsonb_build_object('status', 'reviewed', 'engineer_status', null),
    'Admin reviewed public report.',
    jsonb_build_object('priority', p_priority, 'inspection_target_date', p_inspection_target_date)
  );
end;
$function$;

-- ------------------------------------------------------------
-- RPC 2: Admin assigns/reassigns a field engineer
-- ------------------------------------------------------------

create or replace function public.assign_public_report_engineer(
  p_report_id uuid,
  p_engineer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_report public.public_reports%rowtype;
  v_engineer record;
  v_old_state jsonb;
  v_action text;
begin
  perform public._public_report_require_admin();

  select id, email, full_name, role
    into v_engineer
  from public.profiles
  where id = p_engineer_id
    and lower(replace(replace(coalesce(role, ''), '-', '_'), ' ', '_')) = 'field_engineer';

  if not found then
    raise exception 'Selected user is not a Field Engineer';
  end if;

  select * into v_report
  from public.public_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report does not exist';
  end if;

  if v_report.status <> 'reviewed' then
    raise exception 'Report is not in a reviewable assignment state';
  end if;

  if v_report.engineer_status is not null
     and v_report.engineer_status <> 'assigned' then
    raise exception 'Report already has an active engineer workflow';
  end if;

  v_old_state := jsonb_build_object(
    'status', v_report.status,
    'engineer_status', v_report.engineer_status,
    'assigned_engineer_id', v_report.assigned_engineer_id
  );

  v_action := case
    when v_report.assigned_engineer_id is not null
         and v_report.assigned_engineer_id <> p_engineer_id
      then 'ENGINEER_REASSIGNED'
    else 'ENGINEER_ASSIGNED'
  end;

  update public.public_reports
  set assigned_engineer_id = p_engineer_id,
      assigned_engineer_name = coalesce(nullif(v_engineer.full_name, ''), v_engineer.email, ''),
      assigned_at = now(),
      engineer_status = 'assigned',
      updated_at = now()
  where id = p_report_id;

  insert into public.public_report_workflow_meta (
    report_id,
    priority_level,
    assigned_engineer_id,
    updated_at
  )
  values (
    p_report_id,
    'medium',
    p_engineer_id,
    now()
  )
  on conflict (report_id) do update
    set assigned_engineer_id = excluded.assigned_engineer_id,
        updated_at = now();

  perform public._public_report_add_audit(
    p_report_id,
    v_action,
    v_old_state,
    jsonb_build_object('status', 'reviewed', 'engineer_status', 'assigned', 'assigned_engineer_id', p_engineer_id),
    case when v_action = 'ENGINEER_REASSIGNED'
      then 'Admin reassigned field engineer.'
      else 'Admin assigned field engineer.'
    end,
    jsonb_build_object(
      'previous_engineer_id', v_report.assigned_engineer_id,
      'new_engineer_id', p_engineer_id
    )
  );
end;
$function$;

-- ------------------------------------------------------------
-- RPC 3: Admin unassigns a field engineer
-- ------------------------------------------------------------

create or replace function public.unassign_public_report_engineer(
  p_report_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_report public.public_reports%rowtype;
  v_old_state jsonb;
begin
  perform public._public_report_require_admin();

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'An unassignment reason is required';
  end if;

  select * into v_report
  from public.public_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report does not exist';
  end if;

  if v_report.status <> 'reviewed' or v_report.engineer_status <> 'assigned' then
    raise exception 'Report is not in an assignable unassignment state';
  end if;

  v_old_state := jsonb_build_object(
    'status', v_report.status,
    'engineer_status', v_report.engineer_status,
    'assigned_engineer_id', v_report.assigned_engineer_id
  );

  update public.public_reports
  set assigned_engineer_id = null,
      assigned_engineer_name = '',
      assigned_at = null,
      engineer_status = null,
      updated_at = now()
  where id = p_report_id;

  update public.public_report_workflow_meta
  set assigned_engineer_id = null,
      updated_at = now()
  where report_id = p_report_id;

  perform public._public_report_add_audit(
    p_report_id,
    'ENGINEER_UNASSIGNED',
    v_old_state,
    jsonb_build_object('status', 'reviewed', 'engineer_status', null, 'assigned_engineer_id', null),
    p_reason,
    jsonb_build_object('previous_engineer_id', v_report.assigned_engineer_id)
  );
end;
$function$;

-- ------------------------------------------------------------
-- RPC 4: Assigned field engineer starts inspection/reinspection
-- ------------------------------------------------------------

create or replace function public.start_public_report_inspection(
  p_report_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_report public.public_reports%rowtype;
  v_old_state jsonb;
  v_inspection_id uuid;
  v_next_number integer;
begin
  perform public._public_report_require_field_engineer();

  select * into v_report
  from public.public_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report does not exist';
  end if;

  if v_report.assigned_engineer_id is distinct from auth.uid() then
    raise exception 'Only the assigned Field Engineer may start this inspection';
  end if;

  if v_report.status <> 'reviewed'
     or v_report.engineer_status not in ('assigned', 'rejected') then
    raise exception 'Report is not ready for field inspection';
  end if;

  if exists (
    select 1
    from public.public_report_field_findings f
    where f.report_id = p_report_id
      and f.engineer_id = auth.uid()
      and f.status = 'in_progress'
  ) then
    raise exception 'An active inspection already exists';
  end if;

  select coalesce(max(inspection_number), 0) + 1
    into v_next_number
  from public.public_report_field_findings
  where report_id = p_report_id;

  v_old_state := jsonb_build_object(
    'status', v_report.status,
    'engineer_status', v_report.engineer_status,
    'assigned_engineer_id', v_report.assigned_engineer_id
  );

  insert into public.public_report_field_findings (
    report_id,
    engineer_id,
    inspection_number,
    status,
    inspection_started_at,
    submitted_at
  )
  values (
    p_report_id,
    auth.uid(),
    v_next_number,
    'in_progress',
    now(),
    null
  )
  returning id into v_inspection_id;

  update public.public_reports
  set engineer_status = 'in_progress',
      verification = 'Needs Review',
      updated_at = now()
  where id = p_report_id;

  perform public._public_report_add_audit(
    p_report_id,
    'INSPECTION_STARTED',
    v_old_state,
    jsonb_build_object('status', 'reviewed', 'engineer_status', 'in_progress', 'inspection_id', v_inspection_id),
    'Field engineer started site inspection.',
    jsonb_build_object('inspection_id', v_inspection_id, 'inspection_number', v_next_number)
  );

  return v_inspection_id;
end;
$function$;

-- ------------------------------------------------------------
-- RPC 5: Assigned field engineer submits inspection
-- ------------------------------------------------------------

create or replace function public.submit_public_report_inspection(
  p_report_id uuid,
  p_condition_observed text,
  p_recommended_action text,
  p_site_rating integer,
  p_field_photo_url text,
  p_certified boolean,
  p_estimated_cost_range text default null,
  p_inspection_latitude double precision default null,
  p_inspection_longitude double precision default null,
  p_gps_accuracy_meters double precision default null
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
  v_old_report_state jsonb;
begin
  perform public._public_report_require_field_engineer();

  if coalesce(btrim(p_condition_observed), '') = '' then
    raise exception 'Condition observed is required';
  end if;

  if coalesce(btrim(p_recommended_action), '') = '' then
    raise exception 'Recommended action is required';
  end if;

  if coalesce(btrim(p_field_photo_url), '') = '' then
    raise exception 'Field photo is required';
  end if;

  if p_site_rating is null or p_site_rating < 1 or p_site_rating > 5 then
    raise exception 'Site rating must be between 1 and 5';
  end if;

  if coalesce(p_certified, false) is not true then
    raise exception 'Engineer certification is required before submitting inspection';
  end if;

  if (p_inspection_latitude is null) <> (p_inspection_longitude is null) then
    raise exception 'Both inspection latitude and longitude are required when one coordinate is provided';
  end if;

  if p_inspection_latitude is not null
     and (p_inspection_latitude < -90 or p_inspection_latitude > 90) then
    raise exception 'Inspection latitude must be between -90 and 90';
  end if;

  if p_inspection_longitude is not null
     and (p_inspection_longitude < -180 or p_inspection_longitude > 180) then
    raise exception 'Inspection longitude must be between -180 and 180';
  end if;

  if p_gps_accuracy_meters is not null and p_gps_accuracy_meters < 0 then
    raise exception 'GPS accuracy must not be negative';
  end if;

  select * into v_report
  from public.public_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report does not exist';
  end if;

  if v_report.assigned_engineer_id is distinct from auth.uid() then
    raise exception 'Only the assigned Field Engineer may submit this inspection';
  end if;

  if v_report.status <> 'reviewed' or v_report.engineer_status <> 'in_progress' then
    raise exception 'Report is not in inspection progress state';
  end if;

  select * into v_inspection
  from public.public_report_field_findings
  where report_id = p_report_id
    and engineer_id = auth.uid()
    and status = 'in_progress'
  order by inspection_number desc nulls last,
           inspection_started_at desc nulls last,
           created_at desc nulls last
  limit 1
  for update;

  if not found then
    raise exception 'No active inspection exists';
  end if;

  v_old_report_state := jsonb_build_object(
    'status', v_report.status,
    'engineer_status', v_report.engineer_status,
    'inspection_id', v_inspection.id,
    'inspection_status', v_inspection.status
  );

  update public.public_report_field_findings
  set condition_observed = btrim(p_condition_observed),
      recommended_action = btrim(p_recommended_action),
      estimated_cost_range = nullif(btrim(coalesce(p_estimated_cost_range, '')), ''),
      site_rating = p_site_rating,
      field_photo_url = btrim(p_field_photo_url),
      inspection_latitude = p_inspection_latitude,
      inspection_longitude = p_inspection_longitude,
      gps_accuracy_meters = p_gps_accuracy_meters,
      engineer_certified_at = now(),
      status = 'submitted',
      submitted_at = now()
  where id = v_inspection.id;

  update public.public_reports
  set engineer_status = 'inspected',
      verification = 'Needs Review',
      updated_at = now()
  where id = p_report_id;

  perform public._public_report_add_audit(
    p_report_id,
    'INSPECTION_SUBMITTED',
    v_old_report_state,
    jsonb_build_object('status', 'reviewed', 'engineer_status', 'inspected', 'inspection_id', v_inspection.id, 'inspection_status', 'submitted'),
    'Field engineer submitted inspection findings.',
    jsonb_build_object(
      'inspection_id', v_inspection.id,
      'inspection_number', v_inspection.inspection_number,
      'site_rating', p_site_rating,
      'has_gps', p_inspection_latitude is not null and p_inspection_longitude is not null
    )
  );

  return v_inspection.id;
end;
$function$;

-- ------------------------------------------------------------
-- RPC 6: Admin rejects latest submitted inspection
-- ------------------------------------------------------------

create or replace function public.reject_public_report_inspection(
  p_report_id uuid,
  p_inspection_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_report public.public_reports%rowtype;
  v_inspection public.public_report_field_findings%rowtype;
  v_latest_id uuid;
  v_old_state jsonb;
begin
  perform public._public_report_require_admin();

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A rejection reason is required';
  end if;

  select * into v_report
  from public.public_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report does not exist';
  end if;

  if v_report.status <> 'reviewed' or v_report.engineer_status <> 'inspected' then
    raise exception 'Report does not have submitted inspection awaiting admin review';
  end if;

  select * into v_inspection
  from public.public_report_field_findings
  where id = p_inspection_id
    and report_id = p_report_id
  for update;

  if not found then
    raise exception 'Inspection does not belong to this report';
  end if;

  if v_inspection.status <> 'submitted' then
    raise exception 'Inspection must be submitted before rejection';
  end if;

  v_latest_id := public._public_report_latest_inspection_id(p_report_id);
  if v_latest_id is distinct from p_inspection_id then
    raise exception 'Only the latest submitted inspection can be rejected';
  end if;

  v_old_state := jsonb_build_object(
    'status', v_report.status,
    'engineer_status', v_report.engineer_status,
    'inspection_id', v_inspection.id,
    'inspection_status', v_inspection.status
  );

  update public.public_report_field_findings
  set status = 'rejected',
      rejection_reason = btrim(p_reason)
  where id = p_inspection_id;

  update public.public_reports
  set engineer_status = 'rejected',
      verification = 'Needs Review',
      updated_at = now()
  where id = p_report_id;

  perform public._public_report_add_audit(
    p_report_id,
    'INSPECTION_REJECTED',
    v_old_state,
    jsonb_build_object('status', 'reviewed', 'engineer_status', 'rejected', 'inspection_id', p_inspection_id, 'inspection_status', 'rejected'),
    btrim(p_reason),
    jsonb_build_object('inspection_id', p_inspection_id, 'inspection_number', v_inspection.inspection_number)
  );
end;
$function$;

-- ------------------------------------------------------------
-- RPC 7: Admin validates latest submitted inspection
-- ------------------------------------------------------------

create or replace function public.validate_public_report_inspection(
  p_report_id uuid,
  p_inspection_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_report public.public_reports%rowtype;
  v_inspection public.public_report_field_findings%rowtype;
  v_latest_id uuid;
  v_old_state jsonb;
begin
  perform public._public_report_require_admin();

  select * into v_report
  from public.public_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report does not exist';
  end if;

  if v_report.status <> 'reviewed' or v_report.engineer_status <> 'inspected' then
    raise exception 'Report does not have submitted inspection awaiting admin validation';
  end if;

  select * into v_inspection
  from public.public_report_field_findings
  where id = p_inspection_id
    and report_id = p_report_id
  for update;

  if not found then
    raise exception 'Inspection does not belong to this report';
  end if;

  if v_inspection.status <> 'submitted' then
    raise exception 'Inspection must be submitted before validation';
  end if;

  if v_inspection.engineer_id = auth.uid() then
    raise exception 'Field Engineers cannot validate their own inspection';
  end if;

  v_latest_id := public._public_report_latest_inspection_id(p_report_id);
  if v_latest_id is distinct from p_inspection_id then
    raise exception 'Only the latest submitted inspection can be validated';
  end if;

  v_old_state := jsonb_build_object(
    'status', v_report.status,
    'engineer_status', v_report.engineer_status,
    'verification', v_report.verification,
    'inspection_id', v_inspection.id,
    'inspection_status', v_inspection.status
  );

  update public.public_report_field_findings
  set status = 'validated',
      validated_by = auth.uid(),
      validated_at = now()
  where id = p_inspection_id;

  update public.public_reports
  set engineer_status = 'validated',
      verification = 'Verified On-Site',
      updated_at = now()
  where id = p_report_id;

  perform public._public_report_add_audit(
    p_report_id,
    'INSPECTION_VALIDATED',
    v_old_state,
    jsonb_build_object('status', 'reviewed', 'engineer_status', 'validated', 'verification', 'Verified On-Site', 'inspection_id', p_inspection_id, 'inspection_status', 'validated'),
    'Admin validated field inspection findings.',
    jsonb_build_object('inspection_id', p_inspection_id, 'inspection_number', v_inspection.inspection_number)
  );
end;
$function$;

-- ------------------------------------------------------------
-- RPC 8: Admin dismisses report before engineer workflow starts
-- ------------------------------------------------------------

create or replace function public.dismiss_public_report(
  p_report_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_report public.public_reports%rowtype;
  v_old_state jsonb;
begin
  perform public._public_report_require_admin();

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A dismissal reason is required';
  end if;

  select * into v_report
  from public.public_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report does not exist';
  end if;

  if v_report.status not in ('pending', 'reviewed') or v_report.engineer_status is not null then
    raise exception 'Report cannot be dismissed after engineer workflow has started';
  end if;

  if exists (
    select 1
    from public.public_report_field_findings
    where report_id = p_report_id
      and status in ('in_progress', 'submitted', 'rejected', 'validated')
  ) then
    raise exception 'Report cannot be dismissed because inspection history exists';
  end if;

  v_old_state := jsonb_build_object('status', v_report.status, 'engineer_status', v_report.engineer_status);

  update public.public_reports
  set status = 'dismissed',
      engineer_status = null,
      dismissed_by = auth.uid(),
      dismissed_at = now(),
      dismissal_reason = btrim(p_reason),
      updated_at = now()
  where id = p_report_id;

  perform public._public_report_add_audit(
    p_report_id,
    'REPORT_DISMISSED',
    v_old_state,
    jsonb_build_object('status', 'dismissed', 'engineer_status', null),
    btrim(p_reason),
    '{}'::jsonb
  );
end;
$function$;

-- ------------------------------------------------------------
-- RPC 9: Admin resolves validated report atomically
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
    'repaired',
    'scheduled_for_repair',
    'referred_to_contractor',
    'monitoring_required',
    'no_action_required',
    'outside_project_scope',
    'duplicate_case',
    'other'
  ) then
    raise exception 'Invalid resolution type';
  end if;

  select * into v_report
  from public.public_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report does not exist';
  end if;

  if v_report.status <> 'reviewed' or v_report.engineer_status <> 'validated' then
    raise exception 'Report cannot be resolved before inspection validation';
  end if;

  v_latest_id := public._public_report_latest_inspection_id(p_report_id);

  select * into v_inspection
  from public.public_report_field_findings
  where id = v_latest_id
    and report_id = p_report_id
  for update;

  if not found or v_inspection.status <> 'validated' then
    raise exception 'A validated latest inspection is required before resolution';
  end if;

  select full_name, email
    into v_actor
  from public.profiles
  where id = auth.uid();

  v_old_state := jsonb_build_object(
    'status', v_report.status,
    'engineer_status', v_report.engineer_status,
    'inspection_id', v_inspection.id,
    'inspection_status', v_inspection.status
  );

  insert into public.public_report_resolutions (
    report_id,
    resolution_type,
    summary,
    resolved_by,
    resolved_by_name,
    resolved_by_email,
    resolved_at,
    created_at
  )
  values (
    p_report_id,
    v_resolution_type,
    btrim(p_resolution_summary),
    auth.uid(),
    coalesce(nullif(v_actor.full_name, ''), v_actor.email, 'Administrator'),
    v_actor.email,
    now(),
    now()
  )
  returning id into v_resolution_id;

  update public.public_reports
  set status = 'resolved',
      resolved_by = auth.uid(),
      resolved_at = now(),
      updated_at = now()
  where id = p_report_id;

  perform public._public_report_add_audit(
    p_report_id,
    'REPORT_RESOLVED',
    v_old_state,
    jsonb_build_object(
      'status', 'resolved',
      'engineer_status', 'validated',
      'inspection_id', v_inspection.id,
      'resolution_id', v_resolution_id,
      'resolution_type', v_resolution_type
    ),
    btrim(p_resolution_summary),
    jsonb_build_object(
      'inspection_id', v_inspection.id,
      'inspection_number', v_inspection.inspection_number,
      'resolution_id', v_resolution_id,
      'resolution_type', v_resolution_type
    )
  );

  return v_resolution_id;
end;
$function$;

-- ------------------------------------------------------------
-- Grants: expose only the public workflow RPCs.
-- ------------------------------------------------------------

grant execute on function public.review_public_report(uuid, text, date) to authenticated;
grant execute on function public.assign_public_report_engineer(uuid, uuid) to authenticated;
grant execute on function public.unassign_public_report_engineer(uuid, text) to authenticated;
grant execute on function public.start_public_report_inspection(uuid) to authenticated;
grant execute on function public.submit_public_report_inspection(uuid, text, text, integer, text, boolean, text, double precision, double precision, double precision) to authenticated;
grant execute on function public.reject_public_report_inspection(uuid, uuid, text) to authenticated;
grant execute on function public.validate_public_report_inspection(uuid, uuid) to authenticated;
grant execute on function public.dismiss_public_report(uuid, text) to authenticated;
grant execute on function public.resolve_public_report(uuid, text, text) to authenticated;

commit;
