-- =============================================================================
-- Admin-assisted password reset (accounts without a reachable email inbox).
-- Run once in the Supabase SQL editor. Safe to run again.
--
--   Admin  -> Settings -> Account passwords -> [Reset password]
--          admin_reset_password(user) gives a one-time temporary password
--          (e.g. KT-7M2Q-9XBN), shown to the admin once, and signs the
--          account out everywhere.
--   User   -> signs in with it -> must set a new password before using the app
--          (my_password_reset_pending / password_change_done).
--
-- account_password_resets is the log (who reset whom, when, when it was
-- changed) and the "must change" flag. Users can only read their own rows, so
-- they cannot clear the flag without really changing the password.
-- Admin accounts are not reset here: use Supabase -> Authentication -> Users.
-- =============================================================================

create table if not exists public.account_password_resets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  reset_by    uuid not null references auth.users(id),
  temp_hash   text not null,               -- the temporary password's hash, to tell it was changed
  created_at  timestamptz not null default now(),
  changed_at  timestamptz                  -- null = must still change the password
);
create index if not exists account_password_resets_open on public.account_password_resets (user_id) where changed_at is null;

alter table public.account_password_resets enable row level security;
drop policy if exists account_password_resets_select on public.account_password_resets;
create policy account_password_resets_select on public.account_password_resets
  for select to authenticated using (user_id = auth.uid() or public.is_admin_jwt());
revoke all on public.account_password_resets from anon;
grant select on public.account_password_resets to authenticated;

-- Accounts for the admin's list, with whether a reset is waiting to be used.
create or replace function public.admin_list_accounts(p_search text default null)
returns table (id uuid, email text, full_name text, role text, municipality text,
               reset_pending boolean, last_reset_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._public_report_require_admin();
  return query
    select p.id, p.email, p.full_name, p.role, p.municipality,
           exists (select 1 from public.account_password_resets r where r.user_id = p.id and r.changed_at is null),
           (select max(r.created_at) from public.account_password_resets r where r.user_id = p.id)
      from public.profiles p
     where coalesce(btrim(p_search), '') = ''
        or p.email ilike '%' || btrim(p_search) || '%'
        or p.full_name ilike '%' || btrim(p_search) || '%'
     order by p.role, coalesce(p.full_name, p.email)
     limit 200;
end $$;
revoke all on function public.admin_list_accounts(text) from public;
grant execute on function public.admin_list_accounts(text) to authenticated;

-- Sets a one-time temporary password and returns it (shown to the admin once).
create or replace function public.admin_reset_password(p_user uuid)
returns text
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  v_role text;
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';   -- no 0/O, 1/I/L, U: easy to read out
  v_bytes bytea := gen_random_bytes(8);
  v_code text := '';
  v_temp text;
  v_hash text;
begin
  perform public._public_report_require_admin();
  if p_user = auth.uid() then
    raise exception 'Use your own profile page to change your password';
  end if;
  select lower(coalesce(role, '')) into v_role from public.profiles where id = p_user;
  if not found then
    raise exception 'Account not found';
  end if;
  if v_role = 'admin' then
    raise exception 'Admin passwords are reset in Supabase (Authentication -> Users)';
  end if;

  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
  end loop;
  v_temp := 'KT-' || substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);
  v_hash := crypt(v_temp, gen_salt('bf'));

  update auth.users set encrypted_password = v_hash, updated_at = now() where id = p_user;
  -- Sign the account out everywhere: whoever had it must use the new password.
  delete from auth.refresh_tokens where user_id::text = p_user::text;
  delete from auth.sessions where user_id = p_user;

  update public.account_password_resets set changed_at = now() where user_id = p_user and changed_at is null;
  insert into public.account_password_resets (user_id, reset_by, temp_hash) values (p_user, auth.uid(), v_hash);
  return v_temp;
end $$;
revoke all on function public.admin_reset_password(uuid) from public;
grant execute on function public.admin_reset_password(uuid) to authenticated;

-- For the signed-in user: must they set a new password first?
create or replace function public.my_password_reset_pending()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.account_password_resets
                  where user_id = auth.uid() and changed_at is null);
$$;
revoke all on function public.my_password_reset_pending() from public;
grant execute on function public.my_password_reset_pending() to authenticated;

-- Called after the user changed their password (auth.updateUser). Refuses while
-- the account still has the temporary password.
create or replace function public.password_change_done()
returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.account_password_resets r join auth.users u on u.id = r.user_id
              where r.user_id = auth.uid() and r.changed_at is null and u.encrypted_password = r.temp_hash) then
    raise exception 'Choose a new password first';
  end if;
  update public.account_password_resets set changed_at = now() where user_id = auth.uid() and changed_at is null;
end $$;
revoke all on function public.password_change_done() from public;
grant execute on function public.password_change_done() to authenticated;

-- Checks (read-only):
-- select * from public.account_password_resets order by created_at desc limit 5;
-- select proname from pg_proc where proname in ('admin_reset_password', 'password_change_done');
