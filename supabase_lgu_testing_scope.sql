-- ============================================================
-- TEMPORARY (testing): the Leon LGU handles LGU reports from every town.
--
-- Normally an LGU only sees and fixes citizen reports in its own municipality.
-- For testing there is only one LGU account (Leon), so this lets it:
--   * read citizen reports from all municipalities, and
--   * receive, accept, start and send after-photos for LGU jobs anywhere.
-- Matching client switch: src/lib/lguTestingScope.js.
--
-- To undo, run the "REVERT" block at the bottom (and set
-- LGU_ALL_REGION_TEST_MUNICIPALITIES to [] in lguTestingScope.js).
-- Safe to re-run.
-- ============================================================

begin;

-- Who handles a job: the LGU of the report's town, plus (testing) Leon's LGU.
create or replace function public._public_report_handler_users(p_report_id uuid, p_party text)
returns setof uuid
language sql
stable
security definer
set search_path = public
set row_security = off
as $function$
  select p.id
  from public.profiles p
  join public.public_reports pr on pr.id = p_report_id
  where p_party = 'lgu'
    and p.role = 'lgu'
    and (
      lower(btrim(coalesce(p.municipality, ''))) = lower(btrim(coalesce(pr.municipality, '')))
      or lower(btrim(coalesce(p.municipality, ''))) = 'leon'   -- TEMPORARY: testing
    )
  union
  select fp.contractor_id
  from public.fmr_projects fp
  join public.public_reports pr on pr.id = p_report_id
  where p_party = 'contractor'
    and fp.contractor_id is not null
    and pr.project_id = 'fmr-' || fp.id::text;
$function$;

revoke execute on function public._public_report_handler_users(uuid, text) from public, anon, authenticated;

-- LGU read access: own town, plus (testing) Leon reads every town.
drop policy if exists public_reports_select_lgu_municipality on public.public_reports;
create policy public_reports_select_lgu_municipality
  on public.public_reports for select to authenticated
  using (
    public.public_report_current_role() = 'lgu'
    and (
      municipality = public.public_report_current_municipality()
      or lower(coalesce(public.public_report_current_municipality(), '')) = 'leon'   -- TEMPORARY: testing
    )
  );

commit;

-- ------------------------------------------------------------
-- REVERT (after testing): run this to go back to one town per LGU.
-- ------------------------------------------------------------
-- begin;
-- create or replace function public._public_report_handler_users(p_report_id uuid, p_party text)
-- returns setof uuid language sql stable security definer set search_path = public set row_security = off
-- as $f$
--   select p.id from public.profiles p join public.public_reports pr on pr.id = p_report_id
--   where p_party = 'lgu' and p.role = 'lgu'
--     and lower(btrim(coalesce(p.municipality, ''))) = lower(btrim(coalesce(pr.municipality, '')))
--   union
--   select fp.contractor_id from public.fmr_projects fp join public.public_reports pr on pr.id = p_report_id
--   where p_party = 'contractor' and fp.contractor_id is not null and pr.project_id = 'fmr-' || fp.id::text;
-- $f$;
-- revoke execute on function public._public_report_handler_users(uuid, text) from public, anon, authenticated;
-- drop policy if exists public_reports_select_lgu_municipality on public.public_reports;
-- create policy public_reports_select_lgu_municipality on public.public_reports for select to authenticated
--   using (public.public_report_current_role() = 'lgu' and municipality = public.public_report_current_municipality());
-- commit;
