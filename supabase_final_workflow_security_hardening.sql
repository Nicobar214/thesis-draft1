-- Final workflow security hardening.
-- This migration changes only confirmed workflow integrity controls: narrow
-- RLS/grants, role-assignment checks, and stored-quantity calculation guards.

begin;

-- Project reads remain unchanged. Direct project mutation is an Admin-only
-- application operation; contractors and engineers use workflow RPCs.
drop policy if exists "Authenticated users can insert fmr_projects"
  on public.fmr_projects;
drop policy if exists "Authenticated users can update fmr_projects"
  on public.fmr_projects;
drop policy if exists "Authenticated users can delete fmr_projects"
  on public.fmr_projects;

drop policy if exists fmr_projects_insert_admin on public.fmr_projects;
create policy fmr_projects_insert_admin
  on public.fmr_projects
  for insert
  to authenticated
  with check (public.current_profile_role() = 'admin');

drop policy if exists fmr_projects_update_admin on public.fmr_projects;
create policy fmr_projects_update_admin
  on public.fmr_projects
  for update
  to authenticated
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

drop policy if exists fmr_projects_delete_admin on public.fmr_projects;
create policy fmr_projects_delete_admin
  on public.fmr_projects
  for delete
  to authenticated
  using (public.current_profile_role() = 'admin');

-- Work Plan Adoption Baseline:
-- the official accomplishment already approved when quantity reporting begins.
-- Quantity percentages remain post-adoption cumulative increments and historical
-- percentage records are never converted into artificial quantities.
alter table public.fmr_projects
  add column if not exists work_plan_adoption_baseline numeric(5,2);

alter table public.fmr_projects
  drop constraint if exists fmr_projects_work_plan_adoption_baseline_range;
alter table public.fmr_projects
  add constraint fmr_projects_work_plan_adoption_baseline_range
  check (
    work_plan_adoption_baseline is null
    or work_plan_adoption_baseline between 0 and 100
  );

-- These projects adopted Work Plans before this column existed. Their current
-- official values are the authoritative adoption baselines. No progress row is
-- modified and no historical percentage is converted to a quantity.
update public.fmr_projects
set work_plan_adoption_baseline = coalesce(accomplishment, 0)
where work_plan_status = 'finalized'
  and work_plan_adoption_baseline is null;

create or replace function public.protect_work_plan_adoption_baseline()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if tg_op = 'INSERT' then
    if new.work_plan_adoption_baseline is not null then
      raise exception 'The Work Plan adoption baseline is captured only during finalization';
    end if;
    return new;
  end if;

  if old.work_plan_adoption_baseline is not null
     and new.work_plan_adoption_baseline is distinct from old.work_plan_adoption_baseline then
    raise exception 'The Work Plan adoption baseline is immutable after finalization';
  end if;

  if old.work_plan_adoption_baseline is null
     and new.work_plan_adoption_baseline is not null
     and (
       new.work_plan_status <> 'finalized'
       or new.work_plan_adoption_baseline is distinct from coalesce(old.accomplishment, 0)
     ) then
    raise exception 'The Work Plan adoption baseline must equal the official accomplishment at finalization';
  end if;

  return new;
end;
$function$;

revoke execute on function public.protect_work_plan_adoption_baseline()
  from public, anon, authenticated;

drop trigger if exists trg_protect_work_plan_adoption_baseline
  on public.fmr_projects;
create trigger trg_protect_work_plan_adoption_baseline
before insert or update of work_plan_adoption_baseline
  on public.fmr_projects
for each row execute function public.protect_work_plan_adoption_baseline();

create or replace function public.finalize_work_plan(p_fmr_project_id bigint)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_project record;
  v_valid_item_count integer;
begin
  if public.current_profile_role() <> 'admin' then
    raise exception 'Only admins can finalize Work Plans';
  end if;

  select work_plan_status, accomplishment, work_plan_adoption_baseline
    into v_project
  from public.fmr_projects
  where id = p_fmr_project_id
  for update;

  if not found then
    raise exception 'Project not found';
  end if;

  if v_project.work_plan_status = 'finalized' then
    raise exception 'This Work Plan is already finalized';
  end if;

  select count(*) into v_valid_item_count
  from public.work_plan_items
  where fmr_project_id = p_fmr_project_id
    and btrim(activity_name) <> ''
    and planned_quantity > 0
    and char_length(unit) <= 50;

  if v_valid_item_count = 0 then
    raise exception 'At least one valid Work Plan item is required before finalization';
  end if;

  if exists (
    select 1
    from public.work_plan_items
    where fmr_project_id = p_fmr_project_id
      and (btrim(activity_name) = '' or planned_quantity <= 0 or char_length(unit) > 50)
  ) then
    raise exception 'All Work Plan items must be valid before finalization';
  end if;

  update public.fmr_projects
  set work_plan_status = 'finalized',
      work_plan_adoption_baseline = coalesce(
        v_project.work_plan_adoption_baseline,
        v_project.accomplishment,
        0
      ),
      updated_at = now()
  where id = p_fmr_project_id;
end;
$function$;

-- Calculate from the numeric(12,4) quantities that are actually persisted.
-- This prevents raw JSON precision from diverging from the official percentage.
create or replace function public.calculate_quantity_progress(
  p_progress_update_id uuid,
  p_use_engineer_quantities boolean
)
returns numeric
language sql
stable
security definer
set search_path = public
set row_security = off
as $function$
  with current_update as (
    select fmr_project_id
    from public.progress_updates
    where id = p_progress_update_id
  ),
  previous as (
    select
      pui.work_plan_item_id,
      sum(
        case
          when p_use_engineer_quantities then pui.engineer_validated_quantity
          else pui.contractor_reported_quantity
        end
      ) as quantity
    from public.progress_update_items pui
    join public.progress_updates pu on pu.id = pui.progress_update_id
    join current_update cu on cu.fmr_project_id = pu.fmr_project_id
    where pu.status = 'approved'
      and pu.id <> p_progress_update_id
    group by pui.work_plan_item_id
  ),
  current_items as (
    select
      pui.work_plan_item_id,
      pui.contractor_reported_quantity,
      pui.engineer_validated_quantity,
      wpi.planned_quantity
    from public.progress_update_items pui
    join public.work_plan_items wpi on wpi.id = pui.work_plan_item_id
    join current_update cu on cu.fmr_project_id = wpi.fmr_project_id
    where pui.progress_update_id = p_progress_update_id
  )
  select case
    when p_use_engineer_quantities
      and bool_and(current_items.engineer_validated_quantity is not null) is not true
      then null
    else avg(
      (
        coalesce(previous.quantity, 0)
        + case
            when p_use_engineer_quantities then current_items.engineer_validated_quantity
            else current_items.contractor_reported_quantity
          end
      ) / current_items.planned_quantity * 100
    )
  end
  from current_items
  left join previous using (work_plan_item_id);
$function$;

revoke execute on function public.calculate_quantity_progress(uuid, boolean)
  from public, anon, authenticated;

create or replace function public.enforce_stored_quantity_progress()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
begin
  if new.certification_status = 'certified'
     and exists (
       select 1
       from public.progress_update_items
       where progress_update_id = new.id
     ) then
    new.certified_accomplishment :=
      public.calculate_quantity_progress(new.id, true);

    if new.certified_accomplishment is null then
      raise exception 'Every quantity item requires an Engineer validated quantity';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_enforce_stored_quantity_progress
  on public.progress_updates;
create trigger trg_enforce_stored_quantity_progress
before update of certification_status, certified_accomplishment
  on public.progress_updates
for each row execute function public.enforce_stored_quantity_progress();

create or replace function public.sync_reported_quantity_progress()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_progress_update_id uuid := new.progress_update_id;
begin
  update public.progress_updates
  set reported_accomplishment =
    public.calculate_quantity_progress(v_progress_update_id, false)
  where id = v_progress_update_id
    and status = 'pending';

  return new;
end;
$function$;

revoke execute on function public.enforce_stored_quantity_progress()
  from public, anon, authenticated;
revoke execute on function public.sync_reported_quantity_progress()
  from public, anon, authenticated;

drop trigger if exists trg_sync_reported_quantity_progress
  on public.progress_update_items;
create trigger trg_sync_reported_quantity_progress
after insert or update of contractor_reported_quantity
  on public.progress_update_items
for each row execute function public.sync_reported_quantity_progress();

-- Correct currently pending quantity rows using their stored values. Approved
-- historical records are deliberately left untouched.
update public.progress_updates pu
set reported_accomplishment =
      public.calculate_quantity_progress(pu.id, false),
    certified_accomplishment = case
      when pu.certification_status = 'certified'
        then public.calculate_quantity_progress(pu.id, true)
      else pu.certified_accomplishment
    end
where pu.status = 'pending'
  and exists (
    select 1
    from public.progress_update_items pui
    where pui.progress_update_id = pu.id
  );

-- Legacy approvals continue to use the certified percentage exactly as before.
-- Quantity approvals use baseline + cumulative post-adoption quantity progress;
-- the baseline is added once, never the previous official accomplishment.
create or replace function public.approve_progress_update_admin(
  progress_update_id uuid,
  p_approval_remarks text default null
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_progress_update_id uuid := progress_update_id;
  upd record;
  v_current numeric;
  v_baseline numeric;
  v_official numeric;
  v_unrounded_official numeric;
  v_is_quantity_update boolean;
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only admins can approve progress updates';
  end if;

  select * into upd
  from public.progress_updates
  where id = v_progress_update_id
  for update;

  if not found then
    raise exception 'Progress update not found';
  end if;

  if coalesce(upd.status, '') = 'approved' then
    raise exception 'This progress update has already been approved';
  end if;

  if coalesce(upd.status, '') <> 'pending' then
    raise exception 'This progress update is % and can no longer be approved', upd.status;
  end if;

  if coalesce(upd.certification_status, '') = 'disputed' then
    raise exception 'The supervising engineer disputed this accomplishment. It cannot be approved.';
  end if;

  if coalesce(upd.certification_status, '') <> 'certified' then
    raise exception 'This accomplishment has not been certified by a supervising engineer yet.';
  end if;

  if upd.certified_accomplishment is null then
    raise exception 'No certified accomplishment value is recorded for this update.';
  end if;

  if upd.certified_accomplishment < 0 or upd.certified_accomplishment > 100 then
    raise exception 'Certified accomplishment must be between 0 and 100';
  end if;

  select coalesce(accomplishment, 0), work_plan_adoption_baseline
    into v_current, v_baseline
  from public.fmr_projects
  where id = upd.fmr_project_id
  for update;

  if not found then
    raise exception 'The project for this progress update no longer exists';
  end if;

  select exists (
    select 1
    from public.progress_update_items pui
    where pui.progress_update_id = upd.id
  ) into v_is_quantity_update;

  if v_is_quantity_update then
    if v_baseline is null then
      raise exception 'This quantity project has no Work Plan adoption baseline';
    end if;

    v_unrounded_official := v_baseline + upd.certified_accomplishment;
    if v_unrounded_official > 100 then
      raise exception
        'Baseline plus certified quantity accomplishment exceeds 100 percent';
    end if;

    -- fmr_projects.accomplishment is numeric(5,2); make its stored precision
    -- explicit instead of relying on an implicit assignment cast.
    v_official := round(v_unrounded_official, 2);
  else
    v_official := upd.certified_accomplishment;
  end if;

  if v_official < v_current then
    raise exception
      'Certified accomplishment of % percent is lower than the project''s current official accomplishment of % percent. Resolve this with the engineer before approving.',
      v_official, v_current;
  end if;

  update public.fmr_projects
  set accomplishment = v_official,
      status = case when v_official >= 100 then 'Completed' else status end,
      updated_at = now()
  where id = upd.fmr_project_id;

  update public.progress_updates
  set status = 'approved',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      approval_remarks = p_approval_remarks
  where id = v_progress_update_id;
end;
$function$;

-- Client-editable auth metadata must not be able to mint workflow approvers.
-- Existing non-privileged onboarding roles are intentionally left unchanged.
create or replace function public.protect_privileged_profile_roles()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_new_role text := lower(replace(replace(coalesce(new.role, ''), '-', '_'), ' ', '_'));
begin
  if v_new_role in ('admin', 'field_engineer')
     and (tg_op = 'INSERT' or new.role is distinct from old.role)
     and coalesce(public.current_profile_role(), '') <> 'admin' then
    raise exception 'Only admins can assign privileged profile roles';
  end if;

  return new;
end;
$function$;

revoke execute on function public.protect_privileged_profile_roles()
  from public, anon, authenticated;

drop trigger if exists trg_protect_privileged_profile_roles on public.profiles;
create trigger trg_protect_privileged_profile_roles
before insert or update of role on public.profiles
for each row execute function public.protect_privileged_profile_roles();

-- These role-assignment helpers are called by the authenticated Admin portal.
-- Enforce that contract in the database instead of trusting caller-supplied IDs.
create or replace function public.create_contractor_profile(
  user_id uuid,
  user_email text,
  user_name text default '',
  user_phone text default ''
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
begin
  if auth.uid() is null or public.current_profile_role() <> 'admin' then
    raise exception 'Only admins can create contractor profiles';
  end if;

  insert into public.profiles (id, email, full_name, phone, role, created_at)
  values (user_id, user_email, user_name, user_phone, 'contractor', now())
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        phone = excluded.phone,
        role = 'contractor',
        updated_at = now();
end;
$function$;

create or replace function public.create_field_engineer_profile(
  user_id uuid,
  user_email text,
  user_name text default '',
  user_phone text default ''
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
begin
  if auth.uid() is null or public.current_profile_role() <> 'admin' then
    raise exception 'Only admins can create field engineer profiles';
  end if;

  insert into public.profiles (id, email, full_name, phone, role, created_at)
  values (user_id, user_email, user_name, user_phone, 'field_engineer', now())
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        phone = excluded.phone,
        role = 'field_engineer',
        updated_at = now();
end;
$function$;

create or replace function public.create_lgu_profile(
  user_id uuid,
  user_email text,
  user_name text default '',
  user_phone text default '',
  user_municipality text default null
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  has_municipality boolean;
begin
  if auth.uid() is null or public.current_profile_role() <> 'admin' then
    raise exception 'Only admins can create LGU profiles';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'municipality'
  ) into has_municipality;

  if has_municipality then
    insert into public.profiles
      (id, email, full_name, phone, role, municipality, created_at)
    values (
      user_id, user_email, user_name, user_phone, 'lgu',
      nullif(trim(coalesce(user_municipality, '')), ''), now()
    )
    on conflict (id) do update
      set email = excluded.email,
          full_name = excluded.full_name,
          phone = excluded.phone,
          role = 'lgu',
          municipality = coalesce(excluded.municipality, public.profiles.municipality);
  else
    insert into public.profiles (id, email, full_name, phone, role, created_at)
    values (user_id, user_email, user_name, user_phone, 'lgu', now())
    on conflict (id) do update
      set email = excluded.email,
          full_name = excluded.full_name,
          phone = excluded.phone,
          role = 'lgu';
  end if;
end;
$function$;

-- Remove direct anonymous access to authenticated workflow mutations.
revoke execute on function public.approve_progress_update_admin(uuid, text) from public, anon;
revoke execute on function public.certify_progress_update_engineer(uuid, numeric, text, boolean) from public, anon;
revoke execute on function public.reject_progress_update_admin(uuid, text) from public, anon;
revoke execute on function public.set_billing_hold_admin(uuid, boolean, text, uuid) from public, anon;
revoke execute on function public.release_project_tranche(bigint, numeric, date, text) from public, anon;
revoke execute on function public.validate_lgu_project_proposal(uuid, text) from public, anon;
revoke execute on function public.reject_lgu_project_proposal(uuid, text) from public, anon;
revoke execute on function public.request_lgu_project_proposal_revision(uuid, text) from public, anon;
revoke execute on function public.initialize_project_tranches(bigint) from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
revoke execute on function public.create_contractor_profile(uuid, text, text, text) from public, anon;
revoke execute on function public.create_field_engineer_profile(uuid, text, text, text) from public, anon;
revoke execute on function public.create_lgu_profile(uuid, text, text, text, text) from public, anon;
revoke execute on function public.get_field_engineers_secure() from public, anon;
revoke execute on function public.current_profile_role() from public, anon;
revoke execute on function public.is_admin() from public, anon;

grant execute on function public.approve_progress_update_admin(uuid, text) to authenticated;
grant execute on function public.certify_progress_update_engineer(uuid, numeric, text, boolean) to authenticated;
grant execute on function public.reject_progress_update_admin(uuid, text) to authenticated;
grant execute on function public.set_billing_hold_admin(uuid, boolean, text, uuid) to authenticated;
grant execute on function public.release_project_tranche(bigint, numeric, date, text) to authenticated;
grant execute on function public.validate_lgu_project_proposal(uuid, text) to authenticated;
grant execute on function public.reject_lgu_project_proposal(uuid, text) to authenticated;
grant execute on function public.request_lgu_project_proposal_revision(uuid, text) to authenticated;
grant execute on function public.initialize_project_tranches(bigint) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.create_contractor_profile(uuid, text, text, text) to authenticated;
grant execute on function public.create_field_engineer_profile(uuid, text, text, text) to authenticated;
grant execute on function public.create_lgu_profile(uuid, text, text, text, text) to authenticated;
grant execute on function public.get_field_engineers_secure() to authenticated;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- Trigger execution does not require client EXECUTE privileges. Pin its lookup
-- path and remove unnecessary API exposure.
alter function public.handle_new_user() set search_path = public;
alter function public.protect_approved_progress_update() set search_path = public;
alter function public.prevent_finalized_work_plan_item_mutation() set search_path = public;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- The current application stores evidence as public URLs. Keep that compatible
-- visibility model while restricting object creation and deletion to the
-- authenticated Contractor's own folder. Overwrite is denied by omission of an
-- UPDATE policy. A future private-evidence design requires signed-URL UI work.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'progress-photos',
  'progress-photos',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists progress_photos_insert_own on storage.objects;
create policy progress_photos_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'progress-photos'
    and public.current_profile_role() = 'contractor'
    and (storage.foldername(name))[1] = 'updates'
    and (storage.foldername(name))[2] = auth.uid()::text
    and array_length(storage.foldername(name), 1) >= 4
  );

drop policy if exists progress_photos_select_workflow on storage.objects;
create policy progress_photos_select_workflow
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'progress-photos'
    and (
      public.current_profile_role() in ('admin', 'field_engineer')
      or (storage.foldername(name))[2] = auth.uid()::text
    )
  );

drop policy if exists progress_photos_delete_own on storage.objects;
create policy progress_photos_delete_own
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'progress-photos'
    and public.current_profile_role() = 'contractor'
    and (storage.foldername(name))[1] = 'updates'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

commit;
