-- ============================================================
-- Work Plan: a draft may never go over the project budget.
--
-- finalize_work_plan already refuses a plan whose planned cost is above the
-- cost basis (contract amount, else the recorded total budget). Saving a
-- draft had no such check, so an over-budget plan could be stored and only
-- caught at finalization. This adds the same rule to save_work_plan_draft.
--
-- The function is otherwise unchanged. The check runs after the items are
-- written, over ALL of the project's items (including history rows kept
-- because progress updates point at them), so an over-budget save is rolled
-- back as a whole. Items without a unit cost yet count as zero, like
-- finalize_work_plan's sum. Without a cost basis the draft is allowed.
-- Safe to re-run.
-- ============================================================

create or replace function public.save_work_plan_draft(p_fmr_project_id bigint, p_items jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
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
  v_cost_basis numeric;
  v_planned_cost numeric;
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

  -- Budget guard (same rule as finalize_work_plan): never above the cost basis.
  select coalesce(nullif(contract_amount, 0), nullif(total_budget, 0))
    into v_cost_basis
  from public.fmr_projects
  where id = p_fmr_project_id;

  if v_cost_basis is not null and v_cost_basis > 0 then
    select coalesce(sum(planned_quantity * coalesce(unit_cost, 0)), 0)
      into v_planned_cost
    from public.work_plan_items
    where fmr_project_id = p_fmr_project_id;

    if v_planned_cost > v_cost_basis then
      raise exception 'Planned Work Plan cost (%) exceeds the project cost basis (%)',
        v_planned_cost, v_cost_basis;
    end if;
  end if;

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
$function$;

-- Same access as before: signed-in users (the function itself allows admins only).
revoke execute on function public.save_work_plan_draft(bigint, jsonb) from public, anon;
grant execute on function public.save_work_plan_draft(bigint, jsonb) to authenticated;

-- Check: select position('exceeds the project cost basis' in pg_get_functiondef('public.save_work_plan_draft(bigint, jsonb)'::regprocedure)) > 0;
