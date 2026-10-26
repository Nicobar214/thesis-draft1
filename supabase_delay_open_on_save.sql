-- =============================================================================
-- Overdue follow-up opens as soon as a project is saved overdue. ADDS ONE TRIGGER.
-- Run ONLY after supabase_project_delay_cases.sql.
--
-- Why: follow-up cases were opened only by the daily check (cron
-- project-delay-daily, 00:05 Manila). A project saved later in the day with a
-- target date already passed (e.g. "zz test overdue 2", saved 10:47 PM with
-- target Oct 25) did not show under Project Management -> Overdue until the
-- next midnight, unless the admin pressed "Run check now".
--
-- Now: whenever a project is created, or its status, target date or contractor
-- changes, the same check runs for that one project (_delay_check(id), the
-- function the daily job uses). The rules are unchanged: On-Going, has a
-- contractor, target date before today, no open follow-up. The check is
-- idempotent (one open case per project; notices are ledgered), and if it
-- fails the project still saves; the daily job then picks it up as before.
--
-- Run once in the Supabase SQL editor. Safe to run again.
-- =============================================================================

create or replace function public._delay_open_on_save()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if lower(btrim(coalesce(new.status, ''))) = 'on-going'
     and new.contractor_id is not null
     and public._delay_parse_date(new.target_completion_date) < public._delay_today() then
    begin
      perform public._delay_check(new.id);
    exception when others then
      raise warning 'delay follow-up on save for project % failed: % (the daily check will retry)', new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;

drop trigger if exists trg_delay_open_on_save on public.fmr_projects;
create trigger trg_delay_open_on_save
  after insert or update of status, target_completion_date, contractor_id on public.fmr_projects
  for each row execute function public._delay_open_on_save();

-- Trigger-only function: nobody calls it directly (applied 2026-10-26).
revoke all on function public._delay_open_on_save() from public, anon, authenticated, service_role;

-- Open the follow-ups that are waiting for tonight's run (e.g. project 358) now.
select p.id, p.project_name, public._delay_check(p.id) ->> 'cases_opened' as cases_opened
  from public.fmr_projects p
 where lower(btrim(coalesce(p.status, ''))) = 'on-going'
   and p.contractor_id is not null
   and public._delay_parse_date(p.target_completion_date) < public._delay_today()
   and not exists (select 1 from public.project_delay_cases c where c.project_id = p.id and c.status <> 'closed');

-- Check (read-only): should list trg_delay_open_on_save.
-- select tgname from pg_trigger where tgrelid = 'public.fmr_projects'::regclass and tgname = 'trg_delay_open_on_save';
