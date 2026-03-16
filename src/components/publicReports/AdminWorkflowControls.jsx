import { useEffect, useState } from 'react';

import { supabase } from '../../lib/supabase';

const priorityTone = {
  low: 'bg-slate-100 text-slate-700 border-slate-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  urgent: 'bg-red-100 text-red-700 border-red-200',
};

export default function AdminWorkflowControls({ report, adminIdentity, onNotify, onResolve }) {
  const [priority, setPriority] = useState('medium');
  const [deadline, setDeadline] = useState('');
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [showResolveSummary, setShowResolveSummary] = useState(false);

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

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-800">Admin Workflow Controls</p>
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${priorityTone[priority] || priorityTone.medium}`}>
          Priority: {priority.charAt(0).toUpperCase() + priority.slice(1)}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500 font-semibold uppercase">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-slate-500 font-semibold uppercase">Visit Deadline</label>
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={saveMeta}
          disabled={saving}
          className="px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm font-semibold hover:bg-slate-100 disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save Priority and Deadline'}
        </button>
        <button
          type="button"
          onClick={() => setShowResolveSummary((v) => !v)}
          className="px-4 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-semibold hover:bg-emerald-100"
        >
          Mark as Resolved
        </button>
      </div>

      {showResolveSummary && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-2">
          <label className="text-xs text-emerald-700 font-semibold uppercase">Resolution Summary</label>
          <textarea
            value={resolutionSummary}
            onChange={(e) => setResolutionSummary(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-emerald-200 px-3 py-2 text-sm text-slate-800"
            placeholder="Write the final resolution outcome visible to the citizen"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={markResolvedWithSummary}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Confirm Resolve'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
