-- Citizen Reporting workflow RLS hardening
-- Run after:
--   1. supabase_public_report_workflow_foundation.sql
--   2. supabase_public_report_legacy_state_cleanup.sql
--   3. supabase_public_report_workflow_rpcs.sql
--   4. frontend RPC migration

begin;

do $$
begin
  if exists (select 1 from public.public_report_state_violations) then
    raise exception 'Stop: public_report_state_violations is not empty';
  end if;
end $$;

create or replace function public.public_report_current_role()
returns text
language sql
stable
security definer
set search_path = public
set row_security = off
as $function$
  select coalesce(
    (
      select lower(replace(replace(p.role, '-', '_'), ' ', '_'))
      from public.profiles p
      where p.id = auth.uid()
    ),
    ''
  );
$function$;

create or replace function public.public_report_current_municipality()
returns text
language sql
stable
security definer
set search_path = public
set row_security = off
as $function$
  select nullif(btrim(coalesce(
    (
      select p.municipality
      from public.profiles p
      where p.id = auth.uid()
    ),
    ''
  )), '');
$function$;

grant execute on function public.public_report_current_role() to anon, authenticated;
grant execute on function public.public_report_current_municipality() to authenticated;

alter table public.public_reports
  add column if not exists user_id uuid,
  add column if not exists assigned_engineer_id uuid,
  add column if not exists assigned_engineer_name text default '',
  add column if not exists assigned_at timestamptz,
  add column if not exists engineer_status text,
  add column if not exists engineer_notes text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by uuid,
  add column if not exists dismissal_reason text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid,
  add column if not exists legacy_resolved_without_engineer_validation boolean not null default false,
  add column if not exists severity_category text,
  add column if not exists specific_problem text,
  add column if not exists contractor_remark text,
  add column if not exists contractor_remark_at timestamptz,
  add column if not exists updated_at timestamptz default now();

create or replace function public.public_report_prepare_citizen_insert()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
begin
  if public.public_report_current_role() <> 'admin' then
    new.status := 'pending';
    new.engineer_status := null;
    new.assigned_engineer_id := null;
    new.assigned_engineer_name := '';
    new.assigned_at := null;
    new.engineer_notes := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.dismissed_at := null;
    new.dismissed_by := null;
    new.dismissal_reason := null;
    new.resolved_at := null;
    new.resolved_by := null;
    new.legacy_resolved_without_engineer_validation := false;

    if new.verification = 'Verified On-Site' then
      new.verification := 'Needs Review';
    end if;

    if auth.uid() is null then
      new.user_id := null;
    elsif new.user_id is distinct from auth.uid() then
      new.user_id := auth.uid();
    end if;
  end if;

  new.updated_at := coalesce(new.updated_at, now());
  return new;
end;
$function$;

drop trigger if exists trg_public_report_prepare_citizen_insert on public.public_reports;
create trigger trg_public_report_prepare_citizen_insert
before insert on public.public_reports
for each row
execute function public.public_report_prepare_citizen_insert();

create or replace function public.public_report_enforce_direct_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_role text := public.public_report_current_role();
begin
  if v_role = 'contractor' then
    if row(
      new.full_name, new.contact_info, new.region, new.province, new.municipality,
      new.barangay, new.street, new.project_id, new.project_name, new.photo_url,
      new.latitude, new.longitude, new.geo_accuracy, new.photo_timestamp,
      new.verification, new.category, new.description, new.source, new.status,
      new.user_id, new.assigned_engineer_id, new.assigned_engineer_name,
      new.assigned_at, new.engineer_status, new.engineer_notes, new.reviewed_at,
      new.reviewed_by, new.dismissed_at, new.dismissed_by, new.dismissal_reason,
      new.resolved_at, new.resolved_by, new.legacy_resolved_without_engineer_validation
    ) is distinct from row(
      old.full_name, old.contact_info, old.region, old.province, old.municipality,
      old.barangay, old.street, old.project_id, old.project_name, old.photo_url,
      old.latitude, old.longitude, old.geo_accuracy, old.photo_timestamp,
      old.verification, old.category, old.description, old.source, old.status,
      old.user_id, old.assigned_engineer_id, old.assigned_engineer_name,
      old.assigned_at, old.engineer_status, old.engineer_notes, old.reviewed_at,
      old.reviewed_by, old.dismissed_at, old.dismissed_by, old.dismissal_reason,
      old.resolved_at, old.resolved_by, old.legacy_resolved_without_engineer_validation
    ) then
      raise exception 'Contractors may only update contractor report remarks';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_public_report_direct_update_guard on public.public_reports;
create trigger trg_public_report_direct_update_guard
before update on public.public_reports
for each row
execute function public.public_report_enforce_direct_update_guard();

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
     and coalesce(new.legacy_resolved_without_engineer_validation, false) is not true then
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

drop trigger if exists trg_public_report_state_invariant on public.public_reports;
create trigger trg_public_report_state_invariant
before insert or update on public.public_reports
for each row
execute function public.public_report_enforce_state_invariant();

drop view if exists public.public_reports_citizen_view;

create view public.public_reports_citizen_view
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
  (pr.user_id = auth.uid()) as is_current_user_report,
  case
    when pr.status = 'resolved' then 'Resolved'
    when pr.status = 'dismissed' then 'Closed'
    when pr.engineer_status in ('assigned', 'in_progress') then 'Site Inspection Scheduled'
    when pr.engineer_status in ('inspected', 'validated') then 'Under Verification'
    when pr.engineer_status = 'rejected' then 'Under Review'
    when pr.status = 'reviewed' then 'Under Review'
    else 'Submitted'
  end as citizen_status
from public.public_reports pr
where pr.status <> 'dismissed'
   or pr.user_id = auth.uid();

create or replace view public.public_report_field_findings_citizen_view
with (security_barrier = true)
as
select
  f.id,
  f.report_id,
  f.status,
  f.condition_observed,
  f.recommended_action,
  f.estimated_cost_range,
  f.field_photo_url,
  f.site_rating,
  f.submitted_at,
  f.validated_at,
  f.created_at
from public.public_report_field_findings f
join public.public_reports pr on pr.id = f.report_id
where f.status in ('submitted', 'validated')
  and (pr.status <> 'dismissed' or pr.user_id = auth.uid());

create or replace view public.public_report_resolutions_citizen_view
with (security_barrier = true)
as
select
  r.id,
  r.report_id,
  r.resolution_type,
  r.summary,
  r.resolved_at,
  r.created_at
from public.public_report_resolutions r
join public.public_reports pr on pr.id = r.report_id
where pr.status = 'resolved'
  and (pr.status <> 'dismissed' or pr.user_id = auth.uid());

grant select on public.public_reports_citizen_view to anon, authenticated;
grant select on public.public_report_field_findings_citizen_view to anon, authenticated;
grant select on public.public_report_resolutions_citizen_view to anon, authenticated;

alter table public.public_reports enable row level security;
alter table public.public_report_field_findings enable row level security;
alter table public.public_report_activity_logs enable row level security;
alter table public.public_report_resolutions enable row level security;
alter table public.public_report_workflow_meta enable row level security;
alter table public.public_report_visits enable row level security;
alter table public.public_report_admin_notes enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "Anon users can view public reports" on public.public_reports;
drop policy if exists "Authenticated users can view public reports" on public.public_reports;
drop policy if exists "Field engineers can view assigned reports" on public.public_reports;
drop policy if exists "Anyone can submit public reports" on public.public_reports;
drop policy if exists "Authenticated users can update public reports" on public.public_reports;
drop policy if exists "Field engineers can update assigned reports" on public.public_reports;
drop policy if exists "Authenticated users can delete public reports" on public.public_reports;
drop policy if exists "contractors_select_own_public_reports" on public.public_reports;
drop policy if exists "contractors_update_remark_public_reports" on public.public_reports;

create policy public_reports_select_admin
  on public.public_reports for select to authenticated
  using (public.public_report_current_role() = 'admin');

create policy public_reports_select_assigned_field_engineer
  on public.public_reports for select to authenticated
  using (
    public.public_report_current_role() = 'field_engineer'
    and assigned_engineer_id = auth.uid()
  );

create policy public_reports_select_contractor_projects
  on public.public_reports for select to authenticated
  using (
    public.public_report_current_role() = 'contractor'
    and project_id in (
      select 'fmr-' || fp.id::text
      from public.fmr_projects fp
      where fp.contractor_id = auth.uid()
    )
  );

create policy public_reports_select_lgu_municipality
  on public.public_reports for select to authenticated
  using (
    public.public_report_current_role() = 'lgu'
    and municipality = public.public_report_current_municipality()
  );

create policy public_reports_insert_citizen_initial
  on public.public_reports for insert to anon, authenticated
  with check (
    status = 'pending'
    and engineer_status is null
    and assigned_engineer_id is null
    and reviewed_by is null
    and reviewed_at is null
    and dismissed_by is null
    and dismissed_at is null
    and dismissal_reason is null
    and resolved_by is null
    and resolved_at is null
    and verification <> 'Verified On-Site'
    and (auth.uid() is not null or user_id is null)
    and (auth.uid() is null or user_id = auth.uid())
  );

create policy public_reports_update_contractor_remark
  on public.public_reports for update to authenticated
  using (
    public.public_report_current_role() = 'contractor'
    and project_id in (
      select 'fmr-' || fp.id::text
      from public.fmr_projects fp
      where fp.contractor_id = auth.uid()
    )
  )
  with check (
    public.public_report_current_role() = 'contractor'
    and project_id in (
      select 'fmr-' || fp.id::text
      from public.fmr_projects fp
      where fp.contractor_id = auth.uid()
    )
  );

drop policy if exists public_report_workflow_meta_rw on public.public_report_workflow_meta;
drop policy if exists public_report_field_findings_rw on public.public_report_field_findings;
drop policy if exists public_report_visits_rw on public.public_report_visits;
drop policy if exists public_report_resolutions_rw on public.public_report_resolutions;
drop policy if exists public_report_activity_logs_rw on public.public_report_activity_logs;
drop policy if exists public_report_admin_notes_rw on public.public_report_admin_notes;
drop policy if exists notifications_rw on public.notifications;

create policy public_report_workflow_meta_select_admin
  on public.public_report_workflow_meta for select to authenticated
  using (public.public_report_current_role() = 'admin');

create policy public_report_workflow_meta_select_assigned_engineer
  on public.public_report_workflow_meta for select to authenticated
  using (
    public.public_report_current_role() = 'field_engineer'
    and exists (
      select 1 from public.public_reports pr
      where pr.id = public_report_workflow_meta.report_id
        and pr.assigned_engineer_id = auth.uid()
    )
  );

create policy public_report_field_findings_select_admin
  on public.public_report_field_findings for select to authenticated
  using (public.public_report_current_role() = 'admin');

create policy public_report_field_findings_select_assigned_engineer
  on public.public_report_field_findings for select to authenticated
  using (
    public.public_report_current_role() = 'field_engineer'
    and exists (
      select 1 from public.public_reports pr
      where pr.id = public_report_field_findings.report_id
        and pr.assigned_engineer_id = auth.uid()
    )
  );

create policy public_report_resolutions_select_admin
  on public.public_report_resolutions for select to authenticated
  using (public.public_report_current_role() = 'admin');

create policy public_report_resolutions_select_assigned_engineer
  on public.public_report_resolutions for select to authenticated
  using (
    public.public_report_current_role() = 'field_engineer'
    and exists (
      select 1 from public.public_reports pr
      where pr.id = public_report_resolutions.report_id
        and pr.assigned_engineer_id = auth.uid()
    )
  );

create policy public_report_activity_logs_select_admin
  on public.public_report_activity_logs for select to authenticated
  using (public.public_report_current_role() = 'admin');

create policy public_report_activity_logs_select_assigned_engineer
  on public.public_report_activity_logs for select to authenticated
  using (
    public.public_report_current_role() = 'field_engineer'
    and exists (
      select 1 from public.public_reports pr
      where pr.id = public_report_activity_logs.report_id
        and pr.assigned_engineer_id = auth.uid()
    )
  );

create policy public_report_activity_logs_insert_admin
  on public.public_report_activity_logs for insert to authenticated
  with check (public.public_report_current_role() = 'admin');

create policy public_report_activity_logs_insert_assigned_engineer_visit
  on public.public_report_activity_logs for insert to authenticated
  with check (
    public.public_report_current_role() = 'field_engineer'
    and lower(coalesce(action_type, action, '')) in ('visited')
    and exists (
      select 1 from public.public_reports pr
      where pr.id = public_report_activity_logs.report_id
        and pr.assigned_engineer_id = auth.uid()
    )
  );

create policy public_report_admin_notes_admin_only
  on public.public_report_admin_notes for all to authenticated
  using (public.public_report_current_role() = 'admin')
  with check (public.public_report_current_role() = 'admin');

create policy public_report_visits_select_admin
  on public.public_report_visits for select to authenticated
  using (public.public_report_current_role() = 'admin');

create policy public_report_visits_select_assigned_engineer
  on public.public_report_visits for select to authenticated
  using (
    public.public_report_current_role() = 'field_engineer'
    and exists (
      select 1 from public.public_reports pr
      where pr.id = public_report_visits.report_id
        and pr.assigned_engineer_id = auth.uid()
    )
  );

create policy public_report_visits_insert_assigned_engineer
  on public.public_report_visits for insert to authenticated
  with check (
    public.public_report_current_role() = 'field_engineer'
    and engineer_id = auth.uid()
    and exists (
      select 1 from public.public_reports pr
      where pr.id = public_report_visits.report_id
        and pr.assigned_engineer_id = auth.uid()
    )
  );

create policy notifications_select_own
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

create policy notifications_update_own_read_state
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notifications_delete_own
  on public.notifications for delete to authenticated
  using (user_id = auth.uid());

create policy notifications_insert_authenticated
  on public.notifications for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists public_report_lgu_escalations_rw on public.public_report_lgu_escalations;
drop policy if exists public_report_lgu_decisions_rw on public.public_report_lgu_decisions;

create policy public_report_lgu_escalations_select_admin
  on public.public_report_lgu_escalations for select to authenticated
  using (public.public_report_current_role() = 'admin');

create policy public_report_lgu_escalations_insert_admin
  on public.public_report_lgu_escalations for insert to authenticated
  with check (public.public_report_current_role() = 'admin');

create policy public_report_lgu_escalations_select_lgu_municipality
  on public.public_report_lgu_escalations for select to authenticated
  using (
    public.public_report_current_role() = 'lgu'
    and municipality = public.public_report_current_municipality()
  );

create policy public_report_lgu_escalations_update_lgu_municipality
  on public.public_report_lgu_escalations for update to authenticated
  using (
    public.public_report_current_role() = 'lgu'
    and municipality = public.public_report_current_municipality()
  )
  with check (
    public.public_report_current_role() = 'lgu'
    and municipality = public.public_report_current_municipality()
  );

create policy public_report_lgu_decisions_select_admin
  on public.public_report_lgu_decisions for select to authenticated
  using (public.public_report_current_role() = 'admin');

create policy public_report_lgu_decisions_select_lgu_municipality
  on public.public_report_lgu_decisions for select to authenticated
  using (
    public.public_report_current_role() = 'lgu'
    and municipality = public.public_report_current_municipality()
  );

create policy public_report_lgu_decisions_select_report_owner
  on public.public_report_lgu_decisions for select to authenticated
  using (
    exists (
      select 1 from public.public_reports pr
      where pr.id = public_report_lgu_decisions.report_id
        and pr.user_id = auth.uid()
    )
  );

create policy public_report_lgu_decisions_insert_lgu_municipality
  on public.public_report_lgu_decisions for insert to authenticated
  with check (
    public.public_report_current_role() = 'lgu'
    and lgu_user_id = auth.uid()
    and municipality = public.public_report_current_municipality()
  );

create or replace function public.update_public_report_workflow_meta(
  p_report_id uuid,
  p_priority text default null,
  p_visit_deadline date default null
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_previous public.public_report_workflow_meta%rowtype;
  v_priority text;
begin
  perform public._public_report_require_admin();

  if not exists (select 1 from public.public_reports where id = p_report_id) then
    raise exception 'Report not found';
  end if;

  v_priority := lower(nullif(btrim(coalesce(p_priority, '')), ''));
  if v_priority is null then
    v_priority := 'medium';
  end if;

  if v_priority not in ('low', 'medium', 'urgent') then
    raise exception 'Invalid priority level';
  end if;

  select * into v_previous
  from public.public_report_workflow_meta
  where report_id = p_report_id;

  insert into public.public_report_workflow_meta (
    report_id,
    priority_level,
    visit_deadline,
    assigned_engineer_id,
    updated_at,
    created_at
  )
  select
    p_report_id,
    v_priority,
    p_visit_deadline,
    pr.assigned_engineer_id,
    now(),
    now()
  from public.public_reports pr
  where pr.id = p_report_id
  on conflict (report_id) do update
  set priority_level = excluded.priority_level,
      visit_deadline = excluded.visit_deadline,
      assigned_engineer_id = excluded.assigned_engineer_id,
      updated_at = now();

  perform public._public_report_add_audit(
    p_report_id,
    'REPORT_METADATA_UPDATED',
    jsonb_build_object(
      'priority', v_previous.priority_level,
      'visit_deadline', v_previous.visit_deadline
    ),
    jsonb_build_object(
      'priority', v_priority,
      'visit_deadline', p_visit_deadline
    ),
    'Updated report priority or target inspection date',
    jsonb_build_object(
      'previous_priority', v_previous.priority_level,
      'new_priority', v_priority,
      'previous_target_date', v_previous.visit_deadline,
      'new_target_date', p_visit_deadline
    )
  );
end;
$function$;

revoke execute on function public.update_public_report_workflow_meta(uuid, text, date) from public, anon;
grant execute on function public.update_public_report_workflow_meta(uuid, text, date) to authenticated;

revoke execute on function public.review_public_report(uuid, text, date) from public, anon;
revoke execute on function public.assign_public_report_engineer(uuid, uuid) from public, anon;
revoke execute on function public.unassign_public_report_engineer(uuid, text) from public, anon;
revoke execute on function public.start_public_report_inspection(uuid) from public, anon;
revoke execute on function public.submit_public_report_inspection(uuid, text, text, integer, text, boolean, text, double precision, double precision, double precision) from public, anon;
revoke execute on function public.reject_public_report_inspection(uuid, uuid, text) from public, anon;
revoke execute on function public.validate_public_report_inspection(uuid, uuid) from public, anon;
revoke execute on function public.dismiss_public_report(uuid, text) from public, anon;
revoke execute on function public.resolve_public_report(uuid, text, text) from public, anon;

grant execute on function public.review_public_report(uuid, text, date) to authenticated;
grant execute on function public.assign_public_report_engineer(uuid, uuid) to authenticated;
grant execute on function public.unassign_public_report_engineer(uuid, text) to authenticated;
grant execute on function public.start_public_report_inspection(uuid) to authenticated;
grant execute on function public.submit_public_report_inspection(uuid, text, text, integer, text, boolean, text, double precision, double precision, double precision) to authenticated;
grant execute on function public.reject_public_report_inspection(uuid, uuid, text) to authenticated;
grant execute on function public.validate_public_report_inspection(uuid, uuid) to authenticated;
grant execute on function public.dismiss_public_report(uuid, text) to authenticated;
grant execute on function public.resolve_public_report(uuid, text, text) to authenticated;

revoke execute on function public._public_report_actor_role() from public, anon, authenticated;
revoke execute on function public._public_report_require_admin() from public, anon, authenticated;
revoke execute on function public._public_report_require_field_engineer() from public, anon, authenticated;
revoke execute on function public._public_report_add_audit(uuid, text, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke execute on function public._public_report_latest_inspection_id(uuid) from public, anon, authenticated;

commit;
