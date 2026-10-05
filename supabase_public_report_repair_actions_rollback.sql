-- ============================================================
-- ROLLBACK for supabase_public_report_repair_actions.sql
--
-- Removes everything that migration added and nothing else. The report state
-- machine, the nine existing RPCs and every other table are untouched by both
-- the migration and this rollback.
--
-- WARNING: dropping the table deletes all repair-action records. Audit log
-- entries (REPAIR_PLANNED / COMPLETED / VERIFIED / CANCELLED) are append-only
-- and are intentionally NOT removed, so the history of what happened remains.
-- ============================================================

begin;

drop view if exists public.public_report_repair_actions_citizen_view;

drop function if exists public.plan_public_report_repair(uuid, text, date, text);
drop function if exists public.complete_public_report_repair(uuid, text);
drop function if exists public.verify_public_report_repair(uuid, text, double precision, double precision, double precision, text);
drop function if exists public.cancel_public_report_repair(uuid, text);
drop function if exists public._public_report_distance_m(double precision, double precision, double precision, double precision);

drop table if exists public.public_report_repair_actions;

-- Shared by other objects only if someone reused it; drop only if unreferenced.
drop function if exists public._public_report_touch_updated_at();

commit;
