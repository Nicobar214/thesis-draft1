-- A new FMR project stays private until the DA admin drafts AND finalizes its
-- Work Plan; finalizing publishes it to the public, citizens, farmers and LGUs.
-- Run once in the Supabase SQL editor.
--
-- published_at: when the project became public (null = not public yet).
-- Every project that exists today stays public (most were imported before
-- Work Plans existed), so nothing currently visible disappears.

-- 1. The flag, with today's projects already published
alter table public.fmr_projects add column if not exists published_at timestamptz;

update public.fmr_projects
   set published_at = coalesce(created_at, now())
 where published_at is null;

-- New rows start unpublished (no default), whatever screen creates them.

-- 2. Finalizing the Work Plan publishes the project (once; reopening the plan
--    later does not take a public project back down).
create or replace function public.publish_fmr_project_on_finalized_work_plan()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.work_plan_status = 'finalized' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists fmr_projects_publish_on_finalized_work_plan on public.fmr_projects;
create trigger fmr_projects_publish_on_finalized_work_plan
  before insert or update of work_plan_status, published_at on public.fmr_projects
  for each row execute function public.publish_fmr_project_on_finalized_work_plan();

-- 3. Who can see an unpublished project: DA admin and field engineers (they
--    plan and inspect it) and the contractor assigned to it. Everyone else,
--    signed in or not, sees published projects only.
drop policy if exists "Anon users can view fmr_projects" on public.fmr_projects;
create policy "Anon users can view fmr_projects"
  on public.fmr_projects for select to anon
  using (published_at is not null);

drop policy if exists "Anyone authenticated can view fmr_projects" on public.fmr_projects;
create policy "Anyone authenticated can view fmr_projects"
  on public.fmr_projects for select to authenticated
  using (
    published_at is not null
    or public.current_profile_role() in ('admin', 'field_engineer')
  );
-- contractors_select_own_fmr_projects (contractor_id = auth.uid()) is unchanged,
-- so an assigned contractor still sees their project before it is public.
