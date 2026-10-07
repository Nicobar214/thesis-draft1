-- ============================================================
-- Citizen "Is it fixed?" confirmation.
--
-- Staff verify repairs on site, but the person who reported the problem is the
-- best witness that it is actually gone. After a report is resolved, the citizen
-- who filed it can answer yes / no (with an optional note). Staff can read the
-- answers to spot repairs that did not hold.
--
-- Purely additive: one new table. No existing table, view or policy is changed.
-- Safe to re-run.
--
-- Rules enforced by the database (not just the UI):
--   * only the citizen who owns the report can answer, and only once it is resolved
--   * one answer per citizen per report; they may change it later
--   * a citizen can read only their own answer; admins can read all
--
-- Rollback:  drop table public.public_report_citizen_confirmations;
-- ============================================================

begin;

create table if not exists public.public_report_citizen_confirmations (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.public_reports(id) on delete cascade,
  user_id     uuid not null default auth.uid(),
  is_fixed    boolean not null,
  comment     text check (comment is null or char_length(comment) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (report_id, user_id)
);

create index if not exists public_report_citizen_confirmations_report_idx
  on public.public_report_citizen_confirmations (report_id);

alter table public.public_report_citizen_confirmations enable row level security;

drop policy if exists "citizen_confirmations_select" on public.public_report_citizen_confirmations;
drop policy if exists "citizen_confirmations_insert" on public.public_report_citizen_confirmations;
drop policy if exists "citizen_confirmations_update" on public.public_report_citizen_confirmations;

create policy "citizen_confirmations_select"
  on public.public_report_citizen_confirmations
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_profile_role() = 'admin'
    or public.is_admin_jwt()
  );

create policy "citizen_confirmations_insert"
  on public.public_report_citizen_confirmations
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.public_reports r
      where r.id = report_id
        and r.user_id = auth.uid()
        and r.status = 'resolved'
    )
  );

create policy "citizen_confirmations_update"
  on public.public_report_citizen_confirmations
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.public_reports r
      where r.id = report_id
        and r.user_id = auth.uid()
        and r.status = 'resolved'
    )
  );

revoke all on public.public_report_citizen_confirmations from public, anon;
grant select, insert, update on public.public_report_citizen_confirmations to authenticated;

commit;
