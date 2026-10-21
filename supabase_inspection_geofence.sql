-- Geofence for the field engineer's inspection photo: it must be taken at the
-- reported site. Same limits as the repair check (verify_public_report_repair):
-- within 500 m of the citizen's pin, with a GPS fix of 100 m or better.
-- Run once in the Supabase SQL editor. Only submit_public_report_inspection
-- changes; everything else in it is as before.

create or replace function public.submit_public_report_inspection(
  p_report_id uuid,
  p_condition_observed text,
  p_recommended_action text,
  p_site_rating integer,
  p_field_photo_url text,
  p_certified boolean,
  p_estimated_cost_range text default null,
  p_inspection_latitude double precision default null,
  p_inspection_longitude double precision default null,
  p_gps_accuracy_meters double precision default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
set row_security to 'off'
as $function$
declare
  c_max_distance_m constant double precision := 500;
  c_max_accuracy_m constant double precision := 100;
  v_report public.public_reports%rowtype;
  v_inspection public.public_report_field_findings%rowtype;
  v_old_report_state jsonb;
  v_dist double precision;
begin
  perform public._public_report_require_field_engineer();

  if coalesce(btrim(p_condition_observed), '') = '' then
    raise exception 'Condition observed is required';
  end if;

  if coalesce(btrim(p_recommended_action), '') = '' then
    raise exception 'Recommended action is required';
  end if;

  if coalesce(btrim(p_field_photo_url), '') = '' then
    raise exception 'Field photo is required';
  end if;

  if p_site_rating is null or p_site_rating < 1 or p_site_rating > 5 then
    raise exception 'Site rating must be between 1 and 5';
  end if;

  if coalesce(p_certified, false) is not true then
    raise exception 'Engineer certification is required before submitting inspection';
  end if;

  -- The photo's geotag is now required (it used to be optional).
  if p_inspection_latitude is null or p_inspection_longitude is null then
    raise exception 'The inspection photo must be geotagged';
  end if;

  if p_inspection_latitude < -90 or p_inspection_latitude > 90 then
    raise exception 'Inspection latitude must be between -90 and 90';
  end if;

  if p_inspection_longitude < -180 or p_inspection_longitude > 180 then
    raise exception 'Inspection longitude must be between -180 and 180';
  end if;

  if p_gps_accuracy_meters is null or p_gps_accuracy_meters < 0 then
    raise exception 'A GPS accuracy reading is required';
  end if;

  if p_gps_accuracy_meters > c_max_accuracy_m then
    raise exception 'GPS accuracy is too low (% m, maximum % m). Move to open sky and retake the photo',
      round(p_gps_accuracy_meters), round(c_max_accuracy_m);
  end if;

  select * into v_report
  from public.public_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report does not exist';
  end if;

  if v_report.assigned_engineer_id is distinct from auth.uid() then
    raise exception 'Only the assigned Field Engineer may submit this inspection';
  end if;

  if v_report.status <> 'reviewed' or v_report.engineer_status <> 'in_progress' then
    raise exception 'Report is not in inspection progress state';
  end if;

  -- Geofence: the photo must be taken at the reported site.
  if v_report.latitude is not null and v_report.longitude is not null then
    v_dist := public._public_report_distance_m(
      v_report.latitude, v_report.longitude, p_inspection_latitude, p_inspection_longitude
    );
    if v_dist > c_max_distance_m then
      raise exception 'Inspection photo was taken % m from the reported site (maximum % m)',
        round(v_dist), round(c_max_distance_m);
    end if;
  end if;

  select * into v_inspection
  from public.public_report_field_findings
  where report_id = p_report_id
    and engineer_id = auth.uid()
    and status = 'in_progress'
  order by inspection_number desc nulls last,
           inspection_started_at desc nulls last,
           created_at desc nulls last
  limit 1
  for update;

  if not found then
    raise exception 'No active inspection exists';
  end if;

  v_old_report_state := jsonb_build_object(
    'status', v_report.status,
    'engineer_status', v_report.engineer_status,
    'inspection_id', v_inspection.id,
    'inspection_status', v_inspection.status
  );

  update public.public_report_field_findings
  set condition_observed = btrim(p_condition_observed),
      recommended_action = btrim(p_recommended_action),
      estimated_cost_range = nullif(btrim(coalesce(p_estimated_cost_range, '')), ''),
      site_rating = p_site_rating,
      field_photo_url = btrim(p_field_photo_url),
      inspection_latitude = p_inspection_latitude,
      inspection_longitude = p_inspection_longitude,
      gps_accuracy_meters = p_gps_accuracy_meters,
      engineer_certified_at = now(),
      status = 'submitted',
      submitted_at = now()
  where id = v_inspection.id;

  update public.public_reports
  set engineer_status = 'inspected',
      verification = 'Needs Review',
      updated_at = now()
  where id = p_report_id;

  perform public._public_report_add_audit(
    p_report_id,
    'INSPECTION_SUBMITTED',
    v_old_report_state,
    jsonb_build_object('status', 'reviewed', 'engineer_status', 'inspected', 'inspection_id', v_inspection.id, 'inspection_status', 'submitted'),
    'Field engineer submitted inspection findings.',
    jsonb_build_object(
      'inspection_id', v_inspection.id,
      'inspection_number', v_inspection.inspection_number,
      'site_rating', p_site_rating,
      'has_gps', true,
      'distance_from_site_m', round(coalesce(v_dist, -1)),
      'gps_accuracy_m', round(p_gps_accuracy_meters)
    )
  );

  return v_inspection.id;
end;
$function$;
