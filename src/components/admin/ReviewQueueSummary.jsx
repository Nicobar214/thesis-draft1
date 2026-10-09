import { CheckCircle2Icon, TriangleAlertIcon } from 'lucide-react';
import { QUEUE_ACTIVE_RING, QUEUE_TONES } from '../../lib/reviewQueueTones';

/**
 * Shared summary for the three Review Queue pages.
 *
 * Hierarchy: one lead card with the number the admin acts on, then compact
 * stage cards that double as the list filter. Colors come from QUEUE_TONES
 * only, so every page reads the same way.
 *
 * lead:    { value, label }            e.g. 4, 'reports awaiting your action'
 * groups:  [{ label?, stages: [{ key, label, count, tone, hint, icon }] }]
 */
export default function ReviewQueueSummary({ lead, groups, activeKey, onSelect, allKey = 'all', allCount, allLabel = 'Show all' }) {
  const clear = lead.value === 0;
  const showGroupLabels = groups.length > 1;

  return (
    <section className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]" aria-label="Review queue summary">
      <div
        className={`flex flex-col items-center justify-center gap-3 rounded-2xl border p-6 text-center ${
          clear ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/70'
        }`}
      >
        <span
          className={`inline-flex size-11 items-center justify-center rounded-full ${
            clear ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}
          aria-hidden="true"
        >
          {clear ? <CheckCircle2Icon className="size-6" /> : <TriangleAlertIcon className="size-6" />}
        </span>
        <p className="text-6xl font-bold tracking-tight tabular-nums text-slate-900">{lead.value}</p>
        <div>
          <p className={`text-sm font-semibold ${clear ? 'text-emerald-800' : 'text-amber-900'}`}>
            {clear ? 'All caught up' : 'Needs your action'}
          </p>
          <p className={`mt-0.5 text-xs ${clear ? 'text-emerald-700' : 'text-amber-800'}`}>{lead.label}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-900">By stage</p>
          <button
            type="button"
            onClick={() => onSelect(allKey)}
            aria-pressed={activeKey === allKey}
            className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
              activeKey === allKey
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {allLabel}{Number.isFinite(allCount) ? ` (${allCount})` : ''}
          </button>
        </div>

        <div className="space-y-3">
          {groups.map((group, gi) => (
            <div key={group.label || gi}>
              {showGroupLabels && group.label && (
                <p className="mb-1.5 text-xs font-medium text-slate-500">{group.label}</p>
              )}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                {group.stages.map((stage) => {
                  const tone = QUEUE_TONES[stage.tone] || QUEUE_TONES.waiting;
                  const active = activeKey === stage.key;
                  const Icon = stage.icon;
                  return (
                    <button
                      key={stage.key}
                      type="button"
                      onClick={() => onSelect(active ? allKey : stage.key)}
                      aria-pressed={active}
                      title={stage.hint}
                      className={`relative overflow-hidden rounded-xl border bg-white py-2.5 pl-4 pr-3 text-left transition-colors ${
                        active ? `ring-2 ${QUEUE_ACTIVE_RING}` : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60'
                      }`}
                    >
                      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} />
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-xl font-semibold leading-none tabular-nums ${stage.count === 0 ? 'text-slate-300' : tone.value}`}>
                          {stage.count}
                        </span>
                        {Icon && <Icon className={`size-4 shrink-0 ${stage.count === 0 ? 'text-slate-300' : tone.value}`} aria-hidden="true" />}
                      </div>
                      <span className="mt-1 block truncate text-xs font-medium text-slate-700">{stage.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
