-- Delete test projects #198, #199, #200 and everything linked to them.
-- MODIFIES DATA. Run once in the Supabase SQL editor as postgres.
BEGIN;

-- 0. Safety: abort unless exactly these 3 unpublished test projects match.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.fmr_projects
       WHERE (id, project_name) IN ((198, 'Test Project 2'), (199, 'Lil Street'), (200, 'CICT ROAD'))
         AND published_at IS NULL) <> 3 THEN
    RAISE EXCEPTION 'Safety check failed: projects 198/199/200 do not match the expected test projects. Nothing deleted.';
  END IF;
END $$;

-- The exact rows to remove (fixed at the start).
CREATE TEMP TABLE _del_reports ON COMMIT DROP AS
  SELECT id FROM public.public_reports WHERE project_id IN ('fmr-198', 'fmr-199', 'fmr-200');
CREATE TEMP TABLE _del_updates ON COMMIT DROP AS
  SELECT id FROM public.progress_updates WHERE fmr_project_id IN (198, 199, 200);

-- 0b. Safety: abort (roll back everything) unless the row counts are exactly what was reviewed.
DO $$
DECLARE v_reports int; v_updates int;
BEGIN
  SELECT count(*) INTO v_reports FROM _del_reports;
  SELECT count(*) INTO v_updates FROM _del_updates;
  IF v_reports <> 17 OR v_updates <> 3 THEN
    RAISE EXCEPTION 'Safety check failed: expected 17 reports and 3 progress updates, found % and %. Nothing deleted.',
      v_reports, v_updates;
  END IF;
END $$;

-- 1. Notifications (no-action FKs: must go first)
DELETE FROM public.notifications WHERE report_id          IN (SELECT id FROM _del_reports);   -- expect 38
DELETE FROM public.notifications WHERE progress_update_id IN (SELECT id FROM _del_updates);   -- expect 0
DELETE FROM public.notifications WHERE project_id         IN (198, 199, 200);                 -- expect 0

-- 2. Report children
ALTER TABLE public.public_report_activity_logs DISABLE TRIGGER trg_prevent_public_report_activity_log_delete;
DELETE FROM public.public_report_activity_logs   WHERE report_id IN (SELECT id FROM _del_reports);   -- expect 28
ALTER TABLE public.public_report_activity_logs ENABLE TRIGGER trg_prevent_public_report_activity_log_delete;
DELETE FROM public.public_report_field_findings  WHERE report_id IN (SELECT id FROM _del_reports);   -- expect 3
DELETE FROM public.public_report_resolutions     WHERE report_id IN (SELECT id FROM _del_reports);   -- expect 3
DELETE FROM public.public_report_visits          WHERE report_id IN (SELECT id FROM _del_reports);   -- expect 2
DELETE FROM public.public_report_workflow_meta   WHERE report_id IN (SELECT id FROM _del_reports);   -- expect 2
DELETE FROM public.public_report_admin_notes     WHERE report_id IN (SELECT id FROM _del_reports);   -- expect 0
DELETE FROM public.public_report_citizen_confirmations WHERE report_id IN (SELECT id FROM _del_reports); -- expect 0
DELETE FROM public.public_report_lgu_decisions   WHERE report_id IN (SELECT id FROM _del_reports);   -- expect 0
DELETE FROM public.public_report_lgu_escalations WHERE report_id IN (SELECT id FROM _del_reports);   -- expect 0
DELETE FROM public.public_report_repair_actions  WHERE report_id IN (SELECT id FROM _del_reports);   -- expect 0
DELETE FROM public.public_report_supporters      WHERE report_id IN (SELECT id FROM _del_reports);   -- expect 0
DELETE FROM public.feedbacks                     WHERE public_report_id IN (SELECT id FROM _del_reports); -- expect 0

-- 3. Reports
DELETE FROM public.public_reports WHERE id IN (SELECT id FROM _del_reports);                       -- expect 17

-- 4. Progress updates
DELETE FROM public.progress_update_items WHERE progress_update_id IN (SELECT id FROM _del_updates);  -- expect 0
DELETE FROM public.progress_updates      WHERE id IN (SELECT id FROM _del_updates);                  -- expect 3

-- 5. Other project children (all 0 today; listed so nothing can block or be left behind)
DELETE FROM public.project_time_extensions WHERE project_id IN (198, 199, 200);
DELETE FROM public.project_suspensions     WHERE project_id IN (198, 199, 200);
DELETE FROM public.project_follows         WHERE project_id IN (198, 199, 200);
DELETE FROM public.project_milestones      WHERE project_id IN (198, 199, 200);
DELETE FROM public.project_penalties       WHERE project_id IN (198, 199, 200);
DELETE FROM public.project_routes          WHERE project_id IN (198, 199, 200);
DELETE FROM public.project_tasks           WHERE project_id IN (198, 199, 200);
DELETE FROM public.project_tranches        WHERE project_id IN (198, 199, 200);
DELETE FROM public.work_plan_items         WHERE fmr_project_id IN (198, 199, 200);
DELETE FROM public.priority_decisions      WHERE fmr_project_id IN (198, 199, 200);
DELETE FROM public.lgu_project_proposals   WHERE fmr_project_id IN (198, 199, 200);
DELETE FROM public.road_network_gaps       WHERE from_project_id IN (198, 199, 200) OR to_project_id IN (198, 199, 200);

-- 6. The projects themselves
DELETE FROM public.fmr_projects WHERE id IN (198, 199, 200);                                       -- expect 3

-- 7. Final check: abort (roll back everything) unless all is gone and the log trigger is enabled again.
DO $$
DECLARE v_projects int; v_reports int; v_updates int; v_trigger "char";
BEGIN
  SELECT count(*) INTO v_projects FROM public.fmr_projects WHERE id IN (198, 199, 200);
  SELECT count(*) INTO v_reports  FROM public.public_reports WHERE project_id IN ('fmr-198', 'fmr-199', 'fmr-200');
  SELECT count(*) INTO v_updates  FROM public.progress_updates WHERE fmr_project_id IN (198, 199, 200);
  SELECT t.tgenabled INTO v_trigger FROM pg_trigger t
   WHERE t.tgname = 'trg_prevent_public_report_activity_log_delete'
     AND t.tgrelid = 'public.public_report_activity_logs'::regclass;
  IF v_projects <> 0 OR v_reports <> 0 OR v_updates <> 0 OR v_trigger IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'Final check failed: projects_left=%, reports_left=%, updates_left=%, log_trigger_state=%. Everything rolled back.',
      v_projects, v_reports, v_updates, v_trigger;
  END IF;
END $$;

COMMIT;
