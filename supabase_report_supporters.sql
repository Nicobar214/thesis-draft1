-- ============================================================
-- "I see this too" on community road reports.
--
-- Reports are now visible to the whole community. Instead of filing a duplicate,
-- a citizen can back an existing report. Staff get a real priority signal (how many
-- residents are affected) and fewer duplicates to triage.
--
-- Purely additive: one table, one view, two helper functions, one trigger. No
-- existing table, view or policy is changed. Safe to re-run.
--
-- Rules enforced by the database (not just the UI):
--   * you cannot back your own report
--   * only reports still open (pending / reviewed) can be backed
--   * one backing per citizen per report; you can withdraw it
--   * you can see only your own rows; counts come from a view that never exposes who
--
-- Notifications: when a report reaches 3, 5 or 10 supporters, the reporter and the
-- admins are told. Messages never include anyone's name.
--
-- Rollback:
--   drop trigger report_supporter_notify on public.public_report_supporters;
--   drop function public.notify_report_supporter_milestone();
--   drop view public.public_report_support_counts;
--   drop table public.public_report_supporters;
--   drop function public.citizen_can_support_report(uuid);
-- ============================================================

begin;

create table if not exists public.public_report_supporters (
  report_id   uuid not null references public.public_reports(id) on delete cascade,
  user_id     uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (report_id, user_id)
);

create index if not exists public_report_supporters_user_idx
  on public.public_report_supporters (user_id);

-- True when the signed-in user may back this report: it is open and not their own.
-- security definer because citizens cannot read public.public_reports directly
-- (they use public_reports_citizen_view); it returns only true/false.
create or replace function public.citizen_can_support_report(p_report_id uuid)
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
      and r.status in ('pending', 'reviewed')
      and r.user_id is distinct from auth.uid()
  );
$$;

revoke all on function public.citizen_can_support_report(uuid) from public, anon;
grant execute on function public.citizen_can_support_report(uuid) to authenticated;

alter table public.public_report_supporters enable row level security;

drop policy if exists "report_supporters_select" on public.public_report_supporters;
drop policy if exists "report_supporters_insert" on public.public_report_supporters;
drop policy if exists "report_supporters_delete" on public.public_report_supporters;

create policy "report_supporters_select"
  on public.public_report_supporters
  for select to authenticated
  using (user_id = auth.uid());

create policy "report_supporters_insert"
  on public.public_report_supporters
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.citizen_can_support_report(report_id)
  );

-- Withdrawing is always allowed, even after the report moves on.
create policy "report_supporters_delete"
  on public.public_report_supporters
  for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.public_report_supporters from public, anon;
grant select, insert, delete on public.public_report_supporters to authenticated;

-- Counts for everyone, identities for no one. The view runs with its owner's rights
-- (so it can count every row) and exposes only the total and the viewer's own flag.
-- Dismissed reports are hidden unless they are the viewer's own, as in the citizen view.
create or replace view public.public_report_support_counts
with (security_barrier = true)
as
select
  s.report_id,
  count(*)::int as support_count,
  coalesce(bool_or(s.user_id = auth.uid()), false) as i_support
from public.public_report_supporters s
join public.public_reports r on r.id = s.report_id
where r.status <> 'dismissed' or r.user_id = auth.uid()
group by s.report_id;

revoke all on public.public_report_support_counts from public, anon;
grant select on public.public_report_support_counts to authenticated;

-- Milestone notifications ---------------------------------------------------------
create or replace function public.notify_report_supporter_milestone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count  int;
  r        record;
  v_place  text;
  v_title  text;
begin
  select count(*) into v_count
  from public.public_report_supporters
  where report_id = new.report_id;

  if v_count not in (3, 5, 10) then
    return new;
  end if;

  select pr.user_id, pr.barangay, pr.municipality
    into r
  from public.public_reports pr
  where pr.id = new.report_id;
  if not found then
    return new;
  end if;

  v_place := coalesce(nullif(concat_ws(', ', r.barangay, r.municipality), ''), 'the reported location');
  v_title := v_count || ' residents report the same problem';

  insert into public.notifications (user_id, type, title, message, report_id, is_read)
  select p.id, 'public_report_support_milestone', v_title,
         v_count || ' residents now say they see the road problem at ' || v_place || ' too.',
         new.report_id, false
  from public.profiles p
  where p.role = 'admin';

  if r.user_id is not null then
    insert into public.notifications (user_id, type, title, message, report_id, is_read)
    values (r.user_id, 'public_report_support_milestone', v_title,
            v_count || ' other residents say they see the problem you reported at ' || v_place || ' too.',
            new.report_id, false);
  end if;

  return new;
end;
$$;

revoke all on function public.notify_report_supporter_milestone() from public, anon, authenticated;

drop trigger if exists report_supporter_notify on public.public_report_supporters;
create trigger report_supporter_notify
  after insert on public.public_report_supporters
  for each row execute function public.notify_report_supporter_milestone();

commit;
