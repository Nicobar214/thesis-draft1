import { CheckCircle2Icon, TriangleAlertIcon, UsersIcon, CircleCheckBigIcon, Undo2Icon, LayersIcon, ListFilterIcon, ChevronRightIcon } from 'lucide-react';
import HierarchyKpis from '../ui/HierarchyKpis';
import { QUEUE_TONES } from '../../lib/reviewQueueTones';

/**
 * Shared summary for the three Review Queue pages (Public Reports, Progress
 * Updates, LGU Proposals). Same KPI hierarchy as the rest of the app
 * (HierarchyKpis):
 *
 *   Lead   — what the admin owes right now, with the whole queue split by
 *            tone underneath it.
 *   Minis  — the rest of the queue by tone: with others / done / returned,
 *            plus the total (which clears the filter).
 *   Chips  — every individual stage, as a compact filter row below, so the
 *            fine-grained filter stays without cluttering the headline.
 *
 * Colors come from QUEUE_TONES only, so a color means the same thing on all
 * three pages.
 *
 * lead:    { value, label }            e.g. 4, 'reports awaiting your action'
 * groups:  [{ label?, stages: [{ key, label, count, tone, hint, icon }] }]
 */

const TONE_META = {
  action: { label: 'Needs your action', short: 'Needs you', chip: 'bg-amber-50 text-amber-700' },
  waiting: { label: 'With others', short: 'With others', chip: 'bg-slate-100 text-slate-600', icon: UsersIcon, hint: 'Waiting on an engineer, contractor or LGU' },
  done: { label: 'Completed', short: 'Completed', chip: 'bg-emerald-50 text-emerald-700', icon: CircleCheckBigIcon, hint: 'Finished, nothing left to do' },
  problem: { label: 'Returned / Rejected', short: 'Returned', chip: 'bg-rose-50 text-rose-700', icon: Undo2Icon, hint: 'Sent back, disputed or rejected' },
};
const TONE_ORDER = ['action', 'waiting', 'done', 'problem'];

// showActionList: the "Waiting on you" list in the lead card. Public Reports
// turns it off; its stage filter row already highlights the admin's stages.
export default function ReviewQueueSummary({ lead, groups, activeKey, onSelect, allKey = 'all', allCount, allLabel = 'Show all', showActionList = true }) {
  const clear = lead.value === 0;
  const stages = groups.flatMap((g) => g.stages);
  // The first group is the main flow; any others are side queues.
  const flowStages = groups[0]?.stages || [];
  const sideStages = groups.slice(1).flatMap((g) => g.stages);

  const byTone = TONE_ORDER.reduce((acc, tone) => {
    const inTone = stages.filter((s) => (s.tone || 'waiting') === tone);
    acc[tone] = { stages: inTone, count: inTone.reduce((sum, s) => sum + (s.count || 0), 0) };
    return acc;
  }, {});
  const total = Number.isFinite(allCount) ? allCount : stages.reduce((sum, s) => sum + (s.count || 0), 0);

  // A tone card filters the list only when it maps to exactly one stage.
  const toneItem = (tone) => {
    const meta = TONE_META[tone];
    const { stages: inTone, count } = byTone[tone];
    const single = inTone.length === 1 ? inTone[0] : null;
    const Icon = meta.icon;
    return {
      icon: <Icon className="size-4" aria-hidden="true" />,
      label: meta.label,
      value: count,
      hint: inTone.length ? inTone.map((s) => s.label).join(' · ') : meta.hint,
      chip: meta.chip,
      ...(single ? {
        onClick: () => onSelect(activeKey === single.key ? allKey : single.key),
        active: activeKey === single.key,
      } : {}),
    };
  };

  return (
    <div className="space-y-4">
      <HierarchyKpis
        dense
        ariaLabel="Review queue summary"
        lead={{
          label: 'Needs your action',
          value: lead.value,
          note: clear ? (
            <span><span className="font-semibold text-emerald-700">All caught up</span> — nothing is waiting on you</span>
          ) : (
            <span><span className="font-semibold text-amber-700">{lead.label}</span> · {total} in the queue</span>
          ),
          icon: clear ? <CheckCircle2Icon className="size-6" aria-hidden="true" /> : <TriangleAlertIcon className="size-6" aria-hidden="true" />,
          iconTone: clear ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
          body: showActionList && byTone.action.stages.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Waiting on you</p>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/70">
                {byTone.action.stages.map((stage) => {
                  const active = activeKey === stage.key;
                  return (
                    <li key={stage.key}>
                      <button
                        type="button"
                        onClick={() => onSelect(active ? allKey : stage.key)}
                        aria-pressed={active}
                        title={stage.hint}
                        className={`flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-sm transition-colors ${active ? 'bg-teal-50' : 'hover:bg-slate-50'}`}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className={`size-2 shrink-0 rounded-full ${stage.count ? QUEUE_TONES.action.bar : 'bg-slate-300'}`} aria-hidden="true" />
                          <span className={`truncate font-medium ${stage.count ? 'text-slate-800' : 'text-slate-500'}`}>{stage.label}</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className={`text-base font-semibold tabular-nums ${stage.count ? 'text-amber-700' : 'text-slate-400'}`}>{stage.count}</span>
                          <ChevronRightIcon className="size-4 text-slate-300" aria-hidden="true" />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ),
          segments: TONE_ORDER
            .filter((tone) => byTone[tone].count > 0)
            .map((tone) => ({ label: TONE_META[tone].short, value: byTone[tone].count, bar: QUEUE_TONES[tone].bar })),
        }}
        items={[
          toneItem('waiting'),
          toneItem('done'),
          toneItem('problem'),
          {
            icon: <LayersIcon className="size-4" aria-hidden="true" />,
            label: 'Total in queue',
            value: total,
            hint: 'Tap to show everything',
            chip: 'bg-teal-50 text-teal-700',
            onClick: () => onSelect(allKey),
            active: activeKey === allKey,
          },
        ]}
      />

      {/* Every stage as a filter: the main flow as connected steps, side
          queues (repairs due, returned work) as small chips beside "All". */}
      <nav aria-label="Filter by stage" className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-xs">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
            <ListFilterIcon className="size-4 text-slate-400" aria-hidden="true" />
            Filter by stage
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {sideStages.map((stage) => {
              const active = activeKey === stage.key;
              return (
                <FilterChip
                  key={stage.key}
                  active={active}
                  onClick={() => onSelect(active ? allKey : stage.key)}
                  label={stage.label}
                  count={stage.count}
                  icon={stage.icon}
                  alert={stage.count > 0 && (stage.tone === 'problem' || stage.tone === 'action')}
                  title={stage.hint}
                />
              );
            })}
            <FilterChip active={activeKey === allKey} onClick={() => onSelect(allKey)} label={allLabel} count={total} icon={LayersIcon} />
          </div>
        </div>

        <ol className="flex gap-1.5 overflow-x-auto pb-1">
          {flowStages.map((stage, i) => (
            <li key={stage.key} className="flex min-w-[8.5rem] flex-1 items-center gap-1.5">
              <StageStep
                stage={stage}
                active={activeKey === stage.key}
                onClick={() => onSelect(activeKey === stage.key ? allKey : stage.key)}
              />
              {i < flowStages.length - 1 && <ChevronRightIcon className="size-4 shrink-0 text-slate-300" aria-hidden="true" />}
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}

/* One step of the main flow. Only the selected step is highlighted (teal
 * border, fill and top line); empty steps fade. */
function StageStep({ stage, active, onClick }) {
  const Icon = stage.icon;
  const empty = !stage.count;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={stage.hint}
      className={`relative flex w-full min-w-0 flex-col gap-1.5 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
        active
          ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-500/20'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-teal-500" aria-hidden="true" />}
      <span className="flex items-center justify-between gap-2">
        {Icon && (
          <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${
            active ? 'bg-teal-600 text-white' : empty ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-slate-600'
          }`}>
            <Icon className="size-4" aria-hidden="true" />
          </span>
        )}
        <span className={`text-xl font-bold tabular-nums leading-none ${active ? 'text-teal-700' : empty ? 'text-slate-300' : 'text-slate-900'}`}>
          {stage.count}
        </span>
      </span>
      <span className={`truncate text-xs font-semibold ${empty && !active ? 'text-slate-400' : 'text-slate-700'}`}>{stage.label}</span>
    </button>
  );
}

function FilterChip({ active, onClick, label, count, icon: Icon, alert = false, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
        // Only the selected chip is filled; an alert just turns its count red.
        active
          ? 'border-teal-600 bg-teal-600 text-white shadow-sm'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {Icon && <Icon className="size-3.5" aria-hidden="true" />}
      {label}
      <span className={`grid h-5 min-w-5 place-items-center rounded-md px-1 tabular-nums ${
        active ? 'bg-white/20 text-white' : alert ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600'
      }`}>
        {count}
      </span>
    </button>
  );
}
