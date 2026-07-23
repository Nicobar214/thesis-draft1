-- ============================================================
-- Supabase Migration: Project Scheduling
-- Department of Agriculture - RAED Region VI
--
-- Adds per-project scheduling data (DPWH/PERT-CPM style): task phases,
-- milestones, and suspension periods, powering the new Calendar/Gantt/
-- Table views in the DA Admin "Project Management -> Timeline" tab.
--
-- project_id references fmr_projects(id), which is BIGINT (not uuid) --
-- match that type exactly. assigned_to / approved_by reuse the existing
-- profiles(id) RBAC -- no parallel person table.
--
-- Run this SQL in your Supabase SQL Editor.
-- ============================================================

create extension if not exists pgcrypto;

-- 1. project_tasks -------------------------------------------------------

create table if not exists public.project_tasks (
  id              uuid primary key default gen_random_uuid(),
  project_id      bigint not null references public.fmr_projects(id) on delete cascade,
  task_name       text not null,
  category        text not null default 'general_requirements'
    check (category in ('mobilization', 'earthworks', 'subbase_base', 'surface_course', 'bridge_works', 'general_requirements')),
  sequence_order  integer not null default 0,
  planned_start   date not null,
  planned_end     date not null,
  duration_cd     integer not null default 0,
  assigned_to     uuid references public.profiles(id),
  status          text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed', 'delayed', 'suspended')),
  remarks         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 2. project_milestones ---------------------------------------------------

create table if not exists public.project_milestones (
  id                      uuid primary key default gen_random_uuid(),
  project_id              bigint not null references public.fmr_projects(id) on delete cascade,
  milestone_name          text not null,
  milestone_date          date not null,
  contract_days_at_point  integer,
  approved_by             uuid references public.profiles(id),
  remarks                 text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- 3. project_suspensions ---------------------------------------------------

create table if not exists public.project_suspensions (
  id                  uuid primary key default gen_random_uuid(),
  project_id          bigint not null references public.fmr_projects(id) on delete cascade,
  suspension_start    date not null,
  suspension_end      date,
  reason              text not null,
  time_extension_ref  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_project_tasks_project_id on public.project_tasks(project_id);
create index if not exists idx_project_tasks_assigned_to on public.project_tasks(assigned_to);
create index if not exists idx_project_milestones_project_id on public.project_milestones(project_id);
create index if not exists idx_project_suspensions_project_id on public.project_suspensions(project_id);

-- 4. RLS -------------------------------------------------------------------
-- SELECT is broad (authenticated) so a future read-only LGU/contractor view
-- doesn't need a migration change. INSERT/UPDATE/DELETE are admin-only,
-- using the existing current_profile_role() helper (defined in
-- supabase_farmer_beneficiaries_migration.sql) rather than a raw
-- "exists (select ... from profiles ...)" subquery -- that helper is
-- SECURITY DEFINER, so its internal profiles lookup bypasses profiles' own
-- RLS; a plain subquery embedded directly in another table's policy does
-- NOT get that bypass and can silently fail to see the calling user's row,
-- which is what caused "new row violates row-level security policy" here.
--
-- Policies are dropped and recreated (not "if not exists") so re-running
-- this file after a prior run always applies the current definition.

alter table public.project_tasks enable row level security;
alter table public.project_milestones enable row level security;
alter table public.project_suspensions enable row level security;

drop policy if exists project_tasks_select_all on public.project_tasks;
drop policy if exists project_tasks_admin_insert on public.project_tasks;
drop policy if exists project_tasks_admin_update on public.project_tasks;
drop policy if exists project_tasks_admin_delete on public.project_tasks;
drop policy if exists project_milestones_select_all on public.project_milestones;
drop policy if exists project_milestones_admin_insert on public.project_milestones;
drop policy if exists project_milestones_admin_update on public.project_milestones;
drop policy if exists project_milestones_admin_delete on public.project_milestones;
drop policy if exists project_suspensions_select_all on public.project_suspensions;
drop policy if exists project_suspensions_admin_insert on public.project_suspensions;
drop policy if exists project_suspensions_admin_update on public.project_suspensions;
drop policy if exists project_suspensions_admin_delete on public.project_suspensions;

create policy project_tasks_select_all on public.project_tasks for select to authenticated using (true);
create policy project_tasks_admin_insert on public.project_tasks for insert to authenticated
  with check (public.current_profile_role() = 'admin');
create policy project_tasks_admin_update on public.project_tasks for update to authenticated
  using (public.current_profile_role() = 'admin');
create policy project_tasks_admin_delete on public.project_tasks for delete to authenticated
  using (public.current_profile_role() = 'admin');

create policy project_milestones_select_all on public.project_milestones for select to authenticated using (true);
create policy project_milestones_admin_insert on public.project_milestones for insert to authenticated
  with check (public.current_profile_role() = 'admin');
create policy project_milestones_admin_update on public.project_milestones for update to authenticated
  using (public.current_profile_role() = 'admin');
create policy project_milestones_admin_delete on public.project_milestones for delete to authenticated
  using (public.current_profile_role() = 'admin');

create policy project_suspensions_select_all on public.project_suspensions for select to authenticated using (true);
create policy project_suspensions_admin_insert on public.project_suspensions for insert to authenticated
  with check (public.current_profile_role() = 'admin');
create policy project_suspensions_admin_update on public.project_suspensions for update to authenticated
  using (public.current_profile_role() = 'admin');
create policy project_suspensions_admin_delete on public.project_suspensions for delete to authenticated
  using (public.current_profile_role() = 'admin');

-- 5. Notifications: additive nullable column (same precedent as proposal_id)

alter table public.notifications
  add column if not exists schedule_task_id uuid references public.project_tasks(id) on delete set null;

create index if not exists idx_notifications_schedule_task_id on public.notifications(schedule_task_id);

-- 6. Realtime ---------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'project_tasks') then
    alter publication supabase_realtime add table public.project_tasks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'project_milestones') then
    alter publication supabase_realtime add table public.project_milestones;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'project_suspensions') then
    alter publication supabase_realtime add table public.project_suspensions;
  end if;
end $$;

-- ============================================================
-- Done. New tables use proper DATE columns (unlike the legacy
-- fmr_projects.target_completion_date/date_completed, which are TEXT) --
-- that's a pre-existing quirk on fmr_projects, not replicated here.
-- ============================================================
