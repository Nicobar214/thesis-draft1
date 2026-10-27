-- =============================================================================
-- Priority action for an ongoing project: a short process with an END.
--
--   DA records action  ->  contractor commits (what + done-by date)  ->  DA marks
--   the result: Done / Not done  ->  closed, contractor told.        (END)
--
-- 1. priority_decisions: committed_by (date), outcome ('done' | 'not_done'),
--    outcome_note, outcome_at, outcome_by.
-- 2. respond_priority_action: a CONTRACTOR reply must say what they will do
--    (10+ characters) and by when (tomorrow .. 90 days). The site engineer's
--    inspection reply is unchanged (photos, no date). Old app builds that send
--    no date get a clear message.
-- 3. close_priority_action(id, outcome, note): the DA marks the result; "Not
--    done" needs a reason (10+ characters). Works with or without a reply.
-- 4. Guard: a new action clears the old commitment/result; a project with a
--    recorded action can only be closed WITH a result.
-- 5. The closing notice tells the contractor the result.
-- Functions are their live definitions (copied 2026-10-27) with changes marked
-- "ADDED" / "CHANGED". Run once in the Supabase SQL editor. Safe to run again.
-- =============================================================================

-- 1. Columns ------------------------------------------------------------------------
alter table public.priority_decisions add column if not exists committed_by date;
alter table public.priority_decisions add column if not exists outcome text;
alter table public.priority_decisions add column if not exists outcome_note text;
alter table public.priority_decisions add column if not exists outcome_at timestamptz;
alter table public.priority_decisions add column if not exists outcome_by uuid references auth.users(id);
alter table public.priority_decisions drop constraint if exists priority_decisions_outcome_check;
alter table public.priority_decisions add constraint priority_decisions_outcome_check check (outcome is null or outcome in ('done', 'not_done'));

-- 2. The reply, with a commitment ---------------------------------------------------
drop function if exists public.respond_priority_action(uuid, text, jsonb);
create or replace function public.respond_priority_action(p_decision_id uuid, p_note text, p_photos jsonb default '[]'::jsonb, p_committed_by date default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  d public.priority_decisions%rowtype;
  p public.fmr_projects%rowtype;
  v_inspection boolean;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  select * into d from public.priority_decisions where id = p_decision_id for update;
  if not found then raise exception 'Request not found'; end if;
  if d.candidate_kind <> 'project' or d.status <> 'action_recorded' then
    raise exception 'This project is not waiting for a reply';
  end if;
  select * into p from public.fmr_projects where id::text = d.candidate_id;
  v_inspection := d.action = 'Schedule site inspection';
  if not (
    (v_inspection and p.site_engineer_id = auth.uid())
    or (not v_inspection and p.contractor_id = auth.uid())
  ) then
    raise exception 'This action is for someone else';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'Write a short reply';
  end if;
  if v_inspection then
    perform public._check_priority_photos(p_photos, 'project', d.candidate_id);
  else
    -- ADDED: the contractor commits to what and by when.
    if length(btrim(p_note)) < 10 then
      raise exception 'Say what you will do (at least 10 characters)';
    end if;
    if p_committed_by is null then
      raise exception 'Set the date you will have it done by';
    end if;
    if p_committed_by <= v_today or p_committed_by > v_today + 90 then
      raise exception 'The done-by date must be from tomorrow up to 90 days from today';
    end if;
  end if;
  update public.priority_decisions
     set response_note = btrim(p_note), responded_by = auth.uid(), responded_at = now(),
         response_photos = case when v_inspection then p_photos else '[]'::jsonb end,
         committed_by = case when v_inspection then null else p_committed_by end   -- ADDED
   where id = p_decision_id;
end;
$function$;
grant execute on function public.respond_priority_action(uuid, text, jsonb, date) to authenticated;

-- 3. The DA marks the result (the END) ----------------------------------------------
create or replace function public.close_priority_action(p_decision_id uuid, p_outcome text, p_note text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare d public.priority_decisions%rowtype;
begin
  if public.current_profile_role() <> 'admin' then
    raise exception 'Only the DA admin can mark the result';
  end if;
  if p_outcome is null or p_outcome not in ('done', 'not_done') then
    raise exception 'Choose Done or Not done';
  end if;
  select * into d from public.priority_decisions where id = p_decision_id for update;
  if not found then raise exception 'Priority item not found'; end if;
  if d.candidate_kind <> 'project' or d.status <> 'action_recorded' then
    raise exception 'Only a project with a recorded action can be marked done or not done';
  end if;
  if p_outcome = 'not_done' and length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'Say why it was not done (at least 10 characters)';
  end if;
  update public.priority_decisions
     set status = 'closed', outcome = p_outcome, outcome_note = nullif(btrim(coalesce(p_note, '')), ''),
         outcome_at = now(), outcome_by = auth.uid()
   where id = p_decision_id;
end;
$function$;
revoke all on function public.close_priority_action(uuid, text, text) from public, anon;
grant execute on function public.close_priority_action(uuid, text, text) to authenticated;

-- 4. Guard ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.priority_decisions_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.candidate_kind = 'gap' and new.status = 'for_validation' and new.assigned_engineer_id is null then
    raise exception 'Choose the field engineer who will validate this road on site';
  end if;
  -- A new validation request needs a deadline that is not already past.
  if new.candidate_kind = 'gap' and new.status = 'for_validation'
     and (tg_op = 'INSERT' or old.status is distinct from 'for_validation') then
    if new.due_date is null then
      raise exception 'Set the date the field engineer should visit the road by';
    end if;
    if new.due_date < (now() at time zone 'Asia/Manila')::date then
      raise exception 'The validation deadline cannot be in the past';
    end if;
  end if;
  if new.candidate_kind = 'gap' and new.status = 'endorsed'
     and new.validation_result is distinct from 'confirmed' then
    raise exception 'A road can only be endorsed after the site validation confirms it';
  end if;
  if new.status = 'for_validation' and (tg_op = 'INSERT' or old.status is distinct from 'for_validation') then
    new.validation_result := null;
    new.validation_note := null;
    new.validated_at := null;
    new.validation_photos := '[]'::jsonb;
  end if;
  if new.status = 'action_recorded' and (tg_op = 'INSERT' or old.status is distinct from 'action_recorded') then
    new.response_note := null;
    new.responded_by := null;
    new.responded_at := null;
    new.response_photos := '[]'::jsonb;
    -- ADDED: a new action starts a new commitment and result.
    new.committed_by := null;
    new.outcome := null;
    new.outcome_note := null;
    new.outcome_at := null;
    new.outcome_by := null;
  end if;
  -- ADDED: a project's recorded action ends with a result (close_priority_action).
  if tg_op = 'UPDATE' and new.candidate_kind = 'project' and new.status = 'closed'
     and old.status = 'action_recorded' and new.outcome is null then
    raise exception 'Mark the result first: Done or Not done';
  end if;
  -- A new action needs a reply date that is not already past (optional).
  if new.status = 'action_recorded' and (tg_op = 'INSERT' or old.status is distinct from 'action_recorded')
     and new.reply_due_date is not null and new.reply_due_date < (now() at time zone 'Asia/Manila')::date then
    raise exception 'The reply date cannot be in the past';
  end if;
  -- Each new step starts its own overdue reminders.
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    new.overdue_notified_at := null;
  end if;
  return new;
end;
$function$;

-- 5. The closing notice says the result ---------------------------------------------
CREATE OR REPLACE FUNCTION public.priority_decisions_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project public.fmr_projects%rowtype;
  v_gap public.road_network_gaps%rowtype;
  v_name text;
  v_changed boolean := tg_op = 'INSERT' or old.status is distinct from new.status;
  v_note text := coalesce(nullif(btrim(new.note), ''), '');
begin
  if new.candidate_kind = 'project' then
    select * into v_project from public.fmr_projects where id::text = new.candidate_id;
    v_name := coalesce(v_project.project_name, 'your project');

    if v_changed and new.status = 'flagged' then
      perform public._priority_notify(v_project.contractor_id, 'priority_flagged',
        'DA flagged your project for priority attention',
        format('"%s" is on the DA priority list. A follow-up action will be sent to you.%s', v_name, case when v_note <> '' then ' Note: ' || v_note else '' end),
        v_project.id);
      perform public._priority_notify(v_project.site_engineer_id, 'priority_flagged',
        'Project flagged for priority attention',
        format('"%s", where you are the site engineer, is on the DA priority list.', v_name),
        v_project.id);
    elsif v_changed and new.status = 'action_recorded' then
      if new.action = 'Schedule site inspection' then
        perform public._priority_notify(v_project.site_engineer_id, 'priority_action',
          'Site inspection requested',
          format('The DA asks you to inspect "%s". Record the result in Priority Tasks.%s%s', v_name, case when new.reply_due_date is not null then ' Reply by ' || to_char(new.reply_due_date, 'FMMonth FMDD, YYYY') || '.' else '' end, case when v_note <> '' then ' Note: ' || v_note else '' end),
          v_project.id);
      else
        perform public._priority_notify(v_project.contractor_id, 'priority_action',
          coalesce(new.action, 'Action requested'),
          -- CHANGED: where to reply, and that a done-by date is asked
          format('DA action on "%s": %s. In Priority Tasks, say what you will do and by when.%s%s', v_name, coalesce(new.action, 'follow-up'), case when new.reply_due_date is not null then ' Reply by ' || to_char(new.reply_due_date, 'FMMonth FMDD, YYYY') || '.' else '' end, case when v_note <> '' then ' Note: ' || v_note else '' end),
          v_project.id);
      end if;
    elsif v_changed and new.status = 'closed' then
      -- CHANGED: say the result when there is one.
      if new.outcome is not null then
        perform public._priority_notify(v_project.contractor_id, 'priority_closed',
          case when new.outcome = 'done' then 'Priority action: done' else 'Priority action: not done' end,
          format('The DA marked "%s" (%s) as %s.%s', v_name, coalesce(new.action, 'priority action'),
            case when new.outcome = 'done' then 'done. Thank you' else 'not done' end,
            case when coalesce(btrim(new.outcome_note), '') <> '' then ' Note: ' || btrim(new.outcome_note) else '' end),
          v_project.id);
      else
        perform public._priority_notify(v_project.contractor_id, 'priority_closed',
          'Priority follow-up closed', format('The DA closed the priority follow-up on "%s".', v_name), v_project.id);
      end if;
      perform public._priority_notify(v_project.site_engineer_id, 'priority_closed',
        'Priority follow-up closed', format('The DA closed the priority follow-up on "%s".', v_name), v_project.id);
    end if;

    if tg_op = 'UPDATE' and new.responded_at is not null and old.responded_at is distinct from new.responded_at then
      perform public._priority_notify_admins('priority_response',
        'Reply to a priority action',
        -- CHANGED: include the commitment date
        format('"%s" (%s): %s%s', v_name, coalesce(new.action, 'action'), coalesce(new.response_note, ''),
          case when new.committed_by is not null then ' Done by ' || to_char(new.committed_by, 'FMMonth FMDD, YYYY') || '.' else '' end),
        v_project.id);
    end if;

  else
    select * into v_gap from public.road_network_gaps where id::text = new.candidate_id;
    v_name := coalesce(v_gap.source_road_name, v_gap.gap_code, 'a road gap');

    if v_changed and new.status = 'for_validation' then
      perform public._priority_notify(new.assigned_engineer_id, 'priority_validation',
        'Site validation requested',
        format('The DA asks you to confirm "%s" on site (%s km unpaved, %s) by %s. Answer in Priority Tasks.%s',
          v_name, coalesce(v_gap.gap_km::text, '?'), coalesce(v_gap.barangay, v_gap.municipality, 'Leon'),
          coalesce(to_char(new.due_date, 'FMMonth FMDD, YYYY'), 'the date set by the DA'),
          case when v_note <> '' then ' Note: ' || v_note else '' end),
        null);
    end if;

    if tg_op = 'UPDATE' and new.validated_at is not null and old.validated_at is distinct from new.validated_at then
      perform public._priority_notify_admins('priority_validated',
        case when new.validation_result = 'confirmed' then 'Road gap confirmed on site' else 'Road gap not as described' end,
        format('"%s": %s', v_name, coalesce(new.validation_note, '')),
        null);
    end if;
  end if;
  return new;
end;
$function$;

-- Checks (read-only):
-- select column_name from information_schema.columns where table_name = 'priority_decisions' and column_name in ('committed_by','outcome','outcome_note','outcome_at','outcome_by');
-- select pg_get_function_identity_arguments('public.respond_priority_action'::regproc);   -- includes p_committed_by date
