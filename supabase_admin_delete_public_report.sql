-- ============================================================
-- TEMPORARY: let an admin permanently delete a citizen report.
--
-- For cleaning test data before the defense. Remove it afterwards with:
--   drop function if exists public.admin_delete_public_report(uuid);
--
-- Deletes the report and everything attached to it (inspections, resolution,
-- LGU/contractor job, notes, supporters, visits, its notifications). The
-- activity log is append-only, so its delete guard is switched off only
-- inside this function and switched back on before it returns.
-- Uploaded photos stay in storage.
-- Safe to re-run.
-- ============================================================

create or replace function public.admin_delete_public_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
begin
  perform public._public_report_require_admin();

  if not exists (select 1 from public.public_reports where id = p_report_id) then
    raise exception 'Report does not exist';
  end if;

  delete from public.notifications where report_id = p_report_id;

  alter table public.public_report_activity_logs disable trigger trg_prevent_public_report_activity_log_delete;
  begin
    -- Everything else cascades from the report (or is set to null).
    delete from public.public_reports where id = p_report_id;
  exception when others then
    alter table public.public_report_activity_logs enable trigger trg_prevent_public_report_activity_log_delete;
    raise;
  end;
  alter table public.public_report_activity_logs enable trigger trg_prevent_public_report_activity_log_delete;
end;
$function$;

revoke execute on function public.admin_delete_public_report(uuid) from public, anon;
grant execute on function public.admin_delete_public_report(uuid) to authenticated;
