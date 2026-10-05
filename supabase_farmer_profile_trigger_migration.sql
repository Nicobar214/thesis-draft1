-- Copy farmer provisioning metadata into public.profiles at signup.
--
-- LguDashboard.jsx provisions farmers via supabaseAdmin.auth.signUp() and used
-- to follow up with a direct profiles insert. That insert always failed: this
-- trigger had already created the row, and RLS only lets a user write their
-- own profile. Farmers ended up with role = 'user' and username = null.
--
-- Only 'farmer' is accepted from user metadata -- metadata is client-supplied
-- (public signUp), so privileged roles must never be granted from it.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  meta_username text := lower(trim(meta->>'username'));
begin
  insert into public.profiles (id, email, role, username, full_name, phone)
  values (
    new.id,
    new.email,
    case when lower(trim(meta->>'role')) = 'farmer' then 'farmer' else 'user' end,
    case when meta_username ~ '^[a-z0-9_]{3,30}$' then meta_username end,
    nullif(trim(meta->>'full_name'), ''),
    nullif(trim(meta->>'phone'), '')
  );
  return new;
end;
$$;

-- Backfill farmers provisioned before this fix.
update public.profiles p
set role = 'farmer',
    username = coalesce(
      p.username,
      case
        when u.email like '%@farmer.kalsatrack.internal'
          and split_part(u.email, '@', 1) ~ '^[a-z0-9_]{3,30}$'
        then split_part(u.email, '@', 1)
      end
    ),
    full_name = coalesce(p.full_name, nullif(trim(u.raw_user_meta_data->>'full_name'), ''))
from auth.users u
where u.id = p.id
  and u.raw_user_meta_data->>'role' = 'farmer'
  and coalesce(p.role, 'user') = 'user';
