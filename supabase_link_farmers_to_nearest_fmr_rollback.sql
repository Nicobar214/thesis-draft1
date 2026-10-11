-- Undo supabase_link_farmers_to_nearest_fmr.sql: restore every farmer's FMR
-- link, distance, status, service area and reason from the backup taken on
-- its first run. Drops the backup afterwards.
--
-- Only needed AFTER the main migration has run. If it hasn't, this does
-- nothing and just says so.

do $$
begin
  if to_regclass('public.farmer_fmr_link_backup') is null then
    raise notice 'Nothing to undo: supabase_link_farmers_to_nearest_fmr.sql has not been run yet.';
    return;
  end if;

  update public.farmer_beneficiaries fb
  set linked_project_id = b.linked_project_id,
      linked_project_name = b.linked_project_name,
      linked_project_status = b.linked_project_status,
      distance_to_fmr_km = b.distance_to_fmr_km,
      service_area = b.service_area,
      benefit_reason = b.benefit_reason
  from public.farmer_fmr_link_backup b
  where b.id = fb.id;

  drop table public.farmer_fmr_link_backup;
  raise notice 'Restored farmer FMR links from backup.';
end $$;
