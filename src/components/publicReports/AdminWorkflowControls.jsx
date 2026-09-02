import { useEffect, useState } from 'react';

import { supabaseAdminPortal as supabase } from '../../lib/supabase';
import BillingHoldControl from './BillingHoldControl';

const priorityTone = {
  low: 'bg-slate-100 text-slate-700 border-slate-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  urgent: 'bg-red-100 text-red-700 border-red-200',
};

// Recommend the next realistic inspection date for an engineer: urgent reports
// should be pushed in as soon as possible, everything else queues one day per
// active assignment so work doesn't pile onto a single day.
function recommendInspectionDate(workloadCount, priorityLevel) {
  const daysOut = priorityLevel === 'urgent' ? 1 : Math.max(1, workloadCount + 1);
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
}

function fmtRecommendedDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminWorkflowControls({
  report,
  resolution,
  adminIdentity,
  onNotify,
  onResolve,
  fieldEngineers = [],
  engineerWorkloads = {},
  assigningEngineer = false,
  onAssignEngineer,
  onUnassignEngineer,
}) {
  const [priority, setPriority] = useState('medium');
  const [deadline, setDeadline] = useState('');
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [showResolveSummary, setShowResolveSummary] = useState(false);
  const [selectedEngineerId, setSelectedEngineerId] = useState('');

  useEffect(() => {
    let alive = true;

    async function loadMeta() {
      if (!report?.id) return;
      try {
        const { data } = await supabase
          .from('public_report_workflow_meta')
          .select('*')
          .eq('report_id', report.id)
          .maybeSingle();

        if (!alive) return;
        setPriority(data?.priority_level || 'medium');
        setDeadline(data?.visit_deadline ? String(data.visit_deadline).slice(0, 10) : '');
      } catch {
        if (!alive) return;
        setPriority('medium');
        setDeadline('');
      }
    }

    loadMeta();
    return () => {
      alive = false;
    };
  }, [report]);

  const saveMeta = async () => {
    if (!report?.id) return;
    setSaving(true);
    try {
      const payload = {
        report_id: report.id,
        priority_level: priority,
        visit_deadline: deadline || null,
        assigned_engineer_id: report.assigned_engineer_id || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('public_report_workflow_meta')
        .upsert(payload, { onConflict: 'report_id' });

      if (error) throw error;
      if (onNotify) onNotify('Priority and deadline saved');
    } catch (err) {
      if (onNotify) onNotify(`Save failed: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const markResolvedWithSummary = async () => {
    if (!report?.id || !resolutionSummary.trim()) {
      if (onNotify) onNotify('Resolution summary is required', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        report_id: report.id,
        summary: resolutionSummary.trim(),
        resolved_by_name: adminIdentity?.full_name || 'Administrator',
        resolved_by_email: adminIdentity?.email || null,
        resolved_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('public_report_resolutions')
        .insert(payload);

      if (error) throw error;

      if (typeof onResolve === 'function') {
        await onResolve(payload.summary);
      }

      setResolutionSummary('');
      setShowResolveSummary(false);
      if (onNotify) onNotify('Report marked resolved with summary');
    } catch (err) {
      if (onNotify) onNotify(`Resolve failed: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const assignEngineer = () => {
    if (!selectedEngineerId || typeof onAssignEngineer !== 'function') return;
    onAssignEngineer(selectedEngineerId);
    setSelectedEngineerId('');
  };

  // Recommend a date for whichever engineer is relevant right now — the one
  // already assigned, or the one currently picked in the dropdown below.
  const activeEngineerId = report?.assigned_engineer_id || selectedEngineerId || '';
  const activeWorkload = engineerWorkloads[activeEngineerId] || 0;
  const recommendedDateIso = activeEngineerId ? recommendInspectionDate(activeWorkload, priority) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Priority & Field Inspection</span>
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${priorityTone[priority] || priorityTone.medium}`}>
          {priority.toUpperCase()} PRIORITY
        </span>
      </div>

      <div className="space-y-2">
        <label className="text-[11px] text-slate-400 font-bold uppercase block">Assigned Field Engineer</label>
        {report?.assigned_engineer_id ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-emerald-950">{report.assigned_engineer_name || 'Field Engineer'}</p>
              <p className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                Assigned {report.assigned_at ? new Date(report.assigned_at).toLocaleDateString() : 'recently'} · {activeWorkload} active inspection{activeWorkload === 1 ? '' : 's'}
              </p>
            </div>
            <button
              type="button"
              onClick={onUnassignEngineer}
              className="shrink-0 px-2.5 py-1 text-xs font-bold text-red-700 bg-white border border-red-200 rounded-md hover:bg-red-50 transition-colors"
            >
              Unassign
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <select
              value={selectedEngineerId}
              onChange={(e) => setSelectedEngineerId(e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="">Select Field Engineer...</option>
              {fieldEngineers.map((eng) => (
                <option key={eng.id} value={eng.id}>
                  {eng.full_name || eng.email} ({engineerWorkloads[eng.id] || 0} active)
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={assignEngineer}
              disabled={!selectedEngineerId || assigningEngineer}
              className="px-4 py-2 bg-emerald-700 text-white rounded-lg text-xs font-bold disabled:opacity-50 hover:bg-emerald-800 transition-colors shadow-xs"
            >
              Assign
            </button>
          </div>
        )}

        {recommendedDateIso && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-teal-50 border border-teal-200 text-[11px] text-teal-800">
            <span>
              Recommended inspection date: <strong>{fmtRecommendedDate(recommendedDateIso)}</strong>
              {priority === 'urgent'
                ? ' — urgent priority, scheduled as soon as possible'
                : activeWorkload > 0
                  ? ` — engineer has ${activeWorkload} other active inspection${activeWorkload === 1 ? '' : 's'} queued first`
                  : ' — engineer has no other active inspections'}
            </span>
            <button
              type="button"
              onClick={() => setDeadline(recommendedDateIso)}
              className="shrink-0 px-2 py-1 rounded-md bg-teal-600 text-white font-bold hover:bg-teal-700 transition-colors"
            >
              Use date
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <label className="text-[11px] text-slate-400 font-bold uppercase block mb-1">Priority Level</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs bg-white font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="low">Low Priority</option>
            <option value="medium">Medium Priority</option>
            <option value="urgent">Urgent Priority</option>
          </select>
        </div>

        <div>
          <label className="text-[11px] text-slate-400 font-bold uppercase block mb-1">Target Inspection</label>
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
      </div>

      <div className="pt-1 flex justify-end">
        <button
          type="button"
          onClick={saveMeta}
          disabled={saving}
          className="w-full py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 disabled:opacity-60 transition-colors shadow-xs"
        >
          {saving ? 'Updating...' : 'Save Priority & Target Date'}
        </button>
      </div>

      {/* DA item 7: a credible discrepancy raised by a citizen report may hold
          the affected billing for verification — never automatically. */}
      <div className="pt-3 border-t border-slate-100 space-y-2.5">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
          Contractor Billings
        </span>
        <BillingHoldControl report={report} />
      </div>

      <div className="pt-3 border-t border-slate-100 space-y-2.5">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
          Official Resolution
        </span>

        {report?.status === 'resolved' ? (
          <div className="px-3 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 space-y-1">
            <p className="font-semibold">This report has already been marked resolved.</p>
            {resolution?.summary && (
              <p className="text-emerald-900">{resolution.summary}</p>
            )}
            {resolution?.resolved_by_name && (
              <p className="text-emerald-700">— {resolution.resolved_by_name}</p>
            )}
          </div>
        ) : report?.engineer_status !== 'validated' ? (
          <div className="px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500">
            Resolution requires DA validation of the field engineer's findings first.
          </div>
        ) : showResolveSummary ? (
          <div className="space-y-2">
            <textarea
              value={resolutionSummary}
              onChange={(e) => setResolutionSummary(e.target.value)}
              rows={3}
              placeholder="Describe the official DA action taken and confirm the road issue is settled (required)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShowResolveSummary(false)}
                disabled={saving}
                className="py-2 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-60 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={markResolvedWithSummary}
                disabled={saving || !resolutionSummary.trim()}
                className="py-2 rounded-lg text-xs font-bold bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50 transition-colors shadow-xs"
              >
                {saving ? 'Saving...' : 'Confirm Resolution'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowResolveSummary(true)}
            className="w-full py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 transition-colors shadow-xs"
          >
            Mark Resolved
          </button>
        )}
      </div>
    </div>
  );
}
