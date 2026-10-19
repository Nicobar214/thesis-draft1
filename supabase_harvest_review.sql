-- ============================================================
-- Harvest review: unusually high entries are checked by the LGU.
--
-- A harvest is "flagged" when its kg per hectare is more than 2.5x the typical
-- yield for its crop (about record-yield level), using the harvest's own area or,
-- if missing, the farm's registered area. Flagged entries are left out of the LGU
-- harvest totals until the LGU marks them correct (confirm_harvest_log) or the
-- farmer fixes the entry (editing re-checks it).
--
-- The app uses the same rule (src/lib/harvestPlausibility.js) to warn the farmer
-- before saving. Keep the two yield tables in sync. Safe to re-run.
-- ============================================================

alter table public.farmer_harvest_logs
  add column if not exists review_status text,
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'farmer_harvest_logs_review_status_check') then
    alter table public.farmer_harvest_logs
      add constraint farmer_harvest_logs_review_status_check
      check (review_status is null or review_status in ('flagged', 'confirmed'));
  end if;
end $$;

-- Typical yield, tonnes per hectare (same values as harvestPlausibility.js).
create or replace function public.typical_yield_t_per_ha(p_crop text)
returns numeric
language sql
immutable
as $$
  select case btrim(coalesce(p_crop, ''))
    when 'Rice' then 4.2 when 'Corn' then 3.6 when 'Sugarcane' then 65 when 'Coconut' then 8
    when 'Vegetables' then 12 when 'Banana' then 20 when 'Bellpepper (Green/Red)' then 10
    when 'Cacao' then 1 when 'Carrot' then 15 when 'Dragon Fruit' then 10 when 'Long Chili' then 8
    when 'Mango' then 8 when 'Mongo - dry' then 0.8 when 'Mung Bean' then 0.8
    when 'Other fruit-bearing trees and vines' then 10 when 'Other fruit-bearing vegetables' then 12
    when 'Other industrial crops' then 5 when 'Other leafy vegetables' then 10
    when 'Other leguminous plants' then 1.5 when 'Papaya' then 25 when 'Peanuts' then 1.5
    when 'Pepper - small green' then 8 when 'Pepper - sweet' then 10 when 'Radish (labanos)' then 15
    when 'Squash (kalabasa)' then 12 when 'Tomato (kamatis)' then 15
    else 9 end::numeric;
$$;

create or replace function public.farmer_harvest_review_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_area numeric;
  v_unusual boolean := false;
  v_role text := coalesce(public.current_profile_role(), '');
begin
  -- Only the LGU or an admin may mark an entry correct.
  if new.review_status = 'confirmed'
     and (tg_op = 'INSERT' or old.review_status is distinct from 'confirmed')
     and v_role not in ('lgu', 'admin') then
    raise exception 'Only the LGU can confirm a flagged harvest entry.';
  end if;

  -- A confirmed entry stays confirmed while its numbers are unchanged.
  if tg_op = 'UPDATE'
     and new.review_status = 'confirmed'
     and old.quantity_kg is not distinct from new.quantity_kg
     and old.area_ha is not distinct from new.area_ha
     and old.crop is not distinct from new.crop then
    return new;
  end if;

  v_area := coalesce(
    nullif(new.area_ha, 0),
    (select nullif(fb.farm_area_ha, 0) from public.farmer_beneficiaries fb where fb.user_id = new.farmer_id limit 1)
  );
  if v_area is not null and new.quantity_kg is not null then
    v_unusual := new.quantity_kg > public.typical_yield_t_per_ha(new.crop) * 1000 * v_area * 2.5;
  end if;

  if v_unusual then
    new.review_status := 'flagged';
    new.reviewed_by := null;
    new.reviewed_at := null;
  elsif new.review_status is distinct from 'confirmed' or tg_op = 'UPDATE' then
    new.review_status := null;
  end if;
  return new;
end;
$$;

drop trigger if exists farmer_harvest_review_check on public.farmer_harvest_logs;
create trigger farmer_harvest_review_check
  before insert or update of quantity_kg, area_ha, crop, review_status
  on public.farmer_harvest_logs
  for each row
  execute function public.farmer_harvest_review_check();

-- LGU (same municipality as the farmer) or admin marks a flagged entry as correct.
create or replace function public.confirm_harvest_log(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(public.current_profile_role(), '');
  v_ok boolean;
begin
  if v_role = 'admin' then
    v_ok := true;
  elsif v_role = 'lgu' then
    select exists (
      select 1
      from public.farmer_harvest_logs h
      join public.farmer_beneficiaries fb on fb.user_id = h.farmer_id
      where h.id = p_id
        and (public.public_report_current_municipality() is null
             or fb.municipality = public.public_report_current_municipality())
    ) into v_ok;
  else
    v_ok := false;
  end if;
  if not v_ok then
    raise exception 'You can only confirm harvest entries of farmers in your municipality.';
  end if;

  update public.farmer_harvest_logs
     set review_status = 'confirmed', reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id and review_status = 'flagged';
end;
$$;

revoke all on function public.confirm_harvest_log(uuid) from public;
grant execute on function public.confirm_harvest_log(uuid) to authenticated;

-- Flag the entries already saved (runs the trigger once over existing rows).
update public.farmer_harvest_logs set quantity_kg = quantity_kg where review_status is null;
