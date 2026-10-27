-- =============================================================================
-- New routes could not be saved: project_routes.id is an identity column whose
-- counter was at 633 while the snapped-route SQL had inserted ids up to 750 by
-- hand, so the next route got an id already in use ("duplicate key"). The
-- project was created, its route failed, and retrying hit the duplicate-name
-- rule. This moves the counter past the highest id in use.
-- Run once in the Supabase SQL editor. Safe to run again.
-- =============================================================================

select setval(
  pg_get_serial_sequence('public.project_routes', 'id'),
  greatest((select coalesce(max(id), 0) from public.project_routes), 1)
);

-- Check (read-only): last_value is now at least the highest id.
-- select last_value, (select max(id) from public.project_routes) from public.project_routes_id_seq;
