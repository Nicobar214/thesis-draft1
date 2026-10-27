/* "Contractor history" on a project's page (public, LGU, DA, contractors): each
 * contractor's own period, % range, target, delays and days late
 * (project_contractor_history, supabase_overdue_v2.sql). A reassigned project
 * shows who did what, so the next contractor is not blamed for the earlier delay.
 * Shows nothing for a project without delays or reassignments, or before the SQL is run.
 *
 *   <ContractorHistory projectId={project.id} client={supabase} /> */
import { useEffect, useState } from 'react';
import { UsersRoundIcon } from 'lucide-react';
import { supabase as defaultClient } from '../../lib/supabase';
import { fmtDay } from '../../lib/delayCases';
import { delayLine, historyWorthShowing, projectSummary } from '../../lib/contractorHistory';

const STATUS = {
  holding: { label: 'Now holding', tone: 'border-teal-200 bg-teal-50 text-teal-700' },
  completed: { label: 'Completed', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  terminated: { label: 'Terminated', tone: 'border-rose-200 bg-rose-50 text-rose-700' },
};
const pct = (v) => `${Math.round(Number(v || 0) * 100) / 100}%`;

export default function ContractorHistory({ projectId, client = defaultClient, className = '' }) {
  const [terms, setTerms] = useState([]);

  useEffect(() => {
    if (projectId == null) return undefined;
    let alive = true;
    client.rpc('project_contractor_history', { p_project: Number(projectId) })
      .then(({ data, error }) => { if (alive) setTerms(error || !Array.isArray(data) ? [] : data); });
    return () => { alive = false; };
  }, [client, projectId]);

  if (!historyWorthShowing(terms)) return null;
  const summary = projectSummary(terms);
  return (
    <section className={`rounded-2xl border border-slate-200/60 bg-white p-5 ${className}`} aria-label="Contractor history">
      <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
        <UsersRoundIcon className="size-4 text-teal-600" aria-hidden="true" />
        Contractor history
      </h4>
      <ol className="space-y-3">
        {terms.map((t) => {
          const st = STATUS[t.status] || STATUS.holding;
          const delays = t.delays || [];
          // "On time" only for a finished period with no offenses (excused days can bring days late to 0).
          const onTime = t.days_late === 0 && t.status === 'completed' && !delays.some((d) => d.kind === 'offense');
          return (
            <li key={t.term_no} className="rounded-xl border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-semibold text-slate-900">
                  <span className="mr-1.5 inline-grid size-5 place-items-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">{t.term_no}</span>
                  {t.contractor_name}
                </p>
                <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${st.tone}`}>{st.label}</span>
              </div>
              <p className="mt-1 text-slate-600">
                {fmtDay(t.started_on)} – {t.ended_on ? fmtDay(t.ended_on) : 'present'}
                {' · '}{t.term_no > 1 ? 'Continued from' : 'Did'} {pct(t.start_percent)} → {t.end_percent != null ? pct(t.end_percent) : 'ongoing'}
              </p>
              <p className="mt-0.5 text-slate-600">
                Own target: {fmtDay(t.target_date)}
                {t.days_late != null && (
                  <span className={`ml-1.5 font-semibold ${onTime ? 'text-emerald-700' : 'text-rose-700'}`}>
                    · {onTime ? 'On time' : `${t.days_late} day${t.days_late === 1 ? '' : 's'} late`}
                  </span>
                )}
                {Number(t.excused_days) > 0 && <span className="ml-1.5 text-slate-500">({t.excused_days} day{Number(t.excused_days) === 1 ? '' : 's'} excused: act of nature)</span>}
              </p>
              {delays.length > 0 && (
                <ul className="mt-2 space-y-0.5 border-l-2 border-slate-100 pl-3 text-xs text-slate-600">
                  {delays.map((d, i) => <li key={`${d.closed_on}-${i}`}>• {delayLine(d)}{d.closed_on ? ` · ${fmtDay(d.closed_on)}` : ''}</li>)}
                </ul>
              )}
              {t.status === 'terminated' && t.end_reason && <p className="mt-2 text-xs text-slate-500">DA: “{t.end_reason}”</p>}
            </li>
          );
        })}
      </ol>
      {summary && (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {summary.finished ? 'Project overall' : 'So far'}: {summary.overallDays ?? '—'} day(s) past the original target ({fmtDay(terms[0].target_date)}).
          {summary.gapDays > 0 && ` Reassignment gap: ${summary.gapDays} day(s), not counted against either contractor.`}
        </p>
      )}
    </section>
  );
}
