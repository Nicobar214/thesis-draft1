-- =============================================================================
-- Evidence behind a granted extension is public. Run ONLY after
-- supabase_delay_evidence_and_extensions.sql. Run once in the Supabase SQL
-- editor. Safe to run again.
--
-- Once the DA grants an extension, the files the contractor sent with that
-- request can be seen by anyone viewing the project, citizens included, so the
-- new target is backed by its proof. Open and refused requests stay private
-- (_delay_can_view: DA admin, the contractor, the assigned field engineer).
--
--  1. _delay_case_extended(name): is this storage file part of a granted extension?
--  2. Storage read policy on "delay-evidence" for those files only.
--  3. project_extension_evidence(id): the files per extension, numbered like
--     project_extension_history (1 = first granted). The uploader is left out.
-- =============================================================================

-- 1. Helper (security definer: anon cannot read project_delay_cases) -----------------
create or replace function public._delay_case_extended(p_object_name text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.project_delay_cases c
     where c.id::text = split_part(p_object_name, '/', 1)
       and c.outcome = 'extended');
$$;
revoke all on function public._delay_case_extended(text) from public;
grant execute on function public._delay_case_extended(text) to anon, authenticated;

-- 2. Storage: anyone may open evidence of a granted extension ------------------------
drop policy if exists "delay evidence read extended" on storage.objects;
create policy "delay evidence read extended" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'delay-evidence' and public._delay_case_extended(name));

-- 3. Files per extension -----------------------------------------------------------
create or replace function public.project_extension_evidence(p_project bigint)
returns table (extension_no int, kind text, storage_path text, file_name text, mime_type text,
               latitude double precision, longitude double precision, accuracy_m double precision,
               captured_at timestamptz, attestation_code text)
language sql stable security definer set search_path = public, pg_temp as $$
  with ext as (
    select c.id, row_number() over (order by c.closed_at)::int as n
      from public.project_delay_cases c
     where c.project_id = p_project and c.outcome = 'extended')
  select ext.n, e.kind, e.storage_path, e.file_name, e.mime_type,
         e.latitude, e.longitude, e.accuracy_m::double precision, e.captured_at, e.attestation_code
    from ext join public.project_delay_evidence e on e.case_id = ext.id
   order by ext.n, e.created_at;
$$;
revoke all on function public.project_extension_evidence(bigint) from public;
grant execute on function public.project_extension_evidence(bigint) to anon, authenticated;

-- Checks (read-only):
-- select * from public.project_extension_evidence(347);   -- 2 rows: extension 1 and 2
-- select policyname from pg_policies where policyname = 'delay evidence read extended';
