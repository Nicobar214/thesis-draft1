/* "Citizen reports" on a project's details (landing page and citizen portal):
 * every road report filed on this project that was not dismissed, newest first.
 * Opening one shows who answered it (ReportResponses) and the Before / Site
 * check / After photos (BeforeAfterCard), as in Community Feedback. The
 * reporter is never named. Shows nothing when the project has no reports.
 *
 *   <ProjectReports projectId={project.id} /> */
import { useEffect, useState } from 'react';
import { ChevronDownIcon, MessageSquareWarningIcon } from 'lucide-react';
import { supabase as defaultClient } from '../../lib/supabase';
import { getCitizenStatus, resolveCategory, SEVERITY_TAXONOMY } from '../../lib/publicReportStatus';
import { useReportOutcome, useReportRepair } from './reportAccountability';
import ReportResponses from './ReportResponses';
import BeforeAfterCard from './BeforeAfterCard';

const PAGE = 5;

function fmtDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* Loaded only when opened, so a long list stays cheap. */
function ReportDetail({ client, report }) {
  const repair = useReportRepair(client, report.id);
  const { finding, resolution } = useReportOutcome(client, report.id);
  const answered = finding || repair || resolution || report.citizen_closed_reason;
  return (
    <div className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-3">
      <p className="whitespace-pre-line text-sm text-slate-700">{report.description || 'No description provided.'}</p>
      {answered
        ? <ReportResponses client={client} report={report} finding={finding} repair={repair} resolution={resolution} />
        : <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">No response yet. The DA reviews new reports and sends a field engineer when needed.</p>}
      <BeforeAfterCard report={report} repair={repair} finding={finding} />
    </div>
  );
}

export default function ProjectReports({ projectId, client = defaultClient, className = '' }) {
  const [reports, setReports] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    if (projectId == null) return undefined;
    let alive = true;
    // Reports point at their road as "fmr-<id>" (lib/reportSubmission.js).
    client.from('public_reports_citizen_view').select('*').eq('project_id', `fmr-${projectId}`).order('created_at', { ascending: false })
      .then(({ data, error }) => { if (alive) setReports(error ? [] : data || []); });
    return () => { alive = false; };
  }, [client, projectId]);

  if (!reports.length) return null;
  return (
    <section className={`rounded-2xl border border-slate-200/60 bg-white p-6 ${className}`} aria-label="Citizen reports on this project">
      <h4 className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
        <MessageSquareWarningIcon className="size-4 text-amber-600" aria-hidden="true" />
        Citizen reports · {reports.length}
      </h4>
      <p className="mb-4 text-sm text-slate-500">Road problems reported by the public, and how the DA, the field engineer and the contractor or LGU answered.</p>
      <ul className="space-y-2">
        {reports.slice(0, shown).map((r) => {
          const status = getCitizenStatus(r);
          const issue = SEVERITY_TAXONOMY[resolveCategory(r)]?.label;
          const open = openId === r.id;
          return (
            <li key={r.id} className="overflow-hidden rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : r.id)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">{issue || 'Road report'}{r.barangay ? ` · ${r.barangay}` : ''}</span>
                  <span className="block text-xs text-slate-500">Reported {fmtDate(r.created_at)}</span>
                </span>
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${status.tone}`}>{status.label}</span>
                <ChevronDownIcon className={`size-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {open && <ReportDetail client={client} report={r} />}
            </li>
          );
        })}
      </ul>
      {reports.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE)} className="mt-3 text-sm font-semibold text-emerald-700 hover:underline">
          Show more reports ({reports.length - shown} more)
        </button>
      )}
    </section>
  );
}
