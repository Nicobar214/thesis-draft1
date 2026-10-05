import { useEffect, useMemo, useState } from 'react';

import { supabaseAdminPortal as supabase } from '../../lib/supabase';
import { updatePublicReportWorkflowMeta } from '../../services/publicReportWorkflow';
import {
  TRIAGE,
  canDismissReport,
  formatRecommendedDate,
  recommendInspectionDate,
} from '../../lib/publicReportTriage';
import { RESOLUTION_TYPE_LABELS, resolutionTypeMeaning } from '../../lib/publicReportStatus';
import BillingHoldControl from './BillingHoldControl';
import RepairActionPanel from './RepairActionPanel';

/* resolve_public_report validates this list server-side. The labels and the
 * citizen-facing meaning live in publicReportStatus.js so the form and the
 * citizen's report cannot drift apart. */
const RESOLUTION_TYPES = Object.entries(RESOLUTION_TYPE_LABELS).map(([value, label]) => ({ value, label }));

function SectionShell({ tone, eyebrow, title, description, children }) {
  return (
    <div className={`rounded-xl border-2 p-4 space-y-3 ${tone}`}>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider opacity-80">{eyebrow}</p>
        <p className="text-sm font-semibold text-slate-900 mt-0.5">{title}</p>
        {description && <p className="text-xs text-slate-600 mt-1">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * The single contextual action area for a public report.
 *
 * Only the action that is legal for the report's current state is rendered —
 * the backend state machine (status + engineer_status) decides, not the admin.
 * Priority was removed deliberately: it drove nothing in the workflow and
 * competed with the real decision, which is "dispatch someone or close this".
 */
export default function AdminWorkflowControls({
  report,
  resolution,
  triage,
  onNotify,
  onRepairChanged,
  onResolve,
  onDismiss,
  fieldEngineers = [],
  engineerWorkloads = {},
  assigningEngineer = false,
  onAssignEngineer,
  onUnassignEngineer,
}) {
  const [deadline, setDeadline] = useState('');
  const [editingDate, setEditingDate] = useState(false);
  const [savingDate, setSavingDate] = useState(false);

  const [selectedEngineerId, setSelectedEngineerId] = useState('');
  const [showUnassign, setShowUnassign] = useState(false);
  const [unassignReason, setUnassignReason] = useState('');

  const [showDismiss, setShowDismiss] = useState(false);
  const [dismissReason, setDismissReason] = useState('');
  const [dismissing, setDismissing] = useState(false);

  const [resolutionType, setResolutionType] = useState('repaired');
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [showResolveForm, setShowResolveForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const status = String(report?.status || '').toLowerCase();
  const engineerStatus = String(report?.engineer_status || '').toLowerCase();

  useEffect(() => {
    let alive = true;
    async function loadMeta() {
      if (!report?.id) return;
      try {
        const { data } = await supabase
          .from('public_report_workflow_meta')
          .select('visit_deadline')
          .eq('report_id', report.id)
          .maybeSingle();
        if (!alive) return;
        setDeadline(data?.visit_deadline ? String(data.visit_deadline).slice(0, 10) : '');
      } catch {
        if (alive) setDeadline('');
      }
    }
    loadMeta();
    setShowUnassign(false);
    setShowDismiss(false);
    setShowResolveForm(false);
    setEditingDate(false);
    return () => { alive = false; };
  }, [report?.id]);

  /* Auto-computed target date. Driven by the chosen engineer's live workload
   * and the issue severity — no manual priority input. */
  const activeEngineerId = report?.assigned_engineer_id || selectedEngineerId || '';
  const activeWorkload = engineerWorkloads[activeEngineerId] || 0;
  const autoDate = useMemo(
    () => recommendInspectionDate(activeWorkload, report?.severity_category),
    [activeWorkload, report?.severity_category]
  );

  const saveDeadline = async (iso) => {
    if (!report?.id) return;
    setSavingDate(true);
    try {
      await updatePublicReportWorkflowMeta(supabase, {
        reportId: report.id,
        priority: null,
        visitDeadline: iso || null,
      });
      setDeadline(iso || '');
      setEditingDate(false);
      if (onNotify) onNotify('Target inspection date updated');
    } catch (err) {
      if (onNotify) onNotify(`Could not update the target date: ${err.message}`, 'error');
    } finally {
      setSavingDate(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedEngineerId || typeof onAssignEngineer !== 'function') return;
    // The parent reviews the report first when it is still pending, then
    // assigns, then stores this target date — one admin gesture.
    await onAssignEngineer(selectedEngineerId, autoDate);
    setSelectedEngineerId('');
  };

  const handleUnassign = async () => {
    if (!unassignReason.trim()) {
      if (onNotify) onNotify('Please give a reason for removing this engineer.', 'error');
      return;
    }
    await onUnassignEngineer(unassignReason.trim());
    setUnassignReason('');
    setShowUnassign(false);
  };

  const handleDismiss = async () => {
    const reason = dismissReason.trim();
    if (!reason) {
      if (onNotify) onNotify('A reason is required to close this report.', 'error');
      return;
    }
    setDismissing(true);
    try {
      await onDismiss(reason);
      setShowDismiss(false);
      setDismissReason('');
    } finally {
      setDismissing(false);
    }
  };

  const handleResolve = async () => {
    if (!resolutionSummary.trim()) {
      if (onNotify) onNotify('A resolution summary is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      await onResolve(resolutionSummary.trim(), resolutionType);
      setResolutionSummary('');
      setShowResolveForm(false);
    } finally {
      setSaving(false);
    }
  };

  const engineerCard = report?.assigned_engineer_id && (
    <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-900 truncate">
            {report.assigned_engineer_name || 'Field Engineer'}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Assigned {report.assigned_at ? new Date(report.assigned_at).toLocaleDateString() : 'recently'}
            {' · '}{activeWorkload} active inspection{activeWorkload === 1 ? '' : 's'}
          </p>
        </div>
        {engineerStatus === 'assigned' && (
          <button
            type="button"
            onClick={() => setShowUnassign((v) => !v)}
            className="shrink-0 px-2.5 py-1 text-[11px] font-semibold text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
          >
            Replace
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] border-t border-slate-100 pt-2">
        <span className="text-slate-500">
          Target inspection:{' '}
          <strong className="text-slate-800">
            {deadline ? formatRecommendedDate(deadline) : 'not set'}
          </strong>
        </span>
        {!editingDate && (
          <button
            type="button"
            onClick={() => setEditingDate(true)}
            className="text-slate-500 underline underline-offset-2 hover:text-slate-800"
          >
            Change
          </button>
        )}
      </div>

      {editingDate && (
        <div className="flex items-center gap-2">
          <label htmlFor="target-inspection-date" className="sr-only">Target inspection date</label>
          <input
            id="target-inspection-date"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
          <button
            type="button"
            onClick={() => saveDeadline(deadline)}
            disabled={savingDate}
            className="px-2.5 py-1 rounded-md bg-slate-900 text-white text-[11px] font-semibold disabled:opacity-50"
          >
            {savingDate ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      {showUnassign && (
        <div className="space-y-2 border-t border-slate-100 pt-2">
          <label htmlFor="unassign-reason" className="text-[11px] font-semibold text-slate-600">
            Why is this engineer being removed?
          </label>
          <textarea
            id="unassign-reason"
            value={unassignReason}
            onChange={(e) => setUnassignReason(e.target.value)}
            rows={2}
            placeholder="e.g. reassigned to a closer engineer"
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-slate-400/30"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setShowUnassign(false); setUnassignReason(''); }}
              className="py-1.5 rounded-md text-[11px] font-semibold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUnassign}
              disabled={!unassignReason.trim()}
              className="py-1.5 rounded-md text-[11px] font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Remove engineer
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ── The one contextual action area ───────────────────────────
  const renderAction = () => {
    if (status === 'dismissed') {
      return (
        <SectionShell
          tone="border-slate-300 bg-slate-50"
          eyebrow="Closed"
          title="This report was closed without inspection"
          description={report?.dismissal_reason || undefined}
        />
      );
    }

    if (status === 'resolved') {
      return (
        <SectionShell
          tone="border-emerald-200 bg-emerald-50"
          eyebrow="Complete"
          title="This report has been resolved"
        >
          {resolution?.summary && (
            <div className="text-xs text-emerald-900 bg-white/70 rounded-lg p-2.5 space-y-1">
              <p>{resolution.summary}</p>
              {resolution.resolved_by_name && (
                <p className="text-emerald-700">— {resolution.resolved_by_name}</p>
              )}
            </div>
          )}
          {/* Resolving records a decision. This tracks whether the road was
              actually fixed, and who confirmed it. */}
          <RepairActionPanel report={report} resolution={resolution} onNotify={onNotify} onChanged={onRepairChanged} />
        </SectionShell>
      );
    }

    if (engineerStatus === 'validated') {
      return (
        <SectionShell
          tone="border-emerald-300 bg-emerald-50"
          eyebrow="Action required"
          title="Issue the official resolution"
          description="Findings are validated. Record the outcome to close this case for the citizen."
        >
          {!showResolveForm ? (
            <button
              type="button"
              onClick={() => setShowResolveForm(true)}
              className="w-full py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 transition-colors"
            >
              Resolve Report
            </button>
          ) : (
            <div className="space-y-2">
              <label htmlFor="resolution-type" className="text-[11px] font-semibold text-slate-600 block">
                Outcome
              </label>
              <select
                id="resolution-type"
                value={resolutionType}
                onChange={(e) => setResolutionType(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
              >
                {RESOLUTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500">
                The citizen will see:{' '}
                <span className="text-slate-700">
                  {resolutionTypeMeaning(resolutionType) || 'only your note below.'}
                </span>
              </p>

              <label htmlFor="resolution-summary" className="text-[11px] font-semibold text-slate-600 block">
                What was done? <span className="text-red-600">*</span>
              </label>
              <textarea
                id="resolution-summary"
                value={resolutionSummary}
                onChange={(e) => setResolutionSummary(e.target.value)}
                rows={3}
                placeholder="This is published to the citizen on their resolution certificate."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowResolveForm(false)}
                  disabled={saving}
                  className="py-2 rounded-lg text-xs font-semibold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleResolve}
                  disabled={saving || !resolutionSummary.trim()}
                  className="py-2 rounded-lg text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Confirm Resolution'}
                </button>
              </div>
            </div>
          )}
        </SectionShell>
      );
    }

    if (engineerStatus === 'inspected') {
      return (
        <SectionShell
          tone="border-violet-300 bg-violet-50"
          eyebrow="Action required"
          title="Review the submitted inspection"
          description="Validate or reject the engineer's findings in the Field Inspection panel above."
        />
      );
    }

    if (engineerStatus === 'in_progress') {
      return (
        <SectionShell
          tone="border-slate-200 bg-slate-50"
          eyebrow="In progress"
          title="Inspection underway"
          description="The assigned engineer is on site. Nothing is needed from you until findings arrive."
        >
          {engineerCard}
        </SectionShell>
      );
    }

    if (engineerStatus === 'rejected') {
      return (
        <SectionShell
          tone="border-amber-300 bg-amber-50"
          eyebrow="Waiting on engineer"
          title="Returned for re-inspection"
          description="The engineer has been asked to revisit the site and resubmit."
        >
          {engineerCard}
        </SectionShell>
      );
    }

    if (engineerStatus === 'assigned') {
      return (
        <SectionShell
          tone="border-slate-200 bg-slate-50"
          eyebrow="Dispatched"
          title="Waiting for the site inspection"
          description="The engineer starts the inspection from their own dashboard."
        >
          {engineerCard}
        </SectionShell>
      );
    }

    // ── Nothing dispatched yet: dispatch, or close as not credible ──
    const recommendReject = triage?.recommendation === TRIAGE.REJECT;
    const dismissAllowed = canDismissReport(report);

    if (recommendReject && dismissAllowed) {
      return (
        <SectionShell
          tone="border-red-300 bg-red-50"
          eyebrow="Action required · automated check failed"
          title="Recommended: close this report"
          description={triage?.reasons?.[0]}
        >
          {triage?.reasons?.length > 1 && (
            <ul className="text-xs text-slate-700 list-disc pl-4 space-y-0.5">
              {triage.reasons.slice(1).map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}

          {!showDismiss ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setDismissReason(triage?.suggestedDismissalReason || '');
                  setShowDismiss(true);
                }}
                className="w-full py-2.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
              >
                Close Report as Not Credible
              </button>
              <details className="text-xs">
                <summary className="cursor-pointer text-slate-600 hover:text-slate-900">
                  Dispatch an engineer anyway
                </summary>
                <div className="pt-2 space-y-2">
                  <p className="text-[11px] text-slate-600">
                    Use this if you have reason to believe the report is genuine despite the location check.
                  </p>
                  <select
                    value={selectedEngineerId}
                    onChange={(e) => setSelectedEngineerId(e.target.value)}
                    aria-label="Select field engineer"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="">Select field engineer...</option>
                    {fieldEngineers.map((eng) => (
                      <option key={eng.id} value={eng.id}>
                        {eng.full_name || eng.email} ({engineerWorkloads[eng.id] || 0} active)
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAssign}
                    disabled={!selectedEngineerId || assigningEngineer}
                    className="w-full py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-50 hover:bg-slate-800"
                  >
                    {assigningEngineer ? 'Assigning...' : 'Assign & Dispatch'}
                  </button>
                </div>
              </details>
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor="dismiss-reason" className="text-[11px] font-semibold text-slate-600 block">
                Reason shown in the audit log <span className="text-red-600">*</span>
              </label>
              <textarea
                id="dismiss-reason"
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                rows={4}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-red-500/20"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowDismiss(false)}
                  disabled={dismissing}
                  className="py-2 rounded-lg text-xs font-semibold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDismiss}
                  disabled={dismissing || !dismissReason.trim()}
                  className="py-2 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {dismissing ? 'Closing...' : 'Confirm Close'}
                </button>
              </div>
            </div>
          )}
        </SectionShell>
      );
    }

    return (
      <SectionShell
        tone="border-teal-300 bg-teal-50"
        eyebrow="Action required"
        title="Assign a field engineer"
        description={
          triage?.recommendation === TRIAGE.REVIEW
            ? 'Automated checks flagged something worth a look — see Location Check below.'
            : 'Dispatching marks this report reviewed and schedules the site visit automatically.'
        }
      >
        <div className="space-y-2">
          <select
            value={selectedEngineerId}
            onChange={(e) => setSelectedEngineerId(e.target.value)}
            aria-label="Select field engineer"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white outline-none focus:ring-2 focus:ring-teal-500/20"
          >
            <option value="">Select field engineer...</option>
            {fieldEngineers.map((eng) => (
              <option key={eng.id} value={eng.id}>
                {eng.full_name || eng.email} ({engineerWorkloads[eng.id] || 0} active)
              </option>
            ))}
          </select>

          {selectedEngineerId && (
            <p className="text-[11px] text-teal-900 bg-white/70 border border-teal-200 rounded-md px-2.5 py-1.5">
              Target inspection date will be set to{' '}
              <strong>{formatRecommendedDate(autoDate)}</strong>
              {['safety', 'flood'].includes(String(report?.severity_category || '').toLowerCase())
                ? ' — earliest slot for a safety or flood hazard.'
                : activeWorkload > 0
                  ? ` — after the ${activeWorkload} inspection${activeWorkload === 1 ? '' : 's'} already queued.`
                  : ' — engineer has no other active inspections.'}
            </p>
          )}

          <button
            type="button"
            onClick={handleAssign}
            disabled={!selectedEngineerId || assigningEngineer}
            className="w-full py-2.5 rounded-lg bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 disabled:opacity-50 transition-colors"
          >
            {assigningEngineer ? 'Assigning...' : 'Assign & Dispatch'}
          </button>

          {dismissAllowed && (
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-500 hover:text-slate-800">
                Close without inspection
              </summary>
              <div className="pt-2 space-y-2">
                <label htmlFor="dismiss-reason-manual" className="text-[11px] font-semibold text-slate-600 block">
                  Reason <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="dismiss-reason-manual"
                  value={dismissReason}
                  onChange={(e) => setDismissReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. duplicate of an existing case"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
                <button
                  type="button"
                  onClick={handleDismiss}
                  disabled={dismissing || !dismissReason.trim()}
                  className="w-full py-2 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {dismissing ? 'Closing...' : 'Close Report'}
                </button>
              </div>
            </details>
          )}
        </div>
      </SectionShell>
    );
  };

  return (
    <div className="space-y-4">
      {renderAction()}

      {/* Secondary: a credible citizen report may justify holding a billing. */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
          Contractor Billings
        </span>
        <BillingHoldControl report={report} />
      </div>
    </div>
  );
}
