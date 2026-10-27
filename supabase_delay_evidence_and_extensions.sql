-- =============================================================================
-- Supporting evidence (contractor delay explanations + LGU project proposals)
-- and the extension note on a project. Run ONLY after supabase_project_delay_cases.sql.
-- Run once in the Supabase SQL editor. Safe to run again.
--
--  1. Two new photo kinds for the KalsaTrack camera (verification QR on /verify).
--  2. project_delay_evidence + a PRIVATE storage bucket "delay-evidence":
--     geotagged photos and files a contractor attaches to a delay explanation.
--     Only that project's contractor can add them, and only while it is their
--     turn to reply; the DA admin, that contractor and the assigned field
--     engineer can see them (_delay_can_view). Evidence is never edited.
--  3. lgu_project_proposals.supporting_evidence: photos/files an LGU adds to a
--     proposal (stored in the existing lgu-proposal-documents bucket).
--  4. Extensions carry the contractor's reason: the time-extension record now
--     says why the contractor was late, and project_extension_history(id) lists a
--     project's extensions (old -> new target, days, DA reason, contractor reason)
--     for the project page. delay_grant_extension is the live definition
--     (copied 2026-10-27) with ONE change, marked "CHANGED".
-- =============================================================================

-- 1. Photo kinds -------------------------------------------------------------------
alter table public.photo_attestations drop constraint if exists photo_attestations_kind_check;
alter table public.photo_attestations add constraint photo_attestations_kind_check check (kind = any (array[
  'citizen_report', 'field_inspection', 'repair_verification', 'contractor_progress',
  'progress_certification', 'priority_validation', 'priority_inspection',
  'delay_evidence', 'lgu_proposal_evidence'
]));

-- 2. Delay evidence -----------------------------------------------------------------
create table if not exists public.project_delay_evidence (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.project_delay_cases(id) on delete cascade,
  project_id     bigint not null,
  uploaded_by    uuid not null default auth.uid() references auth.users(id),
  kind           text not null check (kind in ('photo', 'file')),
  storage_path   text not null,
  file_name      text,
  mime_type      text,
  size_bytes     bigint check (size_bytes is null or size_bytes <= 10485760),
  latitude       double precision,
  longitude      double precision,
  accuracy_m     double precision,
  captured_at    timestamptz,
  attestation_code text,
  created_at     timestamptz not null default now()
);
create index if not exists project_delay_evidence_case_idx on public.project_delay_evidence (case_id);
alter table public.project_delay_evidence enable row level security;

-- May the signed-in user add evidence to this case now? (its contractor, their turn)
create or replace function public._delay_can_add_evidence(p_case uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.project_delay_cases c join public.fmr_projects p on p.id = c.project_id
     where c.id = p_case and auth.uid() is not null and p.contractor_id = auth.uid()
       and c.status in ('awaiting_explanation', 'revision_requested', 'final_notice'));
$$;
revoke all on function public._delay_can_add_evidence(uuid) from public, anon;
grant execute on function public._delay_can_add_evidence(uuid) to authenticated;

drop policy if exists project_delay_evidence_select on public.project_delay_evidence;
create policy project_delay_evidence_select on public.project_delay_evidence for select to authenticated
  using (exists (select 1 from public.project_delay_cases c where c.id = case_id and public._delay_can_view(c.project_id, c.verifier_id)));
drop policy if exists project_delay_evidence_insert on public.project_delay_evidence;
create policy project_delay_evidence_insert on public.project_delay_evidence for insert to authenticated
  with check (uploaded_by = auth.uid() and public._delay_can_add_evidence(case_id)
              and project_id = (select c.project_id from public.project_delay_cases c where c.id = case_id));
-- No update / delete policies: evidence is part of the record.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delay-evidence', 'delay-evidence', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Files live at "<case id>/<file>".
drop policy if exists "delay evidence upload" on storage.objects;
create policy "delay evidence upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'delay-evidence'
              and public._delay_can_add_evidence(nullif((storage.foldername(name))[1], '')::uuid));
drop policy if exists "delay evidence read" on storage.objects;
create policy "delay evidence read" on storage.objects for select to authenticated
  using (bucket_id = 'delay-evidence' and exists (
    select 1 from public.project_delay_cases c
     where c.id::text = (storage.foldername(name))[1] and public._delay_can_view(c.project_id, c.verifier_id)));

-- 3. LGU proposal evidence ----------------------------------------------------------
alter table public.lgu_project_proposals
  add column if not exists supporting_evidence jsonb not null default '[]'::jsonb;

-- 4. Extensions carry the contractor's reason ---------------------------------------
CREATE OR REPLACE FUNCTION public.delay_grant_extension(p_case uuid, p_new_target_date date, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c public.project_delay_cases; p public.fmr_projects; v_current date; v_ext uuid; v_name text;
begin
  perform public._delay_require_role('admin');
  c := public._delay_lock_case(p_case);
  perform public._delay_require_state(c.status, array['awaiting_decision']);
  if c.final_notice_missed then raise exception 'After a missed final notice, only Suspend or Terminate are allowed'; end if;
  perform public._delay_check_reason(p_reason, 'The reason');
  p := public._delay_lock_project(c.project_id);
  v_current := public._delay_parse_date(p.target_completion_date);
  if v_current is null then raise exception 'The project''s current target date cannot be read. Fix it first.'; end if;
  if p_new_target_date is null or p_new_target_date <= public._delay_today() or p_new_target_date <= v_current then
    raise exception 'The new target date must be after today (%) and after the current target date (%)', public._delay_today(), v_current;
  end if;
  if public._delay_extensions_used(p.id) >= 2 then
    raise exception 'This project already has 2 approved extensions; no more can be granted';
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  perform public._delay_set_target(p.id, p_new_target_date);
  insert into public.project_time_extensions (project_id, days_granted, effective_date, reference_no, reason, approved_by, approved_by_name)
  values (p.id, p_new_target_date - v_current, null, null,
          -- CHANGED: the record also says why the contractor was late.
          concat_ws(' ',
            format('Delay follow-up: extended from %s to %s. DA: %s', v_current, p_new_target_date, btrim(p_reason)),
            case when nullif(btrim(coalesce(c.explanation, '')), '') is not null then
              format('Contractor (%s): %s',
                case c.cause when 'weather' then 'Weather' when 'right_of_way' then 'Right-of-way' when 'materials' then 'Materials'
                             when 'fund_release' then 'Fund release' when 'design_change' then 'Design change' else 'Other' end,
                btrim(c.explanation))
            end),
          auth.uid(), v_name)
  returning id into v_ext;
  perform public._delay_close(c.id, 'extended', p_reason, p_new_target_date, null, public._delay_today() - c.target_date_at_open,
    jsonb_build_object('previous_target', v_current, 'extension_id', v_ext, 'extension_number', public._delay_extensions_used(p.id) + 1));
end $function$;

-- A project's extensions for its page (public projects: anyone may read them).
create or replace function public.project_extension_history(p_project bigint)
returns table (extended_on date, previous_target date, new_target date, days_added int,
               da_reason text, contractor_cause text, contractor_explanation text, evidence_count int)
language sql stable security definer set search_path = public, pg_temp as $$
  select (c.closed_at at time zone 'Asia/Manila')::date,
         c.target_date_at_open,
         c.new_target_date,
         (c.new_target_date - c.target_date_at_open)::int,
         c.outcome_reason,
         c.cause,
         c.explanation,
         (select count(*)::int from public.project_delay_evidence e where e.case_id = c.id)
    from public.project_delay_cases c
   where c.project_id = p_project and c.outcome = 'extended'
   order by c.closed_at;
$$;
revoke all on function public.project_extension_history(bigint) from public;
grant execute on function public.project_extension_history(bigint) to anon, authenticated;

-- Checks (read-only):
-- select * from storage.buckets where id = 'delay-evidence';                -- private, 10 MB
-- select * from public.project_extension_history(357);                      -- rows once extended
-- select column_name from information_schema.columns where table_name = 'lgu_project_proposals' and column_name = 'supporting_evidence';
