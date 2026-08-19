/* BillingHoldControl.jsx — hold a contractor billing pending verification,
 * driven by a citizen report. DA Region VI, item 7:
 *
 *   "Conflicting public reports are treated as monitoring leads and are
 *    validated through site inspection and supporting records. Payment is NOT
 *    automatically frozen, but affected billings may be held for verification
 *    if a credible discrepancy is identified."
 *
 * Two things follow from that wording and are deliberate here:
 *   1. Nothing is automatic. An admin decides, and must give a reason.
 *   2. A hold is a verification pause, not a penalty or a rejection — the
 *      wording in the UI says so, and the hold can be lifted in one click.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

/* public_reports.project_id is TEXT holding values like "fmr-123", while
   progress_updates.fmr_project_id is a BIGINT. Bridge the two carefully and
   give up rather than guess if the shape is unfamiliar. */
function toFmrProjectId(rawProjectId) {
  if (rawProjectId === null || rawProjectId === undefined) return null;
  const text = String(rawProjectId).trim();
  const match = text.match(/(\d+)\s*$/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

const fmtDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function BillingHoldControl({ report, onChanged }) {
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [reasonFor, setReasonFor] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  const projectId = toFmrProjectId(report?.project_id);

  const fetchUpdates = useCallback(async () => {
    if (!projectId) { setUpdates([]); setLoading(false); return; }
    setLoading(true);
    const { data, error: err } = await supabase
      .from('progress_updates')
      .select('id, reported_accomplishment, certified_accomplishment, amount_this_billing, period_start, period_end, status, billing_hold, hold_reason, held_at, submitted_at')
      .eq('fmr_project_id', projectId)
      .order('submitted_at', { ascending: false })
      .limit(12);
    if (err) {
      console.error('Failed to load billings for hold control', err);
      setError('Could not load billings for this project.');
      setUpdates([]);
    } else {
      setError(null);
      setUpdates(data || []);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { fetchUpdates(); }, [fetchUpdates]);

  const applyHold = async (update, hold) => {
    if (hold && !reason.trim()) {
      setError('A reason is required to hold a billing.');
      return;
    }
    setBusyId(update.id);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('set_billing_hold_admin', {
        progress_update_id: update.id,
        p_hold: hold,
        p_reason: hold ? reason.trim() : null,
        p_report_id: report?.id ?? null,
      });
      if (rpcErr) throw rpcErr;
      setReasonFor(null);
      setReason('');
      await fetchUpdates();
      onChanged?.();
    } catch (err) {
      console.error('Billing hold failed', err);
      setError(err.message || 'Could not update the billing hold.');
    } finally {
      setBusyId(null);
    }
  };

  if (!projectId) {
    return (
      <div className="px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500">
        This report is not linked to an FMR project, so there is no billing to hold.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
        Holding a billing pauses it for verification. It does <span className="font-semibold">not</span>{' '}
        freeze the project&rsquo;s payments automatically and is not a penalty.
      </div>

      {loading ? (
        <p className="text-xs text-slate-400">Loading billings…</p>
      ) : updates.length === 0 ? (
        <p className="text-xs text-slate-500">No contractor billings recorded for this project yet.</p>
      ) : (
        <div className="space-y-2">
          {updates.map((u) => {
            const verified = u.certified_accomplishment ?? u.reported_accomplishment;
            return (
              <div
                key={u.id}
                className={`rounded-lg border p-2.5 ${u.billing_hold ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800">
                      {fmtDate(u.period_start)} – {fmtDate(u.period_end)}
                      {u.amount_this_billing != null && (
                        <span className="ml-2 font-mono text-slate-600">
                          ₱{Number(u.amount_this_billing).toLocaleString('en-PH', { maximumFractionDigits: 0 })}
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {Number(verified ?? 0).toFixed(1)}% accomplishment · {u.status}
                      {u.certified_accomplishment == null && (
                        <span className="ml-1 text-amber-700 font-semibold">· uncertified</span>
                      )}
                    </p>
                  </div>
                  {u.billing_hold && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-amber-300 bg-amber-100 text-[10px] font-bold text-amber-800 whitespace-nowrap">
                      ON HOLD
                    </span>
                  )}
                </div>

                {u.billing_hold && u.hold_reason && (
                  <p className="text-[11px] text-amber-900 mt-1.5 border-t border-amber-200 pt-1.5">
                    {u.hold_reason}
                    <span className="text-amber-700"> · {fmtDate(u.held_at)}</span>
                  </p>
                )}

                {u.billing_hold ? (
                  <button
                    onClick={() => applyHold(u, false)}
                    disabled={busyId === u.id}
                    className="mt-2 w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-60"
                  >
                    {busyId === u.id ? 'Working…' : 'Lift hold'}
                  </button>
                ) : reasonFor === u.id ? (
                  <div className="mt-2 space-y-1.5">
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      placeholder="Describe the credible discrepancy that justifies holding this billing (required)"
                      className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none resize-none"
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => { setReasonFor(null); setReason(''); setError(null); }}
                        className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => applyHold(u, true)}
                        disabled={busyId === u.id}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-semibold transition-colors disabled:opacity-60"
                      >
                        {busyId === u.id ? 'Working…' : 'Confirm hold'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setReasonFor(u.id); setReason(''); setError(null); }}
                    className="mt-2 w-full px-3 py-1.5 rounded-lg border border-amber-200 bg-white text-[11px] font-semibold text-amber-700 hover:bg-amber-50 transition-colors"
                  >
                    Hold for verification
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">{error}</p>
      )}
    </div>
  );
}
