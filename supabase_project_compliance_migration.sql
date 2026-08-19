-- ============================================================
-- KalsaTrack – Delays, time extensions, penalties, and billing holds
-- Department of Agriculture - RAED Region VI
-- Run this SQL in your Supabase SQL Editor.
--
-- WHY THIS EXISTS
-- ---------------
-- DA Region VI (WVSU-CICT Questionnaire, items 6 and 7):
--
--  6. "Delays/Extensions/Penalties: These are documented through progress
--      reports, site inspection reports, notices, and approved contract
--      amendments/extensions, with applicable penalties imposed for
--      contractor-caused delays."
--
--  7. "Crowdsourced Reports: Conflicting public reports are treated as
--      monitoring leads and are validated through site inspection and
--      supporting records. Payment is NOT automatically frozen, but affected
--      billings MAY BE HELD for verification if a credible discrepancy is
--      identified."
--
-- Item 7 is the missing link between the citizen-reporting module and the
-- money: today they are entirely separate. Note the emphasis -- DA is explicit
-- that payment is *not automatically* frozen. The hold is therefore a
-- deliberate human decision recorded here; there is intentionally NO trigger
-- and NO automation that sets it.
--
-- project_suspensions already exists (with a time_extension_ref TEXT), but a
-- suspension is not the same thing as an approved time extension, and there is
-- nowhere at all to record a penalty.
-- ============================================================

create extension if not exists pgcrypto;

-- 1. project_time_extensions ----------------------------------------------
-- An approved contract amendment / extension of contract time.

create table if not exists public.project_time_extensions (
  id                uuid primary key default gen_random_uuid(),
  project_id        bigint not null references public.fmr_projects(id) on delete cascade,
  days_granted      integer not null default 0,
  effective_date    date,
  reference_no      text,           -- the approved amendment / variation order number
  reason            text not null,
  approved_by       uuid references public.profiles(id) on delete set null,
  approved_by_name  text,
  suspension_id     uuid references public.project_suspensions(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_project_time_extensions_project_id
  on public.project_time_extensions(project_id);

-- 2. project_penalties -----------------------------------------------------
-- Liquidated damages for contractor-caused delay. is_contractor_caused is the
-- deciding field: DA only imposes penalties for delays attributable to the
-- contractor, so an excusable delay is recorded with the flag set false and a
-- zero amount, preserving the audit trail without imposing a charge.

create table if not exists public.project_penalties (
  id                    uuid primary key default gen_random_uuid(),
  project_id            bigint not null references public.fmr_projects(id) on delete cascade,
  basis                 text not null,
  days_delayed          integer not null default 0,
  amount                numeric not null default 0,
  is_contractor_caused  boolean not null default true,
  status                text not null default 'Assessed'
    check (status in ('Assessed', 'Waived', 'Collected')),
  assessed_by           uuid references public.profiles(id) on delete set null,
  assessed_by_name      text,
  assessed_at           timestamptz not null default now(),
  remarks               text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_project_penalties_project_id
  on public.project_penalties(project_id);

-- 3. Billing hold on progress_updates --------------------------------------
-- linked_report_id ties the hold back to the citizen report that raised the
-- credible discrepancy, which is exactly the audit trail DA describes.

alter table public.progress_updates
  add column if not exists billing_hold      boolean not null default false,
  add column if not exists hold_reason       text,
  add column if not exists held_by           uuid references public.profiles(id) on delete set null,
  add column if not exists held_at           timestamptz,
  add column if not exists released_hold_at  timestamptz,
  add column if not exists linked_report_id  uuid references public.public_reports(id) on delete set null;

create index if not exists idx_progress_updates_billing_hold
  on public.progress_updates(billing_hold) where billing_hold = true;

-- 4. RLS -------------------------------------------------------------------
-- SELECT broad (authenticated) so LGU/contractor read-only views need no
-- migration change later; writes admin-only via current_profile_role(), the
-- SECURITY DEFINER helper (a plain subquery on profiles would not bypass
-- profiles' own RLS and can silently fail -- see the scheduling migration).
-- Policies are dropped and recreated so re-running always applies the current
-- definition.

alter table public.project_time_extensions enable row level security;
alter table public.project_penalties       enable row level security;

drop policy if exists project_time_extensions_select_all   on public.project_time_extensions;
drop policy if exists project_time_extensions_admin_insert on public.project_time_extensions;
drop policy if exists project_time_extensions_admin_update on public.project_time_extensions;
drop policy if exists project_time_extensions_admin_delete on public.project_time_extensions;
drop policy if exists project_penalties_select_all   on public.project_penalties;
drop policy if exists project_penalties_admin_insert on public.project_penalties;
drop policy if exists project_penalties_admin_update on public.project_penalties;
drop policy if exists project_penalties_admin_delete on public.project_penalties;

create policy project_time_extensions_select_all on public.project_time_extensions
  for select to authenticated using (true);
create policy project_time_extensions_admin_insert on public.project_time_extensions
  for insert to authenticated with check (public.current_profile_role() = 'admin');
create policy project_time_extensions_admin_update on public.project_time_extensions
  for update to authenticated using (public.current_profile_role() = 'admin');
create policy project_time_extensions_admin_delete on public.project_time_extensions
  for delete to authenticated using (public.current_profile_role() = 'admin');

create policy project_penalties_select_all on public.project_penalties
  for select to authenticated using (true);
create policy project_penalties_admin_insert on public.project_penalties
  for insert to authenticated with check (public.current_profile_role() = 'admin');
create policy project_penalties_admin_update on public.project_penalties
  for update to authenticated using (public.current_profile_role() = 'admin');
create policy project_penalties_admin_delete on public.project_penalties
  for delete to authenticated using (public.current_profile_role() = 'admin');

-- 5. RPC: place / lift a billing hold --------------------------------------
-- Explicit, admin-only, and always requires a reason when placing a hold.
-- Deliberately NOT a trigger: DA says payment is not automatically frozen.

create or replace function public.set_billing_hold_admin(
  progress_update_id uuid,
  p_hold             boolean,
  p_reason           text default null,
  p_report_id        uuid default null
)
returns void as $$
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only admins can place or lift a billing hold';
  end if;

  if p_hold then
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'A reason is required when holding a billing for verification';
    end if;

    update public.progress_updates
    set billing_hold     = true,
        hold_reason      = p_reason,
        held_by          = auth.uid(),
        held_at          = now(),
        released_hold_at = null,
        linked_report_id = coalesce(p_report_id, linked_report_id)
    where id = progress_update_id;
  else
    update public.progress_updates
    set billing_hold     = false,
        released_hold_at = now()
    where id = progress_update_id;
  end if;

  if not found then
    raise exception 'Progress update not found';
  end if;
end;
$$ language plpgsql security definer
   set search_path = public
   set row_security = off;

grant execute on function public.set_billing_hold_admin(uuid, boolean, text, uuid) to authenticated;

-- 6. Realtime ---------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'project_time_extensions') then
    alter publication supabase_realtime add table public.project_time_extensions;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'project_penalties') then
    alter publication supabase_realtime add table public.project_penalties;
  end if;
end $$;

-- ============================================================
-- Done. Safe to re-run.
-- ============================================================
