-- ============================================================
-- Purge test / junk citizen reports  (MAINTENANCE SCRIPT — NOT A MIGRATION)
--
-- Purpose: remove development and demo rows from public_reports before a
-- clean run or a demo. This is a deliberate, manual, one-off operation run
-- from the Supabase SQL editor. It is NOT wired into the application, and
-- nothing here changes the security model:
--
--   * No RLS policy is added, dropped or altered.
--   * No RPC is created.
--   * The audit-log immutability trigger is disabled for the DELETE only,
--     inside a transaction, and re-enabled before commit. If anything fails,
--     the rollback restores it automatically (DDL is transactional here).
--
-- Deletion is normally impossible by design: public_reports has no DELETE
-- policy, and public_report_activity_logs cascades into a BEFORE DELETE
-- trigger that raises 'Public report audit logs are immutable'. That is
-- correct for production. This script is the controlled exception.
--
-- WHAT GETS REMOVED WITH EACH REPORT (on delete cascade):
--   public_report_workflow_meta, public_report_field_findings,
--   public_report_visits, public_report_resolutions,
--   public_report_activity_logs, public_report_lgu_escalations,
--   public_report_lgu_decisions
--
-- WHAT SURVIVES, WITH THE LINK CLEARED (on delete set null):
--   notifications.report_id, feedbacks.public_report_id,
--   project_compliance.linked_report_id
--
-- EXPECTED WARNING: the Supabase SQL editor will flag this script as
-- containing destructive operations. That is correct — it deletes reports.
-- Read Step 1's output first, then proceed knowingly. It should NOT warn
-- about row level security; if it does, stop and re-check Step 1.
--
-- NOT HANDLED HERE: uploaded photos in the `public-report-photos` storage
-- bucket. SQL cannot delete storage objects. Step 2 lists the orphaned paths
-- so you can remove them from the Storage browser if you want to.
-- ============================================================

-- ------------------------------------------------------------
-- STEP 1 — Choose what to purge, and review it.
--
-- Edit the WHERE clause below, run this step ALONE, and read the output
-- before going near Step 3. The criteria are captured into a staging table
-- so Steps 2 and 3 act on exactly the rows you reviewed — you cannot
-- accidentally widen the net between previewing and deleting.
-- ------------------------------------------------------------

-- The staging table holds reporter names and complaint text, so it must not
-- live in `public` — PostgREST serves that schema to anon/authenticated keys.
-- A dedicated maintenance schema is not exposed, and RLS with no policies
-- makes the table unreadable even if the schema is ever exposed by mistake.
create schema if not exists maintenance;
revoke all on schema maintenance from anon, authenticated;

drop table if exists maintenance._purge_targets;

create table maintenance._purge_targets as
select
  pr.id,
  pr.created_at,
  pr.status,
  pr.engineer_status,
  pr.project_name,
  pr.municipality,
  pr.barangay,
  pr.full_name,
  pr.description,
  pr.photo_url
from public.public_reports pr
where
  -- ===== EDIT THIS BLOCK =====================================
  -- Default: reports closed without inspection. These are the ones an admin
  -- dismissed, so they carry no field findings and no resolution record.
  pr.status = 'dismissed'

  -- Other criteria you may want instead — uncomment as needed:
  -- or pr.description ilike '%test%'
  -- or pr.project_name ilike '%test%'
  -- or pr.full_name    ilike '%test%'
  -- or pr.municipality = 'TEST MUNICIPALITY'
  -- or pr.created_at < timestamptz '2026-01-01'
  -- or pr.id in ('00000000-0000-0000-0000-000000000000')
  -- ===========================================================
;

alter table maintenance._purge_targets enable row level security;
revoke all on maintenance._purge_targets from anon, authenticated;

-- Review before continuing. Nothing has been deleted yet.
select count(*) as rows_that_will_be_deleted from maintenance._purge_targets;

select id, created_at, status, project_name, municipality, barangay, left(description, 60) as description
from maintenance._purge_targets
order by created_at;


-- ------------------------------------------------------------
-- STEP 2 — Photo paths to clean up in Storage (optional).
--
-- Run after Step 1. Copy these paths, then delete them in the Supabase
-- Storage browser under the `public-report-photos` bucket. Do this BEFORE
-- Step 3 if you want the list, since the rows are gone afterwards.
-- ------------------------------------------------------------

select
  id,
  photo_url,
  -- Best-effort object path within the bucket.
  regexp_replace(photo_url, '^.*/public-report-photos/', '') as storage_object_path
from maintenance._purge_targets
where photo_url is not null and photo_url <> '';


-- ------------------------------------------------------------
-- STEP 3 — Delete. Run this ONLY after reviewing Step 1's output.
--
-- Everything is one transaction. If any statement fails, the whole thing
-- rolls back — including the trigger disable, so the audit log cannot be
-- left unprotected.
-- ------------------------------------------------------------

begin;

-- Safety rail: refuse to run if the filter matched a suspiciously large set.
-- Raise the cap deliberately if you really do mean to delete more.
do $$
declare
  v_count integer;
  v_max   integer := 200;
begin
  select count(*) into v_count from maintenance._purge_targets;

  if v_count = 0 then
    raise exception 'Nothing matched. Re-check the WHERE clause in Step 1.';
  end if;

  if v_count > v_max then
    raise exception
      'Refusing to delete % reports (cap is %). Narrow the filter in Step 1, or raise v_max on purpose.',
      v_count, v_max;
  end if;

  raise notice 'Deleting % report(s) and their cascaded child rows.', v_count;
end $$;

-- The audit log is append-only in normal operation. Lift it for this
-- statement only; the matching re-enable is a few lines below, and a
-- rollback would undo this disable too.
alter table public.public_report_activity_logs
  disable trigger trg_prevent_public_report_activity_log_delete;

delete from public.public_reports
where id in (select id from maintenance._purge_targets);

alter table public.public_report_activity_logs
  enable trigger trg_prevent_public_report_activity_log_delete;

commit;


-- ------------------------------------------------------------
-- STEP 4 — Verify, then clean up the staging table.
-- ------------------------------------------------------------

-- Expect 0: none of the targeted reports should remain.
select count(*) as leftover_targets
from public.public_reports pr
join maintenance._purge_targets t on t.id = pr.id;

-- Expect t: the audit log must be protected again.
select tgenabled <> 'D' as audit_delete_trigger_is_armed
from pg_trigger
where tgname = 'trg_prevent_public_report_activity_log_delete';

-- Expect 0 rows: no report left in an illegal workflow state.
select * from public.public_report_state_violations;

-- Remove the staging table and its schema so nothing lingers.
drop table if exists maintenance._purge_targets;
drop schema if exists maintenance cascade;
