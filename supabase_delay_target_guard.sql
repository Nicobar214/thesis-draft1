-- =============================================================================
-- Delay follow-up: stop a plain edit from undoing a resume/extension, and
-- repair project 358. MODIFIES ONE FUNCTION + one data fix.
-- Run ONLY after supabase_project_delay_cases.sql and supabase_delay_open_on_save.sql.
--
-- What happened to "zz test overdue 2" (358), 2026-10-26 (times UTC):
--   15:19 suspended (follow-up closed as Suspended)
--   15:21:24 resumed with new target 2026-11-28 (recorded as a time extension)
--   15:21:48 the Edit Project form, opened before the resume, was saved. It sent
--            EVERY field, so it wrote the old target 2026-10-25 back. The date
--            lock (_delay_target_lock) only guards projects with an OPEN follow-up,
--            and the resume had just closed it, so the write went through; the
--            project looked overdue again and a new follow-up opened.
-- The app now saves only the fields the admin changed (Dashboard.jsx). This adds
-- the database side: a project that has been through a delay follow-up may not
-- have its target date moved INTO THE PAST by a plain edit, because that only
-- reopens the follow-up. Extensions and resumes (_delay_set_target) still work,
-- and so do future dates. Projects that were never followed up are unaffected.
--
-- This is the live _delay_target_lock (copied 2026-10-26) with ONE added block,
-- marked "ADDED". Run once in the Supabase SQL editor. Safe to run again.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._delay_target_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if public._delay_parse_date(new.target_completion_date) is not distinct from public._delay_parse_date(old.target_completion_date) then
    return new;   -- same date (e.g. re-saved in another format)
  end if;
  if current_setting('delay.target_write', true) = 'on'
     and current_user not in ('anon', 'authenticated', 'service_role', 'authenticator') then
    return new;   -- delay_grant_extension / delay_resume_project via _delay_set_target()
  end if;
  if exists (select 1 from public.project_delay_cases c where c.project_id = new.id and c.status <> 'closed') then
    raise exception 'This project has an open delay case. Its target date can only be changed with Grant extension (Project Management > Overdue).';
  end if;
  -- ADDED: after a follow-up, a plain edit may not put the target date in the past.
  if exists (select 1 from public.project_delay_cases c where c.project_id = new.id)
     and public._delay_parse_date(new.target_completion_date) < public._delay_today() then
    raise exception 'This project has been through a delay follow-up. Its target date cannot be moved into the past here (that would reopen the follow-up); use Project Management > Overdue.';
  end if;
  return new;
end;
$function$;

-- Repair 358: drop the follow-up opened by mistake and put back the resumed target.
delete from public.project_delay_case_events
 where case_id in (select id from public.project_delay_cases where project_id = 358 and status <> 'closed');
delete from public.project_delay_cases where project_id = 358 and status <> 'closed';
select public._delay_set_target(358, date '2026-11-28');

-- Check (read-only): 358 should be On-Going, target 2026-11-28, no open follow-up.
select p.status, p.target_completion_date,
       (select count(*) from public.project_delay_cases c where c.project_id = p.id and c.status <> 'closed') as open_followups
  from public.fmr_projects p where p.id = 358;
