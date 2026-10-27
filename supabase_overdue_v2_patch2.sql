-- =============================================================================
-- Overdue process v2 — patch 2: supporting evidence for an ACT OF NATURE.
--
-- 1. Each evidence file has a type: 'document' (PAGASA/NDRRMC advisory, LGU or
--    barangay notice/certification) or 'photo' (photos of what happened).
-- 2. An act-of-nature claim needs at least ONE official document (photos alone
--    are not enough).
-- 3. While an act-of-nature claim is with the DA or the field engineer, the
--    contractor can still SEND MORE evidence (one notice to the DA and the
--    engineer per upload). Manpower rounds are unchanged.
-- Run after supabase_overdue_v2.sql. Safe to run again.
-- =============================================================================

-- 1. Evidence type ------------------------------------------------------------------
alter table public.project_delay_evidence add column if not exists category text;
alter table public.project_delay_evidence drop constraint if exists project_delay_evidence_category_check;
alter table public.project_delay_evidence add constraint project_delay_evidence_category_check
  check (category is null or category in ('document', 'photo'));

-- 2. Who may add evidence, and when --------------------------------------------------
CREATE OR REPLACE FUNCTION public._delay_can_add_evidence(p_case uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.project_delay_cases c join public.fmr_projects p on p.id = c.project_id
     where c.id = p_case and auth.uid() is not null and p.contractor_id = auth.uid()
       and (c.status in ('awaiting_explanation', 'revision_requested', 'final_notice')
            -- ADDED: more evidence for an act-of-nature claim while it is reviewed.
            or (c.kind = 'act_of_nature' and c.status in ('awaiting_decision', 'awaiting_verification'))));
$function$;

-- 3. One notice when evidence is added after the claim was sent ----------------------
create or replace function public._delay_evidence_added()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare r record;
begin
  for r in
    select a.case_id, count(*) n, c.status, c.verifier_id, p.id project_id, p.project_name
      from added a join public.project_delay_cases c on c.id = a.case_id join public.fmr_projects p on p.id = c.project_id
     where c.kind = 'act_of_nature' and c.status in ('awaiting_decision', 'awaiting_verification')
     group by a.case_id, c.status, c.verifier_id, p.id, p.project_name
  loop
    perform public._delay_event(r.case_id, 'evidence_added', jsonb_build_object('count', r.n));
    perform public._priority_notify_admins('delay_evidence_added', 'More act-of-nature evidence',
      format('"%s": the contractor sent %s more evidence file(s) for the act-of-nature claim.', r.project_name, r.n), r.project_id);
    if r.status = 'awaiting_verification' and r.verifier_id is not null then
      perform public._priority_notify(r.verifier_id, 'delay_evidence_added', 'More evidence for your site check',
        format('"%s": the contractor sent %s more evidence file(s). See them in Priority Tasks before your check.', r.project_name, r.n), r.project_id);
    end if;
  end loop;
  return null;
end $function$;
drop trigger if exists trg_delay_evidence_added on public.project_delay_evidence;
create trigger trg_delay_evidence_added after insert on public.project_delay_evidence
  referencing new table as added for each statement execute function public._delay_evidence_added();

-- 4. The commitment: an act of nature needs an official document ---------------------
CREATE OR REPLACE FUNCTION public.delay_submit_commitment(p_case uuid, p_cause text, p_explanation text, p_new_date date,
                                                         p_event_name text default null, p_stopped_days int default null)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
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
    -- CHANGED: at least one official document (photos alone are not enough).
    if not exists (select 1 from public.project_delay_evidence e where e.case_id = c.id and e.category = 'document') then
      raise exception 'Attach at least one official document (PAGASA/NDRRMC advisory, or an LGU or barangay notice or certification)';
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
    'event_name', nullif(btrim(coalesce(p_event_name, '')), ''), 'stopped_days', p_stopped_days, 'offense_no', c.offense_no,
    'documents', (select count(*) from public.project_delay_evidence e where e.case_id = c.id and e.category = 'document'),
    'photos', (select count(*) from public.project_delay_evidence e where e.case_id = c.id and e.category is distinct from 'document')));
  perform public._priority_notify_admins('delay_explanation_submitted', 'Delay commitment received',
    format('"%s": %s. New finish date %s. %s Decide by %s.', p.project_name,
      case when p_cause = 'act_of_nature' then format('Act of nature (%s, %s day(s) stopped)', btrim(p_event_name), p_stopped_days)
           else format('Manpower, Offense %s of 3', c.offense_no) end,
      to_char(p_new_date, 'FMMonth FMDD, YYYY'),
      case when p_cause = 'act_of_nature' or c.offense_no = 3 then 'Send it to the field engineer first.' else '' end,
      to_char(v_today + 5, 'FMMonth FMDD, YYYY')), p.id);
end $function$;

notify pgrst, 'reload schema';

-- Checks (read-only):
-- select column_name from information_schema.columns where table_name = 'project_delay_evidence' and column_name = 'category';
-- select tgname from pg_trigger where tgname = 'trg_delay_evidence_added';
