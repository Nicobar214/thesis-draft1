-- =============================================================================
-- Reusable cleanup of browser-test data: projects named "ZZ TEST..." (any case).
-- DELETES DATA. Run in the Supabase SQL editor whenever testing is done; safe to
-- run again (with nothing to clean it deletes nothing and shows zeros).
--
-- One transaction. It first counts what it will delete, then STOPS with nothing
-- deleted if anything real would be touched:
--   - a road gap (road_network_gaps) linked to a test project (real survey data),
--   - an LGU proposal linked to a test project,
--   - a priority decision about something else that points to a test project,
--   - a citizen/farmer report filed on a test project (reports have many linked
--     tables; clean those with a dedicated script like delete_test_projects_*.sql),
--   - a progress-update item of a real project that uses a test project's work plan.
--
-- Deletes:
--   1. the test projects, and with them (ON DELETE CASCADE): delay follow-ups and
--      their history, time extensions, suspensions, routes, tasks, milestones,
--      tranches, penalties, follows, work plan items; progress updates and their
--      items are deleted first (work plan items may not go before them);
--   2. priority decisions whose candidate is a test project;
--   3. notifications about the test projects: linked by project, progress update or
--      task, or with "ZZ TEST" in the title or message (their project link is
--      emptied when a project is deleted, so the text is how old ones are found);
--   4. delay "already notified" rows (overdue_alerts, kind 'project_delay') whose
--      follow-up or suspension no longer exists. The rows 'unassigned_summary' and
--      'job_errors' are never touched.
-- Not deleted: photo files in Storage (remove those in the Storage page if any).
--
-- The result table shows the rows deleted per table. If it stops instead, the
-- error message names the test projects and the real rows that are linked.
-- =============================================================================
begin;

create temp table _zz_projects on commit drop as
  select id, project_name from public.fmr_projects where project_name ilike 'zz test%';
create temp table _zz_updates on commit drop as
  select id from public.progress_updates where fmr_project_id in (select id from _zz_projects);
drop table if exists pg_temp._zz_report;   -- kept after commit so the summary below can be shown
create temp table _zz_report (n int, what text, rows_deleted int);

do $$
declare
  v_ids text; v_block text := '';
  n_gaps int; n_proposals int; n_decisions_other int; n_reports int; n_items_real int;
  n_cases int; n_events int; n_ext int; n_susp int; n_routes int; n_tasks int; n_ms int; n_tr int; n_pen int; n_fol int; n_wpi int;
  n_items int; n_updates int; n_decisions int; n_notifs int; n_alerts int; n_projects int; v int;
begin
  select string_agg(format('%s (#%s)', project_name, id), ', ' order by id) into v_ids from _zz_projects;

  -- Safety: anything real that would be deleted or changed?
  select count(*) into n_gaps from public.road_network_gaps
   where from_project_id in (select id from _zz_projects) or to_project_id in (select id from _zz_projects);
  select count(*) into n_proposals from public.lgu_project_proposals where fmr_project_id in (select id from _zz_projects);
  select count(*) into n_decisions_other from public.priority_decisions
   where fmr_project_id in (select id from _zz_projects)
     and not (candidate_kind = 'project' and candidate_id in (select id::text from _zz_projects));
  select count(*) into n_reports from public.public_reports where project_id in (select 'fmr-' || id from _zz_projects);
  select count(*) into n_items_real from public.progress_update_items i
   where i.work_plan_item_id in (select id from public.work_plan_items where fmr_project_id in (select id from _zz_projects))
     and i.progress_update_id not in (select id from _zz_updates);
  if n_gaps > 0 then v_block := v_block || format(' %s road gap(s);', n_gaps); end if;
  if n_proposals > 0 then v_block := v_block || format(' %s LGU proposal(s);', n_proposals); end if;
  if n_decisions_other > 0 then v_block := v_block || format(' %s priority decision(s) about other roads;', n_decisions_other); end if;
  if n_reports > 0 then v_block := v_block || format(' %s citizen/farmer report(s);', n_reports); end if;
  if n_items_real > 0 then v_block := v_block || format(' %s progress item(s) of real projects;', n_items_real); end if;
  if v_block <> '' then
    raise exception 'Stopped, nothing deleted. Real data is linked to the test projects [%]:%', coalesce(v_ids, 'none'), v_block;
  end if;

  -- What goes with the projects (counted before deleting).
  select count(*) into n_cases from public.project_delay_cases where project_id in (select id from _zz_projects);
  select count(*) into n_events from public.project_delay_case_events
   where case_id in (select id from public.project_delay_cases where project_id in (select id from _zz_projects));
  select count(*) into n_ext from public.project_time_extensions where project_id in (select id from _zz_projects);
  select count(*) into n_susp from public.project_suspensions where project_id in (select id from _zz_projects);
  select count(*) into n_routes from public.project_routes where project_id in (select id from _zz_projects);
  select count(*) into n_tasks from public.project_tasks where project_id in (select id from _zz_projects);
  select count(*) into n_ms from public.project_milestones where project_id in (select id from _zz_projects);
  select count(*) into n_tr from public.project_tranches where project_id in (select id from _zz_projects);
  select count(*) into n_pen from public.project_penalties where project_id in (select id from _zz_projects);
  select count(*) into n_fol from public.project_follows where project_id in (select id from _zz_projects);
  select count(*) into n_wpi from public.work_plan_items where fmr_project_id in (select id from _zz_projects);

  -- 3. Notifications (before the project links are emptied).
  delete from public.notifications
   where project_id in (select id from _zz_projects)
      or progress_update_id in (select id from _zz_updates)
      or schedule_task_id in (select id from public.project_tasks where project_id in (select id from _zz_projects))
      or title ilike '%zz test%' or message ilike '%zz test%';
  get diagnostics n_notifs = row_count;

  -- 2. Priority decisions about a test project.
  delete from public.priority_decisions
   where candidate_kind = 'project' and candidate_id in (select id::text from _zz_projects);
  get diagnostics n_decisions = row_count;

  -- 1. Progress updates first (work plan items may not be deleted before their items), then the projects.
  delete from public.progress_update_items where progress_update_id in (select id from _zz_updates);
  get diagnostics n_items = row_count;
  delete from public.progress_updates where id in (select id from _zz_updates);
  get diagnostics n_updates = row_count;
  delete from public.fmr_projects where id in (select id from _zz_projects);
  get diagnostics n_projects = row_count;

  -- 4. Orphaned "already notified" rows of the delay follow-up.
  delete from public.overdue_alerts a
   where a.kind = 'project_delay'
     and a.ref_id not in ('unassigned_summary', 'job_errors')
     and (
       (a.ref_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and not exists (select 1 from public.project_delay_cases c where c.id::text = a.ref_id))
       or (a.ref_id like 'suspension:%'
          and not exists (select 1 from public.project_suspensions s where 'suspension:' || s.id = a.ref_id))
     );
  get diagnostics n_alerts = row_count;

  -- Nothing of the test projects may be left.
  select count(*) into v from public.project_delay_cases where project_id in (select id from _zz_projects);
  if v > 0 or exists (select 1 from public.fmr_projects where id in (select id from _zz_projects)) then
    raise exception 'Stopped, rolled back: test rows were still there after deleting.';
  end if;

  insert into _zz_report values
    (1, 'fmr_projects (ZZ TEST): ' || coalesce(v_ids, 'none'), n_projects),
    (2, '  delay follow-ups (with the projects)', n_cases),
    (3, '  delay follow-up history (with the projects)', n_events),
    (4, '  time extensions (with the projects)', n_ext),
    (5, '  suspensions (with the projects)', n_susp),
    (6, '  routes / tasks / milestones / tranches (with the projects)', n_routes + n_tasks + n_ms + n_tr),
    (7, '  penalties / follows / work plan items (with the projects)', n_pen + n_fol + n_wpi),
    (8, 'progress updates', n_updates),
    (9, 'progress update items', n_items),
    (10, 'priority decisions about a test project', n_decisions),
    (11, 'notifications about test projects', n_notifs),
    (12, 'orphaned delay alert rows (overdue_alerts)', n_alerts);
end $$;

commit;

-- The summary (the SQL editor shows the last result).
select what, rows_deleted from _zz_report order by n;

-- Check afterwards (read-only), expected all 0:
-- select (select count(*) from public.fmr_projects where project_name ilike 'zz test%') projects,
--        (select count(*) from public.notifications where title ilike '%zz test%' or message ilike '%zz test%') notifications,
--        (select count(*) from public.overdue_alerts a where a.kind = 'project_delay'
--           and a.ref_id not in ('unassigned_summary', 'job_errors')
--           and not exists (select 1 from public.project_delay_cases c where c.id::text = a.ref_id)
--           and not exists (select 1 from public.project_suspensions s where 'suspension:' || s.id = a.ref_id)) orphan_alerts;
