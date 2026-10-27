-- =============================================================================
-- Who handled a road report, for citizens (Community Feedback / My Reports).
-- ADDS COLUMNS TO TWO CITIZEN VIEWS; nothing else changes.
--
-- The citizen views already show when a report was inspected and repaired, the
-- inspection photo and the after-photo, but not WHO did it. For transparency
-- they now also name:
--   public_report_field_findings_citizen_view.inspected_by_name
--   public_report_repair_actions_citizen_view.repaired_by_name
--       the contractor (company name), "LGU of <town>" (the office, not a staff
--       member), or "Department of Agriculture"
--   public_report_repair_actions_citizen_view.verified_by_name
-- Each name is ready to show: a field engineer is "Engr. <name>" (not twice when
-- the profile name already says "Engr."), anyone else (the DA admin account,
-- a contractor) is shown by name only. The app adds nothing.
--
-- v2 (2026-10-27): fixes "Engr. Engr. <name>" and "Engr. Department of
-- Agriculture Region - VI" (a repair checked by the admin account). Re-run this file.
--
-- Each view is its live definition (copied 2026-10-27) with the new columns added
-- at the END (CREATE OR REPLACE VIEW keeps the existing columns and grants).
-- Run once in the Supabase SQL editor. Safe to run again.
-- =============================================================================

create or replace view public.public_report_field_findings_citizen_view with (security_barrier = true) as
 SELECT f.id,
    f.report_id,
    f.status,
    f.condition_observed,
    f.recommended_action,
    f.estimated_cost_range,
    f.field_photo_url,
    f.site_rating,
    f.submitted_at,
    f.validated_at,
    f.created_at,
    -- ADDED: ready-to-show name of who inspected
    (select case
              when p.role = 'field_engineer' and btrim(p.full_name) !~* '^engr\.?\s' then 'Engr. ' || btrim(p.full_name)
              else btrim(p.full_name)
            end
       from public.profiles p where p.id = f.engineer_id and nullif(btrim(p.full_name), '') is not null) as inspected_by_name
   FROM (public_report_field_findings f
     JOIN public_reports pr ON ((pr.id = f.report_id)))
  WHERE ((f.status = ANY (ARRAY['submitted'::text, 'validated'::text])) AND ((pr.status <> 'dismissed'::text) OR (pr.user_id = auth.uid())));

create or replace view public.public_report_repair_actions_citizen_view with (security_barrier = true) as
 SELECT a.id,
    a.report_id,
    a.kind,
    a.status,
    a.responsible_party,
    a.target_date,
    a.completed_at,
    a.verified_at,
    a.verification_photo_url,
    a.created_at,
    a.work_photo_url,
    a.work_submitted_at,
    a.accepted_at,
    a.work_date,
    a.started_at,
    -- ADDED: ready-to-show names of who repaired and who checked it
    case a.responsible_party
      when 'lgu' then coalesce('LGU of ' || nullif(btrim(pr.municipality), ''), 'The LGU')
      when 'da' then 'Department of Agriculture'
      else coalesce((select nullif(btrim(p.full_name), '') from public.profiles p
                      where p.id = coalesce(a.work_submitted_by, a.completed_by, a.accepted_by)), 'The project contractor')
    end as repaired_by_name,
    (select case
              when p.role = 'field_engineer' and btrim(p.full_name) !~* '^engr\.?\s' then 'Engr. ' || btrim(p.full_name)
              else btrim(p.full_name)
            end
       from public.profiles p where p.id = a.verified_by and nullif(btrim(p.full_name), '') is not null) as verified_by_name
   FROM (public_report_repair_actions a
     JOIN public_reports pr ON ((pr.id = a.report_id)))
  WHERE ((a.status <> 'cancelled'::text) AND ((pr.status <> 'dismissed'::text) OR (pr.user_id = auth.uid())));

-- Check (read-only): no "Engr. Engr." and no "Engr." on the admin account.
-- select inspected_by_name from public.public_report_field_findings_citizen_view;
-- select repaired_by_name, verified_by_name from public.public_report_repair_actions_citizen_view;
