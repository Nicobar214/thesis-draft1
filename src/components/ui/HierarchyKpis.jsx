/* HierarchyKpis.jsx — the KPI layout used across portals: one large lead card
 * (the headline number, a one-line note and an optional split bar) with four
 * smaller supporting cards in a 2x2 beside it.
 *
 * lead:  { label, value, note, icon, iconTone, body?, segments?: [{ label, value, bar }] }
 *        body: optional extra content between the note and the split bar
 * items: [{ icon, label, value, hint, chip, onClick?, active? }]  -- four fill
 *        the 2x2; an item with onClick renders as a button (e.g. to filter a
 *        list), and `active` marks the one whose filter is applied
 * dense: bigger numbers pinned to the bottom of each card (Review Queue)
 */

function KpiMini({ icon, value, label, hint, chip, onClick, active = false, dense = false }) {
  // dense: number pinned to the bottom and set large, so a card stretched by a
  // tall lead card still reads as "label on top, big number below".
  const body = dense ? (
    <>
      <div className="flex items-center gap-2">
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${chip}`}>{icon}</span>
        <p className="text-sm font-medium text-slate-600">{label}</p>
      </div>
      <div className="mt-auto pt-3">
        <p className="truncate text-4xl font-bold tracking-tight text-slate-900 tabular-nums leading-none">{value}</p>
        {hint && <p className="mt-1.5 truncate text-xs text-slate-400">{hint}</p>}
      </div>
    </>
  ) : (
    <>
      <div className="flex items-center gap-2">
        <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${chip}`}>{icon}</span>
        <p className="text-xs font-medium text-slate-500">{label}</p>
      </div>
      <p className="mt-2 truncate text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </>
  );
  const base = 'flex min-w-0 flex-col rounded-2xl border p-4 text-left shadow-xs';
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${base} transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
        active ? 'border-teal-500 bg-teal-50/50 ring-2 ring-teal-500/30' : 'border-slate-200/60 bg-white hover:border-slate-300 hover:shadow-sm'
      }`}
    >
      {body}
    </button>
  ) : (
    <article className={`${base} border-slate-200/60 bg-white`}>{body}</article>
  );
}

export default function HierarchyKpis({ lead, items, loading = false, ariaLabel = 'Summary', dense = false }) {
  if (loading) {
    return (
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-busy="true">
        <div className="col-span-2 lg:row-span-2 h-56 rounded-2xl border border-slate-200/60 bg-white animate-pulse" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[6.5rem] rounded-2xl border border-slate-200/60 bg-white animate-pulse" />
        ))}
      </section>
    );
  }

  const segments = lead.segments || [];
  const segmentTotal = segments.reduce((sum, s) => sum + (Number(s.value) || 0), 0);

  const leadContent = (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{lead.label}</p>
          <p className={`mt-2 tracking-tight text-slate-900 tabular-nums ${dense ? 'text-6xl font-bold leading-none' : 'text-5xl font-semibold'}`}>{lead.value}</p>
          {lead.note && <p className="mt-1.5 text-sm text-slate-500">{lead.note}</p>}
        </div>
        {lead.icon && (
          <div className={`grid size-12 shrink-0 place-items-center rounded-xl ${lead.iconTone || 'bg-emerald-100 text-emerald-700'}`}>
            {lead.icon}
          </div>
        )}
      </div>

      {lead.body && <div className={dense ? 'mt-4' : 'mt-5'}>{lead.body}</div>}

      {segments.length > 0 && (
        <div className={`mt-auto ${dense ? 'pt-4' : 'pt-6'}`}>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
            {segments.map((s) => (
              <div
                key={s.label}
                className={`h-full ${s.bar}`}
                style={{ width: `${segmentTotal ? ((Number(s.value) || 0) / segmentTotal) * 100 : 0}%` }}
              />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            {segments.map((s) => (
              <span key={s.label} className="inline-flex items-center gap-1.5">
                <span className={`size-2 rounded-full ${s.bar}`} />{s.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );

  const leadBase = 'col-span-2 lg:row-span-2 flex flex-col rounded-2xl border p-6 text-left shadow-xs';

  return (
    <section className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label={ariaLabel}>
      {lead.onClick ? (
        <button
          type="button"
          onClick={lead.onClick}
          aria-pressed={lead.active}
          className={`${leadBase} transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 cursor-pointer ${
            lead.active
              ? 'border-teal-500 bg-teal-50/40 ring-2 ring-teal-500/30'
              : 'border-slate-200/60 bg-white hover:border-slate-300 hover:shadow-sm'
          }`}
        >
          {leadContent}
        </button>
      ) : (
        <article className={`${leadBase} border-slate-200/60 bg-white`}>
          {leadContent}
        </article>
      )}

      {items.map((item) => <KpiMini key={item.label} dense={dense} {...item} />)}
    </section>
  );
}
