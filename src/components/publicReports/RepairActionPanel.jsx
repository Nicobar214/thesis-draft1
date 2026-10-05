import { useCallback, useEffect, useState } from 'react';
import { buttonClass } from '../ui/Button';

import { supabaseAdminPortal as defaultClient } from '../../lib/supabase';
import {
  cancelPublicReportRepair,
  completePublicReportRepair,
  planPublicReportRepair,
} from '../../services/publicReportWorkflow';
import {
  RESPONSIBLE_PARTY_LABELS,
  friendlyReportError,
  isRepairOverdue,
  repairStatusInfo,
  resolutionAllowsRepairFollowUp,
  responsiblePartyLabel,
} from '../../lib/publicReportStatus';

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function defaultTargetDate(days = 14) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Admin view of a resolved report's follow-up.
 *
 * "Resolved" records a decision; this tracks whether the road was actually
 * fixed. The admin plans the work and records it done — but a repair is not
 * finished until a different person (normally the assigned engineer) verifies
 * it on site. That separation is enforced in the database, not just here.
 */
export default function RepairActionPanel({ report, resolution, client = defaultClient, onNotify, onChanged }) {
  const [action, setAction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [party, setParty] = useState('da');
  const [targetDate, setTargetDate] = useState(defaultTargetDate());
  const [planNote, setPlanNote] = useState('');
  const [completeNote, setCompleteNote] = useState('');
  const [showComplete, setShowComplete] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const resolutionType = String(resolution?.resolution_type || '').toLowerCase();
  const eligible = resolutionAllowsRepairFollowUp(resolutionType);
  const isRepairedClaim = resolutionType === 'repaired';
  const mustUseContractor = resolutionType === 'referred_to_contractor';

  const load = useCallback(async () => {
    if (!report?.id) return;
    setLoading(true);
    try {
      const { data, error } = await client
        .from('public_report_repair_actions')
        .select('*')
        .eq('report_id', report.id)
        .maybeSingle();
      if (error) throw error;
      setAction(data || null);
    } catch (err) {
      console.warn('[repair] could not load follow-up:', err?.message || err);
      setAction(null);
    } finally {
      setLoading(false);
    }
  }, [client, report?.id]);

  useEffect(() => {
    setShowComplete(false);
    setShowCancel(false);
    setCompleteNote('');
    setCancelReason('');
    setPlanNote('');
    load();
  }, [load]);

  useEffect(() => {
    setParty(mustUseContractor ? 'contractor' : 'da');
  }, [mustUseContractor, report?.id]);

  const run = async (fn, successMessage) => {
    setBusy(true);
    try {
      await fn();
      if (onNotify) onNotify(successMessage);
      await load();
      if (onChanged) onChanged();
      return true;
    } catch (err) {
      console.error('[repair] action failed:', err);
      if (onNotify) onNotify(friendlyReportError(err, 'That did not work. Please try again.'), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="text-xs text-slate-400">Checking follow-up...</p>;
  }

  // Outcomes like "no action required" or "duplicate" have nothing to follow up.
  if (!action && !eligible) return null;

  const info = repairStatusInfo(action?.status);
  const overdue = isRepairOverdue(action);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Repair follow-up
        </p>
        {info && (
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${info.tone}`}>
            {info.staff}
          </span>
        )}
      </div>

      {/* ---- Nothing planned yet ---- */}
      {!action && (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">
            {isRepairedClaim
              ? 'This outcome says the road was repaired. Send it for on-site verification so the claim is checked, not just recorded.'
              : 'Resolving records the decision. Plan who will do the work and by when, so it can be tracked to a verified repair.'}
          </p>

          <label htmlFor="repair-party" className="block text-[11px] font-semibold text-slate-600">
            Responsible office
          </label>
          <select
            id="repair-party"
            value={party}
            onChange={(e) => setParty(e.target.value)}
            disabled={mustUseContractor}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs disabled:bg-slate-50"
          >
            {Object.entries(RESPONSIBLE_PARTY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {mustUseContractor && (
            <p className="text-[11px] text-slate-500">A report referred to a contractor is assigned to the contractor.</p>
          )}

          {!isRepairedClaim && (
            <>
              <label htmlFor="repair-target" className="block text-[11px] font-semibold text-slate-600">
                Target date <span className="text-red-600">*</span>
              </label>
              <input
                id="repair-target"
                type="date"
                value={targetDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            </>
          )}

          <label htmlFor="repair-note" className="block text-[11px] font-semibold text-slate-600">
            Note <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            id="repair-note"
            rows={2}
            value={planNote}
            onChange={(e) => setPlanNote(e.target.value)}
            placeholder="e.g. 40 m of concrete patching near the culvert"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
          />

          <button
            type="button"
            disabled={busy || (!isRepairedClaim && !targetDate)}
            onClick={() =>
              run(
                () => planPublicReportRepair(client, {
                  reportId: report.id,
                  responsibleParty: party,
                  targetDate: isRepairedClaim ? null : targetDate,
                  note: planNote.trim() || null,
                }),
                isRepairedClaim ? 'Sent for on-site verification' : 'Repair follow-up planned'
              )
            }
            className={buttonClass('primary', 'sm', 'w-full')}
          >
            {busy ? 'Saving...' : isRepairedClaim ? 'Send for verification' : 'Plan the repair'}
          </button>
        </div>
      )}

      {/* ---- Planned / completed / verified / cancelled ---- */}
      {action && (
        <div className="space-y-2.5 text-xs text-slate-700">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-slate-500">Responsible</dt>
            <dd className="font-medium">{responsiblePartyLabel(action.responsible_party)}</dd>
            {action.target_date && (
              <>
                <dt className="text-slate-500">Target date</dt>
                <dd className={`font-medium ${overdue ? 'text-red-700' : ''}`}>
                  {fmtDate(action.target_date)}{overdue ? ' · overdue' : ''}
                </dd>
              </>
            )}
            {action.completed_at && (
              <>
                <dt className="text-slate-500">Recorded done</dt>
                <dd className="font-medium">{fmtDate(action.completed_at)}</dd>
              </>
            )}
            {action.verified_at && (
              <>
                <dt className="text-slate-500">Verified</dt>
                <dd className="font-medium">
                  {fmtDate(action.verified_at)}
                  {Number.isFinite(Number(action.verification_distance_m))
                    ? ` · ${Math.round(Number(action.verification_distance_m))} m from the reported site`
                    : ''}
                </dd>
              </>
            )}
          </dl>

          {action.completion_note && (
            <p className="rounded-md bg-slate-50 p-2 text-slate-600">
              <span className="font-semibold text-slate-700">Work done: </span>{action.completion_note}
            </p>
          )}
          {action.status === 'cancelled' && action.cancel_reason && (
            <p className="rounded-md bg-slate-50 p-2 text-slate-600">
              <span className="font-semibold text-slate-700">Cancelled: </span>{action.cancel_reason}
            </p>
          )}

          {action.verification_photo_url && (
            <a href={action.verification_photo_url} target="_blank" rel="noopener noreferrer">
              <img
                src={action.verification_photo_url}
                alt="After-photo taken during on-site verification"
                className="h-32 w-full rounded-md border border-slate-200 object-cover"
              />
            </a>
          )}

          {action.status === 'completed' && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
              Waiting for the assigned engineer to confirm this on site. It is not counted as repaired until they do.
            </p>
          )}

          {/* Mark complete (planned only) */}
          {action.status === 'planned' && !showComplete && !showCancel && (
            <button
              type="button"
              onClick={() => setShowComplete(true)}
              className={buttonClass('primary', 'sm', 'w-full')}
            >
              Record the work as done
            </button>
          )}
          {action.status === 'planned' && showComplete && (
            <div className="space-y-2">
              <label htmlFor="repair-done" className="block text-[11px] font-semibold text-slate-600">
                What was done? <span className="text-red-600">*</span>
              </label>
              <textarea
                id="repair-done"
                rows={2}
                value={completeNote}
                onChange={(e) => setCompleteNote(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <p className="text-[11px] text-slate-500">
                An engineer must then verify it on site. You cannot verify your own entry.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowComplete(false)}
                  disabled={busy}
                  className={buttonClass('secondary', 'sm')}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || !completeNote.trim()}
                  onClick={() =>
                    run(
                      () => completePublicReportRepair(client, { actionId: action.id, note: completeNote.trim() }),
                      'Recorded as done. The engineer has been asked to verify it.'
                    ).then((ok) => { if (ok) setShowComplete(false); })
                  }
                  className={buttonClass('primary', 'sm')}
                >
                  {busy ? 'Saving...' : 'Confirm'}
                </button>
              </div>
            </div>
          )}

          {/* Cancel (planned or completed) */}
          {['planned', 'completed'].includes(action.status) && !showCancel && !showComplete && (
            <button
              type="button"
              onClick={() => setShowCancel(true)}
              className="text-[11px] text-slate-500 underline underline-offset-2 hover:text-slate-800"
            >
              Cancel this follow-up
            </button>
          )}
          {showCancel && (
            <div className="space-y-2">
              <label htmlFor="repair-cancel" className="block text-[11px] font-semibold text-slate-600">
                Reason <span className="text-red-600">*</span>
              </label>
              <textarea
                id="repair-cancel"
                rows={2}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <p className="text-[11px] text-slate-500">
                A cancelled follow-up cannot be replanned for this report. The history stays in the audit log.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowCancel(false)}
                  disabled={busy}
                  className={buttonClass('secondary', 'sm')}
                >
                  Keep it
                </button>
                <button
                  type="button"
                  disabled={busy || !cancelReason.trim()}
                  onClick={() =>
                    run(
                      () => cancelPublicReportRepair(client, { actionId: action.id, reason: cancelReason.trim() }),
                      'Follow-up cancelled'
                    ).then((ok) => { if (ok) setShowCancel(false); })
                  }
                  className={buttonClass('danger', 'sm')}
                >
                  {busy ? 'Saving...' : 'Cancel follow-up'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
