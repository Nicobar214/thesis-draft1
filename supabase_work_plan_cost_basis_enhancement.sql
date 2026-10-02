-- Work Plan cost-basis enhancement
-- LOCAL ONLY: review and execute manually in Supabase after approval.
-- Historical finalized plans remain valid because unit_cost is nullable.

begin;

alter table public.work_plan_items
  add column if not exists unit_cost numeric(18,2);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.work_plan_items'::regclass
      and conname = 'work_plan_items_unit_cost_positive'
  ) then
    alter table public.work_plan_items
      add constraint work_plan_items_unit_cost_positive
      check (unit_cost is null or unit_cost > 0) not valid;
  end if;
end;
$$;

alter table public.work_plan_items
  validate constraint work_plan_items_unit_cost_positive;

comment on column public.work_plan_items.unit_cost is
  'Approved cost per activity unit. Nullable only for drafts and finalized legacy plans created before cost capture.';

-- RLS does not apply to TRUNCATE. Keep Work Plan mutations confined to the
-- existing authorized SECURITY DEFINER RPCs.
revoke insert, update, delete, truncate on public.work_plan_items from public, anon, authenticated;

create or replace function public.save_work_plan_draft(
  p_fmr_project_id bigint,
  p_items jsonb default '[]'::jsonb
)
returns jsonb as $$
declare
  v_status text;
  v_item jsonb;
  v_item_id bigint;
  v_activity_name text;
  v_unit text;
  v_planned_quantity numeric(12,4);
  v_unit_cost numeric(18,2);
  v_sort_order integer;
  v_remarks text;
  v_payload_ids bigint[] := array[]::bigint[];
  v_preserved_ids bigint[] := array[]::bigint[];
begin
  if public.current_profile_role() <> 'admin' then
    raise exception 'Only admins can save Work Plan drafts';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Work Plan items must be a JSON array';
  end if;

  select work_plan_status into v_status
  from public.fmr_projects
  where id = p_fmr_project_id
  for update;

  if not found then
    raise exception 'Project not found';
  end if;

  if v_status = 'finalized' then
    raise exception 'A finalized Work Plan cannot be edited';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each Work Plan item must be an object';
    end if;

    v_item_id := nullif(v_item->>'id', '')::bigint;
    v_activity_name := btrim(coalesce(v_item->>'activity_name', ''));
    v_unit := btrim(coalesce(v_item->>'unit', ''));
    v_planned_quantity := nullif(v_item->>'planned_quantity', '')::numeric(12,4);
    v_unit_cost := nullif(v_item->>'unit_cost', '')::numeric(18,2);
    v_sort_order := nullif(v_item->>'sort_order', '')::integer;
    v_remarks := nullif(v_item->>'remarks', '');

    if v_activity_name = '' then
      raise exception 'Activity name is required';
    end if;

    if v_planned_quantity is null or v_planned_quantity <= 0 then
      raise exception 'Planned quantity must be greater than zero';
    end if;

    if v_unit = '' or char_length(v_unit) > 50 then
      raise exception 'Unit must be between 1 and 50 characters';
    end if;

    if v_unit_cost is not null and v_unit_cost <= 0 then
      raise exception 'Unit cost must be greater than zero when provided';
    end if;

    if (v_activity_name = 'Earthworks' and v_unit <> 'm³')
       or (v_activity_name = 'Drainage' and v_unit <> 'm')
       or (v_activity_name = 'Gravel' and v_unit <> 'm³') then
      raise exception 'The selected preset activity must use its standard unit';
    end if;

    if v_item_id is not null then
      if v_item_id = any(v_payload_ids) then
        raise exception 'Duplicate Work Plan item id: %', v_item_id;
      end if;

      if not exists (
        select 1 from public.work_plan_items
        where id = v_item_id
          and fmr_project_id = p_fmr_project_id
      ) then
        raise exception 'Work Plan item % does not belong to this project', v_item_id;
      end if;

      v_payload_ids := array_append(v_payload_ids, v_item_id);
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(v_item->>'id', '')::bigint;
    v_activity_name := btrim(coalesce(v_item->>'activity_name', ''));
    v_unit := btrim(coalesce(v_item->>'unit', ''));
    v_planned_quantity := nullif(v_item->>'planned_quantity', '')::numeric(12,4);
    v_unit_cost := nullif(v_item->>'unit_cost', '')::numeric(18,2);
    v_sort_order := nullif(v_item->>'sort_order', '')::integer;
    v_remarks := nullif(v_item->>'remarks', '');

    if v_item_id is null then
      insert into public.work_plan_items (
        fmr_project_id, activity_name, unit, planned_quantity, unit_cost,
        sort_order, remarks, created_by
      ) values (
        p_fmr_project_id, v_activity_name, v_unit, v_planned_quantity, v_unit_cost,
        v_sort_order, v_remarks, auth.uid()
      )
      returning id into v_item_id;

      v_payload_ids := array_append(v_payload_ids, v_item_id);
    else
      update public.work_plan_items
      set activity_name = v_activity_name,
          unit = v_unit,
          planned_quantity = v_planned_quantity,
          unit_cost = v_unit_cost,
          sort_order = v_sort_order,
          remarks = v_remarks
      where id = v_item_id
        and fmr_project_id = p_fmr_project_id;
    end if;
  end loop;

  delete from public.work_plan_items wpi
  where wpi.fmr_project_id = p_fmr_project_id
    and not (wpi.id = any(v_payload_ids))
    and not exists (
      select 1
      from public.progress_update_items pui
      where pui.work_plan_item_id = wpi.id
    );

  select coalesce(array_agg(wpi.id order by wpi.id), array[]::bigint[])
    into v_preserved_ids
  from public.work_plan_items wpi
  where wpi.fmr_project_id = p_fmr_project_id
    and not (wpi.id = any(v_payload_ids));

  if v_status = 'none' then
    update public.fmr_projects
    set work_plan_status = 'draft', updated_at = now()
    where id = p_fmr_project_id;
  else
    update public.fmr_projects
    set updated_at = now()
    where id = p_fmr_project_id;
  end if;

  return jsonb_build_object(
    'project_id', p_fmr_project_id,
    'work_plan_status', case when v_status = 'none' then 'draft' else v_status end,
    'submitted_item_count', jsonb_array_length(p_items),
    'preserved_history_item_ids', coalesce(to_jsonb(v_preserved_ids), '[]'::jsonb)
  );
end;
$$ language plpgsql security definer
   set search_path = public
   set row_security = off;

create or replace function public.finalize_work_plan(
  p_fmr_project_id bigint
)
returns void as $$
declare
  v_project record;
  v_valid_item_count integer;
  v_cost_basis numeric;
  v_planned_cost numeric;
begin
  if public.current_profile_role() <> 'admin' then
    raise exception 'Only admins can finalize Work Plans';
  end if;

  select work_plan_status, accomplishment, work_plan_adoption_baseline,
         contract_amount, total_budget
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
    and unit_cost > 0
    and btrim(unit) <> ''
    and char_length(unit) <= 50;

  if v_valid_item_count = 0 then
    raise exception 'At least one fully costed Work Plan item is required before finalization';
  end if;

  if exists (
    select 1
    from public.work_plan_items
    where fmr_project_id = p_fmr_project_id
      and (
        btrim(activity_name) = '' or planned_quantity <= 0 or unit_cost is null
        or unit_cost <= 0 or btrim(unit) = '' or char_length(unit) > 50
        or (activity_name = 'Earthworks' and unit <> 'm³')
        or (activity_name = 'Drainage' and unit <> 'm')
        or (activity_name = 'Gravel' and unit <> 'm³')
      )
  ) then
    raise exception 'All Work Plan items must have valid quantities, units, and approved unit costs before finalization';
  end if;

  v_cost_basis := coalesce(
    nullif(v_project.contract_amount, 0),
    nullif(v_project.total_budget, 0)
  );

  if v_cost_basis is null or v_cost_basis <= 0 then
    raise exception 'A positive contract amount or recorded project budget is required before finalization';
  end if;

  select sum(planned_quantity * unit_cost)
    into v_planned_cost
  from public.work_plan_items
  where fmr_project_id = p_fmr_project_id;

  if v_planned_cost > v_cost_basis then
    raise exception 'Planned Work Plan cost (%) exceeds the project cost basis (%)',
      v_planned_cost, v_cost_basis;
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
$$ language plpgsql security definer
   set search_path = public
   set row_security = off;

revoke execute on function public.save_work_plan_draft(bigint, jsonb) from public, anon;
revoke execute on function public.finalize_work_plan(bigint) from public, anon;
grant execute on function public.save_work_plan_draft(bigint, jsonb) to authenticated;
grant execute on function public.finalize_work_plan(bigint) to authenticated;

commit;
