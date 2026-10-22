import { useEffect, useMemo, useState } from 'react';

import { supabaseAdminPortal as supabase } from '../../lib/supabase';
import { updatePublicReportWorkflowMeta } from '../../services/publicReportWorkflow';
import {
  TRIAGE,
  canDismissReport,
  formatRecommendedDate,
  recommendInspectionDate,
} from '../../lib/publicReportTriage';
import {
  activeWorkOrder,
  URGENT_TYPES,
  handlerFor,
  resolutionTypeMeaning,
  resolveCategory,
  workOrderStage,
} from '../../lib/publicReportStatus';
import { buttonClass } from '../ui/Button';
import RepairActionPanel from './RepairActionPanel';
import WorkOrderPanel, { SendWorkForm } from './WorkOrderPanel';
import CitizenConfirmationNote from './CitizenConfirmationNote';
import ReopenReportPanel from './ReopenReportPanel';
import SupportCountNote from './SupportCountNote';

/* resolve_public_report validates this list server-side. The labels and the
 * citizen-facing meaning live in publicReportStatus.js so the form and the
 * citizen's report cannot drift apart. */
/* The outcomes that fit each way a report can close. The repair now happens
 * before resolving (LGU/contractor job), so "scheduled for repair" and
 * "referred to contractor" no longer apply to new reports; they stay valid in
 * the database for older ones. Work that is not done is sent back, not resolved. */
const OUTCOMES_AFTER_REPAIR = [
  { value: 'repaired', label: 'Repaired — the after-photo shows it fixed' },
  { value: 'monitoring_required', label: 'Temporary fix — keep monitoring the site' },
];
const OUTCOMES_WITHOUT_REPAIR = [
  { value: 'no_action_required', label: 'No repair needed' },
  { value: 'outside_project_scope', label: 'Outside this project’s scope' },
  { value: 'duplicate_case', label: 'Duplicate of another report' },
  { value: 'other', label: 'Other (explain below)' },
];

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
  onReportChanged,
  costEstimate = null,
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

  // null = use the outcome suggested by who fixes this report.
  const [chosenResolutionType, setResolutionType] = useState(null);
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [showResolveForm, setShowResolveForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // The LGU's or contractor's job for this report (public_report_repair_actions).
  const [workOrder, setWorkOrder] = useState(null);
  const [workTick, setWorkTick] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!report?.id) return undefined;
    supabase
      .from('public_report_repair_actions')
      .select('*')
      .eq('report_id', report.id)
      .maybeSingle()
      .then(({ data, error }) => { if (alive) setWorkOrder(error ? null : data || null); });
    return () => { alive = false; };
  }, [report?.id, report?.status, report?.updated_at, workTick]);
  const activeWork = activeWorkOrder(workOrder);
  const returnedWork = workOrderStage(workOrder) === 'returned' ? workOrder : null;
  const workChanged = () => {
    setWorkTick((t) => t + 1);
    if (onRepairChanged) onRepairChanged();
  };

  // Who fixes it: the contractor (road and structural damage, after a field
  // inspection) or the municipal LGU (obstructions, signs; sent directly).
  // Set by the issue type; shown, not chosen here, to keep it unambiguous.
  const handler = report ? handlerFor(report) : 'contractor';
  // With finished work the outcome is "Repaired"; without a job, "No action required".
  const outcomeOptions = activeWork ? OUTCOMES_AFTER_REPAIR : OUTCOMES_WITHOUT_REPAIR;
  const resolutionType = outcomeOptions.some((o) => o.value === chosenResolutionType)
    ? chosenResolutionType
    : outcomeOptions[0].value;

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
    setResolutionType(null);
    return () => { alive = false; };
  }, [report?.id]);

  /* Auto-computed target date. Driven by the chosen engineer's live workload
   * and the issue severity — no manual priority input. */
  const activeEngineerId = report?.assigned_engineer_id || selectedEngineerId || '';
  const activeWorkload = engineerWorkloads[activeEngineerId] || 0;
  const autoDate = useMemo(
    () => recommendInspectionDate(activeWorkload, report ? resolveCategory(report) : null),
    [activeWorkload, report]
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
    // false = the admin cancelled the confirmation: keep the choice.
    if ((await onAssignEngineer(selectedEngineerId, autoDate)) === false) return;
    setSelectedEngineerId('');
  };

  const handleUnassign = async () => {
    if (!unassignReason.trim()) {
      if (onNotify) onNotify('Please give a reason for removing this engineer.', 'error');
      return;
    }
    if ((await onUnassignEngineer(unassignReason.trim())) === false) return;
    setUnassignReason('');
    setShowUnassign(false);
  };

  const handleDismiss = async (options = {}) => {
    const reason = dismissReason.trim();
    if (!reason) {
      if (onNotify) onNotify('A reason is required to close this report.', 'error');
      return;
    }
    setDismissing(true);
    try {
      if ((await onDismiss(reason, options)) === false) return;
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
      if ((await onResolve(resolutionSummary.trim(), resolutionType)) === false) return;
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
            className={buttonClass('secondary', 'xs', 'shrink-0')}
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
            className={buttonClass('primary', 'xs')}
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
              className={buttonClass('secondary', 'xs')}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUnassign}
              disabled={!unassignReason.trim()}
              className={buttonClass('warning', 'xs')}
            >
              Remove engineer
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const resolveForm = (label) => (
    <>
          {!showResolveForm ? (
            <button
              type="button"
              onClick={() => setShowResolveForm(true)}
              className={buttonClass('primary', 'md', 'w-full')}
            >
              {label}
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
                {outcomeOptions.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500">
                {activeWork
                  ? `Not fixed yet? Use "Send back to the ${workOrder.responsible_party === 'lgu' ? 'LGU' : 'contractor'}" above instead of resolving.`
                  : 'Closing without a repair. To repair it, send it out instead.'}
              </p>
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
                  className={buttonClass('secondary', 'sm')}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleResolve}
                  disabled={saving || !resolutionSummary.trim()}
                  className={buttonClass('primary', 'sm')}
                >
                  {saving ? 'Saving...' : 'Confirm Resolution'}
                </button>
              </div>
            </div>
          )}
    </>
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
          {activeWork
            ? <WorkOrderPanel action={activeWork} report={report} readOnly />
            : <RepairActionPanel report={report} resolution={resolution} onNotify={onNotify} onChanged={onRepairChanged} handler={handler} />}
          <CitizenConfirmationNote key={report?.id} reportId={report?.id} />
          <ReopenReportPanel
            key={`reopen-${report?.id}`}
            report={report}
            onNotify={onNotify}
            onChanged={() => {
              // Back to "reviewed": the job is with the LGU/contractor again.
              if (onReportChanged) onReportChanged({ status: 'reviewed', resolved_at: null });
              workChanged();
            }}
          />
        </SectionShell>
      );
    }

    if (activeWork) {
      const who = activeWork.responsible_party === 'lgu' ? 'LGU' : 'contractor';
      const panel = <WorkOrderPanel action={activeWork} report={report} onNotify={onNotify} onChanged={workChanged} />;
      if (activeWork.status === 'planned') {
        return (
          <SectionShell
            tone="border-slate-200 bg-slate-50"
            eyebrow={`With the ${who}`}
            title={`Waiting for the ${who} to fix it`}
            description={`They accept the job, start the work and send an on-site after-photo. You are notified at each step.`}
          >
            {panel}
          </SectionShell>
        );
      }
      if (activeWork.status === 'completed' && activeWork.engineer_check_requested_at) {
        return (
          <SectionShell
            tone="border-slate-200 bg-slate-50"
            eyebrow="With the field engineer"
            title="Waiting for the on-site repair check"
            description="The engineer confirms the contractor's repair with a photo from the site. Then you resolve the report."
          >
            {panel}
          </SectionShell>
        );
      }
      return (
        <SectionShell
          tone="border-emerald-300 bg-emerald-50"
          eyebrow="Action required"
          title="Review the after-photo and resolve"
          description={`The ${who} sent a photo of the finished work. Resolve the report if it is fixed, or send it back.`}
        >
          {panel}
          {resolveForm('Resolve Report')}
        </SectionShell>
      );
    }

    if (engineerStatus === 'validated') {
      return (
        <SectionShell
          tone="border-emerald-300 bg-emerald-50"
          eyebrow="Action required"
          title={`Send the repair to the ${handler === 'lgu' ? 'LGU' : 'contractor'}`}
          description="The engineer confirmed the problem on site. Send the repair, or resolve it if no repair is needed."
        >
          <SendWorkForm report={report} party={handler} onNotify={onNotify} onChanged={workChanged} returned={returnedWork} costEstimate={costEstimate} />
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-800">No repair needed? Resolve instead</summary>
            <div className="pt-2">{resolveForm('Resolve without repair')}</div>
          </details>
        </SectionShell>
      );
    }

    if (engineerStatus === 'inspected') {
      return (
        <SectionShell
          tone="border-violet-300 bg-violet-50"
          eyebrow="Action required"
          title="Review the submitted inspection"
          description="Validate or reject the engineer's findings in the Field Engineer Findings panel below."
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

    /* Not credible + location mismatch: the reported position is not on this
     * project's road. Policy: no field engineer may be dispatched; the only
     * action is to reject it as a location mismatch, which tells the citizen
     * why. (Dashboard.assignEngineerToReport refuses these too.) */
    if (recommendReject) {
      return (
        <SectionShell
          tone="border-red-300 bg-red-50"
          eyebrow="Not credible · location mismatch"
          title="This report can't be dispatched"
          description={triage?.reasons?.[0]}
        >
          {triage?.reasons?.length > 1 && (
            <ul className="text-xs text-slate-700 list-disc pl-4 space-y-0.5">
              {triage.reasons.slice(1).map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
          <p className="rounded-lg border border-red-200 bg-white/70 px-3 py-2 text-xs text-red-800">
            Field engineers can't be assigned to a report submitted away from the project road.
            Reject it as a location mismatch. The reporter is notified with this reason.
          </p>

          {!dismissAllowed ? (
            <p className="text-xs text-slate-600">This report can no longer be closed from here.</p>
          ) : !showDismiss ? (
            <button
              type="button"
              onClick={() => {
                setDismissReason(triage?.suggestedDismissalReason || '');
                setShowDismiss(true);
              }}
              className={buttonClass('danger', 'md', 'w-full')}
            >
              Reject as Location Mismatch
            </button>
          ) : (
            <div className="space-y-2">
              <label htmlFor="dismiss-reason" className="text-[11px] font-semibold text-slate-600 block">
                Reason (saved to the audit log) <span className="text-red-600">*</span>
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
                  className={buttonClass('secondary', 'sm')}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleDismiss({ locationMismatch: true })}
                  disabled={dismissing || !dismissReason.trim()}
                  className={buttonClass('danger', 'sm')}
                >
                  {dismissing ? 'Rejecting...' : 'Confirm Reject'}
                </button>
              </div>
            </div>
          )}
        </SectionShell>
      );
    }

    const dismissDetails = (
      dismissAllowed && (
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
              onClick={() => handleDismiss()}
              disabled={dismissing || !dismissReason.trim()}
              className={buttonClass('danger', 'sm', 'w-full')}
            >
              {dismissing ? 'Closing...' : 'Close Report'}
            </button>
          </div>
        </details>
      )
    );

    const engineerDispatch = (
      <>
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
            {report && URGENT_TYPES.includes(resolveCategory(report))
              ? ' — earliest slot for a structural failure or road obstruction.'
              : activeWorkload > 0
                ? ` — after the ${activeWorkload} inspection${activeWorkload === 1 ? '' : 's'} already queued.`
                : ' — engineer has no other active inspections.'}
          </p>
        )}

        <button
          type="button"
          onClick={handleAssign}
          disabled={!selectedEngineerId || assigningEngineer}
          className={buttonClass('primary', 'md', 'w-full')}
        >
          {assigningEngineer ? 'Assigning...' : 'Assign & Dispatch'}
        </button>
      </>
    );

    if (handler === 'lgu') {
      return (
        <SectionShell
          tone="border-teal-300 bg-teal-50"
          eyebrow="Action required"
          title="Send this minor issue to the LGU"
          description="Obstructions and signs are fixed by the LGU directly; no site inspection is needed. Sending it marks the report reviewed."
        >
          <div className="space-y-2">
            <SendWorkForm report={report} party="lgu" onNotify={onNotify} onChanged={workChanged} returned={returnedWork} costEstimate={costEstimate} />
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-500 hover:text-slate-800">Not sure it is minor? Send a field engineer first</summary>
              <div className="space-y-2 pt-2">{engineerDispatch}</div>
            </details>
            {dismissDetails}
          </div>
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
            : 'Major issues are inspected first. Dispatching marks this report reviewed and schedules the site visit.'
        }
      >
        <div className="space-y-2">
          {returnedWork && (
            <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">{returnedWork.cancel_reason}</p>
          )}
          {engineerDispatch}
          {dismissDetails}
        </div>
      </SectionShell>
    );
  };

  // The contractor-billing hold control is intentionally not rendered for now
  // (BillingHoldControl.jsx is kept in place, unused, until the policy is settled).
  const handlerCard = report && status !== 'dismissed' && (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
      <p>
        {/* Wording follows the job: nothing is "fixed" until the work is accepted. */}
        {status === 'resolved' && activeWork
          ? 'Fixed by'
          : activeWork?.started_at
            ? 'Being fixed by'
            : activeWork
              ? 'Sent to'
              : 'To be fixed by'}{' '}
        <strong className="text-slate-900">
          {handler === 'lgu' ? `${report.municipality ? `${report.municipality} ` : ''}LGU` : 'Project contractor'}
        </strong>
      </p>
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        handler === 'lgu' ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-orange-200 bg-orange-50 text-orange-700'
      }`}>
        {handler === 'lgu' ? 'Minor issue' : 'Major issue'}
      </span>
    </div>
  );

  return (
    <div className="space-y-3">
      <SupportCountNote key={report?.id} reportId={report?.id} />
      {handlerCard}
      {renderAction()}
    </div>
  );
}
