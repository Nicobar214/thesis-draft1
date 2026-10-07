-- ============================================================
-- Follow a project.
--
-- A citizen follows a farm-to-market road project and is notified when it starts,
-- passes each 10% of progress, and is completed. This is the main reason to come
-- back to the app between reports.
--
-- Purely additive: one table, one counts view, one trigger function and one trigger.
-- No existing table, view or policy is changed. Safe to re-run.
--
-- Rules enforced by the database (not just the UI):
--   * you can follow and unfollow only as yourself
--   * you can read only your own follows; counts come from a view that never shows who
--
-- Notifications fire from the official figure citizens see (fmr_projects.accomplishment
-- and status), whichever way it gets updated. At most about 12 per project:
--   started (status becomes On-Going), every 10% milestone, completed.
-- Messages contain only the project name and progress - nothing about any person.
--
-- Rollback:
--   drop trigger trg_notify_project_followers on public.fmr_projects;
--   drop function public.notify_project_followers();
--   drop view public.project_follow_counts;
--   drop table public.project_follows;
-- ============================================================

begin;

create table if not exists public.project_follows (
  project_id  bigint not null references public.fmr_projects(id) on delete cascade,
  user_id     uuid   not null default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_follows_user_idx
  on public.project_follows (user_id);

alter table public.project_follows enable row level security;

drop policy if exists "project_follows_select" on public.project_follows;
drop policy if exists "project_follows_insert" on public.project_follows;
drop policy if exists "project_follows_delete" on public.project_follows;

create policy "project_follows_select"
  on public.project_follows
  for select to authenticated
  using (user_id = auth.uid());

create policy "project_follows_insert"
  on public.project_follows
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "project_follows_delete"
  on public.project_follows
  for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.project_follows from public, anon;
grant select, insert, delete on public.project_follows to authenticated;

-- How many people follow each project, and whether the viewer is one of them.
-- Runs with its owner's rights so it can count every row; exposes no identities.
create or replace view public.project_follow_counts
with (security_barrier = true)
as
select
  f.project_id,
  count(*)::int as follower_count,
  coalesce(bool_or(f.user_id = auth.uid()), false) as i_follow
from public.project_follows f
group by f.project_id;

revoke all on public.project_follow_counts from public, anon;
grant select on public.project_follow_counts to authenticated;

-- Notify followers when the project's official progress moves --------------------
create or replace function public.notify_project_followers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_pct     numeric := coalesce(old.accomplishment, 0);
  v_new_pct     numeric := coalesce(new.accomplishment, 0);
  v_old_status  text := lower(regexp_replace(coalesce(old.status, ''), '[-\s]', '', 'g'));
  v_new_status  text := lower(regexp_replace(coalesce(new.status, ''), '[-\s]', '', 'g'));
  v_name        text := coalesce(nullif(trim(new.project_name), ''), 'A road project you follow');
  v_type        text;
  v_title       text;
  v_msg         text;
  v_milestone   int;
begin
  if v_new_status = 'completed' and v_old_status <> 'completed' then
    v_type  := 'project_completed';
    v_title := 'Project completed';
    v_msg   := '"' || v_name || '" is now marked completed.';
  elsif v_new_status = 'ongoing' and v_old_status <> 'ongoing' and v_old_status <> 'completed' then
    v_type  := 'project_started';
    v_title := 'Work has started';
    v_msg   := 'Work on "' || v_name || '" is now under way.';
  elsif v_new_pct < 100 and floor(v_new_pct / 10) > floor(v_old_pct / 10) then
    v_milestone := (floor(v_new_pct / 10) * 10)::int;
    v_type  := 'project_milestone';
    v_title := 'Progress: ' || v_milestone || '% complete';
    v_msg   := '"' || v_name || '" has reached ' || v_milestone || '% complete.';
  else
    return new;
  end if;

  insert into public.notifications (user_id, type, title, message, project_id, is_read)
  select f.user_id, v_type, v_title, v_msg, new.id, false
  from public.project_follows f
  where f.project_id = new.id;

  return new;
end;
$$;

revoke all on function public.notify_project_followers() from public, anon, authenticated;

drop trigger if exists trg_notify_project_followers on public.fmr_projects;
create trigger trg_notify_project_followers
  after update of accomplishment, status on public.fmr_projects
  for each row execute function public.notify_project_followers();

commit;
