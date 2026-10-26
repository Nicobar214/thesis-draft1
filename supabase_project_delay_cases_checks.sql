-- =============================================================================
-- Regression checks for the delay follow-up. Run ONLY after File 1 succeeded,
-- in the Supabase SQL editor as postgres. ALL test work is rolled back: it runs inside
-- an inner block that ALWAYS ends with the sentinel SQLSTATE 'DLYOK'. Only the text log
-- survives (session setting delay.checks_log), shown by the final SELECT.
-- Test projects use fixed negative ids (-900001..-900005); real projects are never changed.
-- The daily check is called through _delay_check(<test id>) so real projects are not
-- scanned. The weekly no-contractor summary needs a full run and is NOT tested here.
--
-- Also covers the post-test fixes, each only if it is applied (else a SKIP line):
--   supabase_delay_open_on_save.sql        -> T0b (case opens when the project is saved)
--   supabase_delay_target_guard.sql        -> T11b (no plain edit to a past date after a follow-up)
--   supabase_suspension_extension_limit.sql -> T11c (2 suspension extensions per PROJECT)
-- Test fast-forwards of a project's target date use the same flag as the delay
-- functions (delay.target_write, as postgres), so they work with or without those fixes.
-- =============================================================================

do $$
declare
  log text := ''; fails int := 0; skips int := 0; step text := 'preflight';
  pA constant bigint := -900001; pB constant bigint := -900002; pC constant bigint := -900003; pD constant bigint := -900004;
  pE constant bigint := -900005;
  v_editor text := current_user; today date := public._delay_today();
  v_admin uuid; v_con uuid; v_con2 uuid; v_fe uuid; v_fe2 uuid;
  v_case uuid; v_susp uuid; v_n int; v_s text; v_t text; v_res jsonb; v_ok boolean; v_in text; v_exp date; v_got date;
begin
  perform set_config('lock_timeout', '3s', true);
  perform set_config('statement_timeout', '120s', true);
  perform set_config('delay.checks_log', '', false);
  if exists (select 1 from public.fmr_projects where id in (pA, pB, pC, pD, pE)) then
    perform set_config('delay.checks_log', 'SKIP ALL: a test id (-900001..-900005) is already in use. Nothing was changed.', false);
    return;
  end if;

  begin  -- ===================== everything below is rolled back =====================

    -- P: date parser (pure)
    step := 'P';
    for v_in, v_exp in select * from (values
      ('2026-10-17', date '2026-10-17'), ('August 10, 2025', date '2025-08-10'), ('Sept. 26, 2025', date '2025-09-26'),
      ('Sep 26, 2025', date '2025-09-26'), ('Aug. 5, 2025', date '2025-08-05'), ('  July   02,  2025 ', date '2025-07-02'),
      ('December 13 , 2025', date '2025-12-13'), (null, null), ('', null), ('   ', null), ('TBD', null),
      ('2026-02-30', null), ('2026-13-01', null), ('2026-01-01x', null), ('Feb 30, 2025', null), ('Augst 10, 2025', null)) t(i, e)
    loop
      v_got := public._delay_parse_date(v_in);
      if v_got is not distinct from v_exp then log := log || format(E'\nPASS P %s -> %s', coalesce(quote_literal(v_in), 'NULL'), coalesce(v_got::text, 'NULL'));
      else fails := fails + 1; log := log || format(E'\nFAIL P %s: expected %s, got %s', coalesce(quote_literal(v_in), 'NULL'), coalesce(v_exp::text, 'NULL'), coalesce(v_got::text, 'NULL')); end if;
    end loop;

    select id into v_admin from public.profiles where role = 'admin' limit 1;
    select id into v_con   from public.profiles where role = 'contractor' limit 1;
    select id into v_con2  from public.profiles where role = 'contractor' and id is distinct from v_con limit 1;
    select id into v_fe    from public.profiles where role = 'field_engineer' limit 1;
    select id into v_fe2   from public.profiles where role = 'field_engineer' and id is distinct from v_fe limit 1;
    if v_admin is null or v_con is null or v_fe is null then
      skips := skips + 1; log := log || E'\nSKIP workflow tests: need admin, contractor and field engineer profiles';
      raise exception 'DELAY_CHECKS_DONE' using errcode = 'DLYOK';
    end if;

    step := 'setup';
    insert into public.fmr_projects (id, project_name, status, work_plan_status, target_completion_date, contractor_id) values
      (pA, 'ZZ TEST delay A (rolled back)', 'On-Going', 'none', to_char(today - 1, 'YYYY-MM-DD'), v_con),
      (pB, 'ZZ TEST delay B (rolled back)', 'On-Going', 'none', to_char(today - 5, 'YYYY-MM-DD'), null),
      (pC, 'ZZ TEST delay C (rolled back)', 'On-Going', 'none', to_char(today, 'YYYY-MM-DD'), v_con),
      (pD, 'ZZ TEST delay D (rolled back)', 'On-Going', 'none', to_char(today - 4, 'YYYY-MM-DD'), v_con),
      (pE, 'ZZ TEST delay E (rolled back)', 'On-Going', 'none', to_char(today - 2, 'YYYY-MM-DD'), v_con);

    -- T0b: open on save (supabase_delay_open_on_save.sql)
    step := 'T0b';
    if exists (select 1 from pg_trigger where tgrelid = 'public.fmr_projects'::regclass and tgname = 'trg_delay_open_on_save') then
      if exists (select 1 from public.project_delay_cases where project_id = pD and status = 'awaiting_request')
         and not exists (select 1 from public.project_delay_cases where project_id = pB)
         and not exists (select 1 from public.project_delay_cases where project_id = pC) then
        log := log || E'\nPASS T0b saving an overdue project with a contractor opens its follow-up at once (none without contractor / not yet due)';
      else fails := fails + 1; log := log || E'\nFAIL T0b open on save'; end if;
    else skips := skips + 1; log := log || E'\nSKIP T0b supabase_delay_open_on_save.sql not applied'; end if;

    -- M1/M2: Manila date boundary
    step := 'M';
    if public._delay_today() = (now() at time zone 'Asia/Manila')::date then log := log || format(E'\nPASS M1 today is the Manila date (%s; UTC date is %s%s)', today, (now() at time zone 'UTC')::date, case when (now() at time zone 'UTC')::date <> today then ' -> boundary active now' else '' end);
    else fails := fails + 1; log := log || E'\nFAIL M1 _delay_today() is not the Manila date'; end if;
    v_res := public._delay_check(pA); v_res := public._delay_check(pC);
    if exists (select 1 from public.project_delay_cases where project_id = pA) and not exists (select 1 from public.project_delay_cases where project_id = pC) then
      log := log || E'\nPASS M2 due yesterday (Manila) -> case opened; due today (Manila) -> no case';
    else fails := fails + 1; log := log || E'\nFAIL M2 Manila overdue boundary'; end if;

    -- T1: idempotent check; no case without a contractor
    step := 'T1';
    v_res := public._delay_check(pA); v_res := public._delay_check(pB); v_res := public._delay_check(pB);
    select count(*) into v_n from public.project_delay_cases where project_id = pA;
    select id into v_case from public.project_delay_cases where project_id = pA and status <> 'closed';
    if v_n = 1 and (select count(*) from public.overdue_alerts where kind = 'project_delay' and ref_id = v_case::text and stage = 'opened') = 1
       and not exists (select 1 from public.project_delay_cases where project_id = pB)
       and (select status from public.project_delay_cases where id = v_case) = 'awaiting_request'
       and (select request_due from public.project_delay_cases where id = v_case) = today + 3 then
      log := log || E'\nPASS T1 check run 3x -> 1 case, 1 opened alert, request_due +3; no case without contractor';
    else fails := fails + 1; log := log || format(E'\nFAIL T1 cases=%s', v_n); end if;

    -- T0: grants -- anon/authenticated cannot run the cron entry point or the core
    step := 'T0';
    if not has_function_privilege('authenticated', 'public.delay_detect_and_remind()', 'execute')
       and not has_function_privilege('anon', 'public.delay_detect_and_remind()', 'execute')
       and not has_function_privilege('authenticated', 'public._delay_check(bigint)', 'execute')
       and not has_function_privilege('anon', 'public.delay_grant_extension(uuid,date,text)', 'execute')
       and has_function_privilege('authenticated', 'public.delay_grant_extension(uuid,date,text)', 'execute') then
      log := log || E'\nPASS T0 grants: cron/core not executable by anon/authenticated; RPCs only for authenticated';
    else fails := fails + 1; log := log || E'\nFAIL T0 unexpected function grants'; end if;

    -- T2: blocked transitions from awaiting_request
    step := 'T2';
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_n := 0;
    begin perform public.delay_grant_extension(v_case, today + 30, 'Ten chars at least.'); exception when others then v_n := v_n + 1; end;
    begin perform public.delay_request_revision(v_case, 'Ten chars at least.', today + 5); exception when others then v_n := v_n + 1; end;
    begin perform public.delay_issue_final_notice(v_case, 'Ten chars at least.', today + 5); exception when others then v_n := v_n + 1; end;
    begin perform public.delay_request_verification(v_case, v_fe, 'x'); exception when others then v_n := v_n + 1; end;
    execute 'reset role';
    if v_n = 4 then log := log || E'\nPASS T2 extension/revision/final notice/verification blocked in awaiting_request';
    else fails := fails + 1; log := log || format(E'\nFAIL T2 expected 4 blocks, got %s', v_n); end if;

    -- T3: request explanation -- permissions and reply-by window
    step := 'T3';
    perform set_config('request.jwt.claims', json_build_object('sub', v_con, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin perform public.delay_request_explanation(v_case, today + 7, null);
      fails := fails + 1; log := log || E'\nFAIL T3 contractor could request';
    exception when others then log := log || E'\nPASS T3 non-admin cannot request: ' || sqlerrm; end;
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_n := 0;
    begin perform public.delay_request_explanation(v_case, today, null); exception when others then v_n := v_n + 1; end;
    begin perform public.delay_request_explanation(v_case, today + 31, null); exception when others then v_n := v_n + 1; end;
    perform public.delay_request_explanation(v_case, today + 7, 'Please explain the delay.');
    execute 'reset role';
    if v_n = 2 and (select status from public.project_delay_cases where id = v_case) = 'awaiting_explanation' then
      log := log || E'\nPASS T3b reply-by today / +31 rejected; +7 accepted -> awaiting_explanation';
    else fails := fails + 1; log := log || format(E'\nFAIL T3b rejections=%s', v_n); end if;

    -- T4: only the project's contractor can explain
    step := 'T4';
    if v_con2 is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_con2, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin perform public.delay_submit_explanation(v_case, 'weather', 'Rain for two weeks.', today + 20, 60);
        fails := fails + 1; log := log || E'\nFAIL T4 another contractor could explain';
      exception when others then log := log || E'\nPASS T4 another contractor blocked: ' || sqlerrm; end;
      execute 'reset role';
    else skips := skips + 1; log := log || E'\nSKIP T4 only one contractor profile'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_con, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_n := 0;
    begin perform public.delay_submit_explanation(v_case, 'weather', 'short', today + 20, 60); exception when others then v_n := v_n + 1; end;
    begin perform public.delay_submit_explanation(v_case, 'other', 'short', today + 20, 60); exception when others then v_n := v_n + 1; end;
    begin perform public.delay_submit_explanation(v_case, 'materials', null, today + 20, 60); exception when others then v_n := v_n + 1; end;
    if v_n = 3 then log := log || E'\nPASS T4b explanation needs 10+ chars for every cause (weather/other/materials)';
    else fails := fails + 1; log := log || format(E'\nFAIL T4b short explanations rejected %s of 3', v_n); end if;
    perform public.delay_submit_explanation(v_case, 'weather', 'Rain for two weeks.', today + 20, 60);
    execute 'reset role';
    if (select status from public.project_delay_cases where id = v_case) = 'awaiting_decision'
       and (select decision_due from public.project_delay_cases where id = v_case) = today + 5 then
      log := log || E'\nPASS T4c contractor explained -> awaiting_decision, decision due +5';
    else fails := fails + 1; log := log || E'\nFAIL T4c'; end if;

    -- T5: verification -- only the chosen verifier
    step := 'T5';
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.delay_request_verification(v_case, v_fe, 'Please check on site.');
    begin perform public.delay_submit_verification(v_case, 'agree', 'Admin cannot verify.', null);
      fails := fails + 1; log := log || E'\nFAIL T5 admin could verify';
    exception when others then log := log || E'\nPASS T5 admin cannot verify'; end;
    execute 'reset role';
    if v_fe2 is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_fe2, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin perform public.delay_submit_verification(v_case, 'agree', 'Not my assignment.', null);
        fails := fails + 1; log := log || E'\nFAIL T5b another engineer could verify';
      exception when others then log := log || E'\nPASS T5b another engineer blocked'; end;
      execute 'reset role';
    else skips := skips + 1; log := log || E'\nSKIP T5b only one field engineer profile'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_fe, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.delay_submit_verification(v_case, 'agree', 'Rain confirmed on site.', null);
    execute 'reset role';
    if (select verdict from public.project_delay_cases where id = v_case) = 'agree'
       and (select status from public.project_delay_cases where id = v_case) = 'awaiting_decision' then
      log := log || E'\nPASS T5c verifier submitted -> awaiting_decision';
    else fails := fails + 1; log := log || E'\nFAIL T5c'; end if;

    -- T6: one revision only
    step := 'T6';
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.delay_request_revision(v_case, 'Attach a recovery schedule.', today + 5);
    perform set_config('request.jwt.claims', json_build_object('sub', v_con, 'role', 'authenticated')::text, true);
    perform public.delay_submit_explanation(v_case, 'weather', 'Two crews from Monday.', today + 25, 62);
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    begin perform public.delay_request_revision(v_case, 'A second revision request.', today + 5);
      fails := fails + 1; log := log || E'\nFAIL T6 second revision accepted';
    exception when others then log := log || E'\nPASS T6 second revision rejected: ' || sqlerrm; end;
    execute 'reset role';

    -- T7: target-date lock while the case is open
    step := 'T7';
    v_t := (select target_completion_date from public.fmr_projects where id = pA);
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin update public.fmr_projects set target_completion_date = to_char(today + 50, 'YYYY-MM-DD') where id = pA;
      fails := fails + 1; log := log || E'\nFAIL T7a admin direct date edit allowed';
    exception when others then log := log || E'\nPASS T7a admin direct date edit blocked'; end;
    begin
      perform set_config('delay.target_write', 'on', true);
      update public.fmr_projects set target_completion_date = to_char(today + 50, 'YYYY-MM-DD') where id = pA;
      fails := fails + 1; log := log || E'\nFAIL T7b admin with bypass flag could edit';
    exception when others then log := log || E'\nPASS T7b bypass flag ignored for API role (authenticated)'; end;
    perform set_config('delay.target_write', 'off', true);
    execute 'reset role';
    begin update public.fmr_projects set target_completion_date = to_char(today + 50, 'YYYY-MM-DD') where id = pA;
      fails := fails + 1; log := log || E'\nFAIL T7c owner edit without flag allowed';
    exception when others then log := log || E'\nPASS T7c owner edit without flag blocked'; end;
    update public.fmr_projects set target_completion_date = to_char(_delay_parse_date(v_t), 'FMMonth DD, YYYY') where id = pA;
    if (select count(*) from public.fmr_projects where id = pA) = 1 then log := log || E'\nPASS T7d same date in another format allowed'; end if;

    -- T8: extension date rules + grant
    step := 'T8';
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_n := 0;
    begin perform public.delay_grant_extension(v_case, today, 'Ten chars at least.'); exception when others then v_n := v_n + 1; end;
    begin perform public.delay_grant_extension(v_case, today - 1, 'Ten chars at least.'); exception when others then v_n := v_n + 1; end;
    begin perform public.delay_grant_extension(v_case, today + 30, 'short'); exception when others then v_n := v_n + 1; end;
    perform public.delay_grant_extension(v_case, today + 30, 'Approved per verification.');
    execute 'reset role';
    if v_n = 3 and (select target_completion_date from public.fmr_projects where id = pA) = to_char(today + 30, 'YYYY-MM-DD')
       and (select outcome from public.project_delay_cases where id = v_case) = 'extended'
       and (select count(*) from public.project_time_extensions where project_id = pA and suspension_id is null) = 1 then
      log := log || E'\nPASS T8 bad dates/short reason rejected; extension updated target, record, closed as extended';
    else fails := fails + 1; log := log || format(E'\nFAIL T8 rejections=%s', v_n); end if;

    -- T9: second extension OK, third rejected
    step := 'T9';
    perform set_config('delay.target_write', 'on', true);   -- test fast-forward (see header)
    update public.fmr_projects set target_completion_date = to_char(today - 2, 'YYYY-MM-DD') where id = pA;
    perform set_config('delay.target_write', 'off', true);
    v_res := public._delay_check(pA);
    select id into v_case from public.project_delay_cases where project_id = pA and status <> 'closed';
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.delay_request_explanation(v_case, today + 7, null);
    perform set_config('request.jwt.claims', json_build_object('sub', v_con, 'role', 'authenticated')::text, true);
    perform public.delay_submit_explanation(v_case, 'materials', 'Cement shortage.', today + 40, 70);
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    perform public.delay_grant_extension(v_case, today + 40, 'Second extension approved.');
    execute 'reset role';
    perform set_config('delay.target_write', 'on', true);
    update public.fmr_projects set target_completion_date = to_char(today - 3, 'YYYY-MM-DD') where id = pA;
    perform set_config('delay.target_write', 'off', true);
    v_res := public._delay_check(pA);
    select id into v_case from public.project_delay_cases where project_id = pA and status <> 'closed';
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.delay_request_explanation(v_case, today + 7, null);
    perform set_config('request.jwt.claims', json_build_object('sub', v_con, 'role', 'authenticated')::text, true);
    perform public.delay_submit_explanation(v_case, 'fund_release', 'Funds released late.', today + 60, 75);
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    begin perform public.delay_grant_extension(v_case, today + 60, 'Third extension attempt.');
      fails := fails + 1; log := log || E'\nFAIL T9 third extension accepted';
    exception when others then log := log || E'\nPASS T9 third extension rejected: ' || sqlerrm; end;
    execute 'reset role';

    -- T10: final notice once; missed -> only Suspend/Terminate
    step := 'T10';
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.delay_issue_final_notice(v_case, 'Reply or face termination.', today + 3);
    execute 'reset role';
    update public.project_delay_cases set reply_by = today - 1 where id = v_case;   -- fast-forward
    v_res := public._delay_check(pA);
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_n := 0;
    begin perform public.delay_grant_extension(v_case, today + 60, 'After missed notice.'); exception when others then v_n := v_n + 1; end;
    begin perform public.delay_close_completed_late(v_case, 'After missed notice.'); exception when others then v_n := v_n + 1; end;
    begin perform public.delay_request_revision(v_case, 'After missed notice.', today + 5); exception when others then v_n := v_n + 1; end;
    begin perform public.delay_issue_final_notice(v_case, 'A second final notice.', today + 5); exception when others then v_n := v_n + 1; end;
    perform public.delay_suspend(v_case, 'Contractor unresponsive; site idle.', today + 10);
    execute 'reset role';
    if v_n = 4 and (select final_notice_missed from public.project_delay_cases where id = v_case)
       and (select outcome from public.project_delay_cases where id = v_case) = 'suspended'
       and (select status from public.fmr_projects where id = pA) = 'Suspended'
       and exists (select 1 from public.project_suspensions where project_id = pA and suspension_end is null) then
      log := log || E'\nPASS T10 missed final notice: extend/complete/revise/2nd notice blocked; suspended';
    else fails := fails + 1; log := log || format(E'\nFAIL T10 blocks=%s', v_n); end if;

    -- T10b: resume-due alert once per expected date; extend suspension (max 2)
    step := 'T10b';
    select id into v_susp from public.project_suspensions where project_id = pA and suspension_end is null;
    if (select expected_resume_date from public.project_suspensions where id = v_susp) = today + 10 then
      log := log || E'\nPASS T10b suspend stored expected_resume_date';
    else fails := fails + 1; log := log || E'\nFAIL T10b expected_resume_date not stored'; end if;
    update public.project_suspensions set expected_resume_date = today - 1 where id = v_susp;   -- fast-forward
    v_res := public._delay_check(pA); v_res := public._delay_check(pA);
    if (select count(*) from public.overdue_alerts where kind = 'project_delay' and ref_id = 'suspension:' || v_susp and stage like 'resume_due:%') = 1 then
      log := log || E'\nPASS T10c resume-due alert sent once (check run twice)';
    else fails := fails + 1; log := log || E'\nFAIL T10c resume-due alert count'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_n := 0;
    begin perform public.delay_end_suspension(pA, 'extend', today + 20, 'short'); exception when others then v_n := v_n + 1; end;
    begin perform public.delay_end_suspension(pA, 'extend', today, 'Rains continue on site.'); exception when others then v_n := v_n + 1; end;
    perform public.delay_end_suspension(pA, 'extend', today + 20, 'Rains continue on site.');
    execute 'reset role';
    if v_n = 2 and (select expected_resume_date from public.project_suspensions where id = v_susp) = today + 20
       and (select status from public.fmr_projects where id = pA) = 'Suspended' then
      log := log || E'\nPASS T10d extend suspension: short reason / date not after today rejected; new date stored';
    else fails := fails + 1; log := log || format(E'\nFAIL T10d rejections=%s', v_n); end if;
    update public.project_suspensions set expected_resume_date = today - 2 where id = v_susp;   -- the new date passes
    v_res := public._delay_check(pA); v_res := public._delay_check(pA);
    if (select count(*) from public.overdue_alerts where kind = 'project_delay' and ref_id = 'suspension:' || v_susp and stage like 'resume_due:%') = 2 then
      log := log || E'\nPASS T10e resume-due alert fires again after an extension (once for the new date)';
    else fails := fails + 1; log := log || E'\nFAIL T10e resume-due alert did not fire again'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.delay_end_suspension(pA, 'extend', today + 25, 'Second suspension extension.');
    begin perform public.delay_end_suspension(pA, 'extend', today + 30, 'Third suspension extension.');
      fails := fails + 1; log := log || E'\nFAIL T10f third suspension extension accepted';
    exception when others then log := log || E'\nPASS T10f third suspension extension rejected: ' || sqlerrm; end;
    execute 'reset role';

    -- T11: resume does not count toward the extension limit
    step := 'T11';
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.delay_resume_project(pA, today + 90, 'Contractor back on site.');
    execute 'reset role';
    if (select status from public.fmr_projects where id = pA) = 'On-Going'
       and (select target_completion_date from public.fmr_projects where id = pA) = to_char(today + 90, 'YYYY-MM-DD')
       and (select count(*) from public.project_time_extensions where project_id = pA and suspension_id is not null) = 1
       and public._delay_extensions_used(pA) = 2 then
      log := log || E'\nPASS T11 resumed; suspension-linked extension recorded; extensions used still 2';
    else fails := fails + 1; log := log || E'\nFAIL T11'; end if;

    -- T11b: after a follow-up, a plain edit may not move the target date into the past
    -- (supabase_delay_target_guard.sql). pA: On-Going, target today+90, no open case.
    step := 'T11b';
    if position('cannot be moved into the past' in pg_get_functiondef('public._delay_target_lock()'::regprocedure)) > 0 then
      perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin update public.fmr_projects set target_completion_date = to_char(today - 1, 'YYYY-MM-DD') where id = pA;
        fails := fails + 1; log := log || E'\nFAIL T11b plain edit to a past date allowed after a follow-up';
      exception when others then log := log || E'\nPASS T11b plain edit to a past date blocked after a follow-up'; end;
      update public.fmr_projects set target_completion_date = to_char(today + 100, 'YYYY-MM-DD') where id = pA;
      execute 'reset role';
      if (select target_completion_date from public.fmr_projects where id = pA) = to_char(today + 100, 'YYYY-MM-DD') then
        log := log || E'\nPASS T11b plain edit to a future date still allowed';
      else fails := fails + 1; log := log || E'\nFAIL T11b future date edit'; end if;
    else skips := skips + 1; log := log || E'\nSKIP T11b supabase_delay_target_guard.sql not applied'; end if;

    -- T11c: suspension extensions count per PROJECT (supabase_suspension_extension_limit.sql).
    -- pA already used 2 (T10d, T10f). Suspend it again: a 3rd extension must still be refused.
    step := 'T11c';
    if position('where c.project_id = p.id and e.event_type = ''suspension_extended''' in pg_get_functiondef('public.delay_end_suspension(bigint,text,date,text)'::regprocedure)) > 0 then
      perform set_config('delay.target_write', 'on', true);
      update public.fmr_projects set target_completion_date = to_char(today - 1, 'YYYY-MM-DD') where id = pA;
      perform set_config('delay.target_write', 'off', true);
      v_res := public._delay_check(pA);
      select id into v_case from public.project_delay_cases where project_id = pA and status <> 'closed';
      perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.delay_suspend(v_case, 'Suspended a second time.', today + 10);
      begin perform public.delay_end_suspension(pA, 'extend', today + 20, 'New suspension, new count?');
        fails := fails + 1; log := log || E'\nFAIL T11c a new suspension reset the extension limit';
      exception when others then log := log || E'\nPASS T11c limit is per project: a new suspension does not reset it'; end;
      execute 'reset role';
    else skips := skips + 1; log := log || E'\nSKIP T11c supabase_suspension_extension_limit.sql not applied'; end if;

    -- T12: no response -> terminate (pD was overdue from the start: target today-4)
    step := 'T12';
    v_res := public._delay_check(pD);
    select id into v_case from public.project_delay_cases where project_id = pD and status <> 'closed';
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.delay_request_explanation(v_case, today + 2, null);
    execute 'reset role';
    update public.project_delay_cases set reply_by = today - 1 where id = v_case;
    v_res := public._delay_check(pD);
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.delay_terminate(v_case, 'No reply; contract terminated.');
    execute 'reset role';
    if (select outcome from public.project_delay_cases where id = v_case) = 'terminated'
       and (select status from public.fmr_projects where id = pD) = 'Terminated'
       and exists (select 1 from public.project_delay_case_events where case_id = v_case and event_type = 'no_response') then
      log := log || E'\nPASS T12 no response -> no_response -> terminated';
    else fails := fails + 1; log := log || E'\nFAIL T12'; end if;

    -- T13: no contractor -> cannot ask, but can close directly
    step := 'T13';
    update public.fmr_projects set target_completion_date = to_char(today - 1, 'YYYY-MM-DD') where id = pC;
    v_res := public._delay_check(pC);
    select id into v_case from public.project_delay_cases where project_id = pC and status <> 'closed';
    update public.fmr_projects set contractor_id = null where id = pC;
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin perform public.delay_request_explanation(v_case, today + 7, null);
      fails := fails + 1; log := log || E'\nFAIL T13 asked without a contractor';
    exception when others then log := log || E'\nPASS T13 no contractor: ' || sqlerrm; end;
    perform public.delay_close_completed_late(v_case, 'Finished by the LGU crew.');
    execute 'reset role';
    if (select outcome from public.project_delay_cases where id = v_case) = 'completed_late'
       and (select status from public.fmr_projects where id = pC) = 'Completed' then
      log := log || E'\nPASS T13b closed directly as completed late';
    else fails := fails + 1; log := log || E'\nFAIL T13b'; end if;

    -- T14: marking Completed by any route auto-closes
    step := 'T14';
    update public.fmr_projects set status = 'On-Going', target_completion_date = to_char(today - 1, 'YYYY-MM-DD') where id = pB;
    update public.fmr_projects set contractor_id = v_con where id = pB;
    v_res := public._delay_check(pB);
    select id into v_case from public.project_delay_cases where project_id = pB and status <> 'closed';
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update public.fmr_projects set status = 'Completed' where id = pB;   -- the project form route
    execute 'reset role';
    if (select outcome from public.project_delay_cases where id = v_case) = 'completed_late' then
      log := log || E'\nPASS T14 project marked Completed -> case auto-closed as completed late';
    else fails := fails + 1; log := log || E'\nFAIL T14'; end if;

    -- T15: running the check twice creates nothing new
    step := 'T15';
    select count(*) into v_n from public.project_delay_cases where project_id in (pA, pB, pC, pD);
    v_res := public._delay_check(pA); v_res := public._delay_check(pA);
    if (select count(*) from public.project_delay_cases where project_id in (pA, pB, pC, pD)) = v_n then
      log := log || E'\nPASS T15 repeated check: no duplicate cases';
    else fails := fails + 1; log := log || E'\nFAIL T15'; end if;

    -- T16: history is append-only
    step := 'T16';
    begin update public.project_delay_case_events set payload = '{}' where case_id = v_case;
      fails := fails + 1; log := log || E'\nFAIL T16 history edited';
    exception when others then log := log || E'\nPASS T16 history cannot be edited'; end;
    begin delete from public.project_delay_case_events where case_id = v_case;
      fails := fails + 1; log := log || E'\nFAIL T16b history deleted';
    exception when others then log := log || E'\nPASS T16b history cannot be deleted'; end;

    -- T17: terminate a Suspended project (no dead end)
    step := 'T17';
    v_res := public._delay_check(pE);
    select id into v_case from public.project_delay_cases where project_id = pE and status <> 'closed';
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.delay_suspend(v_case, 'Site flooded; work halted.', today + 7);
    perform set_config('request.jwt.claims', json_build_object('sub', v_con, 'role', 'authenticated')::text, true);
    begin perform public.delay_end_suspension(pE, 'terminate', null, 'Contractor tries to end it.');
      fails := fails + 1; log := log || E'\nFAIL T17 contractor could end a suspension';
    exception when others then log := log || E'\nPASS T17 contractor cannot end a suspension'; end;
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    perform public.delay_end_suspension(pE, 'terminate', null, 'Contractor abandoned the site.');
    execute 'reset role';
    if (select status from public.fmr_projects where id = pE) = 'Terminated'
       and (select suspension_end from public.project_suspensions where project_id = pE) = today
       and exists (select 1 from public.project_delay_case_events where case_id = v_case and event_type = 'suspension_terminated')
       and exists (select 1 from public.notifications where project_id = pE and type = 'delay_case_closed' and user_id = v_con) then
      log := log || E'\nPASS T17b terminate from Suspended: project Terminated, suspension closed, history + contractor notified';
    else fails := fails + 1; log := log || E'\nFAIL T17b'; end if;

    step := 'end';
    raise exception 'DELAY_CHECKS_DONE' using errcode = 'DLYOK';
  exception
    when sqlstate 'DLYOK' then null;
    when others then fails := fails + 1; log := log || format(E'\nABORTED at %s: %s (all test work rolled back)', step, sqlerrm);
  end;

  if current_user is distinct from v_editor then fails := fails + 1; log := log || E'\nFAIL role not restored';
  else log := log || E'\nPASS role restored'; end if;
  if exists (select 1 from public.fmr_projects where id in (pA, pB, pC, pD, pE))
     or exists (select 1 from public.project_delay_cases where project_id in (pA, pB, pC, pD, pE))
     or exists (select 1 from public.project_time_extensions where project_id in (pA, pB, pC, pD, pE))
     or exists (select 1 from public.project_suspensions where project_id in (pA, pB, pC, pD, pE))
     or exists (select 1 from public.overdue_alerts where kind = 'project_delay' and ref_id like 'suspension:%'
                  and not exists (select 1 from public.project_suspensions s where 'suspension:' || s.id = ref_id))
     or exists (select 1 from public.notifications where project_id in (pA, pB, pC, pD, pE) or message like '%ZZ TEST delay%') then
    fails := fails + 1; log := log || E'\nFAIL cleanup: test artifacts remain';
  else log := log || E'\nPASS cleanup: no test projects, cases, extensions, suspensions or notifications remain'; end if;

  log := log || format(E'\n== %s failure(s), %s skip(s) ==%s', fails, skips, case when skips > 0 then ' INCOMPLETE' else '' end);
  perform set_config('delay.checks_log', log, false);
  raise notice '%', log;
end $$;

select line as result from unnest(string_to_array(current_setting('delay.checks_log', true), E'\n')) as line where line <> '';
