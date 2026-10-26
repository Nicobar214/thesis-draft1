-- =============================================================================
-- Overdue FMR projects: delay follow-up (Phase 1, database).
-- Every overdue On-Going project WITH a contractor gets one time-boxed case that
-- always ends in exactly one outcome: extended / completed_late / suspended / terminated.
-- MODIFIES THE DATABASE. Add-only. Run as postgres in the Supabase SQL editor.
-- Existing functions, cron jobs and RLS policies are NOT changed. Adds two triggers
-- to fmr_projects (target-date lock, Completed auto-close) and one nullable column
-- project_suspensions.expected_resume_date.
-- =============================================================================

-- 1. Helpers ------------------------------------------------------------------
create or replace function public._delay_today()
returns date language sql stable set search_path = public, pg_temp as $$
  select (now() at time zone 'Asia/Manila')::date;
$$;

-- Accepts 'YYYY-MM-DD' and 'Month DD, YYYY' (full or abbreviated month, with or without
-- a period: 'Sep', 'Sept.', 'Aug.'), extra spaces, empty and NULL. Impossible dates -> NULL.
create or replace function public._delay_parse_date(p text)
returns date language plpgsql immutable set search_path = public, pg_temp as $$
declare v text; m text[]; mon int;
begin
  v := btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'));
  v := replace(v, ' ,', ',');
  if v = '' then return null; end if;
  m := regexp_match(v, '^(\d{4})-(\d{2})-(\d{2})$');
  if m is not null then return make_date(m[1]::int, m[2]::int, m[3]::int); end if;
  m := regexp_match(v, '^([A-Za-z]+)\.? (\d{1,2}), (\d{4})$');
  if m is null then return null; end if;
  mon := case lower(m[1])
    when 'jan' then 1  when 'january' then 1  when 'feb' then 2  when 'february' then 2
    when 'mar' then 3  when 'march' then 3    when 'apr' then 4  when 'april' then 4
    when 'may' then 5  when 'jun' then 6      when 'june' then 6 when 'jul' then 7
    when 'july' then 7 when 'aug' then 8      when 'august' then 8
    when 'sep' then 9  when 'sept' then 9     when 'september' then 9
    when 'oct' then 10 when 'october' then 10 when 'nov' then 11 when 'november' then 11
    when 'dec' then 12 when 'december' then 12 else null end;
  if mon is null then return null; end if;
  return make_date(m[3]::int, mon, m[2]::int);
exception when others then
  return null;
end $$;

-- 2. Tables -------------------------------------------------------------------
create table if not exists public.project_delay_cases (
  id                     uuid primary key default gen_random_uuid(),
  project_id             bigint not null references public.fmr_projects(id) on delete cascade,
  status                 text not null default 'awaiting_request' check (status in (
                           'awaiting_request','awaiting_explanation','no_response','awaiting_verification',
                           'awaiting_decision','revision_requested','final_notice','closed')),
  opened_at              timestamptz not null default now(),
  original_deadline      date not null,          -- first deadline seen for this project (history)
  target_date_at_open    date not null,          -- the deadline missed in THIS episode
  request_due            date,                   -- awaiting_request deadline (opened + 3 days)
  reply_by               date,                   -- contractor deadline (explanation / revision / final notice)
  decision_due           date,                   -- admin deadline (+5 days)
  verification_due       date,                   -- verifier deadline (+5 days)
  revision_count         int not null default 0 check (revision_count between 0 and 1),
  final_notice_issued    boolean not null default false,
  final_notice_missed    boolean not null default false,
  cause                  text check (cause in ('weather','right_of_way','materials','fund_release','design_change','other')),
  explanation            text,
  proposed_date          date,
  claimed_percent        numeric check (claimed_percent between 0 and 100),
  explained_at           timestamptz,
  verifier_id            uuid references public.profiles(id) on delete set null,
  verdict                text check (verdict in ('agree','disagree')),
  verification_note      text,
  verification_photo_url text,
  verified_at            timestamptz,
  outcome                text check (outcome in ('extended','completed_late','suspended','terminated')),
  outcome_reason         text,
  new_target_date        date,
  resume_date            date,
  days_late              int,
  closed_at              timestamptz,
  closed_by              uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint project_delay_cases_outcome_iff_closed check ((status = 'closed') = (outcome is not null))
);
create unique index if not exists project_delay_cases_one_open
  on public.project_delay_cases (project_id) where status <> 'closed';
create index if not exists project_delay_cases_project on public.project_delay_cases (project_id, opened_at);
create index if not exists project_delay_cases_verifier on public.project_delay_cases (verifier_id) where verifier_id is not null;

create table if not exists public.project_delay_case_events (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.project_delay_cases(id) on delete cascade,
  event_type  text not null,
  actor_id    uuid,                        -- null = system (cron)
  actor_role  text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default clock_timestamp()
);
create index if not exists project_delay_case_events_case on public.project_delay_case_events (case_id, created_at);

-- Current expected resume date of a suspension (updatable; closed cases are locked).
alter table public.project_suspensions add column if not exists expected_resume_date date;

-- 3. Integrity triggers on the new tables --------------------------------------
create or replace function public._delay_cases_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.project_id is distinct from old.project_id or new.opened_at is distinct from old.opened_at
     or new.original_deadline is distinct from old.original_deadline
     or new.target_date_at_open is distinct from old.target_date_at_open then
    raise exception 'Delay case history fields cannot be changed';
  end if;
  if old.status = 'closed' then
    raise exception 'This delay case is closed and cannot change';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_delay_cases_guard on public.project_delay_cases;
create trigger trg_delay_cases_guard before update on public.project_delay_cases
  for each row execute function public._delay_cases_guard();

create or replace function public._delay_events_append_only()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;   -- cascade from a deleted project
  raise exception 'Delay case history is append-only';
end $$;
drop trigger if exists trg_delay_events_append_only on public.project_delay_case_events;
create trigger trg_delay_events_append_only before update or delete on public.project_delay_case_events
  for each row execute function public._delay_events_append_only();

-- 4. Read access (RLS, SELECT only) ---------------------------------------------
create or replace function public._delay_can_view(p_project bigint, p_verifier uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
       (auth.uid() is not null and public.public_report_current_role() is not distinct from 'admin')
    or (auth.uid() is not null and p_verifier is not null and p_verifier = auth.uid())
    or exists (select 1 from public.fmr_projects p
                where p.id = p_project and auth.uid() is not null and p.contractor_id = auth.uid()),
    false);
$$;

alter table public.project_delay_cases enable row level security;
alter table public.project_delay_case_events enable row level security;
revoke all on public.project_delay_cases, public.project_delay_case_events from public, anon, authenticated, service_role;
grant select on public.project_delay_cases, public.project_delay_case_events to authenticated;

drop policy if exists project_delay_cases_select on public.project_delay_cases;
create policy project_delay_cases_select on public.project_delay_cases
  for select to authenticated using (public._delay_can_view(project_id, verifier_id));
drop policy if exists project_delay_case_events_select on public.project_delay_case_events;
create policy project_delay_case_events_select on public.project_delay_case_events
  for select to authenticated using (exists (
    select 1 from public.project_delay_cases c
     where c.id = case_id and public._delay_can_view(c.project_id, c.verifier_id)));

-- 5. Internal helpers (owner only) ------------------------------------------------
create or replace function public._delay_require_role(p_role text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public.public_report_current_role() is distinct from p_role then
    raise exception '%', case p_role
      when 'admin' then 'Only the DA admin can do this'
      when 'contractor' then 'Only the project''s contractor can do this'
      else 'Only the assigned field engineer can do this' end;
  end if;
end $$;

create or replace function public._delay_event(p_case uuid, p_type text, p_payload jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.project_delay_case_events (case_id, event_type, actor_id, actor_role, payload)
  values (p_case, p_type, auth.uid(),
          case when auth.uid() is null then 'system' else nullif(public.public_report_current_role(), '') end,
          coalesce(p_payload, '{}'::jsonb));
$$;

-- True only the first time (case/ref, stage) is recorded: alerts are sent once.
create or replace function public._delay_ledger(p_ref text, p_stage text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v boolean;
begin
  insert into public.overdue_alerts (kind, ref_id, stage) values ('project_delay', p_ref, p_stage)
  on conflict (kind, ref_id, stage) do nothing returning true into v;
  return coalesce(v, false);
end $$;

-- Notify one person; if nobody is assigned, tell the admins instead (never silently dropped).
create or replace function public._delay_notify(p_user uuid, p_who text, p_type text, p_title text, p_message text, p_project bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_user is not null then
    perform public._priority_notify(p_user, p_type, p_title, p_message, p_project);
  else
    perform public._priority_notify_admins('delay_undeliverable', format('No %s to notify', p_who),
      format('"%s" could not be delivered because no %s is assigned. %s', p_title, p_who, p_message), p_project);
  end if;
end $$;

create or replace function public._delay_lock_case(p_case uuid)
returns public.project_delay_cases language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.project_delay_cases;
begin
  if p_case is null then raise exception 'Delay case not found'; end if;
  select * into c from public.project_delay_cases where id = p_case for update;
  if not found then raise exception 'Delay case not found'; end if;
  return c;
end $$;

create or replace function public._delay_lock_project(p_project bigint)
returns public.fmr_projects language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.fmr_projects;
begin
  select * into p from public.fmr_projects where id = p_project for update;
  if not found then raise exception 'Project not found'; end if;
  return p;
end $$;

create or replace function public._delay_require_state(p_status text, p_allowed text[])
returns void language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p_status is null or not (p_status = any (p_allowed)) then
    raise exception 'This action is not allowed while the case is %', coalesce(p_status, 'unknown');
  end if;
end $$;

create or replace function public._delay_check_reply_by(p_date date)
returns void language plpgsql stable set search_path = public, pg_temp as $$
begin
  if p_date is null or p_date < public._delay_today() + 1 or p_date > public._delay_today() + 30 then
    raise exception 'The reply-by date must be from tomorrow up to 30 days from today';
  end if;
end $$;

create or replace function public._delay_check_reason(p_text text, p_what text)
returns void language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if length(btrim(coalesce(p_text, ''))) < 10 then
    raise exception '% must be at least 10 characters', p_what;
  end if;
end $$;

create or replace function public._delay_extensions_used(p_project bigint)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.project_delay_cases where project_id = p_project and outcome = 'extended';
$$;

-- The ONLY way delay functions change a target date: sets a transaction-local flag that the
-- lock trigger accepts solely from a non-API role (the SECURITY DEFINER owner).
create or replace function public._delay_set_target(p_project bigint, p_date date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('delay.target_write', 'on', true);
  update public.fmr_projects set target_completion_date = to_char(p_date, 'YYYY-MM-DD') where id = p_project;
  perform set_config('delay.target_write', 'off', true);
end $$;

-- Close a case with exactly one outcome, record it, notify contractor + verifier.
create or replace function public._delay_close(
  p_case uuid, p_outcome text, p_reason text, p_new_target date, p_resume date, p_days_late int, p_extra jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.project_delay_cases; p public.fmr_projects; v_label text;
begin
  select * into c from public.project_delay_cases where id = p_case;
  select * into p from public.fmr_projects where id = c.project_id;
  update public.project_delay_cases
     set status = 'closed', outcome = p_outcome, outcome_reason = btrim(p_reason), new_target_date = p_new_target,
         resume_date = p_resume, days_late = p_days_late, closed_at = now(), closed_by = auth.uid()
   where id = p_case;
  perform public._delay_event(p_case, 'closed', coalesce(p_extra, '{}'::jsonb) || jsonb_build_object(
    'outcome', p_outcome, 'reason', btrim(p_reason), 'new_target_date', p_new_target,
    'resume_date', p_resume, 'days_late', p_days_late));
  v_label := case p_outcome when 'extended' then format('Extended to %s', to_char(p_new_target, 'FMMonth FMDD, YYYY'))
                            when 'completed_late' then format('Completed late (%s day(s))', p_days_late)
                            when 'suspended' then format('Suspended until about %s', to_char(p_resume, 'FMMonth FMDD, YYYY'))
                            else 'Terminated' end;
  perform public._delay_notify(p.contractor_id, 'contractor', 'delay_case_closed', 'Delay follow-up closed',
    format('"%s": %s. Reason: %s', p.project_name, v_label, btrim(p_reason)), p.id);
  if c.verifier_id is not null then
    perform public._priority_notify(c.verifier_id, 'delay_case_closed', 'Delay follow-up closed',
      format('"%s": %s. Reason: %s', p.project_name, v_label, btrim(p_reason)), p.id);
  end if;
end $$;

-- 6. Triggers added to fmr_projects -------------------------------------------------
-- Lock: while a case is open, the target date can only change through _delay_set_target().
-- Runs as the updating user (NOT security definer) so current_user tells API roles apart.
create or replace function public._delay_target_lock()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if public._delay_parse_date(new.target_completion_date) is not distinct from public._delay_parse_date(old.target_completion_date) then
    return new;   -- same date (e.g. re-saved in another format)
  end if;
  if not exists (select 1 from public.project_delay_cases c where c.project_id = new.id and c.status <> 'closed') then
    return new;
  end if;
  if current_setting('delay.target_write', true) = 'on'
     and current_user not in ('anon', 'authenticated', 'service_role', 'authenticator') then
    return new;   -- delay_grant_extension / delay_resume_project via _delay_set_target()
  end if;
  raise exception 'This project has an open delay case. Its target date can only be changed with Grant extension (Project Management > Overdue).';
end $$;
drop trigger if exists trg_delay_target_lock on public.fmr_projects;
create trigger trg_delay_target_lock before update of target_completion_date on public.fmr_projects
  for each row execute function public._delay_target_lock();

-- Completed by ANY route closes the open case as completed_late.
create or replace function public._delay_on_completed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_case uuid; v_target date;
begin
  if lower(btrim(coalesce(new.status, ''))) = 'completed' and lower(btrim(coalesce(old.status, ''))) <> 'completed' then
    select id, target_date_at_open into v_case, v_target from public.project_delay_cases
     where project_id = new.id and status <> 'closed' for update;
    if v_case is not null then
      v_target := coalesce(public._delay_parse_date(new.target_completion_date), v_target);
      perform public._delay_close(v_case, 'completed_late', 'Project was marked Completed.', null, null,
        greatest(public._delay_today() - v_target, 0), jsonb_build_object('automatic', true));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_delay_on_completed on public.fmr_projects;
create trigger trg_delay_on_completed after update of status on public.fmr_projects
  for each row execute function public._delay_on_completed();

-- 7. The daily check (core; owner only) ----------------------------------------------
create or replace function public._delay_check(p_only_project bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := public._delay_today();
  r record; v_case uuid; v_orig date;
  v_opened int := 0; v_moved int := 0; v_reminders int := 0; v_failed int := 0; v_summary boolean := false;
  v_unassigned text; v_unassigned_n int; v_unreadable text; v_blank int;
begin
  perform pg_advisory_xact_lock(hashtext('project_delay_check'));

  -- 1. Open a case for each On-Going project WITH a contractor, readable target < today, no open case.
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
            format('"%s" passed its target date (%s; %s day(s) late). Ask the contractor to explain by %s.',
              r.project_name, to_char(r.t, 'FMMonth FMDD, YYYY'), v_today - r.t, to_char(v_today + 3, 'FMMonth FMDD, YYYY')), r.id);
        end if;
        v_opened := v_opened + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1; raise warning 'delay check: opening a case for project % failed: %', r.id, sqlerrm;
    end;
    v_case := null; v_orig := null;
  end loop;

  -- 2. Deadlines that passed move the case on (so nothing waits forever).
  for r in
    select c.id, c.status, c.reply_by, c.verification_due, c.project_id, p.project_name
      from public.project_delay_cases c join public.fmr_projects p on p.id = c.project_id
     where c.status in ('awaiting_explanation','revision_requested','final_notice','awaiting_verification')
       and (p_only_project is null or c.project_id = p_only_project)
     order by c.project_id
     for update of c
  loop
    begin
      if r.status in ('awaiting_explanation','revision_requested') and r.reply_by < v_today then
        update public.project_delay_cases set status = 'no_response', decision_due = v_today + 5 where id = r.id;
        perform public._delay_event(r.id, 'no_response', jsonb_build_object('reply_by', r.reply_by, 'decision_due', v_today + 5));
        perform public._priority_notify_admins('delay_no_response', 'No reply from the contractor',
          format('"%s": the contractor did not reply by %s. Decide by %s (final notice, completed late, suspend or terminate).',
            r.project_name, to_char(r.reply_by, 'FMMonth FMDD, YYYY'), to_char(v_today + 5, 'FMMonth FMDD, YYYY')), r.project_id);
        v_moved := v_moved + 1;
      elsif r.status = 'final_notice' and r.reply_by < v_today then
        update public.project_delay_cases
           set status = 'awaiting_decision', final_notice_missed = true, decision_due = v_today + 5 where id = r.id;
        perform public._delay_event(r.id, 'final_notice_missed', jsonb_build_object('reply_by', r.reply_by, 'decision_due', v_today + 5));
        perform public._priority_notify_admins('delay_no_response', 'Final notice not answered',
          format('"%s": the final notice was not answered by %s. Only Suspend or Terminate are now allowed. Decide by %s.',
            r.project_name, to_char(r.reply_by, 'FMMonth FMDD, YYYY'), to_char(v_today + 5, 'FMMonth FMDD, YYYY')), r.project_id);
        v_moved := v_moved + 1;
      elsif r.status = 'awaiting_verification' and r.verification_due < v_today then
        update public.project_delay_cases set status = 'awaiting_decision', decision_due = v_today + 5 where id = r.id;
        perform public._delay_event(r.id, 'verification_timed_out', jsonb_build_object('verification_due', r.verification_due));
        perform public._priority_notify_admins('delay_verification_timeout', 'Verification not received',
          format('"%s": the field engineer did not verify by %s. The case is back with you; decide by %s.',
            r.project_name, to_char(r.verification_due, 'FMMonth FMDD, YYYY'), to_char(v_today + 5, 'FMMonth FMDD, YYYY')), r.project_id);
        v_moved := v_moved + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1; raise warning 'delay check: moving case % failed: %', r.id, sqlerrm;
    end;
  end loop;

  -- 3. Once-only reminders and overdue alerts.
  for r in
    select c.*, p.project_name, p.contractor_id
      from public.project_delay_cases c join public.fmr_projects p on p.id = c.project_id
     where c.status <> 'closed' and (p_only_project is null or c.project_id = p_only_project)
  loop
    begin
      if r.status in ('awaiting_explanation','revision_requested','final_notice') and r.reply_by = v_today
         and public._delay_ledger(r.id::text, 'reply_due:' || r.reply_by) then
        perform public._delay_notify(r.contractor_id, 'contractor', 'delay_reply_due', 'Reply due today',
          format('Your reply on "%s" is due today (%s).', r.project_name, to_char(r.reply_by, 'FMMonth FMDD, YYYY')), r.project_id);
        perform public._priority_notify_admins('delay_reply_due', 'Contractor reply due today',
          format('"%s": the contractor''s reply is due today.', r.project_name), r.project_id);
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

  -- 4. Suspended projects past their expected resume date (once per expected date, so an
  --    extended suspension alerts again when its NEW date passes).
  for r in
    select s.id sid, s.project_id, p.project_name, x.case_id,
           coalesce(s.expected_resume_date, x.resume_date) resume_date
      from public.project_suspensions s
      join public.fmr_projects p on p.id = s.project_id
      join lateral (select c.id case_id, c.resume_date from public.project_delay_cases c
                     where c.project_id = s.project_id and c.outcome = 'suspended'
                     order by c.closed_at desc limit 1) x on true
     where s.suspension_end is null and lower(btrim(coalesce(p.status, ''))) = 'suspended'
       and coalesce(s.expected_resume_date, x.resume_date) < v_today
       and (p_only_project is null or s.project_id = p_only_project)
  loop
    begin
      if public._delay_ledger('suspension:' || r.sid, 'resume_due:' || r.resume_date) then
        perform public._priority_notify_admins('delay_resume_due', 'Suspended project: resume date passed',
          format('"%s" was expected to resume by %s. Choose one: Resume, Extend suspension, or Terminate.', r.project_name,
            to_char(r.resume_date, 'FMMonth FMDD, YYYY')), r.project_id);
        perform public._delay_event(r.case_id, 'reminder', jsonb_build_object('kind', 'resume_due', 'date', r.resume_date));
        v_reminders := v_reminders + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1; raise warning 'delay check: resume alert for suspension % failed: %', r.sid, sqlerrm;
    end;
  end loop;

  -- 5. Admin summary (full runs only): overdue projects WITHOUT a contractor, unreadable dates
  --    (by name) and blank dates (count only). First run, then every Monday while any remain.
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
end $$;

-- Cron entry point (postgres only).
create or replace function public.delay_detect_and_remind()
returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select public._delay_check(null);
$$;

-- 8. Admin RPCs ------------------------------------------------------------------------
create or replace function public.delay_run_check_now()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._delay_require_role('admin');
  return public._delay_check(null);
end $$;

create or replace function public.delay_request_explanation(p_case uuid, p_reply_by date, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.project_delay_cases; p public.fmr_projects;
begin
  perform public._delay_require_role('admin');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_request']);
  p := public._delay_lock_project(c.project_id);
  if p.contractor_id is null then raise exception 'Assign a contractor first'; end if;
  perform public._delay_check_reply_by(p_reply_by);
  update public.project_delay_cases set status = 'awaiting_explanation', reply_by = p_reply_by where id = c.id;
  perform public._delay_event(c.id, 'explanation_requested', jsonb_build_object('reply_by', p_reply_by, 'note', nullif(btrim(p_note), '')));
  perform public._delay_notify(p.contractor_id, 'contractor', 'delay_explanation_requested', 'Explain the delay',
    format('"%s" is past its target date. Please explain the delay and propose a new completion date by %s.%s',
      p.project_name, to_char(p_reply_by, 'FMMonth FMDD, YYYY'), coalesce(' DA note: ' || nullif(btrim(p_note), ''), '')), p.id);
end $$;

create or replace function public.delay_request_verification(p_case uuid, p_verifier uuid, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.project_delay_cases; p public.fmr_projects; v_verifier uuid;
begin
  perform public._delay_require_role('admin');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_decision']);
  if c.final_notice_missed then raise exception 'After a missed final notice, only Suspend or Terminate are allowed'; end if;
  p := public._delay_lock_project(c.project_id);
  v_verifier := coalesce(p_verifier, p.site_engineer_id);
  if v_verifier is null or not exists (select 1 from public.profiles where id = v_verifier and role = 'field_engineer') then
    raise exception 'Choose a field engineer to verify';
  end if;
  update public.project_delay_cases
     set status = 'awaiting_verification', verifier_id = v_verifier, verification_due = public._delay_today() + 5
   where id = c.id;
  perform public._delay_event(c.id, 'verification_requested', jsonb_build_object(
    'verifier_id', v_verifier, 'verification_due', public._delay_today() + 5, 'note', nullif(btrim(p_note), '')));
  perform public._priority_notify(v_verifier, 'delay_verification_requested', 'Verify a delay explanation',
    format('Please check the contractor''s delay explanation for "%s" by %s.%s', p.project_name,
      to_char(public._delay_today() + 5, 'FMMonth FMDD, YYYY'), coalesce(' DA note: ' || nullif(btrim(p_note), ''), '')), p.id);
end $$;

create or replace function public.delay_request_revision(p_case uuid, p_note text, p_reply_by date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.project_delay_cases; p public.fmr_projects;
begin
  perform public._delay_require_role('admin');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_decision']);
  if c.final_notice_missed then raise exception 'After a missed final notice, only Suspend or Terminate are allowed'; end if;
  if c.revision_count >= 1 then raise exception 'Only one revision is allowed per case'; end if;
  perform public._delay_check_reason(p_note, 'The revision note');
  perform public._delay_check_reply_by(p_reply_by);
  p := public._delay_lock_project(c.project_id);
  update public.project_delay_cases set status = 'revision_requested', revision_count = 1, reply_by = p_reply_by where id = c.id;
  perform public._delay_event(c.id, 'revision_requested', jsonb_build_object('note', btrim(p_note), 'reply_by', p_reply_by));
  perform public._delay_notify(p.contractor_id, 'contractor', 'delay_explanation_requested', 'Revise your delay explanation',
    format('"%s": the DA asks you to revise your explanation by %s. Note: %s', p.project_name,
      to_char(p_reply_by, 'FMMonth FMDD, YYYY'), btrim(p_note)), p.id);
end $$;

create or replace function public.delay_issue_final_notice(p_case uuid, p_note text, p_reply_by date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.project_delay_cases; p public.fmr_projects;
begin
  perform public._delay_require_role('admin');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_decision','no_response']);
  if c.final_notice_issued then raise exception 'A final notice was already issued for this case'; end if;
  perform public._delay_check_reason(p_note, 'The final notice');
  perform public._delay_check_reply_by(p_reply_by);
  p := public._delay_lock_project(c.project_id);
  if p.contractor_id is null then raise exception 'Assign a contractor first'; end if;
  update public.project_delay_cases set status = 'final_notice', final_notice_issued = true, reply_by = p_reply_by where id = c.id;
  perform public._delay_event(c.id, 'final_notice_issued', jsonb_build_object('note', btrim(p_note), 'reply_by', p_reply_by));
  perform public._priority_notify(p.contractor_id, 'delay_final_notice', 'Final notice',
    format('"%s": FINAL NOTICE. Reply by %s, or the project may be suspended or terminated. Note: %s', p.project_name,
      to_char(p_reply_by, 'FMMonth FMDD, YYYY'), btrim(p_note)), p.id);
end $$;

-- Extension: date, record, closure and history in ONE transaction (all or nothing).
create or replace function public.delay_grant_extension(p_case uuid, p_new_target_date date, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.project_delay_cases; p public.fmr_projects; v_current date; v_ext uuid; v_name text;
begin
  perform public._delay_require_role('admin');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_decision']);
  if c.final_notice_missed then raise exception 'After a missed final notice, only Suspend or Terminate are allowed'; end if;
  perform public._delay_check_reason(p_reason, 'The reason');
  p := public._delay_lock_project(c.project_id);
  v_current := public._delay_parse_date(p.target_completion_date);
  if v_current is null then raise exception 'The project''s current target date cannot be read. Fix it first.'; end if;
  if p_new_target_date is null or p_new_target_date <= public._delay_today() or p_new_target_date <= v_current then
    raise exception 'The new target date must be after today (%) and after the current target date (%)', public._delay_today(), v_current;
  end if;
  if public._delay_extensions_used(p.id) >= 2 then
    raise exception 'This project already has 2 approved extensions; no more can be granted';
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  perform public._delay_set_target(p.id, p_new_target_date);
  insert into public.project_time_extensions (project_id, days_granted, effective_date, reference_no, reason, approved_by, approved_by_name)
  values (p.id, p_new_target_date - v_current, null, null,
          format('Delay follow-up: extended from %s to %s. %s', v_current, p_new_target_date, btrim(p_reason)), auth.uid(), v_name)
  returning id into v_ext;
  perform public._delay_close(c.id, 'extended', p_reason, p_new_target_date, null, public._delay_today() - c.target_date_at_open,
    jsonb_build_object('previous_target', v_current, 'extension_id', v_ext, 'extension_number', public._delay_extensions_used(p.id) + 1));
end $$;

create or replace function public.delay_close_completed_late(p_case uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.project_delay_cases; p public.fmr_projects; v_target date;
begin
  perform public._delay_require_role('admin');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_request','awaiting_decision','no_response']);
  if c.final_notice_missed then raise exception 'After a missed final notice, only Suspend or Terminate are allowed'; end if;
  perform public._delay_check_reason(p_reason, 'The reason');
  p := public._delay_lock_project(c.project_id);
  v_target := coalesce(public._delay_parse_date(p.target_completion_date), c.target_date_at_open);
  perform public._delay_close(c.id, 'completed_late', p_reason, null, null, greatest(public._delay_today() - v_target, 0), null);
  update public.fmr_projects set status = 'Completed' where id = p.id;   -- the case is already closed: the trigger is a no-op
end $$;

create or replace function public.delay_suspend(p_case uuid, p_reason text, p_resume_date date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.project_delay_cases; p public.fmr_projects; v_susp uuid;
begin
  perform public._delay_require_role('admin');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_request','awaiting_decision','no_response']);
  perform public._delay_check_reason(p_reason, 'The reason');
  if p_resume_date is null or p_resume_date <= public._delay_today() then
    raise exception 'The expected resume date must be after today';
  end if;
  p := public._delay_lock_project(c.project_id);
  insert into public.project_suspensions (project_id, suspension_start, suspension_end, reason, expected_resume_date)
  values (p.id, public._delay_today(), null, btrim(p_reason), p_resume_date) returning id into v_susp;
  perform public._delay_close(c.id, 'suspended', p_reason, null, p_resume_date,
    public._delay_today() - c.target_date_at_open, jsonb_build_object('suspension_id', v_susp));
  update public.fmr_projects set status = 'Suspended' where id = p.id;
end $$;

create or replace function public.delay_terminate(p_case uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.project_delay_cases; p public.fmr_projects;
begin
  perform public._delay_require_role('admin');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_request','awaiting_decision','no_response']);
  perform public._delay_check_reason(p_reason, 'The reason');
  p := public._delay_lock_project(c.project_id);
  perform public._delay_close(c.id, 'terminated', p_reason, null, null, public._delay_today() - c.target_date_at_open, null);
  update public.fmr_projects set status = 'Terminated' where id = p.id;
end $$;

-- Resume: Suspended -> On-Going with a new target; recorded as a suspension-related extension
-- (suspension_id set). It does NOT count toward the 2-extension limit (the limit counts cases).
create or replace function public.delay_resume_project(p_project bigint, p_new_target_date date, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.fmr_projects; s public.project_suspensions; v_old date; v_ext uuid; v_name text; v_case uuid;
begin
  perform public._delay_require_role('admin');
  perform public._delay_check_reason(p_reason, 'The reason');
  p := public._delay_lock_project(p_project);
  if lower(btrim(coalesce(p.status, ''))) <> 'suspended' then raise exception 'Only a Suspended project can be resumed'; end if;
  select * into s from public.project_suspensions where project_id = p.id and suspension_end is null
   order by suspension_start desc limit 1 for update;
  if not found then raise exception 'No open suspension was found for this project'; end if;
  v_old := public._delay_parse_date(p.target_completion_date);
  if p_new_target_date is null or p_new_target_date <= public._delay_today()
     or (v_old is not null and p_new_target_date <= v_old) then
    raise exception 'The new target date must be after today and after the current target date';
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  perform public._delay_set_target(p.id, p_new_target_date);
  update public.fmr_projects set status = 'On-Going' where id = p.id;
  insert into public.project_time_extensions (project_id, days_granted, effective_date, reference_no, reason, approved_by, approved_by_name, suspension_id)
  values (p.id, greatest(p_new_target_date - coalesce(v_old, p_new_target_date), 0), null, null,
          format('Resumed after suspension (%s to %s): target %s -> %s. %s', s.suspension_start, public._delay_today(),
                 coalesce(v_old::text, 'none'), p_new_target_date, btrim(p_reason)), auth.uid(), v_name, s.id)
  returning id into v_ext;
  update public.project_suspensions set suspension_end = public._delay_today(), time_extension_ref = v_ext::text where id = s.id;
  select id into v_case from public.project_delay_cases where project_id = p.id and outcome = 'suspended' order by closed_at desc limit 1;
  if v_case is not null then
    perform public._delay_event(v_case, 'project_resumed', jsonb_build_object(
      'new_target_date', p_new_target_date, 'previous_target', v_old, 'suspension_id', s.id, 'extension_id', v_ext, 'reason', btrim(p_reason)));
  end if;
  perform public._delay_notify(p.contractor_id, 'contractor', 'delay_resumed', 'Project resumed',
    format('"%s" has resumed. New target completion date: %s.', p.project_name, to_char(p_new_target_date, 'FMMonth FMDD, YYYY')), p.id);
end $$;

-- A Suspended project is never a dead end: Resume (above), Extend the suspension (max 2 per
-- suspension), or Terminate. History goes on the case that suspended the project.
create or replace function public.delay_end_suspension(p_project bigint, p_action text, p_new_resume_date date, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.fmr_projects; s public.project_suspensions; v_case uuid; v_used int; v_old date;
begin
  perform public._delay_require_role('admin');
  perform public._delay_check_reason(p_reason, 'The reason');
  if p_action is null or p_action not in ('extend', 'terminate') then
    raise exception 'Choose extend or terminate';
  end if;
  p := public._delay_lock_project(p_project);
  if lower(btrim(coalesce(p.status, ''))) <> 'suspended' then raise exception 'This project is not Suspended'; end if;
  select * into s from public.project_suspensions where project_id = p.id and suspension_end is null
   order by suspension_start desc limit 1 for update;
  if not found then raise exception 'No open suspension was found for this project'; end if;
  select id, resume_date into v_case, v_old from public.project_delay_cases
   where project_id = p.id and outcome = 'suspended' order by closed_at desc limit 1;
  if v_case is null then raise exception 'This suspension was not made through the delay follow-up'; end if;
  v_old := coalesce(s.expected_resume_date, v_old);

  if p_action = 'extend' then
    select count(*) into v_used from public.project_delay_case_events
     where case_id = v_case and event_type = 'suspension_extended' and payload->>'suspension_id' = s.id::text;
    if v_used >= 2 then raise exception 'This suspension was already extended 2 times; resume or terminate the project'; end if;
    if p_new_resume_date is null or p_new_resume_date <= public._delay_today()
       or (v_old is not null and p_new_resume_date <= v_old) then
      raise exception 'The new expected resume date must be after today and after the current one';
    end if;
    update public.project_suspensions set expected_resume_date = p_new_resume_date where id = s.id;
    perform public._delay_event(v_case, 'suspension_extended', jsonb_build_object(
      'suspension_id', s.id, 'previous_resume_date', v_old, 'new_resume_date', p_new_resume_date,
      'extension_number', v_used + 1, 'reason', btrim(p_reason)));
    perform public._delay_notify(p.contractor_id, 'contractor', 'delay_suspension_extended', 'Suspension extended',
      format('"%s" stays suspended. New expected resume date: %s. Reason: %s', p.project_name,
        to_char(p_new_resume_date, 'FMMonth FMDD, YYYY'), btrim(p_reason)), p.id);
  else
    update public.project_suspensions set suspension_end = public._delay_today() where id = s.id;
    update public.fmr_projects set status = 'Terminated' where id = p.id;
    perform public._delay_event(v_case, 'suspension_terminated', jsonb_build_object(
      'suspension_id', s.id, 'reason', btrim(p_reason)));
    perform public._delay_notify(p.contractor_id, 'contractor', 'delay_case_closed', 'Project terminated',
      format('"%s" was terminated while suspended. Reason: %s', p.project_name, btrim(p_reason)), p.id);
  end if;
end $$;

-- 9. Contractor RPC ------------------------------------------------------------------
create or replace function public.delay_submit_explanation(
  p_case uuid, p_cause text, p_explanation text, p_proposed_date date, p_claimed_percent numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.project_delay_cases; p public.fmr_projects; v_round text;
begin
  perform public._delay_require_role('contractor');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_explanation','revision_requested','final_notice']);
  p := public._delay_lock_project(c.project_id);
  if p.contractor_id is null or p.contractor_id is distinct from auth.uid() then
    raise exception 'Only the project''s contractor can do this';
  end if;
  if p_cause is null or p_cause not in ('weather','right_of_way','materials','fund_release','design_change','other') then
    raise exception 'Choose the cause of the delay';
  end if;
  perform public._delay_check_reason(p_explanation, 'The explanation');
  if p_proposed_date is null or p_proposed_date <= public._delay_today() then
    raise exception 'The proposed completion date must be after today';
  end if;
  if p_claimed_percent is not null and (p_claimed_percent < 0 or p_claimed_percent > 100) then
    raise exception 'Claimed accomplishment must be between 0 and 100';
  end if;
  v_round := case c.status when 'revision_requested' then 'revision' when 'final_notice' then 'final_notice' else 'first' end;
  update public.project_delay_cases
     set status = 'awaiting_decision', decision_due = public._delay_today() + 5, cause = p_cause,
         explanation = nullif(btrim(p_explanation), ''), proposed_date = p_proposed_date,
         claimed_percent = p_claimed_percent, explained_at = now()
   where id = c.id;
  perform public._delay_event(c.id, 'explanation_submitted', jsonb_build_object(
    'round', v_round, 'cause', p_cause, 'explanation', nullif(btrim(p_explanation), ''),
    'proposed_date', p_proposed_date, 'claimed_percent', p_claimed_percent));
  perform public._priority_notify_admins('delay_explanation_submitted', 'Delay explanation received',
    format('"%s": the contractor explained the delay (%s; proposed date %s). Decide by %s.', p.project_name,
      replace(p_cause, '_', ' '), to_char(p_proposed_date, 'FMMonth FMDD, YYYY'),
      to_char(public._delay_today() + 5, 'FMMonth FMDD, YYYY')), p.id);
end $$;

-- 10. Field engineer RPC -------------------------------------------------------------
create or replace function public.delay_submit_verification(p_case uuid, p_verdict text, p_note text, p_photo_url text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.project_delay_cases; p public.fmr_projects;
begin
  perform public._delay_require_role('field_engineer');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_verification']);
  if c.verifier_id is null or c.verifier_id is distinct from auth.uid() then
    raise exception 'Only the assigned field engineer can do this';
  end if;
  if p_verdict is null or p_verdict not in ('agree','disagree') then raise exception 'Choose agree or disagree'; end if;
  perform public._delay_check_reason(p_note, 'The verification note');
  if nullif(btrim(p_photo_url), '') is not null
     and position(('/progress-photos/priority/' || auth.uid()::text || '/') in p_photo_url) = 0 then
    raise exception 'The photo must be taken with the KalsaTrack camera from your own account';
  end if;
  p := public._delay_lock_project(c.project_id);
  update public.project_delay_cases
     set status = 'awaiting_decision', decision_due = public._delay_today() + 5, verdict = p_verdict,
         verification_note = btrim(p_note), verification_photo_url = nullif(btrim(p_photo_url), ''), verified_at = now()
   where id = c.id;
  perform public._delay_event(c.id, 'verification_submitted', jsonb_build_object(
    'verdict', p_verdict, 'note', btrim(p_note), 'photo_url', nullif(btrim(p_photo_url), '')));
  perform public._priority_notify_admins('delay_verification_submitted', 'Delay verification received',
    format('"%s": the field engineer %s with the contractor''s explanation. Decide by %s.', p.project_name,
      case p_verdict when 'agree' then 'agrees' else 'disagrees' end, to_char(public._delay_today() + 5, 'FMMonth FMDD, YYYY')), p.id);
end $$;

-- 11. Privileges: REVOKE everything, then grant only what the client needs -----------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like '\_delay\_%' or p.proname like 'delay\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end $$;
grant execute on function public._delay_today() to authenticated;            -- used by the target-date lock trigger
grant execute on function public._delay_parse_date(text) to authenticated;   -- used by the target-date lock trigger
grant execute on function public._delay_can_view(bigint, uuid) to authenticated;   -- used by the RLS policies
grant execute on function public.delay_run_check_now() to authenticated;
grant execute on function public.delay_request_explanation(uuid, date, text) to authenticated;
grant execute on function public.delay_submit_explanation(uuid, text, text, date, numeric) to authenticated;
grant execute on function public.delay_request_verification(uuid, uuid, text) to authenticated;
grant execute on function public.delay_submit_verification(uuid, text, text, text) to authenticated;
grant execute on function public.delay_request_revision(uuid, text, date) to authenticated;
grant execute on function public.delay_issue_final_notice(uuid, text, date) to authenticated;
grant execute on function public.delay_grant_extension(uuid, date, text) to authenticated;
grant execute on function public.delay_close_completed_late(uuid, text) to authenticated;
grant execute on function public.delay_suspend(uuid, text, date) to authenticated;
grant execute on function public.delay_terminate(uuid, text) to authenticated;
grant execute on function public.delay_resume_project(bigint, date, text) to authenticated;
grant execute on function public.delay_end_suspension(bigint, text, date, text) to authenticated;
-- NOT granted: delay_detect_and_remind(), _delay_check(bigint) and all other helpers (postgres/cron only).

-- 12. Realtime (respects RLS) ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_delay_cases') then
    alter publication supabase_realtime add table public.project_delay_cases;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_delay_case_events') then
    alter publication supabase_realtime add table public.project_delay_case_events;
  end if;
end $$;

-- 13. Daily cron at 00:05 Asia/Manila (= 16:05 UTC). Only this job name is touched.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'project-delay-daily';
  perform cron.schedule('project-delay-daily', '5 16 * * *', 'select public.delay_detect_and_remind()');
end $$;
-- The priority_notify_overdue fix is NOT here: see supabase_priority_overdue_skip_suspended.sql.
