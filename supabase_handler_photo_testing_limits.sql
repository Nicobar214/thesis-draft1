-- ============================================================
-- TEMPORARY (testing): wider on-site limits for the LGU/contractor after-photo.
--
-- Normal rule: the photo must be taken within 500 m of the reported spot with
-- GPS accuracy of 100 m or better. For testing from home or a desk this allows
-- up to 50 km away and 1,000 m accuracy. The engineer's repair check is not
-- changed. Matching client switch: HANDLER_PHOTO_TEST_LIMITS in
-- src/lib/onSiteLocation.js.
--
-- To undo: re-run supabase_report_handlers.sql (it restores the normal limits)
-- and set HANDLER_PHOTO_TEST_LIMITS to null.
-- Safe to re-run.
-- ============================================================

create or replace function public.submit_public_report_repair_work(
  p_action_id uuid,
  p_photo_url text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_captured_at timestamptz,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  -- Same evidence rules as verify_public_report_repair.
  -- TEMPORARY (testing): wide limits so the LGU/contractor can test from anywhere.
  -- Normal values: 500 m from the site, 100 m GPS accuracy.
  c_max_distance_m constant double precision := 50000;
  c_max_accuracy_m constant double precision := 1000;
  c_max_age        constant interval := interval '48 hours';
  c_clock_skew     constant interval := interval '5 minutes';
  v_action public.public_report_repair_actions%rowtype;
  v_report public.public_reports%rowtype;
  v_dist double precision;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_who text;
begin
  if coalesce(btrim(p_photo_url), '') = '' then
    raise exception 'An after-photo is required';
  end if;
  if p_latitude is null or p_longitude is null then
    raise exception 'GPS coordinates are required';
  end if;
  if p_accuracy_m is null or p_accuracy_m < 0 then
    raise exception 'A GPS accuracy reading is required';
  end if;
  if p_accuracy_m > c_max_accuracy_m then
    raise exception 'GPS accuracy is too low (% m, maximum % m)', round(p_accuracy_m), round(c_max_accuracy_m);
  end if;
  if p_captured_at is null then
    raise exception 'The time the photo was taken is required';
  end if;
  if p_captured_at > now() + c_clock_skew then
    raise exception 'The photo capture time is in the future';
  end if;
  if now() - p_captured_at > c_max_age then
    raise exception 'The photo was taken more than 48 hours ago; take a new one on site';
  end if;

  v_action := public._public_report_handler_action(p_action_id);
  if v_action.status <> 'planned' then
    raise exception 'Only a planned repair can be sent as done';
  end if;
  if v_action.started_at is null then
    raise exception 'Start the work before sending the after-photo';
  end if;
  if p_captured_at < v_action.started_at - c_clock_skew then
    raise exception 'The photo was taken before the work started';
  end if;

  select * into v_report from public.public_reports where id = v_action.report_id;

  if v_report.latitude is not null and v_report.longitude is not null then
    v_dist := public._public_report_distance_m(v_report.latitude, v_report.longitude, p_latitude, p_longitude);
    if v_dist > c_max_distance_m then
      raise exception 'Verification location is % m from the reported site (maximum % m)',
        round(v_dist), round(c_max_distance_m);
    end if;
  end if;

  v_who := case when v_action.responsible_party = 'lgu' then 'The LGU' else 'The contractor' end;

  update public.public_report_repair_actions
  set status = 'completed',
      work_submitted_by = auth.uid(), work_submitted_at = now(),
      work_photo_url = btrim(p_photo_url), work_latitude = p_latitude, work_longitude = p_longitude,
      work_accuracy_m = p_accuracy_m, work_distance_m = v_dist, work_captured_at = p_captured_at, work_note = v_note,
      completed_by = auth.uid(), completed_at = now(),
      completion_note = coalesce(v_note, case when v_action.responsible_party = 'lgu' then 'Fixed by the LGU.' else 'Repaired by the contractor.' end)
  where id = p_action_id;

  perform public._public_report_add_audit(
    v_action.report_id, 'WORK_DONE',
    jsonb_build_object('repair_status', 'planned'),
    jsonb_build_object('repair_status', 'completed'),
    v_note,
    jsonb_build_object(
      'repair_action_id', p_action_id, 'party', v_action.responsible_party,
      'distance_m', round(coalesce(v_dist, 0)), 'accuracy_m', round(p_accuracy_m), 'captured_at', p_captured_at
    )
  );
  perform public._public_report_notify_admins(
    v_action.report_id, 'public_report_work_done', 'Work done — review the after-photo',
    v_who || ' sent an after-photo for ' || coalesce(v_report.project_name, 'a report') || '.'
  );
  perform public._public_report_notify_citizen(
    v_action.report_id, 'public_report_work_done', 'Repair recorded as done',
    v_who || ' sent a photo of the finished work. The DA is checking it.'
  );

  return 'completed';
end;
$function$;
