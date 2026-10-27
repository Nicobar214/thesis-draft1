-- =============================================================================
-- FIX: reports made AT the road were refused ("new row violates row-level
-- security policy for table public_reports"). REPLACES ONE INSERT POLICY.
--
-- Why: the insert policy still had  verification <> 'Verified On-Site'  from
-- before the server decided the badge. Since supabase_server_location_verdict.sql
-- the BEFORE INSERT trigger (public_report_prepare_citizen_insert) computes the
-- badge from the report's GPS, and PostgreSQL checks the policy AFTER that
-- trigger. So a reporter who really was on site got "Verified On-Site" from the
-- server and was then refused for it, while a report from far away ("Needs
-- Review") went through. Seen in the logs 2026-10-27 (phone reports at the road).
--
-- The condition protected against an app claiming "Verified On-Site" itself;
-- the trigger now overwrites whatever the app sends for every non-admin report,
-- so it is no longer needed. Everything else in the policy is unchanged.
-- Run once in the Supabase SQL editor. Safe to run again.
-- =============================================================================

drop policy if exists public_reports_insert_citizen_initial on public.public_reports;
create policy public_reports_insert_citizen_initial on public.public_reports
  for insert to anon, authenticated
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
    -- (removed: verification <> 'Verified On-Site'; the server sets the badge)
    and (auth.uid() is not null or user_id is null)
    and (auth.uid() is null or user_id = auth.uid())
  );

-- Check (read-only): should return false (the condition is gone).
-- select with_check ilike '%Verified On-Site%' from pg_policies where tablename = 'public_reports' and policyname = 'public_reports_insert_citizen_initial';
