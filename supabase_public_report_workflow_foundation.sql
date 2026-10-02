-- ============================================================
-- Public Report Workflow Foundation
-- Phase: database design foundation only
--
-- Purpose:
--   Prepare the existing Citizen Reporting workflow for controlled RPC-based
--   transitions without breaking the current React UI.
--
-- Rules for this phase:
--   * Additive and backward compatible.
--   * Do not drop or rename existing tables/columns.
--   * Reuse existing public_report_field_findings as inspection history.
--   * Reuse existing public_report_activity_logs as workflow audit history.
--   * Do not tighten public_reports RLS yet; current frontend still uses
--     direct table updates until RPC migration is complete.
--   * Do not enforce the final state matrix yet. First expose diagnostics so
--     legacy rows can be reviewed.
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. public_reports: additive workflow metadata
-- ------------------------------------------------------------

alter table public.public_reports
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by uuid references public.profiles(id) on delete set null,
  add column if not exists dismissal_reason text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz default now();

-- Existing installs usually have public_reports_status_check with:
-- pending/reviewed/resolved. Extend it to dismissed without scanning legacy
-- rows. Existing rows remain untouched, and new writes get the broader rule.
do $$
begin
  alter table public.public_reports
    drop constraint if exists public_reports_status_check;

  alter table public.public_reports
    add constraint public_reports_status_check
    check (status in ('pending', 'reviewed', 'dismissed', 'resolved'))
    not valid;
exception when others then
  raise notice 'Could not update public_reports_status_check: %', sqlerrm;
end $$;

do $$
begin
  alter table public.public_reports
    drop constraint if exists public_reports_engineer_status_check;

  alter table public.public_reports
    add constraint public_reports_engineer_status_check
    check (
      engineer_status is null
      or engineer_status in ('assigned', 'in_progress', 'inspected', 'rejected', 'validated')
    )
    not valid;
exception when others then
  raise notice 'Could not update public_reports_engineer_status_check: %', sqlerrm;
end $$;

create index if not exists idx_public_reports_status_engineer_status
  on public.public_reports(status, engineer_status);

create index if not exists idx_public_reports_dismissed_at
  on public.public_reports(dismissed_at)
  where dismissed_at is not null;

create index if not exists idx_public_reports_resolved_at
  on public.public_reports(resolved_at)
  where resolved_at is not null;

-- ------------------------------------------------------------
-- 2. public_report_field_findings becomes inspection history
-- ------------------------------------------------------------

alter table public.public_report_field_findings
  add column if not exists inspection_number integer,
  add column if not exists status text,
  add column if not exists inspection_started_at timestamptz,
  add column if not exists inspection_latitude double precision,
  add column if not exists inspection_longitude double precision,
  add column if not exists gps_accuracy_meters double precision,
  add column if not exists engineer_certified_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists validated_by uuid references public.profiles(id) on delete set null,
  add column if not exists validated_at timestamptz,
  add column if not exists updated_at timestamptz default now();

-- Future RPCs may create an in-progress inspection before findings are known.
-- Existing frontend submissions still provide both values, so this is a safe
-- relaxation that preserves current behavior while enabling the state machine.
alter table public.public_report_field_findings
  alter column condition_observed drop not null,
  alter column recommended_action drop not null;

alter table public.public_report_field_findings
  alter column status set default 'submitted';

-- Legacy findings are already completed submissions. Preserve them and number
-- them per report by submission/create order.
with numbered_findings as (
  select
    id,
    row_number() over (
      partition by report_id
      order by submitted_at nulls last, created_at nulls last, id
    ) as rn
  from public.public_report_field_findings
)
update public.public_report_field_findings f
set inspection_number = numbered_findings.rn
from numbered_findings
where f.id = numbered_findings.id
  and f.inspection_number is null;

update public.public_report_field_findings
set status = 'submitted'
where status is null;

do $$
begin
  alter table public.public_report_field_findings
    drop constraint if exists public_report_field_findings_status_check;

  alter table public.public_report_field_findings
    add constraint public_report_field_findings_status_check
    check (status in ('in_progress', 'submitted', 'rejected', 'validated'))
    not valid;
exception when others then
  raise notice 'Could not update public_report_field_findings_status_check: %', sqlerrm;
end $$;

do $$
begin
  alter table public.public_report_field_findings
    drop constraint if exists public_report_field_findings_inspection_number_check;

  alter table public.public_report_field_findings
    add constraint public_report_field_findings_inspection_number_check
    check (inspection_number is null or inspection_number > 0)
    not valid;
exception when others then
  raise notice 'Could not update public_report_field_findings_inspection_number_check: %', sqlerrm;
end $$;

create unique index if not exists idx_public_report_findings_report_inspection_no
  on public.public_report_field_findings(report_id, inspection_number)
  where inspection_number is not null;

create index if not exists idx_public_report_findings_report_status
  on public.public_report_field_findings(report_id, status);

create index if not exists idx_public_report_findings_engineer
  on public.public_report_field_findings(engineer_id);

create index if not exists idx_public_report_findings_latest
  on public.public_report_field_findings(report_id, submitted_at desc);

-- Compatibility trigger: old frontend inserts do not know inspection_number or
-- status yet. Assign them without forcing frontend changes in this phase.
create or replace function public.prepare_public_report_field_finding()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.status := coalesce(new.status, 'submitted');

  if new.inspection_number is null then
    select coalesce(max(inspection_number), 0) + 1
      into new.inspection_number
    from public.public_report_field_findings
    where report_id = new.report_id;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_prepare_public_report_field_finding
  on public.public_report_field_findings;
create trigger trg_prepare_public_report_field_finding
before insert on public.public_report_field_findings
for each row execute function public.prepare_public_report_field_finding();

-- Keep updated_at useful for later admin validation/rejection updates.
create or replace function public.touch_public_report_field_finding_updated_at()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_touch_public_report_field_finding_updated_at
  on public.public_report_field_findings;
create trigger trg_touch_public_report_field_finding_updated_at
before update on public.public_report_field_findings
for each row execute function public.touch_public_report_field_finding_updated_at();

-- ------------------------------------------------------------
-- 3. public_report_activity_logs becomes immutable audit history
-- ------------------------------------------------------------

alter table public.public_report_activity_logs
  add column if not exists actor_id uuid references public.profiles(id) on delete set null,
  add column if not exists actor_role text,
  add column if not exists action text,
  add column if not exists old_state jsonb,
  add column if not exists new_state jsonb,
  add column if not exists remarks text;

-- If this migration is re-run after the immutability triggers were created,
-- temporarily remove them so the idempotent compatibility backfill can run.
drop trigger if exists trg_prevent_public_report_activity_log_update
  on public.public_report_activity_logs;
drop trigger if exists trg_prevent_public_report_activity_log_delete
  on public.public_report_activity_logs;

update public.public_report_activity_logs
set
  action = coalesce(action, upper(action_type)),
  remarks = coalesce(remarks, description)
where action is null
   or remarks is null;

create index if not exists idx_public_report_activity_logs_action
  on public.public_report_activity_logs(action);

create index if not exists idx_public_report_activity_logs_actor
  on public.public_report_activity_logs(actor_id);

create index if not exists idx_public_report_activity_logs_report_created
  on public.public_report_activity_logs(report_id, created_at desc);

-- Compatibility trigger: current React code inserts action_type/description.
-- Future RPCs can insert action/remarks. Keep both shapes readable.
create or replace function public.normalize_public_report_activity_log()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.action := coalesce(new.action, upper(new.action_type));
  new.action_type := coalesce(new.action_type, lower(new.action));
  new.remarks := coalesce(new.remarks, new.description);
  new.description := coalesce(new.description, new.remarks);
  return new;
end;
$function$;

drop trigger if exists trg_normalize_public_report_activity_log
  on public.public_report_activity_logs;
create trigger trg_normalize_public_report_activity_log
before insert on public.public_report_activity_logs
for each row execute function public.normalize_public_report_activity_log();

-- Audit entries are append-only. This does not change RLS policies yet, but it
-- prevents accidental or malicious edits through the permissive legacy policy.
create or replace function public.prevent_public_report_activity_log_mutation()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  raise exception 'Public report audit logs are immutable';
end;
$function$;

drop trigger if exists trg_prevent_public_report_activity_log_update
  on public.public_report_activity_logs;
create trigger trg_prevent_public_report_activity_log_update
before update on public.public_report_activity_logs
for each row execute function public.prevent_public_report_activity_log_mutation();

drop trigger if exists trg_prevent_public_report_activity_log_delete
  on public.public_report_activity_logs;
create trigger trg_prevent_public_report_activity_log_delete
before delete on public.public_report_activity_logs
for each row execute function public.prevent_public_report_activity_log_mutation();

-- ------------------------------------------------------------
-- 4. Diagnostics for later state-matrix enforcement
-- ------------------------------------------------------------
-- Run:
--   select * from public.public_report_state_violations;
-- before adding a hard CHECK/trigger in the later RPC/RLS phase.

create or replace view public.public_report_state_violations as
select
  pr.id,
  pr.status,
  pr.engineer_status,
  pr.assigned_engineer_id,
  pr.created_at,
  pr.updated_at,
  case
    when pr.status not in ('pending', 'reviewed', 'dismissed', 'resolved') then
      'invalid report status'
    when pr.engineer_status is not null
      and pr.engineer_status not in ('assigned', 'in_progress', 'inspected', 'rejected', 'validated') then
      'invalid engineer status'
    when pr.status = 'pending' and pr.engineer_status is not null then
      'pending reports must not have an engineer workflow status'
    when pr.status = 'dismissed' and pr.engineer_status is not null then
      'dismissed reports must not have an engineer workflow status'
    when pr.status = 'resolved' and coalesce(pr.engineer_status, '') <> 'validated' then
      'resolved reports require validated engineer status'
    when pr.status = 'reviewed'
      and pr.engineer_status is not null
      and pr.engineer_status not in ('assigned', 'in_progress', 'inspected', 'rejected', 'validated') then
      'reviewed report has invalid engineer workflow status'
    else
      'unknown violation'
  end as violation_reason
from public.public_reports pr
where
  pr.status not in ('pending', 'reviewed', 'dismissed', 'resolved')
  or (
    pr.engineer_status is not null
    and pr.engineer_status not in ('assigned', 'in_progress', 'inspected', 'rejected', 'validated')
  )
  or (pr.status = 'pending' and pr.engineer_status is not null)
  or (pr.status = 'dismissed' and pr.engineer_status is not null)
  or (pr.status = 'resolved' and coalesce(pr.engineer_status, '') <> 'validated');

comment on view public.public_report_state_violations is
  'Diagnostic view for legacy rows that violate the planned public report state matrix. Review and clean this before enforcing hard transition constraints.';

-- ------------------------------------------------------------
-- 5. RLS notes for the next phase
-- ------------------------------------------------------------
-- Intentionally left in place for now because current React components still
-- perform direct writes:
--   public_reports: "Authenticated users can update public reports"
--   public_reports: "Authenticated users can delete public reports"
--   public_report_workflow_meta: public_report_workflow_meta_rw
--   public_report_field_findings: public_report_field_findings_rw
--   public_report_resolutions: public_report_resolutions_rw
--   public_report_activity_logs: public_report_activity_logs_rw
-- These should be replaced after the RPC migration is complete.

commit;
