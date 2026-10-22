-- Field engineer and contractor steps in the prioritization process, with
-- notifications. Run once in the Supabase SQL editor, after
-- supabase_priority_decisions.sql.
--
--   New road (gap):  admin "Send for site validation" picks a field engineer
--                    -> engineer is notified, checks the gap on site and
--                       answers Confirmed / Not as described (+ note)
--                    -> admins are notified; Endorse needs a Confirmed answer.
--   Ongoing project: admin "Flag for action" -> contractor and site engineer
--                    are notified. "Record action" -> the one who must act is
--                    notified (Expedite contractor / Prioritize fund release:
--                    contractor; Schedule site inspection: site engineer) and
--                    answers with a short response -> admins are notified.
--                    "Close" -> both are told.

-- 1. Who validates, what they found, and the reply to an action
alter table public.priority_decisions
  add column if not exists assigned_engineer_id uuid references auth.users(id) on delete set null,
  add column if not exists validation_result text check (validation_result in ('confirmed', 'not_confirmed')),
  add column if not exists validation_note text,
  add column if not exists validated_at timestamptz,
  add column if not exists response_note text,
  add column if not exists responded_by uuid references auth.users(id) on delete set null,
  add column if not exists responded_at timestamptz;

-- 2. Contractors can see the decisions about their own projects
drop policy if exists priority_decisions_select_contractor on public.priority_decisions;
create policy priority_decisions_select_contractor on public.priority_decisions
  for select to authenticated
  using (
    candidate_kind = 'project'
    and exists (
      select 1 from public.fmr_projects p
       where p.id::text = priority_decisions.candidate_id and p.contractor_id = auth.uid()
    )
  );

-- 3. Rules the app cannot skip
create or replace function public.priority_decisions_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.candidate_kind = 'gap' and new.status = 'for_validation' and new.assigned_engineer_id is null then
    raise exception 'Choose the field engineer who will validate this road on site';
  end if;
  if new.candidate_kind = 'gap' and new.status = 'endorsed'
     and new.validation_result is distinct from 'confirmed' then
    raise exception 'A road can only be endorsed after the site validation confirms it';
  end if;
  -- Sending (again) for validation starts a fresh check.
  if new.status = 'for_validation' and (tg_op = 'INSERT' or old.status is distinct from 'for_validation') then
    new.validation_result := null;
    new.validation_note := null;
    new.validated_at := null;
  end if;
  -- Recording a new action waits for a new reply.
  if new.status = 'action_recorded' and (tg_op = 'INSERT' or old.status is distinct from 'action_recorded') then
    new.response_note := null;
    new.responded_by := null;
    new.responded_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists priority_decisions_guard on public.priority_decisions;
create trigger priority_decisions_guard
  before insert or update on public.priority_decisions
  for each row execute function public.priority_decisions_guard();

-- 4. Notifications for every step that involves someone else
create or replace function public._priority_notify(p_user uuid, p_type text, p_title text, p_message text, p_project bigint)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.notifications (user_id, type, title, message, project_id, is_read, created_at)
  select p_user, p_type, p_title, p_message, p_project, false, now()
   where p_user is not null;
$$;

create or replace function public._priority_notify_admins(p_type text, p_title text, p_message text, p_project bigint)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.notifications (user_id, type, title, message, project_id, is_read, created_at)
  select id, p_type, p_title, p_message, p_project, false, now()
    from public.profiles where role = 'admin';
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
        format('The DA asks you to confirm "%s" on site (%s km unpaved, %s). Answer in Priority Tasks.%s',
          v_name, coalesce(v_gap.gap_km::text, '?'), coalesce(v_gap.barangay, v_gap.municipality, 'Leon'),
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

-- 5. The engineer answers a site validation
create or replace function public.submit_priority_validation(p_decision_id uuid, p_result text, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d public.priority_decisions%rowtype;
begin
  select * into d from public.priority_decisions where id = p_decision_id for update;
  if not found then raise exception 'Request not found'; end if;
  if d.assigned_engineer_id is distinct from auth.uid() then
    raise exception 'Only the engineer asked to validate this road can answer';
  end if;
  if d.status <> 'for_validation' then
    raise exception 'This road is no longer waiting for site validation';
  end if;
  if p_result not in ('confirmed', 'not_confirmed') then
    raise exception 'Answer Confirmed or Not as described';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'Add a short note on what you found on site';
  end if;
  update public.priority_decisions
     set validation_result = p_result, validation_note = btrim(p_note), validated_at = now()
   where id = p_decision_id;
end;
$$;

-- 6. The contractor or site engineer replies to a recorded action
create or replace function public.respond_priority_action(p_decision_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d public.priority_decisions%rowtype;
  p public.fmr_projects%rowtype;
begin
  select * into d from public.priority_decisions where id = p_decision_id for update;
  if not found then raise exception 'Request not found'; end if;
  if d.candidate_kind <> 'project' or d.status <> 'action_recorded' then
    raise exception 'This project is not waiting for a reply';
  end if;
  select * into p from public.fmr_projects where id::text = d.candidate_id;
  if not (
    (d.action = 'Schedule site inspection' and p.site_engineer_id = auth.uid())
    or (d.action is distinct from 'Schedule site inspection' and p.contractor_id = auth.uid())
  ) then
    raise exception 'This action is for someone else';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'Write a short reply';
  end if;
  update public.priority_decisions
     set response_note = btrim(p_note), responded_by = auth.uid(), responded_at = now()
   where id = p_decision_id;
end;
$$;

revoke all on function public.submit_priority_validation(uuid, text, text) from public, anon;
grant execute on function public.submit_priority_validation(uuid, text, text) to authenticated;
revoke all on function public.respond_priority_action(uuid, text) from public, anon;
grant execute on function public.respond_priority_action(uuid, text) to authenticated;
revoke all on function public._priority_notify(uuid, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public._priority_notify_admins(text, text, text, bigint) from public, anon, authenticated;
