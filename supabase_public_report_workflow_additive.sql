-- Additive workflow tables for Public Report lifecycle (Citizen -> Admin -> Field Engineer -> Resolution)
-- Safe to run multiple times.

create extension if not exists pgcrypto;

create table if not exists public.public_report_workflow_meta (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.public_reports(id) on delete cascade,
  priority_level text not null default 'medium',
  visit_deadline date,
  assigned_engineer_id uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.public_report_field_findings (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.public_reports(id) on delete cascade,
  engineer_id uuid,
  condition_observed text not null,
  recommended_action text not null,
  estimated_cost_range text,
  field_photo_url text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.public_report_visits (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.public_reports(id) on delete cascade,
  engineer_id uuid,
  visited_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now()
);

create table if not exists public.public_report_resolutions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.public_reports(id) on delete cascade,
  summary text not null,
  resolved_by_name text,
  resolved_by_email text,
  resolved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.public_report_activity_logs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.public_reports(id) on delete cascade,
  action_type text not null,
  description text,
  metadata jsonb,
  actor_name text,
  actor_email text,
  created_at timestamptz not null default now()
);

create table if not exists public.public_report_admin_notes (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.public_reports(id) on delete cascade,
  admin_user_id uuid,
  note text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (report_id, admin_user_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null,
  title text,
  message text,
  report_id uuid references public.public_reports(id) on delete set null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_public_report_field_findings_report_id on public.public_report_field_findings(report_id);
create index if not exists idx_public_report_visits_report_id on public.public_report_visits(report_id);
create index if not exists idx_public_report_resolutions_report_id on public.public_report_resolutions(report_id);
create index if not exists idx_public_report_activity_logs_report_id on public.public_report_activity_logs(report_id);
create index if not exists idx_notifications_user_id on public.notifications(user_id);

alter table public.public_report_workflow_meta enable row level security;
alter table public.public_report_field_findings enable row level security;
alter table public.public_report_visits enable row level security;
alter table public.public_report_resolutions enable row level security;
alter table public.public_report_activity_logs enable row level security;
alter table public.public_report_admin_notes enable row level security;
alter table public.notifications enable row level security;

-- Minimal permissive policies for authenticated app usage; tighten as needed.
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'public_report_workflow_meta' and policyname = 'public_report_workflow_meta_rw'
  ) then
    create policy public_report_workflow_meta_rw on public.public_report_workflow_meta for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'public_report_field_findings' and policyname = 'public_report_field_findings_rw'
  ) then
    create policy public_report_field_findings_rw on public.public_report_field_findings for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'public_report_visits' and policyname = 'public_report_visits_rw'
  ) then
    create policy public_report_visits_rw on public.public_report_visits for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'public_report_resolutions' and policyname = 'public_report_resolutions_rw'
  ) then
    create policy public_report_resolutions_rw on public.public_report_resolutions for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'public_report_activity_logs' and policyname = 'public_report_activity_logs_rw'
  ) then
    create policy public_report_activity_logs_rw on public.public_report_activity_logs for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'public_report_admin_notes' and policyname = 'public_report_admin_notes_rw'
  ) then
    create policy public_report_admin_notes_rw on public.public_report_admin_notes for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_rw'
  ) then
    create policy notifications_rw on public.notifications for all to authenticated using (true) with check (true);
  end if;
end $$;
