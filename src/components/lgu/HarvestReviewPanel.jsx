import { useState } from 'react';
import { CircleAlertIcon, CheckIcon } from 'lucide-react';
import { supabaseLgu as supabase } from '../../lib/supabase';
import { checkHarvest } from '../../lib/harvestPlausibility';
import { notify } from '../../lib/toast';
import { confirm } from '../../lib/confirm';

const fmtKg = (n) => `${Math.round(Number(n) || 0).toLocaleString()} kg`;

/**
 * Harvest entries flagged as unusually high (supabase_harvest_review.sql). They
 * are left out of the totals above until the LGU marks them correct here, or the
 * farmer corrects the entry.
 *
 * flagged: [{ h: harvest row, farmer: beneficiary }]
 */
export default function HarvestReviewPanel({ flagged = [], onReviewed }) {
  const [busyId, setBusyId] = useState(null);
  if (flagged.length === 0) return null;

  const markCorrect = async ({ h, farmer }) => {
    const ok = await confirm({
      title: 'Mark this harvest as correct?',
      message: `${farmer.fullName}: ${fmtKg(h.quantity_kg)} of ${h.crop}. It will be counted in the harvest totals.`,
      confirmLabel: 'Mark as correct',
    });
    if (!ok) return;
    setBusyId(h.id);
    const { error } = await supabase.rpc('confirm_harvest_log', { p_id: h.id });
    setBusyId(null);
    if (error) {
      notify(`Could not confirm the entry: ${error.message}`, 'error');
      return;
    }
    notify('Harvest entry confirmed and added to the totals.');
    onReviewed?.();
  };

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-start gap-2.5">
        <CircleAlertIcon className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-amber-900">
            {flagged.length} harvest {flagged.length === 1 ? 'entry' : 'entries'} to check
          </h3>
          <p className="mt-0.5 text-xs text-amber-800">
            Much higher than usual for the crop and farm size, so left out of the totals until you confirm them.
            If an entry is wrong, ask the farmer to correct it.
          </p>
        </div>
      </div>

      <ul className="mt-3 divide-y divide-amber-100 overflow-hidden rounded-xl border border-amber-100 bg-white">
        {flagged.map(({ h, farmer }) => {
          const check = checkHarvest({ crop: h.crop, quantityKg: h.quantity_kg, areaHa: h.area_ha, fallbackAreaHa: farmer.farmAreaHa });
          return (
            <li key={h.id} className="flex flex-col gap-2 px-3.5 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">
                  {farmer.fullName} <span className="font-normal text-slate-500">· Brgy. {farmer.barangay || '—'}</span>
                </p>
                <p className="text-xs text-slate-600">
                  <strong>{fmtKg(h.quantity_kg)}</strong> of {h.crop}
                  {check.areaHa ? ` from ${check.areaHa} ha` : ''}
                  {check.expectedMaxKg ? ` · usually at most ${fmtKg(check.expectedMaxKg)}` : ''}
                  {h.harvest_date ? ` · ${new Date(h.harvest_date).toLocaleDateString()}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => markCorrect({ h, farmer })}
                disabled={busyId === h.id}
                className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 sm:self-auto"
              >
                <CheckIcon className="size-3.5" aria-hidden="true" />
                {busyId === h.id ? 'Saving…' : 'Mark as correct'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
