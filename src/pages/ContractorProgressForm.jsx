/* ContractorProgressForm.jsx - quantity-based contractor progress reporting.
 * New submissions are created atomically by submit_progress_update_with_quantities.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabaseContractor as supabase } from '../lib/supabase';
import { formatPercentage } from '../lib/percentageFormat';

const inputCls =
  'w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm ' +
  'focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition';

const toDateInput = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const currentMonthStart = () => {
  const now = new Date();
  return toDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
};

const currentMonthEnd = () => {
  const now = new Date();
  return toDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0));
};

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

const friendlySubmitError = (error) => {
  const message = error?.message || '';
  if (error?.code === '23505' || message.toLowerCase().includes('pending progress update')) {
    return 'A pending progress update already exists for this project. Wait for it to be reviewed before submitting another.';
  }
  if (message.toLowerCase().includes('cumulative contractor reported quantity')) {
    return 'One or more cumulative quantities exceed the Work Plan. Refresh the form and review the quantities.';
  }
  return message || 'Something went wrong. Please try again.';
};

export default function ContractorProgressForm({ project, user, onClose, onSubmitted }) {
  const [periodStart, setPeriodStart] = useState(currentMonthStart);
  const [periodEnd, setPeriodEnd] = useState(currentMonthEnd);
  const [amountBilled, setAmountBilled] = useState('');
  const [remainingScope, setRemainingScope] = useState('');
  const [remarks, setRemarks] = useState('');
  const [certified, setCertified] = useState(false);
  const [planStatus, setPlanStatus] = useState(project.work_plan_status || 'none');
  const [planItems, setPlanItems] = useState([]);
  const [previousByItem, setPreviousByItem] = useState({});
  const [quantities, setQuantities] = useState({});
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [planError, setPlanError] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const projectName = project.project_name || project.projectName || 'Unnamed Project';
  const municipality = project.municipality || '';

  useEffect(() => {
    let cancelled = false;

    const loadWorkPlan = async () => {
      setLoadingPlan(true);
      setPlanError(null);

      try {
        const { data: liveProject, error: projectError } = await supabase
          .from('fmr_projects')
          .select('id, work_plan_status')
          .eq('id', project.id)
          .maybeSingle();
        if (projectError) throw projectError;

        const liveStatus = liveProject?.work_plan_status || 'none';
        if (cancelled) return;
        setPlanStatus(liveStatus);

        if (liveStatus !== 'finalized') {
          setPlanItems([]);
          setPreviousByItem({});
          setPlanError('This project does not have a finalized Work Plan. Ask the Admin to finalize it before submitting progress.');
          return;
        }

        const { data: items, error: itemsError } = await supabase
          .from('work_plan_items')
          .select('id, activity_name, unit, planned_quantity, sort_order, remarks')
          .eq('fmr_project_id', project.id)
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('id', { ascending: true });
        if (itemsError) throw itemsError;
        if (!items?.length) {
          throw new Error('Configuration error: this finalized Work Plan has no activities. Contact the Admin before submitting progress.');
        }

        const { data: approvedUpdates, error: approvedError } = await supabase
          .from('progress_updates')
          .select('id')
          .eq('fmr_project_id', project.id)
          .eq('contractor_id', user.id)
          .eq('status', 'approved');
        if (approvedError) throw approvedError;

        let baseline = {};
        const approvedIds = (approvedUpdates || []).map((update) => update.id);
        if (approvedIds.length > 0) {
          const { data: approvedItems, error: baselineError } = await supabase
            .from('progress_update_items')
            .select('work_plan_item_id, contractor_reported_quantity')
            .in('progress_update_id', approvedIds);
          if (baselineError) throw baselineError;
          baseline = (approvedItems || []).reduce((totals, item) => ({
            ...totals,
            [item.work_plan_item_id]: (totals[item.work_plan_item_id] || 0) + Number(item.contractor_reported_quantity || 0),
          }), {});
        }

        if (!cancelled) {
          setPlanItems(items);
          setPreviousByItem(baseline);
          setQuantities(Object.fromEntries(items.map((item) => [item.id, ''])));
        }
      } catch (loadError) {
        if (!cancelled) {
          console.error('Failed to load finalized Work Plan', loadError);
          setPlanItems([]);
          setPreviousByItem({});
          setPlanError(loadError.message || 'Unable to load the finalized Work Plan.');
        }
      } finally {
        if (!cancelled) setLoadingPlan(false);
      }
    };

    loadWorkPlan();
    return () => { cancelled = true; };
  }, [project.id, user.id]);

  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  const previewRows = useMemo(() => planItems.map((item) => {
    const previous = Number(previousByItem[item.id] || 0);
    const current = asNumber(quantities[item.id]) ?? 0;
    const cumulative = previous + current;
    const planned = Number(item.planned_quantity || 0);
    const percent = planned > 0 ? (cumulative / planned) * 100 : 0;
    return { ...item, previous, current, cumulative, percent };
  }), [planItems, previousByItem, quantities]);

  const overallPreview = useMemo(() => {
    if (previewRows.length === 0) return 0;
    return previewRows.reduce((sum, item) => sum + item.percent, 0) / previewRows.length;
  }, [previewRows]);

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const clearPhoto = () => {
    setPhotoFile(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    if (planStatus !== 'finalized' || planItems.length === 0) {
      setError(planError || 'A finalized Work Plan is required.');
      return;
    }
    if (!periodStart || !periodEnd || periodEnd < periodStart) {
      setError('Enter a valid reporting period.');
      return;
    }
    if (!remarks.trim()) {
      setError('Remarks are required.');
      return;
    }
    if (amountBilled !== '' && (asNumber(amountBilled) === null || Number(amountBilled) < 0)) {
      setError('Amount billed must be zero or greater.');
      return;
    }
    if (!certified) {
      setError('You must certify that the reported data is true and correct before submitting.');
      return;
    }

    for (const row of previewRows) {
      const rawQuantity = quantities[row.id];
      const quantity = asNumber(rawQuantity);
      if (rawQuantity === '' || quantity === null || quantity < 0) {
        setError(`Enter a quantity of zero or greater for "${row.activity_name}".`);
        return;
      }
      if (hasUnsupportedPrecision(quantity)) {
        setError(`Use no more than four decimal places for "${row.activity_name}".`);
        return;
      }
      if (row.cumulative > Number(row.planned_quantity)) {
        setError(`The cumulative quantity for "${row.activity_name}" cannot exceed its planned quantity.`);
        return;
      }
    }

    setSubmitting(true);
    let uploadedPath = null;

    try {
      const { data: existingPending, error: pendingError } = await supabase
        .from('progress_updates')
        .select('id')
        .eq('fmr_project_id', project.id)
        .eq('contractor_id', user.id)
        .eq('status', 'pending')
        .limit(1);
      if (pendingError) throw pendingError;
      if (existingPending?.length) {
        throw new Error('A pending progress update already exists for this project.');
      }

      let photoUrl = null;
      if (photoFile) {
        const ext = photoFile.name.split('.').pop() || 'jpg';
        uploadedPath = `updates/${user.id}/${project.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('progress-photos')
          .upload(uploadedPath, photoFile, { contentType: photoFile.type || 'image/jpeg' });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('progress-photos').getPublicUrl(uploadedPath);
        photoUrl = urlData.publicUrl;
      }

      const payload = previewRows.map((row) => ({
        work_plan_item_id: row.id,
        contractor_reported_quantity: Number(quantities[row.id]),
      }));

      const { data: progressUpdateId, error: rpcError } = await supabase.rpc(
        'submit_progress_update_with_quantities',
        {
          p_fmr_project_id: project.id,
          p_period_start: periodStart,
          p_period_end: periodEnd,
          p_remarks: remarks.trim(),
          p_items: payload,
          p_contractor_certified: certified,
          p_photo_url: photoUrl,
          p_amount_this_billing: amountBilled === '' ? null : Number(amountBilled),
          p_remaining_scope: remainingScope.trim() || null,
        }
      );
      if (rpcError) throw rpcError;

      onSubmitted?.(progressUpdateId);
    } catch (submitError) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage.from('progress-photos').remove([uploadedPath]);
        if (cleanupError) console.error('Failed to clean up unreferenced progress photo', cleanupError);
      }
      console.error('Progress update submit error:', submitError);
      setError(friendlySubmitError(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={() => !submitting && onClose()}
      role="presentation"
    >
      <div
        className="bg-white rounded-lg shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Submit progress for ${projectName}`}
      >
        <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">Submit Quantity Progress Update</h2>
            <p className="text-sm text-slate-500 mt-0.5 truncate">{projectName}{municipality ? ` - ${municipality}` : ''}</p>
          </div>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            aria-label="Close progress form"
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {loadingPlan ? (
            <div className="py-14 text-center">
              <div className="w-8 h-8 mx-auto border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin" />
              <p className="text-sm text-slate-500 mt-3">Loading finalized Work Plan...</p>
            </div>
          ) : planError ? (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-4 rounded-lg">
              <p className="text-sm font-semibold">Progress submission unavailable</p>
              <p className="text-sm mt-1">{planError}</p>
            </div>
          ) : (
            <>
              {Number(project.work_plan_adoption_baseline || 0) > 0 && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                  Quantities report progress after Work Plan adoption. The preserved historical baseline is{' '}
                  <strong>{formatPercentage(project.work_plan_adoption_baseline)}</strong>.
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Period Start <span className="text-red-500">*</span></label>
                  <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} max={periodEnd || undefined} className={inputCls} required />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Period End <span className="text-red-500">*</span></label>
                  <input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} min={periodStart || undefined} className={inputCls} required />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Amount Billed This Period <span className="font-normal text-slate-400">(optional)</span></label>
                  <input type="number" min="0" step="0.01" value={amountBilled} onChange={(event) => setAmountBilled(event.target.value)} placeholder="0.00" className={inputCls} />
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Work Plan Quantities</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Enter the quantity accomplished during this reporting period for every activity.</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase text-slate-400">Overall preview</p>
                    <p className="text-xl font-bold text-teal-700 font-mono">{formatPercentage(overallPreview)}</p>
                  </div>
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full min-w-[950px] text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                      <tr>
                        <th className="text-left px-3 py-3">Activity</th>
                        <th className="text-left px-3 py-3">Unit</th>
                        <th className="text-right px-3 py-3">Planned</th>
                        <th className="text-right px-3 py-3">Previous Approved</th>
                        <th className="text-left px-3 py-3 w-48">This Period</th>
                        <th className="text-right px-3 py-3">Cumulative</th>
                        <th className="text-right px-3 py-3">Progress Preview</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {previewRows.map((row) => {
                        const exceedsPlan = row.cumulative > Number(row.planned_quantity);
                        return (
                          <tr key={row.id} className={exceedsPlan ? 'bg-red-50/60' : ''}>
                            <td className="px-3 py-3 font-semibold text-slate-800">{row.activity_name}</td>
                            <td className="px-3 py-3 text-slate-600">{row.unit || '-'}</td>
                            <td className="px-3 py-3 text-right font-mono">{formatQuantity(row.planned_quantity)}</td>
                            <td className="px-3 py-3 text-right font-mono text-slate-600">{formatQuantity(row.previous)}</td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="0"
                                step="0.0001"
                                value={quantities[row.id] ?? ''}
                                onChange={(event) => setQuantities((values) => ({ ...values, [row.id]: event.target.value }))}
                                aria-label={`Quantity accomplished this period for ${row.activity_name}`}
                                className={`${inputCls} ${exceedsPlan ? 'border-red-300 focus:border-red-500' : ''}`}
                                required
                              />
                            </td>
                            <td className={`px-3 py-3 text-right font-mono font-semibold ${exceedsPlan ? 'text-red-700' : 'text-slate-800'}`}>{formatQuantity(row.cumulative)}</td>
                            <td className={`px-3 py-3 text-right font-mono font-bold ${exceedsPlan ? 'text-red-700' : 'text-teal-700'}`}>{formatPercentage(row.percent)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-400 mt-2">Preview percentages are for guidance. The server calculates the submitted accomplishment from all Work Plan activities.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Remaining Workload <span className="font-normal text-slate-400">(optional)</span></label>
                  <textarea value={remainingScope} onChange={(event) => setRemainingScope(event.target.value)} rows={4} placeholder="What remains after this period?" className={`${inputCls} resize-none`} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Remarks / Notes <span className="text-red-500">*</span></label>
                  <textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={4} placeholder="Describe the work completed and site conditions." className={`${inputCls} resize-none`} required />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Site Photo <span className="font-normal text-slate-400">(optional)</span></label>
                {photoPreview ? (
                  <div className="relative max-w-md">
                    <img src={photoPreview} alt="Site evidence preview" className="w-full h-48 object-cover rounded-lg border border-slate-200" />
                    <button type="button" onClick={clearPhoto} aria-label="Remove photo" className="absolute top-2 right-2 bg-white p-2 rounded-lg shadow border border-slate-200 text-slate-500 hover:text-red-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center w-full max-w-md h-28 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer hover:border-teal-400 hover:bg-teal-50/30">
                    <span className="text-sm text-slate-500">Choose a JPG, PNG, or WEBP photo</span>
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                  </label>
                )}
              </div>

              <label className="flex items-start gap-3 p-4 border border-slate-200 rounded-lg bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={certified} onChange={(event) => setCertified(event.target.checked)} className="mt-0.5 w-4 h-4 accent-teal-600" required />
                <span className="text-sm text-slate-700">I certify that the accomplishment quantities and supporting information reported here are true and correct to the best of my knowledge.</span>
              </label>
            </>
          )}

          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
            <button type="button" onClick={() => !submitting && onClose()} disabled={submitting} className="px-5 py-2.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={submitting || loadingPlan || Boolean(planError)} className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? 'Submitting...' : 'Submit Update'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
