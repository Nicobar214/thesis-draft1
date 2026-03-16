import { useMemo } from 'react';

function fmtDateTime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

const stages = [
  { key: 'submitted', label: 'Submitted', applies: () => true },
  { key: 'under_review', label: 'Under Review', applies: (status) => ['reviewed', 'resolved'].includes(status) },
  { key: 'dispatched', label: 'Field Engineer Dispatched', applies: (_, report) => Boolean(report?.assigned_engineer_id) },
  { key: 'resolved', label: 'Resolved', applies: (status) => status === 'resolved' },
];

export default function CitizenReportTimeline({ report, resolutionSummary }) {
  const timeline = useMemo(() => {
    if (!report) return [];

    const status = String(report.status || '').toLowerCase();
    const createdAt = report.created_at || null;
    const reviewedAt = report.reviewed_at || report.updated_at || null;
    const dispatchedAt = report.assigned_at || null;
    const resolvedAt = status === 'resolved' ? (report.updated_at || report.reviewed_at || null) : null;

    const ts = {
      submitted: createdAt,
      under_review: reviewedAt,
      dispatched: dispatchedAt,
      resolved: resolvedAt,
    };

    return stages.map((stage, index) => {
      const done = stage.applies(status, report);
      return {
        ...stage,
        done,
        timestamp: done ? ts[stage.key] : null,
        isLast: index === stages.length - 1,
      };
    });
  }, [report]);

  if (!report) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
      <div>
        <p className="text-sm font-semibold text-slate-800">Status Tracker</p>
        <p className="text-xs text-slate-500 mt-0.5">Reference: {String(report.id || '').slice(0, 8).toUpperCase()}</p>
      </div>

      <div className="space-y-3">
        {timeline.map((stage) => (
          <div key={stage.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={`w-3 h-3 rounded-full mt-1 ${stage.done ? 'bg-teal-600' : 'bg-slate-300'}`} />
              {!stage.isLast && <div className={`w-0.5 flex-1 mt-1 ${stage.done ? 'bg-teal-500' : 'bg-slate-200'}`} />}
            </div>
            <div className="pb-2">
              <p className={`text-sm font-medium ${stage.done ? 'text-slate-900' : 'text-slate-500'}`}>{stage.label}</p>
              <p className="text-xs text-slate-500">{stage.timestamp ? fmtDateTime(stage.timestamp) : 'Waiting'}</p>
            </div>
          </div>
        ))}
      </div>

      {String(report.status || '').toLowerCase() === 'resolved' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs text-emerald-700 uppercase font-semibold">Resolution Summary</p>
          <p className="text-sm text-emerald-900 mt-1">{resolutionSummary || 'This report has been marked as resolved.'}</p>
        </div>
      )}

      <p className="text-sm text-slate-600">Thank you for reporting. Your reference number is <span className="font-semibold text-slate-900">{String(report.id || '').slice(0, 8).toUpperCase()}</span>.</p>
    </section>
  );
}
