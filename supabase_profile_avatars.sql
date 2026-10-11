-- supabase_profile_avatars.sql
-- Profile photos for citizen and farmer accounts.
--
-- One public bucket, `avatars`. Each account may only write inside its own
-- folder: avatars/<auth.uid()>/<file>. Reading is public (the photo is shown
-- in the app header), so the URL is stored on the account itself
-- (auth user_metadata.avatar_url) and no table change is needed.
--
-- The app shrinks every photo to a 320x320 JPEG before upload, so the 2 MB
-- limit is generous; it only stops someone bypassing the app.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Needed so the app can list the account's own folder and clear out old photos.
drop policy if exists avatars_select_own on storage.objects;
create policy avatars_select_own
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
