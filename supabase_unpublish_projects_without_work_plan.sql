-- Follow-up to supabase_project_publish_on_work_plan.sql. That script marked
-- every project that existed at the time as public, including projects the
-- DA admin had created in the app but never finished planning. This hides
-- those again until their Work Plan is finalized (finalizing publishes them
-- automatically). Run once in the Supabase SQL editor.
--
-- "Created in the app" = remarks start with "FMR Code:" (what the admin's Add
-- Project form writes). Imported projects (DA-RAED and Leon CSV lists) are not
-- touched and stay public.
--
-- On 2026-10-22 this matched:
--   353 SAMPLE BARBARA 1, 345 SAMPLE TEST (draft), 338 Agbuy Sur Sample 3 (draft),
--   337 Agbuy Sur Sample 2, 200 CICT ROAD, 199 Lil Street, 198 Test Project 2

-- Preview first (optional):
-- select id, project_name, work_plan_status from public.fmr_projects
--  where remarks ilike 'FMR Code:%' and coalesce(work_plan_status, 'none') <> 'finalized'
--    and published_at is not null;

update public.fmr_projects
   set published_at = null
 where remarks ilike 'FMR Code:%'
   and coalesce(work_plan_status, 'none') <> 'finalized'
   and published_at is not null;
