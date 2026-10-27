/* Who handled a road report, for citizens (Community Feedback and My Reports),
 * so the page has ONE timeline with who did each step:
 *
 *   const repair = useReportRepair(client, report.id);
 *   <CitizenReportTimeline … details={accountabilityDetails({ report, finding, repair, isMine })} />
 *   <BeforeAfterCard report={report} repair={repair} isMine={isMine} />   (BeforeAfterCard.jsx)
 *
 * Names come from the citizen views (supabase_citizen_report_accountability.sql);
 * before that SQL runs the steps read "a DA field engineer" etc. The reporter is
 * never named to others ("A community member"); an LGU repair names the office. */
import { useEffect, useState } from 'react';

/** The report's latest repair job (citizen view), or null. */
export function useReportRepair(client, reportId) {
  const [repair, setRepair] = useState(null);
  useEffect(() => {
    if (!client || !reportId) return undefined;
    let alive = true;
    client.from('public_report_repair_actions_citizen_view').select('*').eq('report_id', reportId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data, error }) => { if (alive) setRepair(error ? null : data || null); });
    return () => { alive = false; };
  }, [client, reportId]);
  return repair;
}

/** Who repaired it: the contractor's name, "LGU of <town>", or the DA. */
export function repairerName(report, repair) {
  if (!repair) return null;
  if (repair.repaired_by_name) return repair.repaired_by_name;
  if (repair.responsible_party === 'lgu') return `LGU of ${report?.municipality || 'the town'}`;
  if (repair.responsible_party === 'da') return 'Department of Agriculture';
  return 'The project contractor';
}

/** "by Engr. Maria Santos  FIELD ENGINEER": one quiet line under a step, with
 * the role as a small tag when it helps. A plain function (not a component), so
 * this file only exports helpers. */
function who(role, name, tag = null) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
      <span>{role} <span className="font-medium text-slate-700">{name}</span></span>
      {tag && <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-500">{tag}</span>}
    </p>
  );
}

const PARTY_TAG = { contractor: 'Contractor', lgu: 'LGU', da: 'DA' };
// A name the view titled "Engr." is a field engineer; anyone else checking is the DA office.
const staffTag = (name) => (/^engr\.?\s/i.test(String(name || '')) ? 'Field engineer' : 'DA');

/** Per-step "who did it" for CitizenReportTimeline's `details`. */
export function accountabilityDetails({ report, finding = null, repair = null, isMine = false }) {
  // The names arrive ready to show (the view adds "Engr." for field engineers only).
  const engineer = finding?.inspected_by_name || 'a DA field engineer';
  const checker = repair?.verified_by_name || 'the DA';
  const repairer = repairerName(report, repair);
  const findingNote = (finding?.condition_observed || finding?.recommended_action) && (
    <div className="mt-1.5 space-y-0.5 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 text-xs text-slate-700">
      {finding.condition_observed && <p><span className="text-slate-400">Found </span>{finding.condition_observed}</p>}
      {finding.recommended_action && <p><span className="text-slate-400">Recommended </span>{finding.recommended_action}</p>}
    </div>
  );
  const partyTag = PARTY_TAG[repair?.responsible_party] || null;
  return {
    submitted: who('by', isMine ? 'you' : 'a community member'),
    inspection: who('by', engineer, finding?.inspected_by_name ? staffTag(engineer) : null),
    findings: <>{who('by', engineer, finding?.inspected_by_name ? staffTag(engineer) : null)}{findingNote}</>,
    ...(repairer ? {
      repair_contractor: who('by', repairer, partyTag),
      repair_lgu_work: who('by', repairer, partyTag),
    } : {}),
    work_checked: who('checked by', checker, repair?.verified_by_name ? staffTag(checker) : null),
  };
}
