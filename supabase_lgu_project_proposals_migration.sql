-- ============================================================
-- Supabase Migration: LGU Project Proposal workflow
-- Department of Agriculture - RAED Region VI
--
-- Real-world process: an LGU (municipality) proposes a Farm-to-Market
-- Road project. DA validates it for feasibility. Only upon DA approval
-- does the project become a real, publicly-visible fmr_projects row.
--
-- IMPORTANT: fmr_projects RLS grants unconditional anon SELECT on every
-- row regardless of status, and no page in this app filters fmr_projects
-- by status server-side. That means a proposal can never live in
-- fmr_projects pre-approval -- it must live in this separate table,
-- which intentionally has NO anon policy, so it stays private until a
-- DA admin approves it and a real fmr_projects row gets created
-- (see supabase_lgu_project_proposal_actions.sql).
--
-- Run this SQL in your Supabase SQL Editor.
-- ============================================================

create extension if not exists pgcrypto;

-- 1. Proposals table --------------------------------------------------

create table if not exists public.lgu_project_proposals (
  id                    uuid primary key default gen_random_uuid(),

  -- Location (mirrors fmr_projects columns so approval-time mapping is trivial)
  project_name          text not null,
  municipality          text not null,
  barangay              text default '',
  location              text default '',
  province              text default 'Iloilo',
  region                text default 'Region VI - Western Visayas',

  -- Proposal-specific content
  road_type             text default '',
  justification         text not null,
  description           text default '',
  estimated_length_km   double precision default 0,
  estimated_budget      numeric,
  target_funding_year   integer,
  beneficiary_farmers_count     integer default 0,
  beneficiary_households_count  integer default 0,

  -- Optional proposed geometry (may be absent at submission time)
  start_latitude        double precision,
  start_longitude       double precision,
  end_latitude          double precision,
  end_longitude         double precision,
  route_waypoints       jsonb default '[]'::jsonb,

  -- Attachments (object paths in the private lgu-proposal-documents bucket,
  -- NOT public URLs -- resolve with createSignedUrl at render time)
  document_url          text,
  document_name         text,
  photo_url             text,

  -- Lifecycle
  status                text not null default 'Submitted'
    check (status in ('Submitted', 'Under Validation', 'Needs Revision', 'Approved', 'Rejected')),
  submitted_by           uuid not null references public.profiles(id) on delete cascade,
  submitted_by_name      text,
  submitted_at           timestamptz not null default now(),
  reviewed_by            uuid references public.profiles(id),
  reviewed_by_name       text,
  reviewed_at            timestamptz,
  review_notes           text,
  revision_count         integer not null default 0,

  -- Approval linkage
  fmr_project_id         bigint references public.fmr_projects(id) on delete set null,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_lgu_project_proposals_municipality on public.lgu_project_proposals(municipality);
create index if not exists idx_lgu_project_proposals_status on public.lgu_project_proposals(status);
create index if not exists idx_lgu_project_proposals_submitted_by on public.lgu_project_proposals(submitted_by);
create index if not exists idx_lgu_project_proposals_fmr_project_id on public.lgu_project_proposals(fmr_project_id);

-- 2. Activity log (audit trail) ---------------------------------------

create table if not exists public.lgu_project_proposal_activity_logs (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid not null references public.lgu_project_proposals(id) on delete cascade,
  action_type   text not null,
  description   text,
  metadata      jsonb,
  actor_name    text,
  actor_email   text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_lgu_project_proposal_activity_logs_proposal_id
  on public.lgu_project_proposal_activity_logs(proposal_id);

-- 3. RLS ---------------------------------------------------------------
-- Authenticated-only, app-layer role separation -- same convention as
-- supabase_lgu_role_additive.sql. Deliberately NO anon policy: this is
-- what keeps proposals invisible to the public until DA approval mints
-- a real fmr_projects row.

alter table public.lgu_project_proposals enable row level security;
alter table public.lgu_project_proposal_activity_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='lgu_project_proposals' and policyname='lgu_project_proposals_rw'
  ) then
    create policy lgu_project_proposals_rw on public.lgu_project_proposals for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='lgu_project_proposal_activity_logs' and policyname='lgu_project_proposal_activity_logs_rw'
  ) then
    create policy lgu_project_proposal_activity_logs_rw on public.lgu_project_proposal_activity_logs for all to authenticated using (true) with check (true);
  end if;
end $$;

-- 4. Notifications: additive nullable column ---------------------------
-- report_id already exists and is FK-constrained to public_reports, so it
-- can't be reused for proposal ids. Add a sibling nullable column instead.

alter table public.notifications
  add column if not exists proposal_id uuid references public.lgu_project_proposals(id) on delete set null;

create index if not exists idx_notifications_proposal_id on public.notifications(proposal_id);

-- 5. Storage bucket for attachments (private, unlike every other bucket
--    in this app) -------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('lgu-proposal-documents', 'lgu-proposal-documents', false)
on conflict (id) do nothing;

do $$
begin
  drop policy if exists "Authenticated can upload proposal documents" on storage.objects;
  drop policy if exists "Authenticated can read proposal documents" on storage.objects;
exception when others then null;
end $$;

create policy "Authenticated can upload proposal documents"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'lgu-proposal-documents');

create policy "Authenticated can read proposal documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'lgu-proposal-documents');

-- 6. Realtime ------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'lgu_project_proposals'
  ) then
    alter publication supabase_realtime add table public.lgu_project_proposals;
  end if;
end $$;

-- ============================================================
-- Done. Next, run supabase_lgu_project_proposal_actions.sql for the
-- approve_lgu_project_proposal() RPC used by the DA admin "Approve" action.
-- ============================================================
