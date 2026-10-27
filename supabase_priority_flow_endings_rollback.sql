-- =============================================================================
-- ROLLBACK of supabase_priority_flow_endings.sql: puts back the definitions that
-- were live on 2026-10-28. Refuses to run while any road is 'dropped' (those rows
-- would break the old status rules): undo or delete them first.
-- =============================================================================

do $$
begin
  if exists (select 1 from public.priority_decisions where status = 'dropped') then
    raise exception 'Some roads are dropped. Delete or change those priority_decisions rows first';
  end if;
end $$;

drop function if exists public.priority_lgu_recipients(text);

alter table public.priority_decisions drop constraint if exists priority_decisions_drop_reason_check;
alter table public.priority_decisions drop column if exists drop_reason;

alter table public.priority_decisions drop constraint if exists priority_decisions_status_check;
alter table public.priority_decisions add constraint priority_decisions_status_check check (status in (
  'shortlisted', 'for_validation', 'endorsed', 'converted',
  'flagged', 'action_recorded', 'closed', 'deferred'
));
alter table public.priority_decisions drop constraint if exists priority_decisions_check;
alter table public.priority_decisions add constraint priority_decisions_check check (
  status = 'deferred'
  or (candidate_kind = 'gap' and status in ('shortlisted', 'for_validation', 'endorsed', 'converted'))
  or (candidate_kind = 'project' and status in ('flagged', 'action_recorded', 'closed'))
);

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

notify pgrst, 'reload schema';
