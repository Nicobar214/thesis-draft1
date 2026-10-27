import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import CopyReference from '../ui/CopyReference';

import { buildCitizenTrack } from '../../lib/publicReportStatus';

/** "4.01 km" / "850 m" from a location-check reason, or null. */
function distanceFromReason(reason) {
  const m = /([\d.,]+)\s*(km|m)\b/i.exec(String(reason || ''));
  return m ? `${m[1]} ${m[2].toLowerCase()}` : null;
}

function fmtDateTime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Citizen-facing progress tracker.
 *
 * Reads only columns the citizen views actually expose. `finding` and
 * `resolution` are optional — when the caller has already loaded them (from
 * public_report_field_findings_citizen_view / _resolutions_citizen_view) the
 * track gains real inspection and resolution dates instead of bare labels.
 *
 * `details` (optional) puts more under a step, keyed by step key ('submitted',
 * 'inspection', 'findings', 'repair_contractor', 'repair_lgu_work',
 * 'work_checked', 'resolved'): who did it, what they found
 * (ReportAccountability.js accountabilityDetails).
 */
export default function CitizenReportTimeline({
  report,
  finding = null,
  resolution = null,
  resolutionSummary,
  details = null,
  client = supabase,
}) {
  const track = useMemo(
    () => (report ? buildCitizenTrack(report, { finding, resolution }) : null),
    [report, finding, resolution]
  );

  /* Was this closed as a location mismatch? The view says so directly once
     supabase_citizen_closed_reason.sql has run (citizen_closed_category).
     Until then, fall back to the reporter's own "not credible" notification. */
  const viewCategory = report?.citizen_closed_category;
  const isClosed = String(report?.status || '').toLowerCase() === 'dismissed';
  // Keyed by report id, so a stale answer for another report is never used.
  const [notified, setNotified] = useState({ id: null, mismatch: false });
  useEffect(() => {
    if (!report?.id || !isClosed || viewCategory !== undefined || report?.is_current_user_report === false) return undefined;
    let alive = true;
    client
      .from('notifications')
      .select('id')
      .eq('report_id', report.id)
      .or('title.ilike.Report not credible%,title.ilike.Report declined%')
      .limit(1)
      .then(({ data }) => { if (alive) setNotified({ id: report.id, mismatch: Boolean(data?.length) }); });
    return () => { alive = false; };
  }, [report?.id, isClosed, viewCategory, report?.is_current_user_report, client]);
  const locationMismatch = viewCategory === 'location_mismatch'
    || (viewCategory === undefined && notified.id === report?.id && notified.mismatch);

  if (!report || !track) return null;

  const { current, closed, needsReinspection, steps } = track;
  const reference = String(report.id || '').slice(0, 8).toUpperCase();
  const summary = resolutionSummary || resolution?.summary || '';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">Report Progress</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Reference <CopyReference value={reference} />
          </p>
        </div>
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${current.tone}`}
        >
          {current.label}
        </span>
      </div>

      <p className="text-sm text-slate-600">
        {closed && locationMismatch
          ? 'This report was declined after location verification.'
          : current.helper}
      </p>

      <ol className="space-y-0">
        {steps.map((step) => {
          const extra = step.done ? details?.[step.key] : null;
          return (
            <li key={step.key} className="flex gap-3">
              <div className="flex flex-col items-center" aria-hidden="true">
                <div
                  className={`mt-1 grid size-4 shrink-0 place-items-center rounded-full ${
                    step.done ? current.dotTone : 'border-2 border-slate-300 bg-white'
                  } ${step.active && !closed ? 'ring-4 ring-emerald-100' : ''}`}
                >
                  {step.done && !step.active && (
                    <svg viewBox="0 0 12 12" className="size-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M2.5 6.2 5 8.5 9.5 3.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  )}
                </div>
                {!step.isLast && (
                  <div className={`w-0.5 flex-1 my-1 rounded-full ${step.done ? 'bg-emerald-200' : 'bg-slate-200'}`} />
                )}
              </div>

              <div className={`min-w-0 flex-1 ${step.isLast ? '' : 'pb-4'}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className={`text-sm ${step.active && !closed ? 'font-semibold text-slate-900' : step.done ? 'font-medium text-slate-800' : 'text-slate-400'}`}>
                    {step.label}
                    {step.active && !closed && (
                      <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 align-[1px] text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                        Now
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] tabular-nums text-slate-400">
                    {step.timestamp ? fmtDateTime(step.timestamp) : step.done ? 'Done' : ''}
                  </p>
                </div>
                {!step.done && <p className="text-xs text-slate-400 mt-0.5">{step.blurb}</p>}
                {extra && <div className="mt-1">{extra}</div>}
              </div>
            </li>
          );
        })}
      </ol>

      {current.key === 'resolved' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs text-emerald-800 uppercase font-semibold tracking-wide">
            Resolution Summary
          </p>
          <p className="text-sm text-emerald-900 mt-1">
            {summary || 'This report has been marked as resolved.'}
          </p>
        </div>
      )}

      {needsReinspection && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-800 uppercase font-semibold tracking-wide">
            Second Visit Scheduled
          </p>
          <p className="text-sm text-amber-900 mt-1">
            Your report has not been rejected. Staff asked the field engineer for another on-site
            check before this can be closed, so the inspection step is running again.
          </p>
        </div>
      )}

      {closed && locationMismatch ? (
        // Declined by location verification: a formal statement, the facts, and the next step.
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
            Report Declined
          </p>
          <p className="mt-1 text-sm font-semibold text-red-900">Location verification unsuccessful</p>
          <p className="mt-1 text-sm leading-6 text-red-900">
            You were too far from the project when you submitted this report, so it could not be verified.
          </p>
          <dl className="mt-3 divide-y divide-red-100 overflow-hidden rounded-lg border border-red-100 bg-white text-sm">
            {report.project_name && (
              <div className="flex justify-between gap-4 px-3 py-2">
                <dt className="text-slate-500">Project</dt>
                <dd className="text-right font-medium text-slate-900">{report.project_name}</dd>
              </div>
            )}
            {distanceFromReason(report.citizen_closed_reason) && (
              <div className="flex justify-between gap-4 px-3 py-2">
                <dt className="text-slate-500">Recorded distance</dt>
                <dd className="text-right font-medium text-slate-900">{distanceFromReason(report.citizen_closed_reason)} from the project road</dd>
              </div>
            )}
            <div className="flex justify-between gap-4 px-3 py-2">
              <dt className="text-slate-500">Allowable range</dt>
              <dd className="text-right font-medium text-slate-900">Within 1 km of the project road</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-5 text-red-800">
            To report again, submit from the project site.
          </p>
        </div>
      ) : closed && (
        <div className="rounded-xl border border-slate-300 bg-slate-50 p-3">
          <p className="text-xs text-slate-600 uppercase font-semibold tracking-wide">
            Report Closed
          </p>
          <p className="text-sm text-slate-700 mt-1">
            This report was reviewed and closed without a site inspection. If the problem is still
            there, you can submit a new report with current photos.
          </p>
          {report.citizen_closed_reason && (
            <p className="mt-2 text-sm text-slate-700"><span className="font-semibold">Reason:</span> {report.citizen_closed_reason}</p>
          )}
        </div>
      )}

      <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">
        Quote reference <CopyReference value={reference} />{' '}
        when following up on this report.
      </p>
    </section>
  );
}
