-- =============================================================================
-- priority_notify_overdue: skip "Reply overdue" reminders for projects that are
-- Suspended or Terminated. MODIFIES ONE EXISTING FUNCTION.
-- Run ONLY after supabase_project_delay_cases.sql and its checks passed.
-- This is the live definition (copied 2026-10-26) with exactly ONE added condition,
-- marked "ADDED" below. CREATE OR REPLACE keeps the existing owner and grants
-- (postgres, authenticated, service_role); the cron job is unchanged.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.priority_notify_overdue()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       -- ADDED: no reminders for Suspended or Terminated projects
       and not exists (select 1 from public.fmr_projects p
                        where p.id::text = d.candidate_id
                          and lower(btrim(coalesce(p.status, ''))) in ('suspended', 'terminated'))
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
$function$;
