-- ============================================================
-- Supabase Migration: Farmer Beneficiaries
-- LGU users create beneficiary records, DA admins validate them.
-- Run this SQL in your Supabase SQL Editor.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.farmer_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  beneficiary_id text not null unique,
  full_name text not null,
  rsbsa_number text not null,
  contact_number text default '',
  municipality text not null,
  barangay text not null,
  crop text not null,
  farm_area_ha numeric(10,2) not null default 0,
  estimated_yield numeric(12,1) not null default 0,
  linked_project_id text default '',
  linked_project_name text default '',
  linked_project_status text default 'On-Going',
  distance_to_fmr_km numeric(10,2) not null default 0,
  service_area text default '',
  benefit_reason text default '',
  beneficiary_status text not null default 'Under Review'
    check (beneficiary_status in ('Active Beneficiary', 'Under Review', 'Inactive')),
  validation_status text not null default 'For Verification'
    check (validation_status in ('For Verification', 'Validated', 'Needs Correction', 'Duplicate Record', 'Rejected', 'Archived')),
  submitted_by_lgu text not null,
  created_by_user_id uuid not null references public.profiles(id) on delete cascade,
  created_by_name text not null,
  created_by_role text not null default 'lgu',
  submitted_date timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  admin_remarks text default '',
  supporting_documents jsonb not null default '[]'::jsonb,
  validation_history jsonb not null default '[]'::jsonb,
  gps jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_farmer_beneficiaries_municipality on public.farmer_beneficiaries(municipality);
create index if not exists idx_farmer_beneficiaries_status on public.farmer_beneficiaries(validation_status);
create index if not exists idx_farmer_beneficiaries_created_by on public.farmer_beneficiaries(created_by_user_id);

alter table public.farmer_beneficiaries enable row level security;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    auth.jwt()->'user_metadata'->>'role',
    auth.jwt()->'app_metadata'->>'role',
    ''
  );
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'farmer_beneficiaries' and policyname = 'farmer_beneficiaries_select_own_or_admin'
  ) then
    create policy farmer_beneficiaries_select_own_or_admin
      on public.farmer_beneficiaries for select
      to authenticated
      using (
        created_by_user_id = auth.uid()
        or public.current_profile_role() = 'admin'
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'farmer_beneficiaries' and policyname = 'farmer_beneficiaries_insert_lgu_or_admin'
  ) then
    create policy farmer_beneficiaries_insert_lgu_or_admin
      on public.farmer_beneficiaries for insert
      to authenticated
      with check (
        created_by_user_id = auth.uid()
        and public.current_profile_role() in ('lgu', 'admin')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'farmer_beneficiaries' and policyname = 'farmer_beneficiaries_update_own_or_admin'
  ) then
    create policy farmer_beneficiaries_update_own_or_admin
      on public.farmer_beneficiaries for update
      to authenticated
      using (
        created_by_user_id = auth.uid()
        or public.current_profile_role() = 'admin'
      )
      with check (
        created_by_user_id = auth.uid()
        or public.current_profile_role() = 'admin'
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'farmer_beneficiaries' and policyname = 'farmer_beneficiaries_delete_admin_only'
  ) then
    create policy farmer_beneficiaries_delete_admin_only
      on public.farmer_beneficiaries for delete
      to authenticated
      using (
        public.current_profile_role() = 'admin'
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'farmer_beneficiaries'
  ) then
    alter publication supabase_realtime add table public.farmer_beneficiaries;
  end if;
end $$;
