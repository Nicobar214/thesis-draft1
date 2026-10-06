import { Children, useState } from 'react';
import { BASEMAPS, BASEMAP_IDS } from '../../lib/basemaps';
import { ChevronDownIcon, LayersIcon, ListIcon, XIcon } from 'lucide-react';

/*
 * Shared floating panels for every map. Two jobs, two corners:
 *   - MapLegend: what the symbols mean, read-only, bottom-left.
 *   - MapControlPanel: toggles, filters and basemap, top-right, collapsible.
 * Both must be rendered inside a `relative` map container. Leaflet's zoom buttons
 * stay top-left and its attribution bottom-right, so nothing overlaps.
 */

const isWide = () => typeof window === 'undefined' || window.innerWidth >= 1024;

/* ----------------------------- Legend ----------------------------- */

/**
 * A compact legend card: one column per group, swatches aligned in a fixed
 * gutter so lines and dots read as a single scannable column, counts pushed to
 * the right edge. Pass only the entries that apply to what is on the map; empty
 * groups disappear. It leaves room on the right for Leaflet's attribution.
 */
export function MapLegend({ title = 'Legend', children, defaultOpen, compact = false }) {
  const [open, setOpen] = useState(() => defaultOpen ?? isWide());
  return (
    <div className={`pointer-events-none absolute left-3 z-[500] max-w-[calc(100%-1.5rem)] ${compact ? 'bottom-2 max-h-[85%] sm:max-w-[calc(100%-11rem)]' : 'bottom-3 sm:max-w-[calc(100%-13rem)]'}`}>
      {open ? (
        <div className={`pointer-events-auto relative rounded-xl bg-white/90 text-slate-600 shadow-lg ring-1 ring-slate-900/10 backdrop-blur-md ${compact ? 'max-h-[calc(100%-0.5rem)] overflow-y-auto py-1.5 pl-3 pr-7 text-[10px] leading-[14px] [&_.space-y-1]:space-y-0 [&_p]:mb-0.5' : 'py-2.5 pl-4 pr-9 text-[11px] leading-4'}`}>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={`Hide ${title.toLowerCase()}`}
            className="absolute right-1.5 top-1.5 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </button>
          <div className={`flex max-w-full items-start overflow-x-auto ${compact ? 'gap-3' : 'gap-5'}`}>{children}</div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Show ${title.toLowerCase()}`}
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-lg ring-1 ring-slate-900/10 backdrop-blur-md transition hover:bg-white"
        >
          <ListIcon className="size-3.5 text-slate-500" aria-hidden="true" />
          {title}
        </button>
      )}
    </div>
  );
}

/** One column: a small heading over its entries. Renders nothing if it has none. */
export function LegendGroup({ label, children }) {
  if (Children.toArray(children).length === 0) return null;
  return (
    <div className="shrink-0 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-slate-200 [&:not(:first-child)]:pl-5">
      {label && <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function LegendRow({ swatch, label, count }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className="flex w-5 shrink-0 items-center justify-center">{swatch}</span>
      <span className="text-slate-700">{label}</span>
      {count != null && <span className="ml-auto pl-3 tabular-nums text-slate-400">{count}</span>}
    </div>
  );
}

/** Colored line sample, e.g. a road status. */
export function LegendLine({ color = 'bg-slate-400', dashed = false, label, count }) {
  return (
    <LegendRow
      label={label}
      count={count}
      swatch={dashed
        ? <span className={`inline-block w-5 border-t-2 border-dashed ${color}`} />
        : <span className={`h-1 w-5 rounded-full ${color}`} />}
    />
  );
}

/** Round marker sample. `style` lets a caller pass a hex color for status pins. */
export function LegendDot({ color = 'bg-slate-400', ring, label, text, style, count }) {
  return (
    <LegendRow
      label={label}
      count={count}
      swatch={(
        <span
          className={`grid size-3.5 place-items-center rounded-full text-[7px] font-bold leading-none text-white ${color} ${ring || ''}`}
          style={style}
        >
          {text}
        </span>
      )}
    />
  );
}

/* ------------------------- Control panel -------------------------- */

export function MapControlPanel({ title = 'Layers', children, defaultOpen, compact = false }) {
  const [open, setOpen] = useState(() => defaultOpen ?? isWide());
  return (
    <div className={`pointer-events-none absolute z-[500] flex flex-col items-end gap-2 ${compact ? 'right-2 top-2 bottom-2 max-w-[calc(100%-1rem)]' : 'right-4 top-4 max-w-[calc(100%-2rem)]'}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`pointer-events-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 font-semibold text-slate-800 shadow-md backdrop-blur hover:bg-white ${compact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-xs'}`}
      >
        <LayersIcon className="size-4 text-slate-600" aria-hidden="true" />
        {title}
        <ChevronDownIcon className={`size-3.5 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className={`pointer-events-auto min-h-0 overflow-y-auto rounded-xl border border-slate-200 bg-white/95 text-slate-700 shadow-md backdrop-blur ${compact ? 'w-44 max-h-full space-y-2 p-2 text-[11px] [&_label]:gap-1.5' : 'max-h-[55vh] w-60 space-y-3 p-3 text-xs'}`}>
          {children}
        </div>
      )}
    </div>
  );
}

/** A titled block of controls inside the panel. */
export function ControlGroup({ label, children }) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>}
      {children}
    </div>
  );
}

export function LayerToggle({ checked, onChange, label, accent = 'text-teal-600 focus:ring-teal-500' }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 font-medium text-slate-600 hover:text-slate-950">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`rounded border-slate-300 ${accent}`}
      />
      <span>{label}</span>
    </label>
  );
}

export function BasemapSwitch({ value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-1" role="group" aria-label="Map theme">
      {BASEMAP_IDS.map((id) => {
        const b = BASEMAPS[id];
        const selected = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={selected}
            title={b.hint}
            className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1 text-left text-[11px] font-medium transition ${selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            <span className="h-4 w-6 shrink-0 rounded border border-black/10" style={{ background: b.swatch }} aria-hidden="true" />
            <span className="truncate">{b.label}</span>
          </button>
        );
      })}
    </div>
  );
}
