import { useMemo } from 'react';

import { buildCitizenTrack } from '../../lib/publicReportStatus';

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
 */
export default function CitizenReportTimeline({
  report,
  finding = null,
  resolution = null,
  resolutionSummary,
}) {
  const track = useMemo(
    () => (report ? buildCitizenTrack(report, { finding, resolution }) : null),
    [report, finding, resolution]
  );

  if (!report || !track) return null;

  const { current, closed, steps } = track;
  const reference = String(report.id || '').slice(0, 8).toUpperCase();
  const summary = resolutionSummary || resolution?.summary || '';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">Report Progress</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Reference <span className="font-mono font-semibold text-slate-700">{reference}</span>
          </p>
        </div>
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${current.tone}`}
        >
          {current.label}
        </span>
      </div>

      <p className="text-sm text-slate-600">{current.helper}</p>

      <ol className="space-y-0">
        {steps.map((step) => (
          <li key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center" aria-hidden="true">
              <div
                className={`w-3 h-3 rounded-full mt-1.5 shrink-0 ${
                  step.done ? current.dotTone : 'bg-slate-300'
                } ${step.active ? 'ring-4 ring-slate-200' : ''}`}
              />
              {!step.isLast && (
                <div className={`w-0.5 flex-1 my-1 ${step.done ? 'bg-slate-300' : 'bg-slate-200'}`} />
              )}
            </div>

            <div className="pb-4 min-w-0">
              <p
                className={`text-sm font-medium ${step.done ? 'text-slate-900' : 'text-slate-400'}`}
              >
                {step.label}
                {step.active && !closed && (
                  <span className="ml-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                    Current
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {step.timestamp
                  ? fmtDateTime(step.timestamp)
                  : step.done
                    ? 'Completed'
                    : step.blurb}
              </p>
            </div>
          </li>
        ))}
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

      {closed && (
        <div className="rounded-xl border border-slate-300 bg-slate-50 p-3">
          <p className="text-xs text-slate-600 uppercase font-semibold tracking-wide">
            Report Closed
          </p>
          <p className="text-sm text-slate-700 mt-1">
            This report was reviewed and closed without a site inspection. If the problem is still
            there, you can submit a new report with current photos.
          </p>
        </div>
      )}

      <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">
        Quote reference <span className="font-mono font-semibold text-slate-700">{reference}</span>{' '}
        when following up on this report.
      </p>
    </section>
  );
}
