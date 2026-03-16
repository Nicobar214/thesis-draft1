import { useMemo, useState } from 'react';

const decisionTone = {
  endorsed: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  rejected: 'bg-red-50 border-red-200 text-red-700',
  more_info_requested: 'bg-amber-50 border-amber-200 text-amber-700',
};

export default function LguForActionTab({ escalations, findings, loading, onDecision }) {
  const [remarksById, setRemarksById] = useState({});
  const [savingId, setSavingId] = useState('');

  const forAction = useMemo(() => {
    return (escalations || []).filter((row) => ['for_action', 'more_info_requested'].includes(row.escalation_status));
  }, [escalations]);

  const submitDecision = async (row, decision) => {
    const remarks = String(remarksById[row.id] || '').trim();
    if (!remarks) return;

    setSavingId(row.id);
    try {
      await onDecision(row, decision, remarks);
      setRemarksById((prev) => ({ ...prev, [row.id]: '' }));
    } finally {
      setSavingId('');
    }
  };

  if (loading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading LGU escalations...</div>;
  }

  if (forAction.length === 0) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No escalated reports for action.</div>;
  }

  return (
    <div className="space-y-3">
      {forAction.map((row) => (
        (() => {
          const finding = (findings || []).find((item) => item.report_id === row.report_id);
          return (
        <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">{row.project_name || 'Unlinked project'}</p>
              <p className="text-xs text-slate-500">{row.barangay || 'N/A'}, {row.municipality || 'N/A'} • Ref {String(row.report_id || '').slice(0, 8).toUpperCase()}</p>
            </div>
            <span className={`px-2.5 py-1 rounded-full border text-xs font-semibold ${decisionTone[row.escalation_status] || 'bg-slate-50 border-slate-200 text-slate-600'}`}>
              {String(row.escalation_status || 'for_action').replace(/_/g, ' ')}
            </span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500 uppercase font-semibold">Escalation Reason</p>
            <p className="mt-1 text-sm text-slate-700">{row.escalation_reason || 'No reason provided.'}</p>
          </div>

          {finding && (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-500 uppercase font-semibold">Field Engineer Findings</p>
              <p className="mt-1 text-sm text-slate-700"><span className="font-medium">Condition:</span> {finding.condition_observed || 'N/A'}</p>
              <p className="mt-1 text-sm text-slate-700"><span className="font-medium">Recommended Action:</span> {finding.recommended_action || 'N/A'}</p>
              {finding.field_photo_url && (
                <a href={finding.field_photo_url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                  <img src={finding.field_photo_url} alt="Field finding" className="w-full sm:w-64 h-40 object-cover rounded-lg border border-slate-200" />
                </a>
              )}
            </div>
          )}

          <div>
            <label className="text-xs text-slate-500 uppercase font-semibold">LGU Remarks</label>
            <textarea
              value={remarksById[row.id] || ''}
              onChange={(e) => setRemarksById((prev) => ({ ...prev, [row.id]: e.target.value }))}
              rows={3}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Write endorsement, rejection reason, or request for more info"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => submitDecision(row, 'endorsed')}
              disabled={savingId === row.id}
              className="px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-semibold hover:bg-emerald-100 disabled:opacity-50"
            >
              Endorse
            </button>
            <button
              onClick={() => submitDecision(row, 'rejected')}
              disabled={savingId === row.id}
              className="px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm font-semibold hover:bg-red-100 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              onClick={() => submitDecision(row, 'more_info_requested')}
              disabled={savingId === row.id}
              className="px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-sm font-semibold hover:bg-amber-100 disabled:opacity-50"
            >
              Request More Info
            </button>
          </div>
        </article>
          );
        })()
      ))}
    </div>
  );
}
