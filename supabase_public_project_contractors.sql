-- ============================================================
-- Public contractor names on FMR project details.
--
-- The landing page, citizen and farmer project details show which contractor is
-- building a road. Contractor names live in public.profiles, which the public
-- cannot read (supabase_tighten_citizen_rls.sql), so this function returns ONLY
-- the project id and the contractor's name, nothing else from the profile (no
-- email, phone or account id). Projects with no contractor assigned, or whose
-- contractor has no name on record, are not returned.
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

create or replace function public.public_project_contractors()
returns table (project_id bigint, contractor_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, btrim(pr.full_name)
  from public.fmr_projects p
  join public.profiles pr on pr.id = p.contractor_id and pr.role = 'contractor'
  where p.contractor_id is not null
    and nullif(btrim(pr.full_name), '') is not null;
$$;

revoke all on function public.public_project_contractors() from public;
grant execute on function public.public_project_contractors() to anon, authenticated;

-- Check: select * from public.public_project_contractors();
