-- =============================================================================
-- Citizen/farmer reports must be made AT the road. MODIFIES ONE EXISTING FUNCTION.
--
-- The app only opens and sends a report when the reporter is at the road
-- (within 150 m, lib/reportSubmission.js reportLocationProblem). This is the
-- server backstop, so an old app build, an offline queue or an edited request
-- cannot get around it: a non-admin report with no GPS, or more than 1 km from
-- its road (the existing "Location Mismatch" line, _report_location_verdict),
-- is refused. 1 km and not 150 m because the app may measure to the road as
-- OSRM draws it, while the server measures to the stored route or start->end
-- line; the two can differ by a few hundred metres on an unmapped road.
--
-- This is the live definition (copied 2026-10-26) with exactly ONE added block,
-- marked "ADDED" below. CREATE OR REPLACE keeps the owner, grants and trigger.
-- Run once in the Supabase SQL editor. Safe to run again.
-- Existing reports are not touched.
--
-- TEMPORARY (testing): the limit below is set to 50 km so reports can be tested
-- away from the roads. Matches REPORT_LOCATION_TEST_LIMIT_M in
-- src/lib/reportSubmission.js.
-- TO GO BACK TO THE REAL LIMIT (before the defense / go-live), run only:
--   create or replace function public._report_location_max_m()
--   returns double precision language sql immutable as $$ select 1000::double precision $$;
-- and set REPORT_LOCATION_TEST_LIMIT_M = null in src/lib/reportSubmission.js.
-- =============================================================================

-- The farthest (m) a non-admin report may be from its road. Normal: 1000
-- (the "Location Mismatch" line). Testing: 50000.
create or replace function public._report_location_max_m()
returns double precision
language sql
immutable
as $$ select 50000::double precision $$;

CREATE OR REPLACE FUNCTION public.public_report_prepare_citizen_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
begin
  if public.public_report_current_role() <> 'admin' then
    new.status := 'pending';
    new.engineer_status := null;
    new.assigned_engineer_id := null;
    new.assigned_engineer_name := '';
    new.assigned_at := null;
    new.engineer_notes := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.dismissed_at := null;
    new.dismissed_by := null;
    new.dismissal_reason := null;
    new.resolved_at := null;
    new.resolved_by := null;
    new.legacy_resolved_without_engineer_validation := false;

    new.verification := public._report_location_verdict(new.project_id, new.latitude, new.longitude, new.geo_accuracy);

    -- ADDED: a report can only be made at the road (_report_location_max_m).
    if new.latitude is null or new.longitude is null then
      raise exception 'REPORT_TOO_FAR: a report needs the reporter''s GPS location';
    end if;
    if public._fmr_project_distance_m(
         nullif(substring(coalesce(new.project_id, '') from '^(?:fmr-)?([0-9]+)$'), '')::bigint,
         new.latitude, new.longitude) > public._report_location_max_m() then
      raise exception 'REPORT_TOO_FAR: the report location is more than % m from the road', public._report_location_max_m();
    end if;

    if auth.uid() is null then
      new.user_id := null;
    elsif new.user_id is distinct from auth.uid() then
      new.user_id := auth.uid();
    end if;
  end if;

  new.updated_at := coalesce(new.updated_at, now());
  return new;
end;
$function$;

-- Check (read-only): should return true, then 50000 while testing (1000 after the revert).
-- select pg_get_functiondef('public.public_report_prepare_citizen_insert'::regproc) ilike '%REPORT_TOO_FAR%';
-- select public._report_location_max_m();
