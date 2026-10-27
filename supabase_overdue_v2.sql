-- =============================================================================
-- Overdue process v2: simple, strict, with an END.
--
--   Project passes its target date
--     -> DA asks -> contractor picks a CAUSE and commits a new finish date
--        ACT OF NATURE : proof + field engineer check; days = days work stopped
--                        (max 30 per event); NOT counted as an offense.
--                        A rejected claim becomes the next offense.
--        MANPOWER      : an OFFENSE.  Offense 1: up to 60 days, 2: up to 45,
--                        3 (final): up to 30 days and the field engineer checks first.
--                        Offense 4: Terminate & reassign (the DA presses it).
--     -> No reply by the reply-by date counts as an offense.
--     -> Finished: "Completed late", days late per contractor.
--
--   Reassign: the next contractor continues from the same %, with their own
--   target date and 0 offenses. Each contractor's period is kept in
--   project_contractor_terms, so lateness stays with whoever held the project.
--
-- Run once in the Supabase SQL editor (as the owner). Safe to run again.
-- Functions not listed here are unchanged. Retired actions (revision, final
-- notice, suspend/resume, plain terminate, plain extension) stay in the
-- database for old history but can no longer be called by the app.
-- =============================================================================

-- 1. Rules (the one place to change the numbers) -----------------------------------
create or replace function public._delay_window(p_offense int)
 returns int language sql immutable set search_path to 'public', 'pg_temp' as $$
  select case p_offense when 1 then 60 when 2 then 45 when 3 then 30 else 0 end;
$$;
create or replace function public._delay_nature_cap()
 returns int language sql immutable set search_path to 'public', 'pg_temp' as $$ select 30; $$;

-- 2. Contractor periods ("terms") ----------------------------------------------------
create table if not exists public.project_contractor_terms (
  id uuid primary key default gen_random_uuid(),
  project_id bigint not null references public.fmr_projects(id) on delete cascade,
  term_no int not null,
  contractor_id uuid references public.profiles(id) on delete set null,
  contractor_name text,
  status text not null default 'holding' check (status in ('holding', 'terminated', 'completed')),
  started_on date not null,
  ended_on date,
  start_percent numeric not null default 0,
  end_percent numeric,
  target_date date,            -- this contractor's OWN original target (lateness is counted from it)
  excused_days int not null default 0,   -- approved act-of-nature days
  days_late int,
  end_reason text,
  created_at timestamptz not null default now(),
  unique (project_id, term_no)
);
create unique index if not exists project_contractor_terms_one_holding
  on public.project_contractor_terms (project_id) where status = 'holding';
create index if not exists project_contractor_terms_contractor on public.project_contractor_terms (contractor_id);

alter table public.project_contractor_terms enable row level security;
drop policy if exists project_contractor_terms_select on public.project_contractor_terms;
create policy project_contractor_terms_select on public.project_contractor_terms for select using (
  contractor_id = auth.uid()
  or public.current_profile_role() in ('admin', 'field_engineer', 'lgu')
  or exists (select 1 from public.fmr_projects p where p.id = project_id and p.published_at is not null)
);
-- No insert/update/delete policies: only the functions below write terms.

-- Backfill: one period per project that has a contractor (as it is today).
insert into public.project_contractor_terms
  (project_id, term_no, contractor_id, contractor_name, status, started_on, ended_on, start_percent, end_percent, target_date)
select p.id, 1, p.contractor_id, pr.full_name,
       case when lower(btrim(coalesce(p.status, ''))) = 'completed' then 'completed'
            when lower(btrim(coalesce(p.status, ''))) = 'terminated' then 'terminated'
            else 'holding' end,
       coalesce(p.date_started, (p.created_at at time zone 'Asia/Manila')::date, public._delay_today()),
       case when lower(btrim(coalesce(p.status, ''))) in ('completed', 'terminated')
            then coalesce(public._delay_parse_date(p.date_completed), public._delay_today()) end,
       0,
       case when lower(btrim(coalesce(p.status, ''))) in ('completed', 'terminated') then p.accomplishment end,
       coalesce((select min(c.original_deadline) from public.project_delay_cases c where c.project_id = p.id),
                public._delay_parse_date(p.target_completion_date))
  from public.fmr_projects p
  left join public.profiles pr on pr.id = p.contractor_id
 where p.contractor_id is not null
   and not exists (select 1 from public.project_contractor_terms t where t.project_id = p.id);

-- Released funds stay with the contractor who received them.
alter table public.project_tranches add column if not exists contractor_id uuid references public.profiles(id) on delete set null;
update public.project_tranches t set contractor_id = p.contractor_id
  from public.fmr_projects p
 where p.id = t.project_id and t.contractor_id is null and t.released_date is not null;

create or replace function public._tranche_stamp_contractor()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if new.released_date is not null and new.contractor_id is null then
    select contractor_id into new.contractor_id from public.fmr_projects where id = new.project_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_tranche_stamp_contractor on public.project_tranches;
create trigger trg_tranche_stamp_contractor before insert or update of released_date on public.project_tranches
  for each row execute function public._tranche_stamp_contractor();

-- 3. Case columns ------------------------------------------------------------------
alter table public.project_delay_cases add column if not exists term_id uuid references public.project_contractor_terms(id) on delete set null;
alter table public.project_delay_cases add column if not exists offense_no int;
alter table public.project_delay_cases add column if not exists kind text;
alter table public.project_delay_cases add column if not exists event_name text;
alter table public.project_delay_cases add column if not exists stopped_days int;
alter table public.project_delay_cases add column if not exists window_max_date date;

alter table public.project_delay_cases drop constraint if exists project_delay_cases_kind_check;
alter table public.project_delay_cases add constraint project_delay_cases_kind_check
  check (kind is null or kind in ('offense', 'act_of_nature'));
alter table public.project_delay_cases drop constraint if exists project_delay_cases_cause_check;
alter table public.project_delay_cases add constraint project_delay_cases_cause_check
  check (cause is null or cause in ('act_of_nature', 'manpower',
         'weather', 'right_of_way', 'materials', 'fund_release', 'design_change', 'other'));   -- old values: history only
alter table public.project_delay_cases drop constraint if exists project_delay_cases_outcome_check;
alter table public.project_delay_cases add constraint project_delay_cases_outcome_check
  check (outcome is null or outcome in ('extended', 'no_reply', 'completed_late', 'suspended', 'terminated'));
alter table public.project_delay_cases drop constraint if exists project_delay_cases_stopped_days_check;
alter table public.project_delay_cases add constraint project_delay_cases_stopped_days_check
  check (stopped_days is null or stopped_days between 1 and 30);

-- Backfill the existing cases (closed cases are normally locked, so the guard is paused).
alter table public.project_delay_cases disable trigger trg_delay_cases_guard;
update public.project_delay_cases c
   set term_id = t.id,
       kind = case when c.cause = 'weather' then 'act_of_nature' else 'offense' end,
       offense_no = 1
  from public.project_contractor_terms t
 where t.project_id = c.project_id and t.term_no = 1 and c.term_id is null;
alter table public.project_delay_cases enable trigger trg_delay_cases_guard;

-- 4. Helpers ------------------------------------------------------------------------
-- The contractor's current period on a project (created if missing).
create or replace function public._delay_holding_term(p_project bigint)
 returns public.project_contractor_terms language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare t public.project_contractor_terms; p public.fmr_projects;
begin
  select * into t from public.project_contractor_terms where project_id = p_project and status = 'holding';
  if found then return t; end if;
  select * into p from public.fmr_projects where id = p_project;
  if p.contractor_id is null then return null; end if;
  insert into public.project_contractor_terms (project_id, term_no, contractor_id, contractor_name, started_on, start_percent, target_date)
  values (p.id,
          coalesce((select max(term_no) from public.project_contractor_terms where project_id = p.id), 0) + 1,
          p.contractor_id, (select full_name from public.profiles where id = p.contractor_id),
          public._delay_today(), coalesce(p.accomplishment, 0), public._delay_parse_date(p.target_completion_date))
  returning * into t;
  return t;
end $$;

-- Offenses already counted in a period.
create or replace function public._delay_offenses_used(p_term uuid)
 returns int language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select count(*)::int from public.project_delay_cases
   where term_id = p_term and kind = 'offense' and outcome in ('extended', 'no_reply');
$$;

-- A new case belongs to the current period and gets its offense number.
create or replace function public._delay_case_defaults()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare t public.project_contractor_terms;
begin
  t := public._delay_holding_term(new.project_id);
  if t.id is not null then
    new.term_id := t.id;
    new.offense_no := public._delay_offenses_used(t.id) + 1;
    new.original_deadline := coalesce(t.target_date, new.original_deadline);
  end if;
  return new;
end $$;
drop trigger if exists trg_delay_case_defaults on public.project_delay_cases;
create trigger trg_delay_case_defaults before insert on public.project_delay_cases
  for each row execute function public._delay_case_defaults();

-- Days the contractor may commit: by offense, or the days work stopped.
create or replace function public._delay_case_window(c public.project_delay_cases, p_kind text, p_stopped int)
 returns int language sql immutable set search_path to 'public', 'pg_temp' as $$
  select case when p_kind = 'act_of_nature' then least(coalesce(p_stopped, 0), public._delay_nature_cap())
              else public._delay_window(c.offense_no) end;
$$;

-- Keep periods in step with the project (assign, correct, complete).
create or replace function public._delay_terms_sync()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare t public.project_contractor_terms; v_end date;
begin
  if current_setting('delay.reassign', true) = 'on' then return null; end if;

  if tg_op = 'INSERT' or old.contractor_id is distinct from new.contractor_id then
    if tg_op = 'UPDATE' and old.contractor_id is not null
       and exists (select 1 from public.project_delay_cases c where c.project_id = new.id) then
      raise exception 'This project has been through a delay follow-up. Change its contractor with Terminate & reassign (Project Management > Overdue).';
    end if;
    select * into t from public.project_contractor_terms where project_id = new.id and status = 'holding';
    if new.contractor_id is null then
      delete from public.project_contractor_terms where id = t.id;            -- a correction before any follow-up
    elsif t.id is not null then
      update public.project_contractor_terms                                  -- a correction before any follow-up
         set contractor_id = new.contractor_id,
             contractor_name = (select full_name from public.profiles where id = new.contractor_id)
       where id = t.id;
    else
      perform public._delay_holding_term(new.id);
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if lower(btrim(coalesce(new.status, ''))) = 'completed' then
      v_end := coalesce(public._delay_parse_date(new.date_completed), public._delay_today());
      update public.project_contractor_terms
         set status = 'completed', ended_on = v_end, end_percent = new.accomplishment,
             days_late = case when target_date is not null then greatest(v_end - target_date - excused_days, 0) end
       where project_id = new.id and status = 'holding';
    elsif lower(btrim(coalesce(old.status, ''))) = 'completed' then
      -- Completed by mistake and put back: the last period is held again.
      update public.project_contractor_terms
         set status = 'holding', ended_on = null, end_percent = null, days_late = null
       where id = (select id from public.project_contractor_terms where project_id = new.id order by term_no desc limit 1)
         and status = 'completed'
         and not exists (select 1 from public.project_contractor_terms where project_id = new.id and status = 'holding');
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_delay_terms_sync on public.fmr_projects;
create trigger trg_delay_terms_sync after insert or update of contractor_id, status on public.fmr_projects
  for each row execute function public._delay_terms_sync();

-- 5. Closing a case: the notice says what happened -----------------------------------
CREATE OR REPLACE FUNCTION public._delay_close(p_case uuid, p_outcome text, p_reason text, p_new_target date, p_resume date, p_days_late integer, p_extra jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare c public.project_delay_cases; p public.fmr_projects; v_label text;
begin
  select * into c from public.project_delay_cases where id = p_case;
  select * into p from public.fmr_projects where id = c.project_id;
  update public.project_delay_cases
     set status = 'closed', outcome = p_outcome, outcome_reason = nullif(btrim(coalesce(p_reason, '')), ''), new_target_date = p_new_target,
         resume_date = p_resume, days_late = p_days_late, closed_at = now(), closed_by = auth.uid()
   where id = p_case;
  perform public._delay_event(p_case, 'closed', coalesce(p_extra, '{}'::jsonb) || jsonb_build_object(
    'outcome', p_outcome, 'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'new_target_date', p_new_target,
    'resume_date', p_resume, 'days_late', p_days_late, 'kind', c.kind, 'offense_no', c.offense_no));
  v_label := case
    when p_outcome = 'extended' and c.kind = 'act_of_nature'
      then format('Act of nature approved: new finish date %s (not counted as an offense)', to_char(p_new_target, 'FMMonth FMDD, YYYY'))
    when p_outcome = 'extended'
      then format('Offense %s of 3 approved: new finish date %s', c.offense_no, to_char(p_new_target, 'FMMonth FMDD, YYYY'))
    when p_outcome = 'no_reply' then format('No reply by the deadline: counted as Offense %s of 3', c.offense_no)
    when p_outcome = 'completed_late' then format('Completed late (%s day(s))', p_days_late)
    when p_outcome = 'suspended' then format('Suspended until about %s', to_char(p_resume, 'FMMonth FMDD, YYYY'))
    else 'Your contract on this project was terminated' end;
  perform public._delay_notify(p.contractor_id, 'contractor', 'delay_case_closed', 'Delay follow-up closed',
    format('"%s": %s.%s', p.project_name, v_label, coalesce(' DA: ' || nullif(btrim(coalesce(p_reason, '')), ''), '')), p.id);
  if c.verifier_id is not null then
    perform public._priority_notify(c.verifier_id, 'delay_case_closed', 'Delay follow-up closed',
      format('"%s": %s.', p.project_name, v_label), p.id);
  end if;
end $function$;

-- 6. The DA asks ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delay_request_explanation(p_case uuid, p_reply_by date, p_note text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare c public.project_delay_cases; p public.fmr_projects; v_rule text;
begin
  perform public._delay_require_role('admin');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_request']);
  p := public._delay_lock_project(c.project_id);
  if p.contractor_id is null then raise exception 'Assign a contractor first'; end if;
  perform public._delay_check_reply_by(p_reply_by);
  update public.project_delay_cases set status = 'awaiting_explanation', reply_by = p_reply_by where id = c.id;
  perform public._delay_event(c.id, 'explanation_requested', jsonb_build_object('reply_by', p_reply_by, 'note', nullif(btrim(p_note), ''), 'offense_no', c.offense_no));
  v_rule := case when c.offense_no >= 4
    then 'Your 3 chances are used: only an act of nature can still be accepted.'
    else format('If the cause is manpower this is Offense %s of 3 (new finish date up to %s days).', c.offense_no, public._delay_window(c.offense_no)) end;
  perform public._delay_notify(p.contractor_id, 'contractor', 'delay_explanation_requested', 'Commit a new finish date',
    format('"%s" is past its target date. In Delay Follow-ups, choose the cause and commit a new finish date by %s. %s%s',
      p.project_name, to_char(p_reply_by, 'FMMonth FMDD, YYYY'), v_rule, coalesce(' DA note: ' || nullif(btrim(p_note), ''), '')), p.id);
end $function$;

-- 7. The contractor commits -----------------------------------------------------------
create or replace function public.delay_submit_commitment(p_case uuid, p_cause text, p_explanation text, p_new_date date,
                                                         p_event_name text default null, p_stopped_days int default null)
 returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare c public.project_delay_cases; p public.fmr_projects; v_today date := public._delay_today(); v_days int; v_max date;
begin
  perform public._delay_require_role('contractor');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_explanation', 'revision_requested']);
  p := public._delay_lock_project(c.project_id);
  if p.contractor_id is null or p.contractor_id is distinct from auth.uid() then
    raise exception 'Only the project''s contractor can do this';
  end if;
  if p_cause is null or p_cause not in ('act_of_nature', 'manpower') then
    raise exception 'Choose the cause: Act of nature or Manpower';
  end if;
  if c.kind = 'offense' and p_cause <> 'manpower' then
    raise exception 'The act-of-nature claim was not accepted, so this delay counts as manpower';
  end if;
  if p_cause = 'manpower' and coalesce(c.offense_no, 1) >= 4 then
    raise exception 'Your 3 chances are used. Only an act of nature can still be accepted on this project.';
  end if;
  perform public._delay_check_reason(p_explanation, 'The explanation');
  if p_cause = 'act_of_nature' then
    if length(btrim(coalesce(p_event_name, ''))) < 3 then raise exception 'Name the event (for example "Typhoon Kristine")'; end if;
    if p_stopped_days is null or p_stopped_days < 1 or p_stopped_days > public._delay_nature_cap() then
      raise exception 'Days work stopped must be from 1 to % days', public._delay_nature_cap();
    end if;
    if not exists (select 1 from public.project_delay_evidence e where e.case_id = c.id) then
      raise exception 'Attach proof first (PAGASA/NDRRMC advisory, LGU notice or photos of the damage)';
    end if;
  end if;
  v_days := public._delay_case_window(c, p_cause, p_stopped_days);
  v_max := v_today + v_days;
  if p_new_date is null or p_new_date <= v_today or p_new_date > v_max then
    raise exception 'The new finish date must be from % to % (% days max)', v_today + 1, v_max, v_days;
  end if;
  update public.project_delay_cases
     set status = 'awaiting_decision', decision_due = v_today + 5, cause = p_cause,
         kind = case when p_cause = 'act_of_nature' then 'act_of_nature' else 'offense' end,
         explanation = btrim(p_explanation), proposed_date = p_new_date, window_max_date = v_max,
         event_name = case when p_cause = 'act_of_nature' then btrim(p_event_name) end,
         stopped_days = case when p_cause = 'act_of_nature' then p_stopped_days end,
         claimed_percent = null, explained_at = now(), verdict = null
   where id = c.id;
  perform public._delay_event(c.id, 'explanation_submitted', jsonb_build_object(
    'cause', p_cause, 'explanation', btrim(p_explanation), 'proposed_date', p_new_date, 'window_max_date', v_max,
    'event_name', nullif(btrim(coalesce(p_event_name, '')), ''), 'stopped_days', p_stopped_days, 'offense_no', c.offense_no));
  perform public._priority_notify_admins('delay_explanation_submitted', 'Delay commitment received',
    format('"%s": %s. New finish date %s. %s Decide by %s.', p.project_name,
      case when p_cause = 'act_of_nature' then format('Act of nature (%s, %s day(s) stopped)', btrim(p_event_name), p_stopped_days)
           else format('Manpower, Offense %s of 3', c.offense_no) end,
      to_char(p_new_date, 'FMMonth FMDD, YYYY'),
      case when p_cause = 'act_of_nature' or c.offense_no = 3 then 'Send it to the field engineer first.' else '' end,
      to_char(v_today + 5, 'FMMonth FMDD, YYYY')), p.id);
end $function$;

-- 8. The DA decides -----------------------------------------------------------------
create or replace function public.delay_approve(p_case uuid, p_new_date date, p_note text default null)
 returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare c public.project_delay_cases; p public.fmr_projects; v_today date := public._delay_today(); v_current date; v_cap date; v_ext uuid; v_name text;
begin
  perform public._delay_require_role('admin');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_decision']);
  if c.kind is null or c.proposed_date is null then raise exception 'The contractor has not committed a date yet'; end if;
  if c.kind = 'offense' and coalesce(c.offense_no, 1) >= 4 then raise exception 'Offense 4: only Terminate & reassign is allowed'; end if;
  if (c.kind = 'act_of_nature' or c.offense_no = 3) and c.verdict is distinct from 'agree' then
    raise exception 'The field engineer must confirm this on site before you can approve';
  end if;
  v_cap := least(c.proposed_date, v_today + public._delay_case_window(c, c.kind, c.stopped_days));
  if p_new_date is null or p_new_date <= v_today or p_new_date > v_cap then
    raise exception 'The approved date must be from % to % (never later than the contractor''s date or the limit)', v_today + 1, v_cap;
  end if;
  p := public._delay_lock_project(c.project_id);
  v_current := public._delay_parse_date(p.target_completion_date);
  select full_name into v_name from public.profiles where id = auth.uid();
  perform public._delay_set_target(p.id, p_new_date);
  insert into public.project_time_extensions (project_id, days_granted, effective_date, reference_no, reason, approved_by, approved_by_name)
  values (p.id, p_new_date - coalesce(v_current, c.target_date_at_open), null, null,
          concat_ws(' ',
            case when c.kind = 'act_of_nature'
                 then format('Act of nature (%s, %s day(s) stopped; not counted as an offense).', c.event_name, c.stopped_days)
                 else format('Offense %s of 3 (manpower).', c.offense_no) end,
            format('New finish date %s.', p_new_date),
            'Contractor: ' || btrim(c.explanation),
            'DA: ' || nullif(btrim(coalesce(p_note, '')), '')),
          auth.uid(), v_name)
  returning id into v_ext;
  if c.kind = 'act_of_nature' then
    update public.project_contractor_terms set excused_days = excused_days + c.stopped_days where id = c.term_id;
  end if;
  perform public._delay_close(c.id, 'extended', p_note, p_new_date, null, v_today - c.target_date_at_open,
    jsonb_build_object('previous_target', v_current, 'extension_id', v_ext));
end $function$;

-- Send a manpower commitment back once (an unrealistic plan, or the engineer disagreed).
create or replace function public.delay_send_back(p_case uuid, p_note text, p_reply_by date)
 returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare c public.project_delay_cases; p public.fmr_projects;
begin
  perform public._delay_require_role('admin');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_decision']);
  if c.kind is distinct from 'offense' then raise exception 'Only a manpower commitment can be sent back'; end if;
  if coalesce(c.revision_count, 0) >= 1 then raise exception 'A commitment can be sent back only once'; end if;
  perform public._delay_check_reason(p_note, 'The reason');
  perform public._delay_check_reply_by(p_reply_by);
  p := public._delay_lock_project(c.project_id);
  update public.project_delay_cases
     set status = 'awaiting_explanation', reply_by = p_reply_by, revision_count = coalesce(revision_count, 0) + 1, verdict = null
   where id = c.id;
  perform public._delay_event(c.id, 'revision_requested', jsonb_build_object('note', btrim(p_note), 'reply_by', p_reply_by));
  perform public._delay_notify(p.contractor_id, 'contractor', 'delay_revision_requested', 'Commit again',
    format('"%s": the DA sent your commitment back. %s Commit again by %s (still Offense %s, up to %s days).', p.project_name,
      btrim(p_note), to_char(p_reply_by, 'FMMonth FMDD, YYYY'), c.offense_no, public._delay_window(c.offense_no)), p.id);
end $function$;

-- An act-of-nature claim that is not accepted becomes the next offense.
create or replace function public.delay_reject_nature_claim(p_case uuid, p_note text, p_reply_by date)
 returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare c public.project_delay_cases; p public.fmr_projects; v_today date := public._delay_today();
begin
  perform public._delay_require_role('admin');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_decision']);
  if c.kind is distinct from 'act_of_nature' then raise exception 'This is not an act-of-nature claim'; end if;
  perform public._delay_check_reason(p_note, 'The reason');
  p := public._delay_lock_project(c.project_id);
  if coalesce(c.offense_no, 1) >= 4 then
    update public.project_delay_cases set kind = 'offense', cause = 'manpower', status = 'no_response', decision_due = v_today + 5 where id = c.id;
    perform public._delay_event(c.id, 'nature_claim_rejected', jsonb_build_object('note', btrim(p_note), 'offense_no', c.offense_no));
    perform public._delay_notify(p.contractor_id, 'contractor', 'delay_nature_rejected', 'Act-of-nature claim not accepted',
      format('"%s": %s Your 3 chances are used, so the DA will decide on termination.', p.project_name, btrim(p_note)), p.id);
  else
    perform public._delay_check_reply_by(p_reply_by);
    update public.project_delay_cases
       set kind = 'offense', cause = null, status = 'awaiting_explanation', reply_by = p_reply_by,
           proposed_date = null, event_name = null, stopped_days = null, window_max_date = null, verdict = null
     where id = c.id;
    perform public._delay_event(c.id, 'nature_claim_rejected', jsonb_build_object('note', btrim(p_note), 'offense_no', c.offense_no, 'reply_by', p_reply_by));
    perform public._delay_notify(p.contractor_id, 'contractor', 'delay_nature_rejected', 'Act-of-nature claim not accepted',
      format('"%s": %s This delay now counts as Offense %s of 3. Commit a new finish date (up to %s days) by %s.', p.project_name,
        btrim(p_note), c.offense_no, public._delay_window(c.offense_no), to_char(p_reply_by, 'FMMonth FMDD, YYYY')), p.id);
  end if;
end $function$;

-- The field engineer's check: now a geotagged site photo is REQUIRED.
CREATE OR REPLACE FUNCTION public.delay_submit_verification(p_case uuid, p_verdict text, p_note text, p_photo_url text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare c public.project_delay_cases; p public.fmr_projects;
begin
  perform public._delay_require_role('field_engineer');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_verification']);
  if c.verifier_id is null or c.verifier_id is distinct from auth.uid() then
    raise exception 'Only the assigned field engineer can do this';
  end if;
  if p_verdict is null or p_verdict not in ('agree','disagree') then raise exception 'Choose Confirmed or Not confirmed'; end if;
  perform public._delay_check_reason(p_note, 'The site note');
  -- CHANGED: the photo is required, and must be the engineer's own KalsaTrack-camera upload.
  if nullif(btrim(coalesce(p_photo_url, '')), '') is null
     or position(('/progress-photos/priority/' || auth.uid()::text || '/') in p_photo_url) = 0 then
    raise exception 'Take the site photo with the KalsaTrack camera from your own account';
  end if;
  p := public._delay_lock_project(c.project_id);
  update public.project_delay_cases
     set status = 'awaiting_decision', decision_due = public._delay_today() + 5, verdict = p_verdict,
         verification_note = btrim(p_note), verification_photo_url = btrim(p_photo_url), verified_at = now()
   where id = c.id;
  perform public._delay_event(c.id, 'verification_submitted', jsonb_build_object(
    'verdict', p_verdict, 'note', btrim(p_note), 'photo_url', btrim(p_photo_url)));
  perform public._priority_notify_admins('delay_verification_submitted', 'Field check received',
    format('"%s": the field engineer %s (%s). Decide by %s.', p.project_name,
      case p_verdict when 'agree' then 'CONFIRMED it' else 'did NOT confirm it' end,
      case when c.kind = 'act_of_nature' then 'act of nature' else format('Offense %s', c.offense_no) end,
      to_char(public._delay_today() + 5, 'FMMonth FMDD, YYYY')), p.id);
end $function$;

-- 9. Offense 4: Terminate & reassign (the DA presses it) ------------------------------
create or replace function public.delay_terminate_and_reassign(p_case uuid, p_reason text, p_new_contractor uuid,
                                                              p_start_date date, p_target_date date)
 returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare c public.project_delay_cases; p public.fmr_projects; t public.project_contractor_terms;
        v_today date := public._delay_today(); v_old uuid; v_new_name text;
begin
  perform public._delay_require_role('admin');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_request', 'awaiting_decision', 'no_response']);
  if coalesce(c.offense_no, 1) < 4 then raise exception 'Terminate & reassign is allowed only at Offense 4'; end if;
  if c.kind = 'act_of_nature' and c.status = 'awaiting_decision' then
    raise exception 'Decide the act-of-nature claim first (approve or reject it)';
  end if;
  perform public._delay_check_reason(p_reason, 'The reason');
  p := public._delay_lock_project(c.project_id);
  v_old := p.contractor_id;
  if p_new_contractor is null or p_new_contractor = v_old
     or not exists (select 1 from public.profiles where id = p_new_contractor and role = 'contractor') then
    raise exception 'Choose a different registered contractor';
  end if;
  if p_start_date is null or p_start_date < v_today or p_start_date > v_today + 30 then
    raise exception 'The new contractor''s start date must be from today up to 30 days from today';
  end if;
  if p_target_date is null or p_target_date <= p_start_date then
    raise exception 'The new target date must be after the start date';
  end if;
  select full_name into v_new_name from public.profiles where id = p_new_contractor;
  t := public._delay_holding_term(p.id);

  perform public._delay_close(c.id, 'terminated', p_reason, null, null, v_today - c.target_date_at_open,
    jsonb_build_object('new_contractor', p_new_contractor, 'accomplishment', p.accomplishment));
  update public.project_contractor_terms
     set status = 'terminated', ended_on = v_today, end_percent = coalesce(p.accomplishment, 0), end_reason = btrim(p_reason),
         days_late = case when target_date is not null then greatest(v_today - target_date - excused_days, 0) end
   where id = t.id;
  insert into public.project_contractor_terms (project_id, term_no, contractor_id, contractor_name, started_on, start_percent, target_date)
  values (p.id, t.term_no + 1, p_new_contractor, v_new_name, p_start_date, coalesce(p.accomplishment, 0), p_target_date);

  -- The new target first, so the save trigger does not see a past date and reopen a case.
  perform public._delay_set_target(p.id, p_target_date);
  perform set_config('delay.reassign', 'on', true);
  update public.fmr_projects
     set contractor_id = p_new_contractor,
         status = case when lower(btrim(coalesce(status, ''))) = 'on-going' then status else 'On-Going' end
   where id = p.id;
  perform set_config('delay.reassign', 'off', true);

  perform public._delay_notify(p_new_contractor, 'contractor', 'project_reassigned_to_you', 'Project assigned to you',
    format('"%s" is now yours, continuing from %s%%. Start by %s; your target date is %s.', p.project_name,
      round(coalesce(p.accomplishment, 0), 2), to_char(p_start_date, 'FMMonth FMDD, YYYY'), to_char(p_target_date, 'FMMonth FMDD, YYYY')), p.id);
  if p.site_engineer_id is not null then
    perform public._priority_notify(p.site_engineer_id, 'project_reassigned', 'Project reassigned',
      format('"%s" was reassigned to %s after 3 offenses by the previous contractor.', p.project_name, coalesce(v_new_name, 'a new contractor')), p.id);
  end if;
end $function$;

-- The plain "New project assigned" notice stays quiet during a reassignment
-- (the reassignment sends its own, with the start date, target and %).
CREATE OR REPLACE FUNCTION public.notify_project_assignment_events()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET row_security TO 'off'
AS $function$
BEGIN
  IF NEW.contractor_id IS NOT NULL AND NEW.contractor_id IS DISTINCT FROM OLD.contractor_id
     AND coalesce(current_setting('delay.reassign', true), '') <> 'on' THEN   -- ADDED
    INSERT INTO public.notifications (user_id, type, title, message, project_id)
    VALUES (NEW.contractor_id, 'project_assigned', 'New project assigned',
      format('You were assigned to %s%s.', NEW.project_name,
             CASE WHEN NEW.municipality IS NOT NULL THEN ' (' || NEW.municipality || ')' ELSE '' END),
      NEW.id);
  END IF;

  IF NEW.site_engineer_id IS NOT NULL AND NEW.site_engineer_id IS DISTINCT FROM OLD.site_engineer_id THEN
    INSERT INTO public.notifications (user_id, type, title, message, project_id)
    VALUES (NEW.site_engineer_id, 'site_engineer_assigned', 'You are the site engineer',
      format('You were assigned as site engineer for %s. Contractor progress on it will be routed to you.', NEW.project_name),
      NEW.id);
    IF NEW.contractor_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, project_id)
      VALUES (NEW.contractor_id, 'project_site_engineer_set', 'Site engineer assigned',
        format('A site engineer was assigned to %s. You can submit progress updates now.', NEW.project_name),
        NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 10. The daily check: no reply counts as an offense ----------------------------------
CREATE OR REPLACE FUNCTION public._delay_check(p_only_project bigint)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_today date := public._delay_today();
  r record; v_case uuid; v_orig date;
  v_opened int := 0; v_moved int := 0; v_reminders int := 0; v_failed int := 0; v_summary boolean := false;
  v_unassigned text; v_unassigned_n int; v_unreadable text; v_blank int;
begin
  perform pg_advisory_xact_lock(hashtext('project_delay_check'));

  -- 1. Deadlines that passed move the case on (first, so a missed reply opens the next round today).
  for r in
    select c.id, c.status, c.reply_by, c.verification_due, c.project_id, c.offense_no, p.project_name
      from public.project_delay_cases c join public.fmr_projects p on p.id = c.project_id
     where c.status in ('awaiting_explanation','revision_requested','final_notice','awaiting_verification')
       and (p_only_project is null or c.project_id = p_only_project)
     order by c.project_id
     for update of c
  loop
    begin
      if r.status in ('awaiting_explanation','revision_requested','final_notice') and r.reply_by < v_today then
        if coalesce(r.offense_no, 1) <= 3 then
          update public.project_delay_cases set kind = 'offense', cause = coalesce(cause, 'manpower') where id = r.id;
          perform public._delay_close(r.id, 'no_reply', null, null, null,
            v_today - (select target_date_at_open from public.project_delay_cases where id = r.id), jsonb_build_object('automatic', true));
          perform public._priority_notify_admins('delay_no_response', 'No reply: counted as an offense',
            format('"%s": the contractor did not reply by %s. Counted as Offense %s of 3; the next round opens.',
              r.project_name, to_char(r.reply_by, 'FMMonth FMDD, YYYY'), coalesce(r.offense_no, 1)), r.project_id);
        else
          update public.project_delay_cases set status = 'no_response', kind = 'offense', decision_due = v_today + 5 where id = r.id;
          perform public._delay_event(r.id, 'no_response', jsonb_build_object('reply_by', r.reply_by, 'decision_due', v_today + 5));
          perform public._priority_notify_admins('delay_no_response', 'Offense 4: terminate & reassign',
            format('"%s": the contractor did not reply by %s and has used 3 chances. Terminate & reassign by %s.',
              r.project_name, to_char(r.reply_by, 'FMMonth FMDD, YYYY'), to_char(v_today + 5, 'FMMonth FMDD, YYYY')), r.project_id);
        end if;
        v_moved := v_moved + 1;
      elsif r.status = 'awaiting_verification' and r.verification_due < v_today then
        update public.project_delay_cases set status = 'awaiting_decision', decision_due = v_today + 5 where id = r.id;
        perform public._delay_event(r.id, 'verification_timed_out', jsonb_build_object('verification_due', r.verification_due));
        perform public._priority_notify_admins('delay_verification_timeout', 'Field check not received',
          format('"%s": the field engineer did not check by %s. Send it again or decide by %s.',
            r.project_name, to_char(r.verification_due, 'FMMonth FMDD, YYYY'), to_char(v_today + 5, 'FMMonth FMDD, YYYY')), r.project_id);
        v_moved := v_moved + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1; raise warning 'delay check: moving case % failed: %', r.id, sqlerrm;
    end;
  end loop;

  -- 2. Open a case for each On-Going project WITH a contractor, readable target < today, no open case.
  for r in
    select p.id, p.project_name, public._delay_parse_date(p.target_completion_date) t
      from public.fmr_projects p
     where lower(btrim(coalesce(p.status, ''))) = 'on-going'
       and p.contractor_id is not null
       and public._delay_parse_date(p.target_completion_date) < v_today
       and (p_only_project is null or p.id = p_only_project)
       and not exists (select 1 from public.project_delay_cases c where c.project_id = p.id and c.status <> 'closed')
     order by p.id
  loop
    begin
      select original_deadline into v_orig from public.project_delay_cases where project_id = r.id order by opened_at limit 1;
      insert into public.project_delay_cases (project_id, status, original_deadline, target_date_at_open, request_due)
      values (r.id, 'awaiting_request', coalesce(v_orig, r.t), r.t, v_today + 3)
      on conflict (project_id) where status <> 'closed' do nothing
      returning id into v_case;
      if v_case is not null then
        perform public._delay_event(v_case, 'case_opened', jsonb_build_object(
          'target_date', r.t, 'days_late', v_today - r.t, 'request_due', v_today + 3));
        if public._delay_ledger(v_case::text, 'opened') then
          perform public._priority_notify_admins('delay_case_opened', 'Overdue project: follow-up opened',
            format('"%s" passed its target date (%s; %s day(s) late). Ask the contractor to commit a new date by %s.',
              r.project_name, to_char(r.t, 'FMMonth FMDD, YYYY'), v_today - r.t, to_char(v_today + 3, 'FMMonth FMDD, YYYY')), r.id);
        end if;
        v_opened := v_opened + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1; raise warning 'delay check: opening a case for project % failed: %', r.id, sqlerrm;
    end;
    v_case := null; v_orig := null;
  end loop;

  -- 3. Once-only reminders and overdue alerts.
  for r in
    select c.*, p.project_name, p.contractor_id
      from public.project_delay_cases c join public.fmr_projects p on p.id = c.project_id
     where c.status <> 'closed' and (p_only_project is null or c.project_id = p_only_project)
  loop
    begin
      if r.status in ('awaiting_explanation','revision_requested') and r.reply_by = v_today
         and public._delay_ledger(r.id::text, 'reply_due:' || r.reply_by) then
        perform public._delay_notify(r.contractor_id, 'contractor', 'delay_reply_due', 'Reply due today',
          format('Your commitment on "%s" is due today (%s). No reply counts as an offense.', r.project_name, to_char(r.reply_by, 'FMMonth FMDD, YYYY')), r.project_id);
        perform public._priority_notify_admins('delay_reply_due', 'Contractor reply due today',
          format('"%s": the contractor''s commitment is due today.', r.project_name), r.project_id);
        perform public._delay_event(r.id, 'reminder', jsonb_build_object('kind', 'reply_due', 'date', r.reply_by));
        v_reminders := v_reminders + 1;
      end if;
      if r.status = 'awaiting_request' and r.request_due < v_today
         and public._delay_ledger(r.id::text, 'request_overdue:' || r.request_due) then
        perform public._priority_notify_admins('delay_action_overdue', 'Action overdue',
          format('"%s": no request was sent to the contractor by %s.', r.project_name, to_char(r.request_due, 'FMMonth FMDD, YYYY')), r.project_id);
        perform public._delay_event(r.id, 'reminder', jsonb_build_object('kind', 'request_overdue', 'date', r.request_due));
        v_reminders := v_reminders + 1;
      end if;
      if r.status in ('awaiting_decision','no_response') and r.decision_due < v_today
         and public._delay_ledger(r.id::text, 'decision_overdue:' || r.decision_due) then
        perform public._priority_notify_admins('delay_decision_overdue', 'Decision overdue',
          format('"%s": a decision was due %s.', r.project_name, to_char(r.decision_due, 'FMMonth FMDD, YYYY')), r.project_id);
        perform public._delay_event(r.id, 'reminder', jsonb_build_object('kind', 'decision_overdue', 'date', r.decision_due));
        v_reminders := v_reminders + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1; raise warning 'delay check: reminders for case % failed: %', r.id, sqlerrm;
    end;
  end loop;

  -- 4. Admin summary (full runs only): overdue projects WITHOUT a contractor, unreadable or blank dates.
  if p_only_project is null then
    select count(*), string_agg(format('%s (%s day(s) late)', project_name, v_today - t), '; ' order by t)
      into v_unassigned_n, v_unassigned
      from (select project_name, public._delay_parse_date(target_completion_date) t from public.fmr_projects
             where lower(btrim(coalesce(status, ''))) = 'on-going' and contractor_id is null) x
     where t < v_today;
    select string_agg(project_name || ' ("' || target_completion_date || '")', '; ' order by id) into v_unreadable
      from public.fmr_projects
     where lower(btrim(coalesce(status, ''))) = 'on-going'
       and btrim(coalesce(target_completion_date, '')) <> ''
       and public._delay_parse_date(target_completion_date) is null;
    select count(*) into v_blank from public.fmr_projects
     where lower(btrim(coalesce(status, ''))) = 'on-going' and btrim(coalesce(target_completion_date, '')) = '';
    if (coalesce(v_unassigned_n, 0) > 0 or v_unreadable is not null or v_blank > 0)
       and (not exists (select 1 from public.overdue_alerts where kind = 'project_delay' and ref_id = 'unassigned_summary')
            or extract(isodow from v_today) = 1)
       and public._delay_ledger('unassigned_summary', v_today::text) then
      perform public._priority_notify_admins('delay_unassigned_summary', 'Overdue projects without a contractor',
        concat_ws(' ',
          case when coalesce(v_unassigned_n, 0) > 0 then format('%s overdue On-Going project(s) have no contractor, so no follow-up was opened: %s. Assign a contractor to start their follow-up.', v_unassigned_n, v_unassigned) end,
          case when v_unreadable is not null then format('Target dates that could not be read: %s.', v_unreadable) end,
          case when v_blank > 0 then format('%s On-Going project(s) have no target date.', v_blank) end),
        null);
      v_summary := true;
    end if;
  end if;

  if v_failed > 0 and public._delay_ledger('job_errors', v_today::text) then
    perform public._priority_notify_admins('delay_job_errors', 'Delay follow-up check had errors',
      format('The daily check skipped %s item(s) because of errors. They will be retried; see the database logs.', v_failed), null);
  end if;

  return jsonb_build_object('cases_opened', v_opened, 'moved', v_moved, 'reminders_sent', v_reminders,
                            'summary_sent', v_summary, 'failed', v_failed, 'checked_at', now());
end $function$;

-- 11. Contractor history (public project page, contractors, DA) ------------------------
create or replace function public.project_contractor_history(p_project bigint)
 returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'term_no', t.term_no, 'contractor_name', coalesce(t.contractor_name, 'Contractor'),
           'status', t.status, 'started_on', t.started_on, 'ended_on', t.ended_on,
           'start_percent', t.start_percent, 'end_percent', t.end_percent,
           'target_date', t.target_date, 'excused_days', t.excused_days, 'days_late', t.days_late,
           'end_reason', t.end_reason,
           'delays', (select coalesce(jsonb_agg(jsonb_build_object(
                         'kind', c.kind, 'offense_no', c.offense_no, 'outcome', c.outcome,
                         'event_name', c.event_name, 'stopped_days', c.stopped_days,
                         'closed_on', (c.closed_at at time zone 'Asia/Manila')::date,
                         'previous_target', c.target_date_at_open, 'new_target', c.new_target_date,
                         'days_added', case when c.new_target_date is not null then c.new_target_date - c.target_date_at_open end)
                       order by c.closed_at), '[]'::jsonb)
                        from public.project_delay_cases c
                       where c.term_id = t.id and c.outcome in ('extended', 'no_reply', 'terminated'))
         ) order by t.term_no), '[]'::jsonb)
    from public.project_contractor_terms t
    join public.fmr_projects p on p.id = t.project_id
   where t.project_id = p_project
     and (p.published_at is not null
          or public.current_profile_role() in ('admin', 'field_engineer', 'lgu')
          or exists (select 1 from public.project_contractor_terms m where m.project_id = p_project and m.contractor_id = auth.uid()));
$$;

-- A terminated contractor keeps a read-only record of their past periods.
create or replace function public.contractor_past_terms()
 returns table (project_id bigint, project_name text, municipality text, term_no int, started_on date, ended_on date,
                start_percent numeric, end_percent numeric, target_date date, days_late int, end_reason text)
 language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select t.project_id, p.project_name, p.municipality, t.term_no, t.started_on, t.ended_on,
         t.start_percent, t.end_percent, t.target_date, t.days_late, t.end_reason
    from public.project_contractor_terms t join public.fmr_projects p on p.id = t.project_id
   where t.contractor_id = auth.uid() and t.status = 'terminated'
   order by t.ended_on desc;
$$;

-- 12. Permissions -------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.delay_submit_commitment(uuid, text, text, date, text, integer)',
    'public.delay_approve(uuid, date, text)',
    'public.delay_send_back(uuid, text, date)',
    'public.delay_reject_nature_claim(uuid, text, date)',
    'public.delay_terminate_and_reassign(uuid, text, uuid, date, date)',
    'public.project_contractor_history(bigint)',
    'public.contractor_past_terms()']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  grant execute on function public.project_contractor_history(bigint) to anon;   -- the public project page

  -- Retired actions: kept for old history, no longer callable.
  foreach f in array array[
    'public.delay_grant_extension(uuid, date, text)',
    'public.delay_submit_explanation(uuid, text, text, date, numeric)',
    'public.delay_request_revision(uuid, text, date)',
    'public.delay_issue_final_notice(uuid, text, date)',
    'public.delay_suspend(uuid, text, date)',
    'public.delay_end_suspension(bigint, text, date, text)',
    'public.delay_resume_project(bigint, date, text)',
    'public.delay_terminate(uuid, text)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- Let the app see the new functions right away.
notify pgrst, 'reload schema';

-- Checks (read-only):
-- select count(*) from public.project_contractor_terms;                                   -- one per project with a contractor
-- select id, kind, offense_no, term_id is not null from public.project_delay_cases;      -- every case has a period
-- select pg_get_function_identity_arguments('public.delay_submit_commitment'::regproc);
