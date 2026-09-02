/* ContractorProjectDetailModal.jsx — full detail for one assigned project.
 *
 * Opened by clicking a row in the contractor's project table. Shows the project
 * description and schedule, the physical-vs-financial position, and the full
 * history of this contractor's own progress submissions including where each
 * one sits in the verification chain (submitted -> certified -> approved).
 *
 * Fetches its own submission history so the table only has to carry the latest
 * update per project.
 */
import { useEffect, useState } from 'react';
import { supabaseContractor as supabase } from '../../lib/supabase';
import { getProjectBudgetSummary, formatPeso } from '../../lib/budgetEstimate';
import { getWorkflowMeta, officialAccomplishmentOf } from '../../lib/progressWorkflow';

const fmtDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/* Three values can exist on one submission and they must never be blurred
   together: what the contractor claimed, what the engineer measured, and what
   the administrator made official. */
function ValueBlock({ label, value, suffix, tone, note }) {
  return (
    <div className={`rounded-lg border p-2.5 ${tone}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-base font-bold font-mono mt-0.5">
        {value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`}
        {suffix}
      </p>
      {note && <p className="text-[10px] mt-0.5 opacity-80">{note}</p>}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-sm text-slate-800 mt-0.5">{value || '—'}</p>
    </div>
  );
}

export default function ContractorProjectDetailModal({ project, tranches = [], onClose, onSubmitUpdate }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const projectId = project?.id;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!projectId) { if (!cancelled) setLoading(false); return; }
      setLoading(true);
      const { data, error } = await supabase
        .from('progress_updates')
        .select('id, reported_accomplishment, certified_accomplishment, certification_status, certification_remarks, amount_this_billing, period_start, period_end, status, remarks, billing_hold, hold_reason, submitted_at')
        .eq('fmr_project_id', projectId)
        .order('submitted_at', { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error('Failed to load submission history', error);
        setHistory([]);
      } else {
        setHistory(data || []);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [projectId]);

  // Close on Escape, matching normal dialog behaviour.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!project) return null;

  const accomplishment = Number(project.accomplishment || 0);
  const budget = getProjectBudgetSummary(project, tranches);
  const contract = Number(project.contract_amount || project.total_budget || 0);
  const financialPct = contract > 0 ? Math.min(100, (Number(budget.released || 0) / contract) * 100) : null;
  const hasPending = history.some((h) => h.status === 'pending');

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Project details for ${project.project_name}`}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 leading-snug">
              {project.project_name || 'Unnamed Project'}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {project.municipality}{project.province ? `, ${project.province}` : ''}
              {project.project_length_km ? ` · ${project.project_length_km} km` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close project details"
            className="p-2 rounded-xl hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600 shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Physical vs financial */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-teal-100 bg-teal-50/50 p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-teal-700">Official physical accomplishment</p>
              <p className="text-2xl font-bold text-teal-700 mt-1 font-mono">{accomplishment.toFixed(1)}%</p>
              <p className="text-[10px] text-teal-700/70">Engineer-certified &amp; DA-approved</p>
              <div className="w-full bg-white/70 rounded-full h-2 mt-2">
                <div className="h-2 rounded-full bg-teal-500" style={{ width: `${Math.min(accomplishment, 100)}%` }} />
              </div>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">Funds released</p>
              <p className="text-2xl font-bold text-indigo-700 mt-1 font-mono">
                {financialPct === null ? '—' : `${financialPct.toFixed(1)}%`}
              </p>
              <p className="text-xs text-indigo-700/80 mt-1">
                {formatPeso(budget.released)} of {formatPeso(budget.totalBudget)}
                {budget.budgetIsEstimated ? ' (est.)' : ''}
              </p>
            </div>
          </div>

          {/* Description */}
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-2">Project description</h3>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
              {project.remarks?.trim()
                || 'No description has been recorded for this project by the DA administrator.'}
            </p>
          </div>

          {/* Facts */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
            <Row label="Status" value={project.status} />
            <Row label="Year funded" value={project.year_funded} />
            <Row label="Length" value={project.project_length_km ? `${project.project_length_km} km` : null} />
            <Row label="Date started" value={fmtDate(project.date_started)} />
            <Row label="Target completion" value={project.target_completion_date || '—'} />
            <Row label="Date completed" value={project.date_completed || '—'} />
            <Row label="Location" value={project.location} />
            <Row label="Funding source" value={project.funding_source} />
            <Row label="Contract amount" value={project.contract_amount ? formatPeso(project.contract_amount) : '—'} />
          </div>

          {/* Submission history */}
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-2">
              My submissions {history.length > 0 && <span className="font-normal text-slate-400">({history.length})</span>}
            </h3>

            {loading ? (
              <p className="text-sm text-slate-400">Loading history…</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-slate-500">
                No progress updates submitted for this project yet.
              </p>
            ) : (
              <div className="space-y-2">
                {history.map((h) => {
                  const meta = getWorkflowMeta(h);
                  const isApproved = h.status === 'approved';
                  return (
                    <div key={h.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                        <p className="text-xs text-slate-500">
                          {h.period_start || h.period_end
                            ? `Period ${fmtDate(h.period_start)} – ${fmtDate(h.period_end)}`
                            : `Submitted ${fmtDate(h.submitted_at)}`}
                          {h.amount_this_billing != null && ` · Billed ${formatPeso(h.amount_this_billing)}`}
                        </p>
                        <span
                          title={meta.hint}
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase whitespace-nowrap ${meta.tone}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </div>

                      {/* Claim → verification → decision, never merged into one number */}
                      <div className="grid grid-cols-3 gap-2">
                        <ValueBlock
                          label="You reported"
                          value={h.reported_accomplishment}
                          tone="border-slate-200 bg-slate-50 text-slate-700"
                          note="Your claim"
                        />
                        <ValueBlock
                          label="Engineer certified"
                          value={h.certified_accomplishment}
                          tone={h.certification_status === 'disputed'
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : 'border-teal-200 bg-teal-50 text-teal-700'}
                          note={h.certification_status === 'disputed'
                            ? 'Disputed'
                            : h.certified_accomplishment == null ? 'Not yet verified' : `Verified ${fmtDate(h.certified_at)}`}
                        />
                        <ValueBlock
                          label="Official"
                          value={isApproved ? officialAccomplishmentOf(h) : null}
                          tone={isApproved
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-white text-slate-400'}
                          note={isApproved ? 'Approved by DA' : 'Not yet official'}
                        />
                      </div>

                      {meta.actor && (
                        <p className="text-[11px] text-slate-500 mt-2">
                          Next step: <span className="font-semibold">{meta.actor}</span>
                        </p>
                      )}

                      {h.remarks && <p className="text-xs text-slate-600 mt-2">{h.remarks}</p>}

                      {h.certification_status === 'disputed' && h.certification_remarks && (
                        <p className="text-xs text-rose-700 mt-2 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">
                          Engineer note: {h.certification_remarks}
                        </p>
                      )}

                      {h.billing_hold && (
                        <p className="text-xs text-amber-800 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                          Billing held for verification{h.hold_reason ? `: ${h.hold_reason}` : '.'}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer action */}
        <div className="px-6 py-4 border-t border-slate-200 flex gap-3 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
          {hasPending ? (
            <span className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-amber-50 text-amber-700 border border-amber-200">
              Pending review
            </span>
          ) : (
            <button
              onClick={() => onSubmitUpdate(project)}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 shadow-lg shadow-teal-500/25 transition-colors"
            >
              Submit progress update
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
