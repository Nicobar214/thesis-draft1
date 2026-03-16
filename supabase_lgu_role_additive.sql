-- LGU additive role support for KalsaTrack
-- Creates escalation/decision records and municipality alert dedupe logs.

create extension if not exists pgcrypto;

create table if not exists public.public_report_lgu_escalations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.public_reports(id) on delete cascade,
  municipality text,
  barangay text,
  project_id text,
  project_name text,
  escalation_reason text,
  escalation_status text not null default 'for_action',
  escalated_by uuid,
  escalated_by_name text,
  decision_by text,
  decision_at timestamptz,
  decision_remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lgu_escalations_report_id on public.public_report_lgu_escalations(report_id);
create index if not exists idx_lgu_escalations_municipality on public.public_report_lgu_escalations(municipality);
create index if not exists idx_lgu_escalations_status on public.public_report_lgu_escalations(escalation_status);

create table if not exists public.public_report_lgu_decisions (
  id uuid primary key default gen_random_uuid(),
  escalation_id uuid references public.public_report_lgu_escalations(id) on delete cascade,
  report_id uuid not null references public.public_reports(id) on delete cascade,
  municipality text,
  decision text not null,
  remarks text,
  lgu_user_id uuid,
  lgu_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_lgu_decisions_report_id on public.public_report_lgu_decisions(report_id);
create index if not exists idx_lgu_decisions_municipality on public.public_report_lgu_decisions(municipality);

create table if not exists public.lgu_project_alert_logs (
  id uuid primary key default gen_random_uuid(),
  project_key text not null,
  municipality text,
  threshold_value int not null,
  alert_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (project_key, threshold_value, alert_date)
);

create index if not exists idx_lgu_project_alert_logs_municipality on public.lgu_project_alert_logs(municipality);

alter table public.public_report_lgu_escalations enable row level security;
alter table public.public_report_lgu_decisions enable row level security;
alter table public.lgu_project_alert_logs enable row level security;

-- permissive authenticated policies; tighten according to your RLS model.
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='public_report_lgu_escalations' and policyname='public_report_lgu_escalations_rw'
  ) then
    create policy public_report_lgu_escalations_rw on public.public_report_lgu_escalations for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='public_report_lgu_decisions' and policyname='public_report_lgu_decisions_rw'
  ) then
    create policy public_report_lgu_decisions_rw on public.public_report_lgu_decisions for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='lgu_project_alert_logs' and policyname='lgu_project_alert_logs_rw'
  ) then
    create policy lgu_project_alert_logs_rw on public.lgu_project_alert_logs for all to authenticated using (true) with check (true);
  end if;
end $$;
