import { useEffect, useMemo, useState } from 'react';
import { formatPercentage } from '../../lib/percentageFormat';
import { confirm } from '../../lib/confirm';
import { MODAL_OVERLAY, MODAL_PANEL, ModalEffects } from '../ui/Modal';
import { buttonClass } from '../ui/Button';
import {
  OTHER_ACTIVITY,
  OTHER_UNIT,
  WORK_PLAN_ACTIVITY_PRESETS,
  WORK_PLAN_UNIT_OPTIONS,
  applyActivitySelection,
  applyUnitSelection,
  formatPlannedQuantity,
  getPlannedQuantityPlaceholder,
  hasDuplicatePreset,
  isUnitLockedForActivity,
  nextWorkPlanSortOrder,
  toWorkPlanItemViewModel,
  validateWorkPlanItems,
} from '../../lib/workPlanPresets';
import {
  calculatePlannedCost,
  formatPesoAmount,
  getProjectCostBasis,
  summarizeWorkPlanCosts,
} from '../../lib/workPlanCost';

const statusStyles = {
  none: 'border-slate-200 bg-slate-50 text-slate-600',
  draft: 'border-amber-200 bg-amber-50 text-amber-700',
  finalized: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

const costStateStyles = {
  unavailable: 'border-slate-200 bg-slate-50 text-slate-600',
  incomplete: 'border-amber-200 bg-amber-50 text-amber-800',
  below: 'border-sky-200 bg-sky-50 text-sky-800',
  matched: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  over: 'border-red-200 bg-red-50 text-red-800',
};

const costStateLabels = {
  unavailable: 'Cost basis unavailable',
  incomplete: 'Unit costs incomplete',
  below: 'Below cost basis',
  matched: 'Matches cost basis',
  over: 'Exceeds cost basis',
};

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900';
const blankItem = (sortOrder) => toWorkPlanItemViewModel({ sort_order: sortOrder });
const normalizeItems = (rows) => (rows || []).map(toWorkPlanItemViewModel);

export default function WorkPlanModal({ project, supabase, onClose, onChanged, showNotification }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState(project?.work_plan_status || 'none');
  const [adoptionBaseline, setAdoptionBaseline] = useState(project?.work_plan_adoption_baseline ?? null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const projectId = project?.id;
  const isFinalized = status === 'finalized';
  const costBasis = useMemo(() => getProjectCostBasis(project), [project]);
  const costSummary = useMemo(
    () => summarizeWorkPlanCosts(items, costBasis, { historical: isFinalized }),
    [items, costBasis, isFinalized]
  );

  useEffect(() => {
    let cancelled = false;
    async function loadWorkPlan() {
      if (!projectId) return;
      setLoading(true);
      const { data, error } = await supabase
        .from('work_plan_items')
        .select('*')
        .eq('fmr_project_id', projectId)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error('Failed to load Work Plan', error);
        showNotification?.(`Failed to load Work Plan: ${error.message}`, 'error');
        setItems([]);
      } else {
        setItems(normalizeItems(data));
      }
      setStatus(project?.work_plan_status || 'none');
      setAdoptionBaseline(project?.work_plan_adoption_baseline ?? null);
      setLoading(false);
    }
    loadWorkPlan();
    return () => { cancelled = true; };
  }, [projectId, project?.work_plan_status, project?.work_plan_adoption_baseline, supabase, showNotification]);

  const updateItem = (clientKey, field, value) => {
    setItems((current) => current.map((item) => (
      item.clientKey === clientKey ? { ...item, [field]: value } : item
    )));
  };

  const selectActivity = (clientKey, selection) => {
    if (hasDuplicatePreset(items, selection, clientKey)) {
      showNotification?.(`${selection} already exists in this Work Plan.`, 'error');
      return;
    }
    setItems((current) => current.map((item) => (
      item.clientKey === clientKey ? applyActivitySelection(item, selection) : item
    )));
  };

  const selectUnit = (clientKey, selection) => {
    setItems((current) => current.map((item) => (
      item.clientKey === clientKey ? applyUnitSelection(item, selection) : item
    )));
  };

  const payloadItems = () => items.map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    activity_name: item.activity_name.trim(),
    unit: item.unit.trim(),
    planned_quantity: Number(item.planned_quantity),
    unit_cost: item.unit_cost === '' ? null : Number(item.unit_cost),
    sort_order: item.sort_order === '' ? null : Number(item.sort_order),
    remarks: item.remarks.trim() || null,
  }));

  const saveDraft = async () => {
    const validationError = validateWorkPlanItems(items);
    if (validationError) return showNotification?.(validationError, 'error');
    setSaving(true);
    try {
      const { error } = await supabase.rpc('save_work_plan_draft', {
        p_fmr_project_id: projectId,
        p_items: payloadItems(),
      });
      if (error) throw error;
      showNotification?.('Work Plan draft saved.');
      setStatus((current) => (current === 'none' ? 'draft' : current));
      await onChanged?.();
      const { data } = await supabase.from('work_plan_items').select('*')
        .eq('fmr_project_id', projectId)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true });
      setItems(normalizeItems(data));
    } catch (error) {
      console.error('Failed to save Work Plan draft', error);
      showNotification?.(`Failed to save Work Plan: ${error.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const finalize = async () => {
    const validationError = validateWorkPlanItems(items, { requireAtLeastOne: true, requireUnitCost: true });
    if (validationError) return showNotification?.(validationError, 'error');
    if (costBasis.amount === null) {
      return showNotification?.('A positive contract amount or recorded project budget is required before finalization.', 'error');
    }
    if (costSummary.state === 'over') {
      return showNotification?.('The planned Work Plan cost exceeds the project cost basis.', 'error');
    }
    const warning = costSummary.state === 'below'
      ? `\n\nWarning: planned cost is ${formatPesoAmount(costSummary.difference)} below the ${costBasis.label.toLowerCase()}.`
      : '';
    const confirmed = await confirm({
      title: 'Finalize this Work Plan?',
      message: `It will become read-only for normal edits.${warning}`,
      confirmLabel: 'Finalize Work Plan',
      tone: warning ? 'warning' : 'primary',
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      const { error } = await supabase.rpc('finalize_work_plan', { p_fmr_project_id: projectId });
      if (error) throw error;
      setStatus('finalized');
      setAdoptionBaseline((current) => current ?? Number(project.accomplishment || 0));
      showNotification?.('Work Plan finalized.');
      await onChanged?.();
    } catch (error) {
      console.error('Failed to finalize Work Plan', error);
      showNotification?.(`Failed to finalize Work Plan: ${error.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!project) return null;

  return (
    <div className={MODAL_OVERLAY} onClick={onClose} role="presentation">
      <ModalEffects onClose={onClose} />
      <div className={`${MODAL_PANEL} max-w-7xl`} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Work Plan for ${project.project_name}`}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Work Plan</p>
            <h2 className="mt-1 text-xl font-bold leading-snug text-slate-900">{project.project_name}</h2>
            <p className="mt-1 text-sm text-slate-500">{project.municipality || 'Unspecified municipality'}{project.year_funded ? ` · FY ${project.year_funded}` : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-lg border px-3 py-1.5 text-xs font-bold uppercase ${statusStyles[status] || statusStyles.none}`}>{status}</span>
            <button type="button" onClick={onClose} aria-label="Close Work Plan" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <section className="mb-5 border-y border-slate-200 bg-slate-50 px-4 py-4" aria-label="Work Plan cost summary">
            <div className="grid grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-5">
              <Summary label="Activities" value={items.length} />
              <Summary label={costBasis.label} value={formatPesoAmount(costBasis.amount)} />
              <Summary label="Planned Cost" value={costSummary.total === null ? 'Cost not recorded' : formatPesoAmount(costSummary.total)} />
              <Summary label="Remaining / Over" value={formatPesoAmount(costSummary.difference)} alert={costSummary.difference < 0} />
              <Summary label="Allocation" value={costSummary.allocationPercent === null ? '—' : formatPercentage(costSummary.allocationPercent)} />
            </div>
            <div className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <span className={`w-fit rounded-lg border px-3 py-1.5 text-xs font-bold ${costStateStyles[costSummary.state]}`}>{costStateLabels[costSummary.state]}</span>
              <p className="text-xs text-slate-500">Work Plan adoption baseline: {adoptionBaseline == null ? 'captured at finalization' : formatPercentage(adoptionBaseline)}</p>
            </div>
          </section>

          {loading ? <LoadingState /> : items.length === 0 ? (
            <p className="border-y border-slate-200 py-12 text-center text-sm text-slate-500">No Work Plan items yet.</p>
          ) : (
            <div className="space-y-3">
              {items.map((item, index) => (
                <section key={item.clientKey} className="rounded-lg border border-slate-200 p-4" aria-label={`Work Plan activity ${index + 1}`}>
                  <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Activity {index + 1}</p>
                    {!isFinalized && <button type="button" onClick={() => setItems((current) => current.filter((entry) => entry.clientKey !== item.clientKey))} title="Remove activity" aria-label={`Remove activity ${index + 1}`} className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-600 hover:bg-red-100"><svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" /></svg></button>}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[90px_1.4fr_1fr_1fr_1fr_1fr]">
                    <Field label="Order">{isFinalized ? <ReadValue value={item.sort_order || index + 1} /> : <input type="number" value={item.sort_order} onChange={(event) => updateItem(item.clientKey, 'sort_order', event.target.value)} className={inputClass} aria-label={`Sort order for activity ${index + 1}`} />}</Field>
                    <Field label="Activity">{isFinalized ? <ReadValue value={item.activity_name} strong /> : <><select value={item.activity_selection} onChange={(event) => selectActivity(item.clientKey, event.target.value)} className={inputClass} aria-label={`Activity ${index + 1}`}><option value="">Select activity</option>{WORK_PLAN_ACTIVITY_PRESETS.map((activity) => <option key={activity} value={activity} disabled={items.some((other) => other.clientKey !== item.clientKey && other.activity_selection === activity)}>{activity}</option>)}<option value={OTHER_ACTIVITY}>{OTHER_ACTIVITY}</option></select>{item.activity_selection === OTHER_ACTIVITY && <input type="text" value={item.activity_name} onChange={(event) => updateItem(item.clientKey, 'activity_name', event.target.value)} className={`${inputClass} mt-2`} placeholder="Specify activity" aria-label={`Custom activity ${index + 1}`} />}</>}</Field>
                    <Field label="Unit of Measure">{isFinalized ? <ReadValue value={item.unit || '—'} /> : isUnitLockedForActivity(item.activity_selection) ? <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-sm font-semibold text-slate-900">{item.unit}</p><p className="mt-1 text-[11px] text-slate-500">Locked standard unit</p></div> : <><select value={item.unit_selection} onChange={(event) => selectUnit(item.clientKey, event.target.value)} className={inputClass} aria-label={`Unit for activity ${index + 1}`}><option value="">Select unit</option>{WORK_PLAN_UNIT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}<option value={OTHER_UNIT}>Other Unit</option></select>{item.unit_selection === OTHER_UNIT && <input type="text" value={item.unit} onChange={(event) => updateItem(item.clientKey, 'unit', event.target.value)} className={`${inputClass} mt-2`} maxLength={50} placeholder="Specify unit" aria-label={`Custom unit ${index + 1}`} />}</>}</Field>
                    <Field label="Planned Quantity">{isFinalized ? <ReadValue value={formatPlannedQuantity(item.planned_quantity)} strong /> : <input type="number" min="0.0001" step="0.0001" value={item.planned_quantity} onChange={(event) => updateItem(item.clientKey, 'planned_quantity', event.target.value)} className={inputClass} placeholder={getPlannedQuantityPlaceholder(item.activity_selection)} aria-label={`Planned quantity ${index + 1}`} />}</Field>
                    <Field label="Approved Unit Cost">{isFinalized ? <ReadValue value={item.unit_cost === '' ? 'Cost not recorded' : `${formatPesoAmount(item.unit_cost)} / ${item.unit}`} strong /> : <><input type="number" min="0.01" step="0.01" value={item.unit_cost} onChange={(event) => updateItem(item.clientKey, 'unit_cost', event.target.value)} className={inputClass} placeholder="0.00" aria-label={`Approved unit cost ${index + 1}`} /><p className="mt-1 text-[11px] text-slate-500">Per {item.unit || 'unit'}</p></>}</Field>
                    <Field label="Planned Cost"><ReadValue value={calculatePlannedCost(item) === null ? 'Cost not recorded' : formatPesoAmount(calculatePlannedCost(item))} strong /></Field>
                  </div>
                  <div className="mt-4"><Field label="Remarks">{isFinalized ? <ReadValue value={item.remarks || '—'} /> : <input type="text" value={item.remarks} onChange={(event) => updateItem(item.clientKey, 'remarks', event.target.value)} className={inputClass} placeholder="Optional" aria-label={`Remarks ${index + 1}`} />}</Field></div>
                </section>
              ))}
              <div className="flex justify-end border-t-2 border-slate-200 px-4 pt-4 text-sm"><span className="mr-4 font-bold uppercase text-slate-500">Total Planned Cost</span><strong className="text-slate-900">{costSummary.total === null ? 'Cost not recorded' : formatPesoAmount(costSummary.total)}</strong></div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>{!isFinalized && <button type="button" onClick={() => setItems((current) => [...current, blankItem(nextWorkPlanSortOrder(current))])} className={buttonClass('secondary')}>+ Add Activity</button>}</div>
          <div className="flex flex-col gap-3 sm:flex-row"><button type="button" onClick={onClose} className={buttonClass('secondary')}>Close</button>{!isFinalized && <><button type="button" onClick={saveDraft} disabled={saving || loading} className={buttonClass('secondary')}>{saving ? 'Saving...' : 'Save Draft'}</button><button type="button" onClick={finalize} disabled={saving || loading} className={buttonClass('primary')}>Finalize</button></>}</div>
        </div>
      </div>
    </div>
  );
}

function Summary({ label, value, alert = false }) {
  return <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p><p className={`mt-1 text-base font-bold sm:text-lg ${alert ? 'text-red-700' : 'text-slate-900'}`}>{value}</p></div>;
}

function Field({ label, children }) {
  return <label className="min-w-0"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>{children}</label>;
}

function ReadValue({ value, strong = false }) {
  return <p className={`break-words text-sm text-slate-800 ${strong ? 'font-semibold' : ''}`}>{value}</p>;
}

function LoadingState() {
  return <div className="py-16 text-center"><div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" /><p className="text-sm text-slate-500">Loading Work Plan...</p></div>;
}
