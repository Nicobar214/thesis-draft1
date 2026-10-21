-- ============================================================
-- Overdue alerts: deadlines that actually do something.
--
-- Until now an overdue site visit or repair only showed a red badge. This
-- adds a job that runs every hour and sends notifications, once per item and
-- stage, so nobody is spammed:
--
--   Site visit overdue (report assigned, visit_deadline passed)
--     stage 'due'        -> the assigned field engineer + all admins
--     stage 'escalated'  -> all admins, once it is 3+ days overdue (reassign?)
--   Repair overdue (repair action still 'planned', target_date passed)
--     stage 'due'        -> all admins + the LGU or contractor handling it
--     stage 'escalated'  -> all admins, at 3+ days overdue
--   (The handler is found with supabase_report_handlers.sql; skipped until that runs.)
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- If "create extension pg_cron" fails, switch it on first:
--   Dashboard -> Database -> Extensions -> pg_cron -> Enable, then run again.
-- The admin dashboard also calls notify_overdue_items() when it opens, as a backup.
-- ============================================================

create table if not exists public.overdue_alerts (
  kind     text not null,                 -- 'visit' | 'repair'
  ref_id   text not null,                 -- report id or repair action id
  stage    text not null,                 -- 'due' | 'escalated'
  sent_at  timestamptz not null default now(),
  primary key (kind, ref_id, stage)
);
alter table public.overdue_alerts enable row level security;
-- No policies: only the function below reads or writes it.

create or replace function public.notify_overdue_items()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sent int := 0;
  r record;
  v_days int;
  v_stage text;
begin
  -- Signed-in callers must be admins. The hourly cron job runs with no
  -- signed-in user (auth.uid() is null) and is allowed.
  if auth.uid() is not null and coalesce(public.current_profile_role(), '') <> 'admin' then
    return jsonb_build_object('skipped', 'admin only');
  end if;

  -- 1) Site visits past their deadline.
  for r in
    select pr.id as report_id,
           pr.assigned_engineer_id,
           coalesce(nullif(pr.project_name, ''), 'a road report') as project_name,
           m.visit_deadline
    from public.public_reports pr
    join public.public_report_workflow_meta m on m.report_id = pr.id
    where m.visit_deadline is not null
      and m.visit_deadline < current_date
      and pr.engineer_status in ('assigned', 'in_progress')
      and coalesce(pr.status, '') not in ('resolved', 'dismissed')
  loop
    v_days := current_date - r.visit_deadline;
    v_stage := case when v_days >= 3 then 'escalated' else 'due' end;

    -- 'due' is always sent first; an item found already 3+ days late gets both.
    if not exists (select 1 from public.overdue_alerts where kind = 'visit' and ref_id = r.report_id::text and stage = 'due') then
      insert into public.overdue_alerts (kind, ref_id, stage) values ('visit', r.report_id::text, 'due');
      if r.assigned_engineer_id is not null then
        insert into public.notifications (user_id, type, title, message, report_id, is_read)
        values (r.assigned_engineer_id, 'public_report_overdue', 'Site visit overdue',
                format('The site visit for %s was due on %s. Please inspect it as soon as possible.',
                       r.project_name, to_char(r.visit_deadline, 'Mon DD, YYYY')),
                r.report_id, false);
      end if;
      insert into public.notifications (user_id, type, title, message, report_id, is_read)
      select p.id, 'public_report_overdue', 'Site visit overdue',
             format('The site visit for %s was due on %s and has not been done yet.',
                    r.project_name, to_char(r.visit_deadline, 'Mon DD, YYYY')),
             r.report_id, false
      from public.profiles p where p.role = 'admin';
      v_sent := v_sent + 1;
    end if;

    if v_stage = 'escalated'
       and not exists (select 1 from public.overdue_alerts where kind = 'visit' and ref_id = r.report_id::text and stage = 'escalated') then
      insert into public.overdue_alerts (kind, ref_id, stage) values ('visit', r.report_id::text, 'escalated');
      insert into public.notifications (user_id, type, title, message, report_id, is_read)
      select p.id, 'public_report_overdue', 'Site visit 3+ days overdue',
             format('The site visit for %s is %s days overdue. Consider reassigning the field engineer.',
                    r.project_name, v_days),
             r.report_id, false
      from public.profiles p where p.role = 'admin';
      v_sent := v_sent + 1;
    end if;
  end loop;

  -- 2) Repairs past their target date.
  for r in
    select a.id as action_id,
           a.report_id,
           a.responsible_party,
           a.target_date,
           coalesce(nullif(pr.project_name, ''), 'a road report') as project_name
    from public.public_report_repair_actions a
    join public.public_reports pr on pr.id = a.report_id
    where a.status = 'planned'
      and a.target_date is not null
      and a.target_date < current_date
  loop
    v_days := current_date - r.target_date;
    v_stage := case when v_days >= 3 then 'escalated' else 'due' end;

    if not exists (select 1 from public.overdue_alerts where kind = 'repair' and ref_id = r.action_id::text and stage = 'due') then
      insert into public.overdue_alerts (kind, ref_id, stage) values ('repair', r.action_id::text, 'due');
      insert into public.notifications (user_id, type, title, message, report_id, is_read)
      select p.id, 'repair_overdue', 'Repair overdue',
             format('The repair for %s (%s) was due on %s and is not marked complete.',
                    r.project_name, upper(coalesce(r.responsible_party, '')), to_char(r.target_date, 'Mon DD, YYYY')),
             r.report_id, false
      from public.profiles p where p.role = 'admin';
      -- The LGU or contractor who owes the after-photo.
      if r.responsible_party in ('lgu', 'contractor')
         and to_regprocedure('public._public_report_handler_users(uuid,text)') is not null then
        insert into public.notifications (user_id, type, title, message, report_id, is_read)
        select h, 'repair_overdue', 'Your follow-up is overdue',
               format('The job for %s was due on %s. Send the on-site after-photo once it is done.',
                      r.project_name, to_char(r.target_date, 'Mon DD, YYYY')),
               r.report_id, false
        from public._public_report_handler_users(r.report_id, r.responsible_party) h;
      end if;
      v_sent := v_sent + 1;
    end if;

    if v_stage = 'escalated'
       and not exists (select 1 from public.overdue_alerts where kind = 'repair' and ref_id = r.action_id::text and stage = 'escalated') then
      insert into public.overdue_alerts (kind, ref_id, stage) values ('repair', r.action_id::text, 'escalated');
      insert into public.notifications (user_id, type, title, message, report_id, is_read)
      select p.id, 'repair_overdue', 'Repair 3+ days overdue',
             format('The repair for %s (%s) is %s days overdue. Follow up with the responsible party.',
                    r.project_name, upper(coalesce(r.responsible_party, '')), v_days),
             r.report_id, false
      from public.profiles p where p.role = 'admin';
      v_sent := v_sent + 1;
    end if;
  end loop;

  return jsonb_build_object('alerts_sent', v_sent, 'checked_at', now());
end;
$$;

revoke all on function public.notify_overdue_items() from public;
grant execute on function public.notify_overdue_items() to authenticated;

-- Hourly schedule (pg_cron).
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule('kalsatrack-overdue-alerts')
  where exists (select 1 from cron.job where jobname = 'kalsatrack-overdue-alerts');
  perform cron.schedule('kalsatrack-overdue-alerts', '0 * * * *', 'select public.notify_overdue_items()');
end $$;

-- Check: select public.notify_overdue_items();   select * from cron.job;
