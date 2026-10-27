-- =============================================================================
-- TEST ONLY — helpers for test-running the overdue process on project #347
-- ("SAMPLE TEST CICT", ABCD BUILDERS CORP., 75%). Run ONE block at a time in the
-- Supabase SQL editor (select the block's lines, then Run). Not part of the app;
-- delete this file after testing.
-- =============================================================================


-- ── A. MAKE IT LATE NOW ────────────────────────────────────────────────────────
-- Moves the target date to yesterday, so the project is overdue, and opens the
-- next round right away (instead of waiting for the date to really pass).
-- First round only: the contractor's own target becomes yesterday too, so the
-- history counts days late (in real use this is the original target date).
update public.project_contractor_terms
   set target_date = (now() at time zone 'Asia/Manila')::date - 1
 where project_id = 347 and status = 'holding'
   and not exists (select 1 from public.project_delay_cases c where c.term_id = project_contractor_terms.id);
select set_config('delay.target_write', 'on', false);
update public.fmr_projects
   set target_completion_date = to_char((now() at time zone 'Asia/Manila')::date - 1, 'YYYY-MM-DD')
 where id = 347;
select set_config('delay.target_write', 'off', false);
select public._delay_check(347);


-- ── B. PRETEND THE CONTRACTOR DID NOT REPLY ────────────────────────────────────
-- Moves the reply-by date to yesterday. The check then counts it as an offense
-- and opens the next round (or, at Offense 4, leaves Terminate & reassign).
update public.project_delay_cases
   set reply_by = (now() at time zone 'Asia/Manila')::date - 1
 where project_id = 347 and status in ('awaiting_explanation', 'revision_requested');
select public._delay_check(347);


-- ── C. SEE WHERE IT STANDS ─────────────────────────────────────────────────────
select c.opened_at::date, c.kind, c.offense_no, c.status, c.outcome, c.cause, c.proposed_date, c.new_target_date, c.verdict
  from public.project_delay_cases c where c.project_id = 347 order by c.opened_at;
select term_no, contractor_name, status, start_percent, end_percent, target_date, excused_days, days_late
  from public.project_contractor_terms where project_id = 347 order by term_no;


-- ── D. RESET AFTER TESTING ─────────────────────────────────────────────────────
-- Puts #347 back as it was: ABCD BUILDERS CORP., target Dec 31, 2027, no follow-ups.
begin;
alter table public.project_delay_case_events disable trigger trg_delay_events_append_only;
delete from public.project_delay_cases where project_id = 347;          -- its events and evidence go with it
alter table public.project_delay_case_events enable trigger trg_delay_events_append_only;
delete from public.project_time_extensions where project_id = 347;
delete from public.project_contractor_terms where project_id = 347;
select set_config('delay.reassign', 'on', true);
select set_config('delay.target_write', 'on', true);
update public.fmr_projects
   set contractor_id = (select id from public.profiles where full_name = 'ABCD BUILDERS CORP.' and role = 'contractor' limit 1),
       target_completion_date = '2027-12-31', status = 'On-Going'
 where id = 347;
select public._delay_holding_term(347);
update public.project_contractor_terms t
   set start_percent = 0, started_on = coalesce(p.date_started, t.started_on), target_date = '2027-12-31'
  from public.fmr_projects p where p.id = t.project_id and t.project_id = 347;
commit;
