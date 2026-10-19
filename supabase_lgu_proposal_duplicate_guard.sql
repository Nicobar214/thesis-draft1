-- ============================================================
-- LGU proposals: no duplicate projects.
--
-- An LGU cannot propose a road that already exists in its municipality, either
-- as an FMR project or as one of its open proposals (anything not Rejected).
-- Names are compared after ignoring filler words ("Concreting of", "FMR",
-- "Brgy.", punctuation), so "Concreting of Brgy. Tabuc FMR" and
-- "Tabuc Farm-to-Market Road" count as the same project.
--
-- The app checks the same rule before submitting (src/lib/proposalDuplicates.js,
-- which also catches the same road under a different name by its start/end
-- points). This trigger enforces the name rule in the database so it cannot be
-- bypassed. Existing rows are not changed. Safe to re-run.
-- ============================================================

-- Keep the word list in sync with FILLER in src/lib/proposalDuplicates.js.
create or replace function public.proposal_name_key(p_name text)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(w, ' ' order by ord), '')
  from regexp_split_to_table(
         btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', ' ', 'g')),
         '\s+'
       ) with ordinality as t(w, ord)
  where w <> ''
    and w not in (
      'fmr', 'farm', 'to', 'market', 'road', 'roads', 'of', 'the', 'and', 'in', 'at',
      'brgy', 'bgy', 'barangay', 'concreting', 'construction', 'rehabilitation',
      'improvement', 'improvements', 'repair', 'upgrading', 'proposed', 'project', 'new'
    );
$$;

create or replace function public.lgu_proposal_block_duplicates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := public.proposal_name_key(new.project_name);
  v_hit text;
begin
  -- A name made only of filler words cannot be compared.
  if v_key = '' then
    return new;
  end if;

  select p.project_name into v_hit
  from public.fmr_projects p
  where lower(btrim(p.municipality)) = lower(btrim(new.municipality))
    and public.proposal_name_key(p.project_name) = v_key
    and p.id is distinct from new.fmr_project_id   -- the project this proposal became
  limit 1;
  if found then
    raise exception 'This project already exists: "%". Duplicate proposals are not allowed.', v_hit
      using errcode = 'unique_violation';
  end if;

  select o.project_name into v_hit
  from public.lgu_project_proposals o
  where o.id <> new.id
    and o.status <> 'Rejected'
    and lower(btrim(o.municipality)) = lower(btrim(new.municipality))
    and public.proposal_name_key(o.project_name) = v_key
  limit 1;
  if found then
    raise exception 'This project already exists as a proposal: "%". Duplicate proposals are not allowed.', v_hit
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists lgu_proposal_block_duplicates on public.lgu_project_proposals;
create trigger lgu_proposal_block_duplicates
  before insert or update of project_name, municipality
  on public.lgu_project_proposals
  for each row
  execute function public.lgu_proposal_block_duplicates();
