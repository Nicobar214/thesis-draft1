-- ============================================================
-- Reopen a resolved report the reporter says is still not fixed.
--
-- Adds a step after resolution; the normal flow is unchanged. The admin
-- decides (a citizen's "not fixed" never reopens a report by itself):
--   * the report goes back to "reviewed" (no longer resolved);
--   * an LGU/contractor job goes back to that same handler at "send the
--     after-photo", with the reason shown as "Sent back by the DA";
--   * an older DA-only follow-up is closed so a new job can be sent out;
--   * the reporter's "not fixed" answer is cleared so they are asked again
--     after the next resolution (the answer is kept in the audit log);
--   * the reporter and the handler are notified.
-- The first resolution and its photos stay in the history.
-- Needs supabase_report_handlers.sql. Safe to re-run.
-- ============================================================

create or replace function public.reopen_resolved_public_report(p_report_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_report public.public_reports%rowtype;
  v_action public.public_report_repair_actions%rowtype;
  v_has_job boolean := false;
  v_answers jsonb;
  v_user uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public._public_report_require_admin();

  if v_reason = '' then
    raise exception 'Say what is still not fixed';
  end if;

  select * into v_report from public.public_reports where id = p_report_id for update;
  if not found then
    raise exception 'Report does not exist';
  end if;
  if v_report.status <> 'resolved' then
    raise exception 'Only a resolved report can be reopened';
  end if;

  select * into v_action
  from public.public_report_repair_actions
  where report_id = p_report_id
  for update;

  if found and v_action.responsible_party in ('lgu', 'contractor') and v_action.status <> 'cancelled' then
    -- Same handler, back to "send the after-photo".
    v_has_job := true;
    update public.public_report_repair_actions
    set status = 'planned',
        resolution_id = null,
        target_date = current_date + 7,
        planning_note = 'Reopened: ' || v_reason,
        sent_back_at = now(),
        accepted_at = coalesce(accepted_at, now()),
        accepted_by = coalesce(accepted_by, auth.uid()),
        started_at = coalesce(started_at, now()),
        engineer_check_requested_at = null,
        completed_by = null, completed_at = null, completion_note = null,
        verified_by = null, verified_at = null, verification_photo_url = null,
        verification_latitude = null, verification_longitude = null, verification_accuracy_m = null,
        verification_distance_m = null, verification_captured_at = null, verification_note = null,
        work_submitted_by = null, work_submitted_at = null, work_photo_url = null,
        work_latitude = null, work_longitude = null, work_accuracy_m = null, work_distance_m = null,
        work_captured_at = null, work_note = null
    where id = v_action.id;
  elsif found and v_action.status in ('planned', 'completed', 'verified') then
    -- Older DA-only follow-up: close it so a new job can be sent out.
    update public.public_report_repair_actions
    set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
        cancel_reason = 'Report reopened: ' || v_reason
    where id = v_action.id;
  end if;

  update public.public_reports
  set status = 'reviewed', resolved_at = null, resolved_by = null, updated_at = now()
  where id = p_report_id;

  -- Ask the reporter again after the next resolution; keep their answer in the log.
  select coalesce(jsonb_agg(jsonb_build_object('is_fixed', c.is_fixed, 'comment', c.comment, 'updated_at', c.updated_at)), '[]'::jsonb)
    into v_answers
  from public.public_report_citizen_confirmations c
  where c.report_id = p_report_id;
  delete from public.public_report_citizen_confirmations where report_id = p_report_id;

  perform public._public_report_add_audit(
    p_report_id, 'REPORT_REOPENED',
    jsonb_build_object('status', 'resolved'),
    jsonb_build_object('status', 'reviewed', 'job_reopened', v_has_job),
    v_reason,
    jsonb_build_object('citizen_answers', v_answers, 'repair_action_id', v_action.id)
  );

  perform public._public_report_notify_citizen(
    p_report_id, 'public_report_reopened', 'Your report was reopened',
    'Thank you for telling us. The DA reopened your report and is having it fixed again.'
  );

  if v_has_job then
    for v_user in select public._public_report_handler_users(p_report_id, v_action.responsible_party) loop
      insert into public.notifications (user_id, type, title, message, report_id, is_read)
      values (v_user, 'public_report_repair_reopened', 'Reopened: still not fixed',
              'The DA reopened this job: ' || v_reason || ' Send a new after-photo once it is fixed.', p_report_id, false);
    end loop;
  end if;
end;
$function$;

revoke execute on function public.reopen_resolved_public_report(uuid, text) from public, anon;
grant execute on function public.reopen_resolved_public_report(uuid, text) to authenticated;
