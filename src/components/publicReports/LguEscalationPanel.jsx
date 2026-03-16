import { useState } from 'react';

export default function LguEscalationPanel({ report, onEscalate, decision }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submitEscalation = async () => {
    if (!reason.trim()) return;
    setSaving(true);
    try {
      await onEscalate(reason.trim());
      setReason('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">LGU Escalation</p>
        {decision?.decision && (
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
            decision.decision === 'endorsed'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : decision.decision === 'rejected'
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}>
            LGU: {String(decision.decision).replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {decision?.remarks && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500 uppercase font-semibold">Latest LGU Remarks</p>
          <p className="mt-1 text-sm text-slate-700">{decision.remarks}</p>
        </div>
      )}

      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
        placeholder="Reason for escalation to LGU (budget approval, policy, major issue)"
      />
      <button
        onClick={submitEscalation}
        disabled={!reason.trim() || saving || !report?.id}
        className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
      >
        {saving ? 'Escalating...' : 'Escalate to LGU'}
      </button>
    </div>
  );
}
