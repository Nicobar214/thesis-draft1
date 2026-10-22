-- What the DA decides after the FMR prioritization ranks a road
-- (src/lib/priorityDecisions.js). One row per candidate, holding its current
-- step. Run once in the Supabase SQL editor.
--
--   New road suggestion (candidate_kind 'gap', a road_network_gaps row):
--     shortlisted -> for_validation -> endorsed -> converted (end: FMR project created)
--   Ongoing project (candidate_kind 'project', an fmr_projects row):
--     flagged -> action_recorded -> closed (end)
--   Either can be 'deferred' (with a note) and resumed.

create table if not exists public.priority_decisions (
  id uuid primary key default gen_random_uuid(),
  candidate_kind text not null check (candidate_kind in ('gap', 'project')),
  candidate_id text not null,
  status text not null check (status in (
    'shortlisted', 'for_validation', 'endorsed', 'converted',
    'flagged', 'action_recorded', 'closed', 'deferred'
  )),
  action text,                 -- ongoing projects: the action decided
  note text,
  score_snapshot jsonb,        -- rank, score and the 5 criteria when decided
  fmr_project_id bigint references public.fmr_projects(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_kind, candidate_id),
  -- a gap moves through gap steps, a project through project steps
  check (
    status = 'deferred'
    or (candidate_kind = 'gap' and status in ('shortlisted', 'for_validation', 'endorsed', 'converted'))
    or (candidate_kind = 'project' and status in ('flagged', 'action_recorded', 'closed'))
  )
);

create or replace function public.priority_decisions_touch()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists priority_decisions_touch on public.priority_decisions;
create trigger priority_decisions_touch
  before update on public.priority_decisions
  for each row execute function public.priority_decisions_touch();

alter table public.priority_decisions enable row level security;

-- The DA admin decides; field engineers can see what was sent for validation.
drop policy if exists priority_decisions_select on public.priority_decisions;
create policy priority_decisions_select on public.priority_decisions
  for select to authenticated
  using (public.current_profile_role() in ('admin', 'field_engineer'));

drop policy if exists priority_decisions_write_admin on public.priority_decisions;
create policy priority_decisions_write_admin on public.priority_decisions
  for all to authenticated
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');
