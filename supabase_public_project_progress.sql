-- ============================================================
-- Public project progress timeline.
--
-- Contractors submit progress updates and DA staff approve them, but citizens cannot
-- read public.progress_updates (it also holds billing amounts, billing holds,
-- contractor and engineer ids, and internal remarks). This view publishes only the
-- parts that are meant to be public, and only for approved updates:
--
--   project_id       which road
--   accomplishment   the engineer-certified % when there is one, otherwise the
--                    approved reported %
--   is_certified     true when a site engineer certified the figure
--   photo_url        a progress photo, if the contractor attached one
--   period_start/end the period the update covers
--   approved_at      when it was approved
--
-- Deliberately NOT exposed: remarks, certification remarks, billing amounts and holds,
-- work items, remaining scope, and every person's id.
--
-- Purely additive: one view. Nothing existing is changed. Safe to re-run.
-- Rollback:  drop view public.public_project_progress;
-- ============================================================

begin;

create or replace view public.public_project_progress
with (security_barrier = true)
as
select
  pu.id,
  pu.fmr_project_id                                         as project_id,
  coalesce(pu.certified_accomplishment, pu.reported_accomplishment) as accomplishment,
  (pu.certification_status = 'certified')                   as is_certified,
  pu.photo_url,
  pu.period_start,
  pu.period_end,
  coalesce(pu.reviewed_at, pu.certified_at, pu.submitted_at) as approved_at
from public.progress_updates pu
where pu.status = 'approved'
  and coalesce(pu.certified_accomplishment, pu.reported_accomplishment) is not null;

revoke all on public.public_project_progress from public, anon;
grant select on public.public_project_progress to authenticated;

commit;
