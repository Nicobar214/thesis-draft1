-- Citizen Reporting security verification queries
-- Run after supabase_public_report_workflow_rls_hardening.sql.
-- These are read-only diagnostics except for the commented manual test templates.

-- 1. State preflight/final diagnostic. Expected: 0 rows.
select *
from public.public_report_state_violations;

-- 2. Final RLS policy map.
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual as using_expression,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'public_reports',
    'public_report_field_findings',
    'public_report_activity_logs',
    'public_report_resolutions',
    'public_report_workflow_meta',
    'public_report_visits',
    'public_report_admin_notes',
    'notifications',
    'public_report_lgu_escalations',
    'public_report_lgu_decisions'
  )
order by tablename, cmd, policyname;

-- 3. Dangerous broad policy detector. Expected: 0 rows, except policies you
-- deliberately accept after review.
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'public_reports',
    'public_report_field_findings',
    'public_report_activity_logs',
    'public_report_resolutions',
    'public_report_workflow_meta',
    'public_report_visits',
    'public_report_admin_notes',
    'notifications',
    'public_report_lgu_escalations',
    'public_report_lgu_decisions'
  )
  and (
    coalesce(qual, '') in ('true', '(true)')
    or coalesce(with_check, '') in ('true', '(true)')
  )
order by tablename, policyname;

-- 4. RPC and helper execute privileges.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  coalesce(array_agg(acl::text order by acl::text) filter (where acl is not null), array[]::text[]) as execute_acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join lateral unnest(coalesce(p.proacl, acldefault('f', p.proowner))) acl on true
where n.nspname = 'public'
  and p.proname in (
    'review_public_report',
    'assign_public_report_engineer',
    'unassign_public_report_engineer',
    'start_public_report_inspection',
    'submit_public_report_inspection',
    'reject_public_report_inspection',
    'validate_public_report_inspection',
    'dismiss_public_report',
    'resolve_public_report',
    'update_public_report_workflow_meta',
    '_public_report_actor_role',
    '_public_report_require_admin',
    '_public_report_require_field_engineer',
    '_public_report_add_audit',
    '_public_report_latest_inspection_id'
  )
group by n.nspname, p.proname, p.oid, p.prosecdef, p.proconfig
order by function_name, arguments;

-- 5. Safe-view column audit. Confirm no contact_info, actor IDs,
-- admin notes, validation internals, or assignment IDs are exposed.
select
  table_name,
  ordinal_position,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'public_reports_citizen_view',
    'public_report_field_findings_citizen_view',
    'public_report_resolutions_citizen_view'
  )
order by table_name, ordinal_position;

-- 6. View definition review.
select
  schemaname,
  viewname,
  definition
from pg_views
where schemaname = 'public'
  and viewname in (
    'public_reports_citizen_view',
    'public_report_field_findings_citizen_view',
    'public_report_resolutions_citizen_view'
  )
order by viewname;

-- 7. Manual role-session test templates:
-- Run these from a real citizen/contractor/LGU/field engineer session through
-- the app or Supabase client, not from the SQL editor service role.
--
-- Citizen malicious insert should be denied or normalized:
-- insert into public.public_reports (
--   municipality, barangay, project_name, description, status, engineer_status, verification
-- ) values (
--   'TEST MUNICIPALITY', 'TEST BARANGAY', 'SECURITY TEST', 'malicious insert',
--   'resolved', 'validated', 'Verified On-Site'
-- ) returning id, status, engineer_status, verification, assigned_engineer_id;
--
-- Citizen/contractor/LGU direct workflow update should be denied:
-- update public.public_reports
-- set status = 'resolved', engineer_status = 'validated'
-- where id = '<test-report-id>';
--
-- Non-admin direct resolution insert should be denied:
-- insert into public.public_report_resolutions (report_id, summary)
-- values ('<test-report-id>', 'fake resolution');
--
-- Non-admin fake audit insert should be denied unless it is an allowed assigned-FE visit:
-- insert into public.public_report_activity_logs (report_id, action_type, action, description)
-- values ('<test-report-id>', 'inspection_validated', 'INSPECTION_VALIDATED', 'fake audit');
