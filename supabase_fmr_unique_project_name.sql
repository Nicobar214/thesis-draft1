-- =============================================================================
-- No duplicate FMR projects: the same name in the same municipality is refused
-- (ignoring case and extra spaces). Run once in the Supabase SQL editor. Safe to
-- run again.
--
-- A trigger, not a unique index, so the few duplicates already in the data
-- (e.g. DA imports, test copies) stay as they are; only NEW duplicates, or
-- renaming a project into one, are refused. The admin form checks the same
-- rule first (lib/projectHelpers.js findDuplicateProject).
-- =============================================================================

create or replace function public._fmr_name_key(p text)
returns text language sql immutable as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'));
$$;

create or replace function public._fmr_refuse_duplicate_name()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE'
     and public._fmr_name_key(new.project_name) = public._fmr_name_key(old.project_name)
     and public._fmr_name_key(new.municipality) = public._fmr_name_key(old.municipality) then
    return new;   -- name and town unchanged
  end if;
  if public._fmr_name_key(new.project_name) <> '' and exists (
       select 1 from public.fmr_projects p
        where p.id <> new.id
          and public._fmr_name_key(p.project_name) = public._fmr_name_key(new.project_name)
          and public._fmr_name_key(p.municipality) = public._fmr_name_key(new.municipality)) then
    raise exception 'A project named "%" already exists in %', btrim(new.project_name), coalesce(nullif(btrim(new.municipality), ''), 'this municipality')
      using errcode = '23505';
  end if;
  return new;
end $$;

drop trigger if exists trg_fmr_refuse_duplicate_name on public.fmr_projects;
create trigger trg_fmr_refuse_duplicate_name
  before insert or update of project_name, municipality on public.fmr_projects
  for each row execute function public._fmr_refuse_duplicate_name();

create index if not exists fmr_projects_name_key on public.fmr_projects (public._fmr_name_key(project_name), public._fmr_name_key(municipality));

-- Check (read-only): existing duplicates, left as they are
-- select project_name, municipality, count(*) from public.fmr_projects
--  group by public._fmr_name_key(project_name), public._fmr_name_key(municipality), project_name, municipality having count(*) > 1;
