-- ============================================================
-- Citizen "Is it fixed?" confirmation.
--
-- Staff verify repairs on site, but the person who reported the problem is the
-- best witness that it is actually gone. After a report is resolved, the citizen
-- who filed it can answer yes / no (with an optional note). Staff can read the
-- answers to spot repairs that did not hold.
--
-- Purely additive: one new table and one small helper function. No existing
-- table, view or policy is changed. Safe to re-run (also safe to re-run over the
-- first version of this file, which had a policy that always denied citizens).
--
-- Rules enforced by the database (not just the UI):
--   * only the citizen who owns the report can answer, and only once it is resolved
--   * one answer per citizen per report; they may change it later
--   * a citizen can read only their own answer; admins can read all
--
-- Why a helper function: citizens have no SELECT access to public.public_reports
-- (they read through public_reports_citizen_view), so a policy that queried the
-- table directly saw no rows and rejected every answer. The security definer
-- function checks ownership with the right privileges and returns only true/false.
--
-- Rollback:
--   drop trigger citizen_confirmation_notify on public.public_report_citizen_confirmations;
--   drop function public.notify_citizen_confirmation();
--   drop table public.public_report_citizen_confirmations;
--   drop function public.citizen_can_confirm_report(uuid);
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

-- True only when the signed-in user filed this report and it is resolved.
create or replace function public.citizen_can_confirm_report(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.public_reports r
    where r.id = p_report_id
      and r.user_id = auth.uid()
      and r.status = 'resolved'
  );
$$;

revoke all on function public.citizen_can_confirm_report(uuid) from public, anon;
grant execute on function public.citizen_can_confirm_report(uuid) to authenticated;

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
    and public.citizen_can_confirm_report(report_id)
  );

create policy "citizen_confirmations_update"
  on public.public_report_citizen_confirmations
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.citizen_can_confirm_report(report_id)
  );

revoke all on public.public_report_citizen_confirmations from public, anon;
grant select, insert, update on public.public_report_citizen_confirmations to authenticated;

-- Notify staff when a citizen answers -----------------------------------------
-- Done in the database rather than the browser: a citizen's browser cannot list
-- the admins, and a trigger cannot be skipped by a client. It runs when an answer
-- is first saved or when yes/no changes (editing only the note stays quiet).
--   * admins are told about every answer (the case file shows it under the repair)
--   * the assigned engineer is also told when the answer is "still a problem"
-- The message never includes the citizen's name or contact details.
create or replace function public.notify_citizen_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r        record;
  v_type   text;
  v_title  text;
  v_msg    text;
  v_place  text;
  v_note   text;
begin
  if tg_op = 'UPDATE' and old.is_fixed is not distinct from new.is_fixed then
    return new;
  end if;

  select pr.id, pr.barangay, pr.municipality, pr.assigned_engineer_id
    into r
  from public.public_reports pr
  where pr.id = new.report_id;
  if not found then
    return new;
  end if;

  v_place := coalesce(nullif(concat_ws(', ', r.barangay, r.municipality), ''), 'the reported location');
  v_note  := case when nullif(trim(new.comment), '') is not null
                  then ' "' || left(trim(new.comment), 140) || '"' else '' end;

  if new.is_fixed then
    v_type  := 'public_report_citizen_confirmed';
    v_title := 'Reporter confirms the repair';
    v_msg   := 'The citizen who reported the problem at ' || v_place || ' says it is fixed.' || v_note;
  else
    v_type  := 'public_report_citizen_disputed';
    v_title := 'Reporter says it is still a problem';
    v_msg   := 'The citizen who reported the problem at ' || v_place
               || ' says it is still there. Consider re-checking the repair.' || v_note;
  end if;

  insert into public.notifications (user_id, type, title, message, report_id, is_read)
  select p.id, v_type, v_title, v_msg, new.report_id, false
  from public.profiles p
  where p.role = 'admin';

  if not new.is_fixed and r.assigned_engineer_id is not null then
    insert into public.notifications (user_id, type, title, message, report_id, is_read)
    values (r.assigned_engineer_id, v_type, v_title, v_msg, new.report_id, false);
  end if;

  return new;
end;
$$;

revoke all on function public.notify_citizen_confirmation() from public, anon, authenticated;

drop trigger if exists citizen_confirmation_notify on public.public_report_citizen_confirmations;
create trigger citizen_confirmation_notify
  after insert or update of is_fixed on public.public_report_citizen_confirmations
  for each row execute function public.notify_citizen_confirmation();

commit;
