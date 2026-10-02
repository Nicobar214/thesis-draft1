-- Fix approve_progress_update_admin: qualify progress_update_items.progress_update_id
-- so it cannot be confused with the RPC input parameter of the same name.

begin;

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

  select pu.* into upd
  from public.progress_updates pu
  where pu.id = v_progress_update_id
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

  select coalesce(fp.accomplishment, 0), fp.work_plan_adoption_baseline
    into v_current, v_baseline
  from public.fmr_projects fp
  where fp.id = upd.fmr_project_id
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
      raise exception 'Baseline plus certified quantity accomplishment exceeds 100 percent';
    end if;

    v_official := round(v_unrounded_official, 2);
  else
    v_official := upd.certified_accomplishment;
  end if;

  if v_official < v_current then
    raise exception
      'Certified accomplishment of % percent is lower than the project''s current official accomplishment of % percent. Resolve this with the engineer before approving.',
      v_official, v_current;
  end if;

  update public.fmr_projects fp
  set accomplishment = v_official,
      status = case when v_official >= 100 then 'Completed' else fp.status end,
      updated_at = now()
  where fp.id = upd.fmr_project_id;

  update public.progress_updates pu
  set status = 'approved',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      approval_remarks = p_approval_remarks
  where pu.id = v_progress_update_id;
end;
$function$;

revoke execute on function public.approve_progress_update_admin(uuid, text)
  from public, anon;
grant execute on function public.approve_progress_update_admin(uuid, text)
  to authenticated;

commit;
