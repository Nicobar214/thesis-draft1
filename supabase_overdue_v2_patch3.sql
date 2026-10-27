-- =============================================================================
-- Overdue process v2 — patch 3: act-of-nature DOCUMENTS stay private.
--
--   Photos of what happened  -> public once the extension is approved (as before).
--   Official documents       -> only the DA, the assigned field engineer and the
--                               project's contractor (they can carry names,
--                               signatures and numbers: Data Privacy Act).
--   The public sees instead: "2 official documents checked by the DA · site
--   confirmed by Engr. <name>".
--
-- 1. Storage: the public read rule for approved extensions skips documents.
-- 2. project_extension_evidence: lists photos only.
-- 3. project_extension_history: adds the act-of-nature details, the document and
--    photo counts and the field check, for the public summary line.
-- Run after supabase_overdue_v2_patch2.sql. Safe to run again.
-- =============================================================================

-- 1. Public storage read: approved extension, and NOT an official document ----------
create or replace function public._delay_case_extended(p_object_name text)
 returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select exists (
    select 1 from public.project_delay_cases c
     where c.id::text = split_part(p_object_name, '/', 1)
       and c.outcome = 'extended')
     -- ADDED: documents are never public (staff read them through "delay evidence read").
     and not exists (
    select 1 from public.project_delay_evidence e
     where e.storage_path = p_object_name and e.category = 'document');
$function$;

-- 2. Public list of extension files: photos only ------------------------------------
create or replace function public.project_extension_evidence(p_project bigint)
 returns table(extension_no integer, kind text, storage_path text, file_name text, mime_type text, latitude double precision,
               longitude double precision, accuracy_m double precision, captured_at timestamp with time zone, attestation_code text)
 language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with ext as (
    select c.id, row_number() over (order by c.closed_at)::int as n
      from public.project_delay_cases c
     where c.project_id = p_project and c.outcome = 'extended')
  select ext.n, e.kind, e.storage_path, e.file_name, e.mime_type,
         e.latitude, e.longitude, e.accuracy_m::double precision, e.captured_at, e.attestation_code
    from ext join public.project_delay_evidence e on e.case_id = ext.id
   where e.category is distinct from 'document'          -- ADDED
   order by ext.n, e.created_at;
$function$;

-- 3. The history, with what the public summary needs ---------------------------------
drop function if exists public.project_extension_history(bigint);
create function public.project_extension_history(p_project bigint)
 returns table(extended_on date, previous_target date, new_target date, days_added integer, da_reason text,
               contractor_cause text, contractor_explanation text, evidence_count integer,
               kind text, offense_no integer, event_name text, stopped_days integer,
               document_count integer, photo_count integer, field_check text, checked_by text)
 language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select (c.closed_at at time zone 'Asia/Manila')::date,
         c.target_date_at_open,
         c.new_target_date,
         (c.new_target_date - c.target_date_at_open)::int,
         c.outcome_reason,
         c.cause,
         c.explanation,
         (select count(*)::int from public.project_delay_evidence e where e.case_id = c.id),
         c.kind, c.offense_no, c.event_name, c.stopped_days,
         (select count(*)::int from public.project_delay_evidence e where e.case_id = c.id and e.category = 'document'),
         (select count(*)::int from public.project_delay_evidence e where e.case_id = c.id and e.category is distinct from 'document'),
         case c.verdict when 'agree' then 'confirmed' when 'disagree' then 'not_confirmed' end,
         (select case when p.role = 'field_engineer' and btrim(p.full_name) !~* '^engr\.?\s' then 'Engr. ' || btrim(p.full_name)
                      else btrim(p.full_name) end
            from public.profiles p where p.id = c.verifier_id and c.verdict is not null and nullif(btrim(p.full_name), '') is not null)
    from public.project_delay_cases c
   where c.project_id = p_project and c.outcome = 'extended'
   order by c.closed_at;
$function$;
revoke all on function public.project_extension_history(bigint) from public;
grant execute on function public.project_extension_history(bigint) to anon, authenticated;

notify pgrst, 'reload schema';

-- Checks (read-only):
-- select kind, event_name, document_count, photo_count, field_check, checked_by from public.project_extension_history(347);
-- select count(*) from public.project_extension_evidence(347);   -- photos only
