-- ============================================================
-- Public Report Legacy State Cleanup
-- Run after: supabase_public_report_workflow_foundation.sql
--
-- Purpose:
--   Normalize three known legacy public report state combinations without
--   fabricating engineer validation or deleting historical evidence.
--
-- Findings from live diagnostic/audit export:
--   1) 85145b62... is resolved with no engineer workflow, no findings,
--      no resolution row, and no activity logs. Treat as legacy-resolved
--      under the pre-validation workflow. Do not set engineer_status.
--   2) e01c0bd3... is pending + inspected with an assigned engineer and
--      verified-on-site marker, but no finding rows. Preserve inspected,
--      correct report status to reviewed.
--   3) 0d6d35d... is pending + assigned with assignment/unassignment/visit
--      activity. Preserve assigned, correct report status to reviewed.
--
-- This migration does not modify React, does not harden RLS, and does not
-- implement RPCs.
-- ============================================================

begin;

-- Mark legacy resolved reports truthfully instead of pretending they passed
-- the new engineer-validation workflow.
alter table public.public_reports
  add column if not exists legacy_resolved_without_engineer_validation boolean not null default false;

create index if not exists idx_public_reports_legacy_resolved_without_engineer_validation
  on public.public_reports(legacy_resolved_without_engineer_validation)
  where legacy_resolved_without_engineer_validation = true;

-- 1. Grandfather the old resolved report.
update public.public_reports
set
  legacy_resolved_without_engineer_validation = true,
  resolved_at = coalesce(resolved_at, updated_at, created_at),
  updated_at = now()
where id = '85145b62-918d-4da1-be58-9b462e709391'::uuid
  and status = 'resolved'
  and engineer_status is null;

insert into public.public_report_activity_logs (
  report_id,
  action_type,
  action,
  description,
  remarks,
  metadata,
  actor_name,
  created_at
)
select
  '85145b62-918d-4da1-be58-9b462e709391'::uuid,
  'legacy_resolved_grandfathered',
  'LEGACY_RESOLVED_GRANDFATHERED',
  'Legacy resolved report preserved without fabricating engineer validation.',
  'Resolved before formal engineer-validation enforcement; no field finding or resolution record existed in legacy data.',
  jsonb_build_object(
    'previous_status', 'resolved',
    'previous_engineer_status', null,
    'cleanup_reason', 'grandfather legacy resolved report'
  ),
  'System Migration',
  now()
where not exists (
  select 1
  from public.public_report_activity_logs
  where report_id = '85145b62-918d-4da1-be58-9b462e709391'::uuid
    and action = 'LEGACY_RESOLVED_GRANDFATHERED'
);

-- 2. Pending + inspected means the case already entered engineering workflow.
-- Preserve engineer_status = inspected; correct report-level status only.
update public.public_reports
set
  status = 'reviewed',
  reviewed_at = coalesce(reviewed_at, assigned_at, updated_at, created_at),
  updated_at = now()
where id = 'e01c0bd3-2749-4ae8-8ff4-97c8c2753393'::uuid
  and status = 'pending'
  and engineer_status = 'inspected';

insert into public.public_report_activity_logs (
  report_id,
  action_type,
  action,
  description,
  remarks,
  metadata,
  actor_name,
  created_at
)
select
  'e01c0bd3-2749-4ae8-8ff4-97c8c2753393'::uuid,
  'legacy_status_normalized',
  'LEGACY_STATUS_NORMALIZED',
  'Legacy report status normalized from pending to reviewed; engineer status preserved.',
  'Existing engineer_status=inspected showed the case had entered engineering workflow, but no field finding row existed.',
  jsonb_build_object(
    'old_state', jsonb_build_object('status', 'pending', 'engineer_status', 'inspected'),
    'new_state', jsonb_build_object('status', 'reviewed', 'engineer_status', 'inspected'),
    'cleanup_reason', 'pending report already had inspected engineer workflow state'
  ),
  'System Migration',
  now()
where not exists (
  select 1
  from public.public_report_activity_logs
  where report_id = 'e01c0bd3-2749-4ae8-8ff4-97c8c2753393'::uuid
    and action = 'LEGACY_STATUS_NORMALIZED'
);

-- 3. Pending + assigned means admin assignment happened. Preserve assignment;
-- correct report-level status only.
update public.public_reports
set
  status = 'reviewed',
  reviewed_at = coalesce(reviewed_at, assigned_at, updated_at, created_at),
  updated_at = now()
where id = '0d6d35dc-5f2e-4b75-921f-9766b6daa349'::uuid
  and status = 'pending'
  and engineer_status = 'assigned';

insert into public.public_report_activity_logs (
  report_id,
  action_type,
  action,
  description,
  remarks,
  metadata,
  actor_name,
  created_at
)
select
  '0d6d35dc-5f2e-4b75-921f-9766b6daa349'::uuid,
  'legacy_status_normalized',
  'LEGACY_STATUS_NORMALIZED',
  'Legacy report status normalized from pending to reviewed; assignment preserved.',
  'Existing assignment and activity logs showed the case had entered admin/engineer workflow.',
  jsonb_build_object(
    'old_state', jsonb_build_object('status', 'pending', 'engineer_status', 'assigned'),
    'new_state', jsonb_build_object('status', 'reviewed', 'engineer_status', 'assigned'),
    'cleanup_reason', 'pending report already had assigned engineer workflow state'
  ),
  'System Migration',
  now()
where not exists (
  select 1
  from public.public_report_activity_logs
  where report_id = '0d6d35dc-5f2e-4b75-921f-9766b6daa349'::uuid
    and action = 'LEGACY_STATUS_NORMALIZED'
);

-- Update the diagnostic view so strict future enforcement can distinguish
-- truthful legacy-resolved records from new invalid resolved states.
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
    when pr.status = 'resolved'
      and coalesce(pr.engineer_status, '') <> 'validated'
      and coalesce(pr.legacy_resolved_without_engineer_validation, false) is not true then
      'resolved reports require validated engineer status unless grandfathered as legacy resolved'
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
  or (
    pr.status = 'resolved'
    and coalesce(pr.engineer_status, '') <> 'validated'
    and coalesce(pr.legacy_resolved_without_engineer_validation, false) is not true
  );

comment on column public.public_reports.legacy_resolved_without_engineer_validation is
  'True only for reports resolved before formal engineer-validation enforcement. This preserves legacy truth without fabricating validation.';

comment on view public.public_report_state_violations is
  'Diagnostic view for rows that violate the planned public report state matrix, excluding explicitly grandfathered legacy-resolved reports.';

commit;
