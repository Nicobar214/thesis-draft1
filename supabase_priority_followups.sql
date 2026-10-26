-- Prioritization follow-ups: deadlines that are followed up.
--
-- Run AFTER supabase_priority_validation_deadline.sql. Safe to run again.
--
-- 1. "Reply by" date for a recorded action on an ongoing project. The
--    contractor / site engineer is told the date, and both sides see how many
--    days are left.
-- 2. Overdue reminders: once a day, an overdue site validation or reply
--    notifies the person it waits on and the DA admins (pg_cron, 08:00 PHT).
--    Admins can also trigger it (the Priority tab does so when it opens).
-- 3. overdue_notified_at keeps it to one reminder per item per day, and
--    resets whenever the item moves to a new step.

alter table public.priority_decisions
  add column if not exists reply_due_date date,
  add column if not exists overdue_notified_at timestamptz;

comment on column public.priority_decisions.reply_due_date is
  'Date the contractor / site engineer should reply to the recorded action by (action_recorded).';
comment on column public.priority_decisions.overdue_notified_at is
  'When the last overdue reminder was sent for the current step.';

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
          format('The DA asks you to inspect "%s". Record the result in Priority Tasks.%s%s', v_name, case when new.reply_due_date is not null then ' Reply by ' || to_char(new.reply_due_date, 'FMMonth FMDD, YYYY') || '.' else '' end, case when v_note <> '' then ' Note: ' || v_note else '' end),
          v_project.id);
      else
        perform public._priority_notify(v_project.contractor_id, 'priority_action',
          coalesce(new.action, 'Action requested'),
          format('DA action on "%s": %s. Please reply with your plan on your dashboard.%s%s', v_name, coalesce(new.action, 'follow-up'), case when new.reply_due_date is not null then ' Reply by ' || to_char(new.reply_due_date, 'FMMonth FMDD, YYYY') || '.' else '' end, case when v_note <> '' then ' Note: ' || v_note else '' end),
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

-- Overdue reminders (one per item per day).
create or replace function public.priority_notify_overdue()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.priority_decisions%rowtype;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_name text;
  v_project public.fmr_projects%rowtype;
  v_owner uuid;
  v_who text;
  v_count integer := 0;
begin
  -- pg_cron runs without a user; a signed-in caller must be an admin.
  if auth.uid() is not null and public.public_report_current_role() <> 'admin' then
    raise exception 'Only the DA admin can send priority reminders';
  end if;

  for r in
    select * from public.priority_decisions d
     where d.status = 'for_validation' and d.validated_at is null
       and d.due_date is not null and d.due_date < v_today
       and (d.overdue_notified_at is null or (d.overdue_notified_at at time zone 'Asia/Manila')::date < v_today)
  loop
    select coalesce(g.source_road_name, g.gap_code, 'a road gap') into v_name
      from public.road_network_gaps g where g.id::text = r.candidate_id;
    perform public._priority_notify(r.assigned_engineer_id, 'priority_overdue',
      'Site validation overdue',
      format('The site validation of "%s" was due %s (%s day(s) ago). Please visit the road and answer in Priority Tasks.',
        coalesce(v_name, 'a road gap'), to_char(r.due_date, 'FMMonth FMDD, YYYY'), v_today - r.due_date),
      null);
    perform public._priority_notify_admins('priority_overdue',
      'Site validation overdue',
      format('"%s": the site validation was due %s and has no answer yet.', coalesce(v_name, 'a road gap'), to_char(r.due_date, 'FMMonth FMDD, YYYY')),
      null);
    update public.priority_decisions set overdue_notified_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;

  for r in
    select * from public.priority_decisions d
     where d.status = 'action_recorded' and d.responded_at is null
       and d.reply_due_date is not null and d.reply_due_date < v_today
       and (d.overdue_notified_at is null or (d.overdue_notified_at at time zone 'Asia/Manila')::date < v_today)
  loop
    select * into v_project from public.fmr_projects where id::text = r.candidate_id;
    if r.action = 'Schedule site inspection' then
      v_owner := v_project.site_engineer_id; v_who := 'site engineer';
    else
      v_owner := v_project.contractor_id; v_who := 'contractor';
    end if;
    perform public._priority_notify(v_owner, 'priority_overdue',
      'Reply overdue',
      format('Your reply to the DA''s "%s" request on "%s" was due %s. Please reply on your dashboard.',
        coalesce(r.action, 'follow-up'), coalesce(v_project.project_name, 'your project'), to_char(r.reply_due_date, 'FMMonth FMDD, YYYY')),
      v_project.id);
    perform public._priority_notify_admins('priority_overdue',
      'Reply overdue',
      format('"%s": the %s''s reply to "%s" was due %s and has not come in.',
        coalesce(v_project.project_name, 'a project'), v_who, coalesce(r.action, 'follow-up'), to_char(r.reply_due_date, 'FMMonth FMDD, YYYY')),
      v_project.id);
    update public.priority_decisions set overdue_notified_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.priority_notify_overdue() from public, anon;
grant execute on function public.priority_notify_overdue() to authenticated;

-- Every day at 08:00 Philippine time (00:00 UTC).
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'priority-overdue-reminders';
  perform cron.schedule('priority-overdue-reminders', '0 0 * * *', 'select public.priority_notify_overdue();');
end;
$$;
