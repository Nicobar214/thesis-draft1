-- =============================================================================
-- Prioritization: every path ends in a recorded result (src/lib/priorityDecisions.js).
--
--   New road:  ranked -> for evaluation -> for site validation
--                -> confirmed:      LGU notified -> project created   (END)
--                -> not confirmed:  dropped, with a reason            (END)
--   Ongoing:   ranked -> prioritized (contractor sees a DA PRIORITY badge)
--                -> ended: project completed, or priority removed      (END)
--
-- 1. New status 'dropped' (new roads only) and drop_reason. Only after the field
--    engineer answered "Not as described", with a reason code and a note.
--    A dropped road is final.
-- 2. "Endorsed" (the stored value is unchanged) now means "LGU notified": every
--    LGU account of the road's municipality gets a notice that a project will start.
-- 3. A prioritized project ends with a reason (completed / priority removed).
-- 4. Notice wording for prioritized / ended projects.
-- Stored values (shortlisted, endorsed, flagged, ...) are NOT renamed; only screen
-- text changes. Functions are their live definitions (copied 2026-10-28) with
-- changes marked "ADDED" / "CHANGED". Run once in the Supabase SQL editor. Safe to
-- run again. Rollback: supabase_priority_flow_endings_rollback.sql
-- =============================================================================

-- 1. Status and column ----------------------------------------------------------------
alter table public.priority_decisions drop constraint if exists priority_decisions_status_check;
alter table public.priority_decisions add constraint priority_decisions_status_check check (status in (
  'shortlisted', 'for_validation', 'endorsed', 'converted', 'dropped',
  'flagged', 'action_recorded', 'closed', 'deferred'
));
alter table public.priority_decisions drop constraint if exists priority_decisions_check;
alter table public.priority_decisions add constraint priority_decisions_check check (
  status = 'deferred'
  or (candidate_kind = 'gap' and status in ('shortlisted', 'for_validation', 'endorsed', 'converted', 'dropped'))
  or (candidate_kind = 'project' and status in ('flagged', 'action_recorded', 'closed'))
);

alter table public.priority_decisions add column if not exists drop_reason text;
alter table public.priority_decisions drop constraint if exists priority_decisions_drop_reason_check;
alter table public.priority_decisions add constraint priority_decisions_drop_reason_check check (
  drop_reason is null or drop_reason in ('already_paved', 'not_fmr', 'right_of_way', 'duplicate', 'other')
);

-- 2. Guard ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.priority_decisions_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- ADDED: a dropped road is final.
  if tg_op = 'UPDATE' and old.status = 'dropped' and new.status is distinct from 'dropped' then
    raise exception 'This road was dropped. Its decision is final';
  end if;
  -- ADDED: drop only after the engineer answered "Not as described", with a reason.
  if new.status = 'dropped' and (tg_op = 'INSERT' or old.status is distinct from 'dropped') then
    if tg_op = 'INSERT' or old.status <> 'for_validation' or old.validation_result is distinct from 'not_confirmed' then
      raise exception 'A road can only be dropped after the site validation found it not as described';
    end if;
    if new.drop_reason is null then
      raise exception 'Choose why the road is dropped';
    end if;
    if length(btrim(coalesce(new.note, ''))) < 10 then
      raise exception 'Say why the road is dropped (at least 10 characters)';
    end if;
  end if;
  -- ADDED: a prioritized project ends with a reason.
  if tg_op = 'UPDATE' and new.candidate_kind = 'project' and new.status = 'closed'
     and old.status = 'flagged' and coalesce(btrim(new.note), '') = '' then
    raise exception 'Say why the priority ends';
  end if;
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
    -- CHANGED: wording ("endorsed" is shown as "LGU notified")
    raise exception 'The LGU can only be notified after the site validation confirms the road';
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
    -- a new action starts a new commitment and result.
    new.committed_by := null;
    new.outcome := null;
    new.outcome_note := null;
    new.outcome_at := null;
    new.outcome_by := null;
  end if;
  -- a project's recorded action ends with a result (close_priority_action).
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

-- 3. Notices --------------------------------------------------------------------------
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
  v_lgu record;          -- ADDED
  v_place text;          -- ADDED
begin
  if new.candidate_kind = 'project' then
    select * into v_project from public.fmr_projects where id::text = new.candidate_id;
    v_name := coalesce(v_project.project_name, 'your project');

    if v_changed and new.status = 'flagged' then
      -- CHANGED: prioritized is the whole request; nothing else follows.
      perform public._priority_notify(v_project.contractor_id, 'priority_flagged',
        'Your project is a DA priority',
        format('"%s" is a DA priority project: the DA ranked it among the most valuable roads to finish. Please give it priority in your work.%s', v_name, case when v_note <> '' then ' Note: ' || v_note else '' end),
        v_project.id);
      perform public._priority_notify(v_project.site_engineer_id, 'priority_flagged',
        'Project is a DA priority',
        format('"%s", where you are the site engineer, is a DA priority project.', v_name),
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
          format('DA action on "%s": %s. In Priority Tasks, say what you will do and by when.%s%s', v_name, coalesce(new.action, 'follow-up'), case when new.reply_due_date is not null then ' Reply by ' || to_char(new.reply_due_date, 'FMMonth FMDD, YYYY') || '.' else '' end, case when v_note <> '' then ' Note: ' || v_note else '' end),
          v_project.id);
      end if;
    elsif v_changed and new.status = 'closed' then
      if new.outcome is not null then
        perform public._priority_notify(v_project.contractor_id, 'priority_closed',
          case when new.outcome = 'done' then 'Priority action: done' else 'Priority action: not done' end,
          format('The DA marked "%s" (%s) as %s.%s', v_name, coalesce(new.action, 'priority action'),
            case when new.outcome = 'done' then 'done. Thank you' else 'not done' end,
            case when coalesce(btrim(new.outcome_note), '') <> '' then ' Note: ' || btrim(new.outcome_note) else '' end),
          v_project.id);
      else
        -- CHANGED: a prioritized project ended; say why.
        perform public._priority_notify(v_project.contractor_id, 'priority_closed',
          'DA priority ended', format('The DA priority on "%s" has ended.%s', v_name, case when v_note <> '' then ' ' || v_note else '' end), v_project.id);
      end if;
      perform public._priority_notify(v_project.site_engineer_id, 'priority_closed',
        'DA priority ended', format('The DA priority on "%s" has ended.%s', v_name, case when v_note <> '' then ' ' || v_note else '' end), v_project.id);
    end if;

    if tg_op = 'UPDATE' and new.responded_at is not null and old.responded_at is distinct from new.responded_at then
      perform public._priority_notify_admins('priority_response',
        'Reply to a priority action',
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

    -- ADDED: "endorsed" = LGU notified. Every LGU account of the road's municipality.
    if v_changed and new.status = 'endorsed' then
      v_place := concat_ws(' to ', 'Brgy. ' || nullif(btrim(v_gap.barangay), ''), 'Brgy. ' || nullif(btrim(v_gap.barangay_end), ''));
      for v_lgu in
        select id from public.profiles
         where role = 'lgu'
           and lower(btrim(coalesce(municipality, ''))) = lower(btrim(coalesce(v_gap.municipality, 'Leon')))
      loop
        perform public._priority_notify(v_lgu.id, 'priority_lgu_upcoming',
          format('Upcoming FMR project in %s', coalesce(nullif(btrim(v_gap.municipality), ''), 'Leon')),
          format('The DA will start a farm-to-market road project in your municipality: "%s"%s, %s km. It was confirmed on site%s. Project details will follow once it is created.%s',
            v_name,
            case when v_place <> '' then ', ' || v_place else '' end,
            coalesce(v_gap.gap_km::text, '?'),
            case when new.validated_at is not null then ' on ' || to_char(new.validated_at at time zone 'Asia/Manila', 'FMMonth FMDD, YYYY') else '' end,
            case when v_note <> '' then ' Note: ' || v_note else '' end),
          null);
      end loop;
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

-- ADDED: how many LGU accounts a road's notice reaches (for the admin's confirmation).
create or replace function public.priority_lgu_recipients(p_municipality text)
 returns integer
 language sql
 stable
 security definer
 set search_path to 'public'
as $$
  select case when public.current_profile_role() = 'admin' then (
    select count(*)::int from public.profiles
     where role = 'lgu'
       and lower(btrim(coalesce(municipality, ''))) = lower(btrim(coalesce(p_municipality, 'Leon')))
  ) end;
$$;
revoke all on function public.priority_lgu_recipients(text) from public, anon;
grant execute on function public.priority_lgu_recipients(text) to authenticated;

notify pgrst, 'reload schema';

-- Checks (read-only):
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.priority_decisions'::regclass and contype = 'c';
-- select column_name from information_schema.columns where table_name = 'priority_decisions' and column_name = 'drop_reason';
-- select prosrc like '%priority_lgu_upcoming%' from pg_proc where proname = 'priority_decisions_notify';
