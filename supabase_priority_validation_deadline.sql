-- Deadline for a road-gap site validation.
--
-- When the DA sends a ranked road gap to a field engineer for site validation,
-- it now sets the date the engineer should visit the road by (due_date). The
-- engineer's notification states the date, and the Priority Tasks card shows
-- how many days are left (or that it is overdue).
--
-- Run AFTER supabase_priority_photos.sql (this keeps its guard and adds the
-- deadline check). Safe to run more than once.

alter table public.priority_decisions
  add column if not exists due_date date;

comment on column public.priority_decisions.due_date is
  'Date the assigned field engineer should validate the road gap on site by (for_validation).';

create or replace function public.priority_decisions_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
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
  end if;
  return new;
end;
$$;

create or replace function public.priority_decisions_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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
          format('The DA asks you to inspect "%s". Record the result in Priority Tasks.%s', v_name, case when v_note <> '' then ' Note: ' || v_note else '' end),
          v_project.id);
      else
        perform public._priority_notify(v_project.contractor_id, 'priority_action',
          coalesce(new.action, 'Action requested'),
          format('DA action on "%s": %s. Please reply with your plan on your dashboard.%s', v_name, coalesce(new.action, 'follow-up'), case when v_note <> '' then ' Note: ' || v_note else '' end),
          v_project.id);
      end if;
    elsif v_changed and new.status = 'closed' then
      perform public._priority_notify(v_project.contractor_id, 'priority_closed',
        'Priority follow-up closed', format('The DA closed the priority follow-up on "%s".', v_name), v_project.id);
      perform public._priority_notify(v_project.site_engineer_id, 'priority_closed',
        'Priority follow-up closed', format('The DA closed the priority follow-up on "%s".', v_name), v_project.id);
    end if;

    if tg_op = 'UPDATE' and new.responded_at is not null and old.responded_at is distinct from new.responded_at then
      perform public._priority_notify_admins('priority_response',
        'Reply to a priority action',
        format('"%s" (%s): %s', v_name, coalesce(new.action, 'action'), coalesce(new.response_note, '')),
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
$$;

drop trigger if exists priority_decisions_notify on public.priority_decisions;
create trigger priority_decisions_notify
  after insert or update on public.priority_decisions
  for each row execute function public.priority_decisions_notify();
