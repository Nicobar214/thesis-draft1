-- =============================================================================
-- project_routes.id had no default, so the app could not save a route for a new
-- project ("null value in column id"): the project was created, the route failed,
-- and retrying hit the duplicate-name rule. This gives id its sequence again,
-- moved past the highest id in use (the snapped-route SQL inserted ids by hand).
-- Run once in the Supabase SQL editor. Safe to run again.
-- =============================================================================

create sequence if not exists public.project_routes_id_seq;
alter sequence public.project_routes_id_seq owned by public.project_routes.id;
select setval('public.project_routes_id_seq', greatest((select coalesce(max(id), 0) from public.project_routes), 1));
alter table public.project_routes alter column id set default nextval('public.project_routes_id_seq');

-- Check (read-only): the default is set and the next id is past the highest one.
-- select column_default from information_schema.columns where table_name = 'project_routes' and column_name = 'id';
-- select last_value, (select max(id) from public.project_routes) from public.project_routes_id_seq;
