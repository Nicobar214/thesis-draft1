/* ProgressCertificationPanel.jsx — field engineer certification of contractor
 * progress, per DA Region VI:
 *
 *   "The contractor reports the accomplishment, but it must be measured and
 *    verified/certified by the supervising or implementing engineer before it
 *    is recognized for payment."
 *
 * The engineer records what they actually measured on site. That figure is
 * stored separately from the contractor's own claim — it never overwrites it —
 * and downstream payment/valuation views prefer the certified number.
 *
 * Writes go through the certify_progress_update_engineer RPC (SECURITY
 * DEFINER, role-checked) rather than a direct table update, matching how every
 * other privileged action in this app is enforced.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getWorkflowMeta } from '../../lib/progressWorkflow';

const inputCls =
  'w-full px-3 py-2 border border-slate-200 rounded-xl text-sm ' +
  'focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition';

const fmtDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/* Labels come from the shared workflow module so the engineer, the contractor
   and the admin all read the same words for the same state. */
const statusBadge = (update) => getWorkflowMeta(update);

export default function ProgressCertificationPanel({ onCountChange, showNotification }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [measured, setMeasured] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('progress_updates')
      .select('*, fmr_projects(project_name, municipality)')
      .order('submitted_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Failed to load progress updates for certification', error);
      setRows([]);
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  /* Anything an engineer still has to act on. Legacy rows have a NULL
     certification_status, so treat "not yet disputed or certified" as pending. */
  const pending = useMemo(
    // Only still-open submissions need the engineer. An update that has been
    // approved or closed is no longer actionable, whatever its certification.
    () => rows.filter((r) => r.status === 'pending' && r.certification_status !== 'certified'),
    [rows]
  );
  const settled = useMemo(
    () => rows.filter((r) => !(r.status === 'pending' && r.certification_status !== 'certified')),
    [rows]
  );

  useEffect(() => { onCountChange?.(pending.length); }, [pending.length, onCountChange]);

  const openRow = (row) => {
    setOpenId((id) => (id === row.id ? null : row.id));
    setMeasured(row.certified_accomplishment ?? row.reported_accomplishment ?? '');
    setRemarks(row.certification_remarks || '');
  };

  const submit = async (row, dispute) => {
    if (dispute && !remarks.trim()) {
      showNotification?.('Remarks are required when disputing a reported accomplishment.', 'error');
      return;
    }
    if (!dispute && (measured === '' || Number(measured) < 0 || Number(measured) > 100)) {
      showNotification?.('Enter a measured accomplishment between 0 and 100.', 'error');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('certify_progress_update_engineer', {
        progress_update_id: row.id,
        p_certified_accomplishment: dispute ? null : Number(measured),
        p_remarks: remarks.trim() || null,
        p_dispute: dispute,
      });
      if (error) throw error;
      showNotification?.(dispute ? 'Reported accomplishment disputed.' : 'Accomplishment certified.', 'success');
      setOpenId(null);
      await fetchRows();
    } catch (err) {
      console.error('Certification failed', err);
      showNotification?.(err.message || 'Certification failed. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const renderCard = (row) => {
    const badge = statusBadge(row);
    const project = row.fmr_projects || {};
    const reported = Number(row.reported_accomplishment ?? 0);
    const certified = row.certified_accomplishment;
    const isOpen = openId === row.id;
    const workItems = Array.isArray(row.work_items) ? row.work_items : [];

    return (
      <div key={row.id} className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
        <button
          onClick={() => openRow(row)}
          className="w-full text-left p-4 sm:p-5 hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 truncate">
                {project.project_name || `Project #${row.fmr_project_id}`}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {project.municipality || '—'} · Period {fmtDate(row.period_start)} – {fmtDate(row.period_end)}
              </p>
            </div>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold whitespace-nowrap ${badge.tone}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
              {badge.label}
            </span>
          </div>

          <div className="flex flex-wrap gap-4 mt-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Contractor reported</p>
              <p className="text-lg font-bold text-slate-700 font-mono">{reported.toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Engineer certified</p>
              <p className={`text-lg font-bold font-mono ${certified === null || certified === undefined ? 'text-slate-300' : 'text-teal-700'}`}>
                {certified === null || certified === undefined ? '—' : `${Number(certified).toFixed(1)}%`}
              </p>
            </div>
            {row.amount_this_billing != null && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Billed</p>
                <p className="text-lg font-bold text-slate-700 font-mono">
                  ₱{Number(row.amount_this_billing).toLocaleString('en-PH', { maximumFractionDigits: 0 })}
                </p>
              </div>
            )}
          </div>
        </button>

        {isOpen && (
          <div className="border-t border-slate-100 p-4 sm:p-5 space-y-4 bg-slate-50/50">
            {row.remarks && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Contractor remarks</p>
                <p className="text-sm text-slate-600">{row.remarks}</p>
              </div>
            )}

            {workItems.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Reported scope of work</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400">
                        <th className="text-left font-semibold py-1">Item</th>
                        <th className="text-left font-semibold py-1">Unit</th>
                        <th className="text-right font-semibold py-1">Plan</th>
                        <th className="text-right font-semibold py-1">Done</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {workItems.map((item, i) => (
                        <tr key={i} className="text-slate-600">
                          <td className="py-1.5 pr-2">{item.item}</td>
                          <td className="py-1.5 pr-2">{item.unit || '—'}</td>
                          <td className="py-1.5 text-right font-mono">{item.planned_qty ?? '—'}</td>
                          <td className="py-1.5 text-right font-mono">{item.accomplished_qty ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {row.remaining_scope && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Remaining workload</p>
                <p className="text-sm text-slate-600">{row.remaining_scope}</p>
              </div>
            )}

            {row.photo_url && (
              <img src={row.photo_url} alt="Site" className="w-full max-h-56 object-cover rounded-xl border border-slate-200" />
            )}

            {/* A submission that is no longer pending is a closed audit record.
                The RPC refuses to touch it; the form is hidden to match. */}
            {row.status !== 'pending' ? (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                This submission is closed ({row.status}) and can no longer be certified.
              </p>
            ) : (
              <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Measured accomplishment % <span className="text-red-500">*</span>
                </label>
                <input
                  type="number" min={0} max={100} step={0.1}
                  value={measured}
                  onChange={(e) => setMeasured(e.target.value)}
                  className={inputCls}
                />
                <p className="text-[11px] text-slate-400 mt-1">What you verified on site.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Certification remarks
                </label>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={2}
                  placeholder="Required when disputing"
                  className={inputCls + ' resize-none'}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => submit(row, false)}
                disabled={saving}
                className="flex-1 min-w-[140px] px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 shadow-lg shadow-teal-500/25 transition-colors disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Certify accomplishment'}
              </button>
              <button
                onClick={() => submit(row, true)}
                disabled={saving}
                className="flex-1 min-w-[140px] px-4 py-2.5 rounded-xl text-sm font-semibold text-rose-700 border border-rose-200 bg-white hover:bg-rose-50 transition-colors disabled:opacity-60"
              >
                Dispute
              </button>
            </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/60 p-12 text-center">
        <div className="animate-spin mx-auto w-8 h-8 border-2 border-slate-300 border-t-teal-600 rounded-full mb-3" />
        <p className="text-sm text-slate-400">Loading progress submissions…</p>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/60 p-12 text-center">
        <p className="font-medium text-slate-900">No progress submissions yet</p>
        <p className="text-sm text-slate-500 mt-1">
          Contractor progress reports awaiting your certification will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3">
        <p className="text-sm text-teal-900">
          <span className="font-semibold">DA requirement:</span> a contractor&rsquo;s reported
          accomplishment must be measured and certified by the supervising engineer before it is
          recognised for payment.
        </p>
      </div>

      {pending.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Awaiting certification ({pending.length})</h3>
          {pending.map(renderCard)}
        </div>
      )}

      {settled.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Already actioned ({settled.length})</h3>
          {settled.map(renderCard)}
        </div>
      )}
    </div>
  );
}
