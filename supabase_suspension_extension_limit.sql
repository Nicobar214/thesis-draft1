-- =============================================================================
-- "Extend suspension": at most 2 per PROJECT, not per suspension.
-- MODIFIES ONE EXISTING FUNCTION. Run ONLY after supabase_project_delay_cases.sql.
--
-- Why: the 2-extension limit was counted for the current suspension only. Once
-- the project was resumed and suspended again, its new suspension started at
-- 0/2, so the limit could be dodged by suspending again. Now every suspension
-- extension the project ever had counts (all its follow-ups), matching the app
-- (OverdueProjectsPanel.jsx, "Suspension extensions n/2").
--
-- This is the live definition (copied 2026-10-26) with exactly ONE change,
-- marked "CHANGED". Run once in the Supabase SQL editor. Safe to run again.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.delay_end_suspension(p_project bigint, p_action text, p_new_resume_date date, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    -- CHANGED: count the project's suspension extensions across ALL its follow-ups
    -- and suspensions (was: this suspension only, which reset on a new suspension).
    select count(*) into v_used from public.project_delay_case_events e
      join public.project_delay_cases c on c.id = e.case_id
     where c.project_id = p.id and e.event_type = 'suspension_extended';
    if v_used >= 2 then raise exception 'This project''s suspension was already extended 2 times; resume or terminate the project'; end if;
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
end $function$;

-- Check (read-only): suspension extensions used per project (max 2).
-- select c.project_id, count(*) from public.project_delay_case_events e
--   join public.project_delay_cases c on c.id = e.case_id
--  where e.event_type = 'suspension_extended' group by 1 order by 2 desc;
