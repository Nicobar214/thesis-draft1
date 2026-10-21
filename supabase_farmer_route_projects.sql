-- ============================================================
-- Farmer beneficiaries: every FMR road on the farm-to-market route.
--
-- linked_project_id keeps the farmer's main (nearest) FMR road. This adds the
-- full list of FMR projects the route from the farm to the chosen market runs
-- along, worked out on the registration map: [{ "id": "...", "name": "..." }].
-- Safe to re-run.
-- ============================================================

alter table public.farmer_beneficiaries
  add column if not exists route_project_ids jsonb not null default '[]'::jsonb;

-- Check: select full_name, linked_project_name, route_project_ids from public.farmer_beneficiaries limit 5;
