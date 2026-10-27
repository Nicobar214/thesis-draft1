-- =============================================================================
-- Progress updates need a geotagged site photo and a Statement of Work
-- Accomplished (SWA) file. Run once in the Supabase SQL editor. Safe to run again.
--
--  1. progress_updates.swa_path / swa_file_name / swa_uploaded_at.
--  2. PRIVATE bucket "progress-documents" (PDF or image, 10 MB): the contractor
--     uploads into a folder named after their user id; the contractor, the
--     update's site engineer and the DA admin can open it.
--  3. submit_progress_update_with_swa(...): the same as
--     submit_progress_update_with_quantities plus the SWA. It refuses a
--     submission without the photo or the SWA file, and saves the update and the
--     SWA together (one transaction). The old function is left as it was.
-- =============================================================================

-- 1. Columns ---------------------------------------------------------------------
alter table public.progress_updates add column if not exists swa_path text;
alter table public.progress_updates add column if not exists swa_file_name text;
alter table public.progress_updates add column if not exists swa_uploaded_at timestamptz;

-- 2. Private bucket + who can use it -------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-documents', 'progress-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "progress documents upload own" on storage.objects;
create policy "progress documents upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'progress-documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "progress documents delete own" on storage.objects;
create policy "progress documents delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'progress-documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- Security definer: the policy must see progress_updates whatever the reader's own access.
create or replace function public._progress_document_readable(p_name text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (
       split_part(p_name, '/', 1) = auth.uid()::text
    or public.public_report_current_role() = 'admin'
    or exists (select 1 from public.progress_updates u
                where u.swa_path = p_name and (u.site_engineer_id = auth.uid() or u.contractor_id = auth.uid())));
$$;
revoke all on function public._progress_document_readable(text) from public;
grant execute on function public._progress_document_readable(text) to authenticated;

drop policy if exists "progress documents read" on storage.objects;
create policy "progress documents read" on storage.objects
  for select to authenticated
  using (bucket_id = 'progress-documents' and public._progress_document_readable(name));

-- 3. Submit with the photo and the SWA -------------------------------------------------
create or replace function public.submit_progress_update_with_swa(
  p_fmr_project_id bigint, p_period_start date, p_period_end date, p_remarks text, p_items jsonb,
  p_contractor_certified boolean, p_photo_url text, p_amount_this_billing numeric, p_remaining_scope text,
  p_swa_path text, p_swa_file_name text)
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if coalesce(btrim(p_photo_url), '') = '' then
    raise exception 'Take a geotagged site photo first';
  end if;
  if coalesce(btrim(p_swa_path), '') = '' then
    raise exception 'Attach the Statement of Work Accomplished';
  end if;
  if split_part(p_swa_path, '/', 1) <> auth.uid()::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'progress-documents' and o.name = p_swa_path) then
    raise exception 'The Statement of Work Accomplished was not uploaded. Please attach it again';
  end if;

  v_id := public.submit_progress_update_with_quantities(
    p_fmr_project_id, p_period_start, p_period_end, p_remarks, p_items,
    p_contractor_certified, p_photo_url, p_amount_this_billing, p_remaining_scope);

  update public.progress_updates
     set swa_path = p_swa_path, swa_file_name = nullif(btrim(p_swa_file_name), ''), swa_uploaded_at = now()
   where id = v_id;
  return v_id;
end $$;
revoke all on function public.submit_progress_update_with_swa(bigint, date, date, text, jsonb, boolean, text, numeric, text, text, text) from public;
grant execute on function public.submit_progress_update_with_swa(bigint, date, date, text, jsonb, boolean, text, numeric, text, text, text) to authenticated;

-- Checks (read-only):
-- select id, public from storage.buckets where id = 'progress-documents';
-- select id, swa_file_name, swa_uploaded_at from public.progress_updates order by submitted_at desc limit 5;
