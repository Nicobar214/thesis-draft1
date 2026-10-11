-- ============================================================
-- Show citizens WHY their report was closed.
--
-- public_reports_citizen_view gains two columns (appended at the end, so
-- CREATE OR REPLACE VIEW keeps working and nothing else changes):
--   citizen_closed_category  'location_mismatch' | 'other' | null
--   citizen_closed_reason    the admin's dismissal reason, or null
--
-- Privacy: both are filled only for the reporter's OWN closed report
-- (pr.user_id = auth.uid()). Closed reports are already hidden from everyone
-- else by this view's WHERE clause; the extra check keeps the reason private
-- even if that clause changes later.
--
-- A rejection counts as a location mismatch when the reason was written by the
-- automated location check ("Automated location check: ...") or tagged by the
-- admin app ("Location mismatch: ...").
--
-- Safe to re-run. Undo by re-running the previous definition from
-- supabase_public_report_workflow_rls_hardening.sql.
-- ============================================================

create or replace view public.public_reports_citizen_view
with (security_barrier = true) as
 SELECT pr.id,
    pr.created_at,
    pr.updated_at,
    pr.region,
    pr.province,
    pr.municipality,
    pr.barangay,
    pr.street,
    pr.project_id,
    pr.project_name,
    pr.photo_url,
    pr.latitude,
    pr.longitude,
    pr.geo_accuracy,
    pr.photo_timestamp,
    pr.verification,
    pr.category,
    pr.description,
    pr.status,
    pr.severity_category,
    pr.specific_problem,
    pr.resolved_at,
    pr.dismissed_at,
    pr.user_id = auth.uid() AS is_current_user_report,
    pr.reviewed_at AS citizen_reviewed_at,
    pr.assigned_at AS citizen_field_dispatched_at,
    latest_finding.inspection_started_at AS citizen_inspection_started_at,
    latest_finding.submitted_at AS citizen_assessment_submitted_at,
        CASE
            WHEN pr.engineer_status = ANY (ARRAY['validated'::text, 'rejected'::text]) THEN latest_finding.updated_at
            ELSE NULL::timestamp with time zone
        END AS citizen_admin_decision_at,
        CASE
            WHEN pr.status = 'resolved'::text THEN 'resolved'::text
            WHEN pr.status = 'dismissed'::text THEN 'closed'::text
            WHEN pr.engineer_status = 'validated'::text THEN 'validated'::text
            WHEN pr.engineer_status = 'rejected'::text THEN 'reinspection_needed'::text
            WHEN pr.engineer_status = 'inspected'::text THEN 'assessment_submitted'::text
            WHEN pr.engineer_status = 'in_progress'::text THEN 'inspection_in_progress'::text
            WHEN pr.engineer_status = 'assigned'::text THEN 'field_engineer_dispatched'::text
            WHEN pr.status = 'reviewed'::text THEN 'under_review'::text
            ELSE 'submitted'::text
        END AS citizen_workflow_stage,
        CASE
            WHEN pr.status = 'resolved'::text THEN 'Resolved'::text
            WHEN pr.status = 'dismissed'::text THEN 'Closed'::text
            WHEN pr.engineer_status = ANY (ARRAY['assigned'::text, 'in_progress'::text]) THEN 'Site Inspection Scheduled'::text
            WHEN pr.engineer_status = ANY (ARRAY['inspected'::text, 'validated'::text]) THEN 'Under Verification'::text
            WHEN pr.engineer_status = 'rejected'::text THEN 'Under Review'::text
            WHEN pr.status = 'reviewed'::text THEN 'Under Review'::text
            ELSE 'Submitted'::text
        END AS citizen_status,
        CASE
            WHEN pr.status <> 'dismissed'::text OR pr.user_id IS DISTINCT FROM auth.uid() THEN NULL::text
            WHEN pr.dismissal_reason ILIKE 'Automated location check%'
              OR pr.dismissal_reason ILIKE 'Location mismatch%' THEN 'location_mismatch'::text
            ELSE 'other'::text
        END AS citizen_closed_category,
        CASE
            WHEN pr.status = 'dismissed'::text AND pr.user_id = auth.uid() THEN pr.dismissal_reason
            ELSE NULL::text
        END AS citizen_closed_reason
   FROM public_reports pr
     LEFT JOIN LATERAL ( SELECT f.inspection_started_at,
            f.submitted_at,
            f.updated_at
           FROM public_report_field_findings f
          WHERE f.report_id = pr.id
          ORDER BY f.inspection_number DESC NULLS LAST, f.created_at DESC NULLS LAST
         LIMIT 1) latest_finding ON true
  WHERE pr.status <> 'dismissed'::text OR pr.user_id = auth.uid();
