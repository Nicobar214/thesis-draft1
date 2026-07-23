import { useState } from 'react';
import {
  estimateProjectBudget,
  buildDisbursementTranches,
  realTranchesToScheduleShape,
  formatPeso,
} from '../../lib/budgetEstimate';

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Renders a project's 4-stage disbursement schedule. If real
 * project_tranches rows exist for the project, shows the actual
 * admin-released history (read-only, or with a Release action when
 * canManage is true). Otherwise falls back to the RA-9184 estimate that
 * budgetEstimate.js has always computed client-side, clearly labeled as
 * such since it isn't backed by an actual allocation yet.
 */
export default function ProjectTrancheTimeline({
  project,
  tranches = [],
  canManage = false,
  onInitialize = null,
  onRelease = null,
}) {
  const [releasingId, setReleasingId] = useState(null);
  const [releaseForm, setReleaseForm] = useState({ amount: '', date: todayISO(), notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState('');

  const hasReal = Array.isArray(tranches) && tranches.length > 0;
  const { amount: totalBudget } = estimateProjectBudget(project);
  const accomplishment = Number(project?.accomplishment) || 0;

  const schedule = hasReal
    ? realTranchesToScheduleShape(tranches)
    : buildDisbursementTranches(totalBudget, project);

  const openReleaseForm = (tranche) => {
    setError('');
    setReleasingId(tranche.id);
    setReleaseForm({ amount: String(tranche.amount), date: todayISO(), notes: '' });
  };

  const cancelReleaseForm = () => {
    setReleasingId(null);
    setError('');
  };

  const confirmRelease = async (trancheId) => {
    if (!onRelease) return;
    const amount = Number(releaseForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid released amount.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onRelease(trancheId, { amount, date: releaseForm.date, notes: releaseForm.notes.trim() });
      setReleasingId(null);
    } catch (err) {
      setError(err.message || 'Failed to release tranche.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleInitialize = async () => {
    if (!onInitialize) return;
    setInitializing(true);
    setError('');
    try {
      await onInitialize(project.id);
    } catch (err) {
      setError(err.message || 'Failed to initialize tranches.');
    } finally {
      setInitializing(false);
    }
  };

  return (
    <div className="space-y-3">
      {!hasReal && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span>
            <span className="font-semibold">Estimated schedule</span> — not yet officially allocated. Figures are computed from physical progress, not an audited release.
          </span>
          {canManage && onInitialize && (
            Number(project?.total_budget) > 0 ? (
              <button
                type="button"
                onClick={handleInitialize}
                disabled={initializing}
                className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {initializing ? 'Initializing…' : 'Initialize Real Tranches'}
              </button>
            ) : (
              <span className="shrink-0 text-amber-700">Set a total budget on this project first.</span>
            )
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <div className="space-y-2">
        {schedule.map((t) => {
          const eligible = accomplishment >= t.requiredProgress;
          const isReleasing = releasingId === t.id;
          return (
            <div key={t.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                  <p className="text-xs text-slate-500">{t.percentage}% • {formatPeso(t.amount)} • requires {t.requiredProgress}% progress</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    t.released ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {t.released ? 'Released' : 'Pending'}
                </span>
              </div>

              {t.released && (
                <div className="mt-2 text-xs text-slate-500 space-y-0.5">
                  {t.date && <p>Released {t.date.toLocaleDateString()}{t.releasedByName ? ` by ${t.releasedByName}` : ''}</p>}
                  {t.notes && <p className="italic">"{t.notes}"</p>}
                </div>
              )}

              {!t.released && hasReal && canManage && onRelease && (
                eligible ? (
                  isReleasing ? (
                    <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Amount (₱)</label>
                          <input
                            type="number"
                            value={releaseForm.amount}
                            onChange={(e) => setReleaseForm((f) => ({ ...f, amount: e.target.value }))}
                            className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Date</label>
                          <input
                            type="date"
                            value={releaseForm.date}
                            onChange={(e) => setReleaseForm((f) => ({ ...f, date: e.target.value }))}
                            className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                          />
                        </div>
                      </div>
                      <textarea
                        placeholder="Notes (optional)"
                        value={releaseForm.notes}
                        onChange={(e) => setReleaseForm((f) => ({ ...f, notes: e.target.value }))}
                        rows={2}
                        className="w-full rounded border border-slate-200 px-2 py-1 text-xs resize-none"
                      />
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={cancelReleaseForm} className="rounded px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => confirmRelease(t.id)}
                          disabled={submitting}
                          className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {submitting ? 'Releasing…' : 'Confirm Release'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openReleaseForm(t)}
                      className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      Release Tranche
                    </button>
                  )
                ) : (
                  <p className="mt-2 text-xs text-slate-400">Needs {t.requiredProgress}% progress (currently {accomplishment}%).</p>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
