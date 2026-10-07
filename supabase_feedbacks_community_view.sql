-- ============================================================
-- Community feedback: share the feedback, not the people behind it.
--
-- Problem: public.feedbacks has a SELECT policy "Anyone can view feedbacks"
-- (USING true). Community Feedback is meant to be shared, but the same policy
-- lets any signed-in user read every row of the table through the API,
-- including each author's user_email and user_id. The project page was even
-- printing that email next to the feedback ("By someone@example.com").
--
-- Fix, following the pattern already used for public_reports_citizen_view:
--   1. A security_barrier view that exposes only public columns, plus
--      is_current_user_feedback so the app can mark "mine" without seeing ids.
--   2. The base table is limited to its author and admins.
--
-- Nothing is deleted or altered in the table. The app (src/lib/communityFeedback.js)
-- reads the view when it exists and falls back to the table when it does not, so
-- this can be run at any time. Safe to re-run.
--
-- Who still reads public.feedbacks directly after this:
--   * the author (their own rows)        - UserProfile, UserFeedback "mine" lookup
--   * admins (admin dashboard)           - status sync / inserts for citizen reports
--   * inserts/deletes by the author      - unchanged policies
-- Everyone else reads feedbacks_community_view.
--
-- Realtime note: Postgres change events follow the table's row-level security, so
-- after this a user is pushed live updates only for their OWN feedback. Others'
-- new feedback appears on the next load / refocus of the page.
-- ============================================================

begin;

-- 1. The shareable view ----------------------------------------------------

create or replace view public.feedbacks_community_view
with (security_barrier = true)
as
select
  f.id,
  f.project_id,
  f.project_name,
  f.type,
  f.message,
  f.photo_urls,
  f.latitude,
  f.longitude,
  f.geo_accuracy,
  f.status,
  f.created_at,
  f.updated_at,
  f.public_report_id,
  f.source,
  (f.user_id = auth.uid()) as is_current_user_feedback
from public.feedbacks f;

revoke all on public.feedbacks_community_view from public, anon;
grant select on public.feedbacks_community_view to authenticated;

-- 2. Limit the base table to its author and admins ---------------------------

drop policy if exists "Anyone can view feedbacks" on public.feedbacks;
drop policy if exists "feedbacks_select_owner_or_admin" on public.feedbacks;

create policy "feedbacks_select_owner_or_admin"
  on public.feedbacks
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or public.current_profile_role() = 'admin'
    or public.is_admin_jwt()
  );

commit;

-- ------------------------------------------------------------
-- Verify (run as a normal citizen, not in the SQL editor as postgres):
--   select count(*) from public.feedbacks_community_view;   -- everyone's feedback
--   select count(*) from public.feedbacks;                  -- only your own rows
--   select user_email from public.feedbacks_community_view; -- must ERROR (column absent)
--
-- Rollback:
--   drop policy "feedbacks_select_owner_or_admin" on public.feedbacks;
--   create policy "Anyone can view feedbacks" on public.feedbacks
--     for select to authenticated using (true);
--   drop view public.feedbacks_community_view;
-- ------------------------------------------------------------
