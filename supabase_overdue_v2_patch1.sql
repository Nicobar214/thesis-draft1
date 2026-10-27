-- =============================================================================
-- Overdue process v2 — patch 1: the field engineer's request says what to check.
-- Before: "Verify a delay explanation / check the contractor's delay explanation".
-- Now:    "Site check: act of nature" or "Site check: final offense", with what to look for.
-- Same rules as before (DA only, only while the DA is deciding). Safe to run again.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.delay_request_verification(p_case uuid, p_verifier uuid, p_note text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare c public.project_delay_cases; p public.fmr_projects; v_verifier uuid; v_what text;
begin
  perform public._delay_require_role('admin');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_decision']);
  p := public._delay_lock_project(c.project_id);
  v_verifier := coalesce(p_verifier, p.site_engineer_id);
  if v_verifier is null or not exists (select 1 from public.profiles where id = v_verifier and role = 'field_engineer') then
    raise exception 'Choose a field engineer to verify';
  end if;
  update public.project_delay_cases
     set status = 'awaiting_verification', verifier_id = v_verifier, verification_due = public._delay_today() + 5, verdict = null
   where id = c.id;
  perform public._delay_event(c.id, 'verification_requested', jsonb_build_object(
    'verifier_id', v_verifier, 'verification_due', public._delay_today() + 5, 'note', nullif(btrim(p_note), '')));
  -- CHANGED: say what to check.
  v_what := case when c.kind = 'act_of_nature'
    then format('the contractor says %s stopped the work for %s day(s). Confirm the damage on site', coalesce(c.event_name, 'an act of nature'), c.stopped_days)
    else format('this is the contractor''s FINAL chance (Offense %s of 3). Confirm the new finish date (%s) is realistic on site',
                c.offense_no, to_char(c.proposed_date, 'FMMonth FMDD, YYYY')) end;
  perform public._priority_notify(v_verifier, 'delay_verification_requested',
    case when c.kind = 'act_of_nature' then 'Site check: act of nature' else 'Site check: final offense' end,
    format('"%s": %s by %s. Open Priority Tasks.%s', p.project_name, v_what,
      to_char(public._delay_today() + 5, 'FMMonth FMDD, YYYY'), coalesce(' DA note: ' || nullif(btrim(p_note), ''), '')), p.id);
end $function$;
