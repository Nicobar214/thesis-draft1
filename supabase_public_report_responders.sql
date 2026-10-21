-- ============================================================
-- Citizen transparency: who responded to a report.
--
-- For one report, returns the field engineer who inspected it and the
-- contractor company or LGU that fixed it, with the key dates. Names only:
-- no contact details, notes or account ids. Visible on the same terms as
-- public_reports_citizen_view (any report that was not dismissed, or your own).
-- Safe to re-run.
-- ============================================================

create or replace function public.public_report_responders(p_report_id uuid)
returns table (
  engineer_name text,
  engineer_assigned_at timestamptz,
  inspection_submitted_at timestamptz,
  handler text,
  handler_name text,
  work_assigned_at timestamptz,
  work_accepted_at timestamptz,
  work_date date,
  work_started_at timestamptz,
  work_done_at timestamptz,
  resolved_at timestamptz
)
language sql
stable
security definer
set search_path = public
set row_security = off
as $function$
  select
    -- The engineer's name as recorded on the assignment (their official name).
    nullif(btrim(coalesce(eng.full_name, pr.assigned_engineer_name, '')), ''),
    pr.assigned_at,
    (select f.submitted_at from public.public_report_field_findings f
      where f.report_id = pr.id and f.submitted_at is not null
      order by f.inspection_number desc nulls last limit 1),
    a.responsible_party,
    case
      when a.responsible_party = 'lgu' then
        coalesce('LGU of ' || nullif(btrim(pr.municipality), ''), 'Municipal LGU')
      when a.responsible_party = 'contractor' then
        coalesce(nullif(btrim(con.full_name), ''), 'Project contractor')
    end,
    a.planned_at,
    a.accepted_at,
    a.work_date,
    a.started_at,
    a.work_submitted_at,
    pr.resolved_at
  from public.public_reports pr
  left join public.profiles eng on eng.id = pr.assigned_engineer_id
  left join public.public_report_repair_actions a
    on a.report_id = pr.id and a.status <> 'cancelled' and a.responsible_party in ('lgu', 'contractor')
  left join public.fmr_projects fp on pr.project_id = 'fmr-' || fp.id::text
  left join public.profiles con on con.id = fp.contractor_id and con.role = 'contractor'
  where pr.id = p_report_id
    and (pr.status <> 'dismissed' or pr.user_id = auth.uid());
$function$;

revoke execute on function public.public_report_responders(uuid) from public;
grant execute on function public.public_report_responders(uuid) to anon, authenticated;
