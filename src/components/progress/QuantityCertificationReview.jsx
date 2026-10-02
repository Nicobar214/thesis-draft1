import { useEffect, useMemo, useState } from 'react';
import { supabaseFieldEngineer as supabase } from '../../lib/supabase';
import { formatPercentage } from '../../lib/percentageFormat';

const inputCls =
  'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono ' +
  'focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition';

const asNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const hasUnsupportedPrecision = (value) =>
  Math.abs(Number(value) * 10000 - Math.round(Number(value) * 10000)) > 1e-8;

const formatQuantity = (value) => Number(value || 0).toLocaleString('en-PH', {
  maximumFractionDigits: 4,
});

const friendlyRpcError = (error) => {
  const message = error?.message || '';
  const normalized = message.toLowerCase();
  if (normalized.includes('already') || normalized.includes('no longer')) {
    return 'This progress update has already been reviewed. Refresh the queue to see its current status.';
  }
  if (normalized.includes('cumulative engineer validated quantity')) {
    return 'One or more cumulative validated quantities exceed the Work Plan. Refresh and review the quantities.';
  }
  if (normalized.includes('permission') || normalized.includes('only field engineers')) {
    return 'Your account does not have permission to certify this progress update.';
  }
  return message || 'Unable to process this quantity review.';
};

export default function QuantityCertificationReview({ row, onClose, onSaved, showNotification }) {
  const [items, setItems] = useState([]);
  const [previousByItem, setPreviousByItem] = useState({});
  const [quantities, setQuantities] = useState({});
  const [remarks, setRemarks] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [disputeMode, setDisputeMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const loadReview = async () => {
      setLoading(true);
      setError(null);
      setRemarks(row.certification_remarks || '');
      setAcknowledged(false);
      setDisputeMode(false);
      setItems([]);
      setPreviousByItem({});
      setQuantities({});

      try {
        const { data: currentItems, error: currentError } = await supabase
          .from('progress_update_items')
          .select('id, work_plan_item_id, contractor_reported_quantity, engineer_validated_quantity, work_plan_items(id, activity_name, unit, planned_quantity, sort_order)')
          .eq('progress_update_id', row.id)
          .order('id', { ascending: true });
        if (currentError) throw currentError;
        if (!currentItems?.length) {
          throw new Error('Configuration error: this quantity submission has no progress item rows.');
        }
        if (currentItems.some((item) => !item.work_plan_items || item.work_plan_items.id !== item.work_plan_item_id)) {
          throw new Error('Configuration error: one or more submitted quantities have a missing Work Plan activity reference.');
        }

        const sortedItems = [...currentItems].sort((left, right) => {
          const leftOrder = left.work_plan_items.sort_order ?? Number.MAX_SAFE_INTEGER;
          const rightOrder = right.work_plan_items.sort_order ?? Number.MAX_SAFE_INTEGER;
          return leftOrder - rightOrder || left.work_plan_item_id - right.work_plan_item_id;
        });

        const { data: approvedUpdates, error: approvedError } = await supabase
          .from('progress_updates')
          .select('id')
          .eq('fmr_project_id', row.fmr_project_id)
          .eq('status', 'approved');
        if (approvedError) throw approvedError;

        let baseline = {};
        const approvedIds = (approvedUpdates || []).map((update) => update.id);
        if (approvedIds.length > 0) {
          const { data: approvedItems, error: baselineError } = await supabase
            .from('progress_update_items')
            .select('work_plan_item_id, engineer_validated_quantity')
            .in('progress_update_id', approvedIds);
          if (baselineError) throw baselineError;
          baseline = (approvedItems || []).reduce((totals, item) => {
            if (item.engineer_validated_quantity === null) return totals;
            totals[item.work_plan_item_id] = (totals[item.work_plan_item_id] || 0)
              + Number(item.engineer_validated_quantity);
            return totals;
          }, {});
        }

        if (!cancelled) {
          setItems(sortedItems);
          setPreviousByItem(baseline);
          setQuantities(Object.fromEntries(sortedItems.map((item) => [
            item.work_plan_item_id,
            String(item.engineer_validated_quantity ?? item.contractor_reported_quantity ?? ''),
          ])));
        }
      } catch (loadError) {
        if (!cancelled) {
          console.error('Failed to load quantity certification review', loadError);
          setItems([]);
          setPreviousByItem({});
          setError(loadError.message || 'Unable to load quantity certification details.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadReview();
    return () => { cancelled = true; };
  }, [row.certification_remarks, row.fmr_project_id, row.id]);

  const previewRows = useMemo(() => items.map((item) => {
    const plan = item.work_plan_items;
    const previous = Number(previousByItem[item.work_plan_item_id] || 0);
    const current = asNumber(quantities[item.work_plan_item_id]) ?? 0;
    const cumulative = previous + current;
    const planned = Number(plan.planned_quantity || 0);
    return {
      ...item,
      plan,
      previous,
      current,
      cumulative,
      percent: planned > 0 ? (cumulative / planned) * 100 : 0,
    };
  }), [items, previousByItem, quantities]);

  const overallPreview = useMemo(() => {
    if (previewRows.length === 0) return 0;
    return previewRows.reduce((sum, item) => sum + item.percent, 0) / previewRows.length;
  }, [previewRows]);

  const validateQuantities = () => {
    for (const item of previewRows) {
      const raw = quantities[item.work_plan_item_id];
      const quantity = asNumber(raw);
      if (raw === '' || quantity === null || quantity < 0) {
        return `Enter a quantity of zero or greater for "${item.plan.activity_name}".`;
      }
      if (hasUnsupportedPrecision(quantity)) {
        return `Use no more than four decimal places for "${item.plan.activity_name}".`;
      }
      if (item.cumulative > Number(item.plan.planned_quantity)) {
        return `The cumulative validated quantity for "${item.plan.activity_name}" cannot exceed its planned quantity.`;
      }
    }
    return null;
  };

  const submitReview = async () => {
    setError(null);
    if (row.status !== 'pending') {
      setError('This progress update is no longer pending. Refresh the queue.');
      return;
    }

    if (disputeMode) {
      if (!remarks.trim()) {
        setError('Remarks are required when disputing a quantity progress update.');
        return;
      }
    } else {
      const quantityError = validateQuantities();
      if (quantityError) {
        setError(quantityError);
        return;
      }
      if (!acknowledged) {
        setError('You must acknowledge responsibility for the validated quantities before certification.');
        return;
      }
    }

    setSaving(true);
    try {
      const payload = disputeMode ? [] : previewRows.map((item) => ({
        work_plan_item_id: item.work_plan_item_id,
        engineer_validated_quantity: Number(quantities[item.work_plan_item_id]),
      }));

      const { error: rpcError } = await supabase.rpc('certify_progress_with_quantities', {
        p_progress_update_id: row.id,
        p_items: payload,
        p_remarks: remarks.trim() || null,
        p_dispute: disputeMode,
        p_engineer_acknowledged: disputeMode ? false : acknowledged,
      });
      if (rpcError) throw rpcError;

      showNotification?.(
        disputeMode ? 'Quantity progress update disputed.' : 'Validated quantities certified successfully.',
        'success'
      );
      await onSaved?.();
      onClose();
    } catch (submitError) {
      console.error('Quantity certification failed', submitError);
      const message = friendlyRpcError(submitError);
      setError(message);
      showNotification?.(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded-lg p-5 bg-slate-50/70 space-y-4 shadow-sm animate-fadeIn">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 pb-3">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-slate-900">
            Validate quantities: {row.fmr_projects?.project_name || `Project #${row.fmr_project_id}`}
          </h4>
          <p className="text-xs text-slate-500 mt-1">
            Contractor-reported accomplishment: <strong className="text-slate-800">{formatPercentage(row.reported_accomplishment)}</strong>
          </p>
          {Number(row.fmr_projects?.work_plan_adoption_baseline || 0) > 0 && (
            <p className="text-xs text-sky-700 mt-1">
              Post-adoption quantities; historical baseline:{' '}
              <strong>{formatPercentage(row.fmr_projects.work_plan_adoption_baseline)}</strong>
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Close quantity review" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white">x</button>
      </div>

      {row.remarks && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Contractor remarks</p>
          <p className="text-xs text-slate-700 bg-white p-3 rounded-lg border border-slate-200">{row.remarks}</p>
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center">
          <div className="animate-spin mx-auto w-7 h-7 border-2 border-slate-300 border-t-teal-600 rounded-full" />
          <p className="text-xs text-slate-500 mt-2">Loading submitted quantities...</p>
        </div>
      ) : items.length > 0 ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Engineer quantity review</p>
              <p className="text-xs text-slate-500 mt-0.5">Validate every current-period activity quantity.</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase text-slate-400">Certified preview</p>
              <p className="text-xl font-bold text-teal-700 font-mono">{formatPercentage(overallPreview)}</p>
            </div>
          </div>

          <div className="overflow-x-auto bg-white rounded-lg border border-slate-200">
            <table className="w-full min-w-[1100px] text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <th className="text-left font-semibold py-2.5 px-3">Activity</th>
                  <th className="text-left font-semibold py-2.5 px-3">Unit</th>
                  <th className="text-right font-semibold py-2.5 px-3">Planned</th>
                  <th className="text-right font-semibold py-2.5 px-3">Previous Approved</th>
                  <th className="text-right font-semibold py-2.5 px-3">Contractor This Period</th>
                  <th className="text-left font-semibold py-2.5 px-3 w-48">Engineer This Period</th>
                  <th className="text-right font-semibold py-2.5 px-3">Cumulative Engineer</th>
                  <th className="text-right font-semibold py-2.5 px-3">Progress Preview</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewRows.map((item) => {
                  const exceedsPlan = item.cumulative > Number(item.plan.planned_quantity);
                  return (
                    <tr key={item.id} className={exceedsPlan ? 'bg-red-50/60' : 'text-slate-700'}>
                      <td className="py-2.5 px-3 font-semibold text-slate-800">{item.plan.activity_name}</td>
                      <td className="py-2.5 px-3">{item.plan.unit || '-'}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatQuantity(item.plan.planned_quantity)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatQuantity(item.previous)}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-amber-700">{formatQuantity(item.contractor_reported_quantity)}</td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={quantities[item.work_plan_item_id] ?? ''}
                          onChange={(event) => setQuantities((values) => ({
                            ...values,
                            [item.work_plan_item_id]: event.target.value,
                          }))}
                          disabled={disputeMode || saving}
                          aria-label={`Engineer validated quantity for ${item.plan.activity_name}`}
                          className={`${inputCls} ${exceedsPlan ? 'border-red-300 focus:border-red-500' : ''}`}
                          required={!disputeMode}
                        />
                      </td>
                      <td className={`py-2.5 px-3 text-right font-mono font-semibold ${exceedsPlan ? 'text-red-700' : ''}`}>{formatQuantity(item.cumulative)}</td>
                      <td className={`py-2.5 px-3 text-right font-mono font-bold ${exceedsPlan ? 'text-red-700' : 'text-teal-700'}`}>{formatPercentage(item.percent)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400">The server calculates the authoritative certified accomplishment from all activity quantities.</p>

          <div className="flex items-center justify-between gap-3 p-3 bg-white border border-slate-200 rounded-lg">
            <div>
              <p className="text-xs font-semibold text-slate-700">Review decision</p>
              <p className="text-[11px] text-slate-400">A dispute rejects this submission and preserves the contractor's reported quantities.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setDisputeMode((value) => !value);
                setAcknowledged(false);
                setError(null);
              }}
              disabled={saving}
              className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${disputeMode
                ? 'bg-teal-50 text-teal-700 border-teal-200'
                : 'bg-rose-50 text-rose-700 border-rose-200'}`}
            >
              {disputeMode ? 'Return to certification' : 'Dispute quantities'}
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Review remarks {disputeMode && <span className="text-rose-500">*</span>}
            </label>
            <textarea
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              rows={3}
              placeholder={disputeMode ? 'Explain why these quantities are disputed...' : 'Optional site validation notes...'}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none resize-none"
            />
          </div>

          {!disputeMode && (
            <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-0.5 w-4 h-4 accent-teal-600"
                required
              />
              <span className="text-xs text-slate-700">
                I acknowledge responsibility for reviewing and certifying these Engineer-validated quantities as accurate to the best of my professional knowledge.
              </span>
            </label>
          )}
        </>
      ) : null}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2.5 rounded-lg text-xs">{error}</div>}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-50">Cancel</button>
        <button
          type="button"
          onClick={submitReview}
          disabled={saving || loading || items.length === 0}
          className={`px-4 py-2.5 rounded-lg text-sm font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed ${disputeMode ? 'bg-rose-600 hover:bg-rose-700' : 'bg-teal-600 hover:bg-teal-700'}`}
        >
          {saving ? 'Saving...' : disputeMode ? 'Submit Dispute' : `Certify Quantities (${formatPercentage(overallPreview)})`}
        </button>
      </div>
    </div>
  );
}
