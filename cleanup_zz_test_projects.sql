-- =============================================================================
-- Cleanup after the Phase 2 browser test ("ZZ TEST overdue", "zz test overdue 2").
-- DELETES DATA. Run once in the Supabase SQL editor; it is one transaction and
-- stops without changing anything if the counts are not what was checked on
-- 2026-10-26.
--
-- Already gone (checked read-only): the test projects themselves, their delay
-- cases, history, time extensions and suspensions (deleted with the projects).
--
-- Left behind, deleted here:
--   16 notifications about the test projects. Their project_id became NULL when
--      the projects were deleted (the foreign key is ON DELETE SET NULL), so they
--      are found by their text: the message contains "zz test" (any case).
--   4 overdue_alerts rows (kind 'project_delay', stage 'opened') whose case no
--      longer exists. These are only the "already notified" ledger; nothing reads
--      them once their case is gone.
--
-- KEPT: the real 'unassigned_summary' alert row and the 2 real delay_* notifications
-- (the first admin summary), and everything else.
-- =============================================================================
begin;

do $$
declare
  v_projects int; v_notifs int; v_alerts int;
begin
  select count(*) into v_projects from public.fmr_projects where project_name ilike 'zz test%';
  select count(*) into v_notifs from public.notifications
   where project_id is null and type like 'delay\_%' and message ilike '%zz test%';
  select count(*) into v_alerts from public.overdue_alerts a
   where a.kind = 'project_delay' and a.stage = 'opened'
     and not exists (select 1 from public.project_delay_cases c where c.id::text = a.ref_id);

  if v_projects <> 0 then raise exception 'Stopped: % "zz test" project(s) still exist. Nothing was deleted.', v_projects; end if;
  if v_notifs <> 16 then raise exception 'Stopped: expected 16 test notifications, found %. Nothing was deleted.', v_notifs; end if;
  if v_alerts <> 4 then raise exception 'Stopped: expected 4 orphaned alert rows, found %. Nothing was deleted.', v_alerts; end if;

  delete from public.notifications
   where project_id is null and type like 'delay\_%' and message ilike '%zz test%';
  get diagnostics v_notifs = row_count;

  delete from public.overdue_alerts a
   where a.kind = 'project_delay' and a.stage = 'opened'
     and not exists (select 1 from public.project_delay_cases c where c.id::text = a.ref_id);
  get diagnostics v_alerts = row_count;

  if v_notifs <> 16 or v_alerts <> 4 then
    raise exception 'Stopped: deleted % notifications and % alerts (expected 16 and 4). Rolled back.', v_notifs, v_alerts;
  end if;
  raise notice 'Deleted % test notifications and % orphaned alert rows.', v_notifs, v_alerts;
end $$;

commit;

-- Check (read-only), expected: 0, 0, and 1 (the real unassigned_summary row).
-- select (select count(*) from public.notifications where message ilike '%zz test%') test_notifications,
--        (select count(*) from public.overdue_alerts a where a.kind = 'project_delay' and a.stage = 'opened'
--          and not exists (select 1 from public.project_delay_cases c where c.id::text = a.ref_id)) orphan_alerts,
--        (select count(*) from public.overdue_alerts where kind = 'project_delay' and ref_id = 'unassigned_summary') summary_rows;
