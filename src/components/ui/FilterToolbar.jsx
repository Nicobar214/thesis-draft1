/* FilterToolbar.jsx — the filter bar used on list pages (same look as the
 * admin Public Reports / Farmer Beneficiaries filters):
 *
 *   [ search ................ ] [select] [select] [select]
 *   Showing 12 of 40 projects  [chip ×] [chip ×]        Clear all  {right}
 *
 * search:  { value, onChange(value), placeholder }
 * selects: [{ key, label, value, onChange(value), allValue = 'All', allLabel, options: [{ value, label }] }]
 *          -- a select whose value isn't its allValue becomes a removable chip
 *          (chip: false for a sort, which isn't a filter; allLabel names its default)
 * extraChips: [{ key, label, clear }]  -- chips for filters set elsewhere (e.g. KPI cards)
 * shown / total / noun: the results line
 * right:   optional node at the end of the results line (e.g. an Export button)
 * embedded: render without its own card (inside a table card header)
 */
import { SearchIcon, XIcon } from 'lucide-react';
import { lowerKeepAcronyms } from '../../lib/textCase';

const fieldBase = 'h-10 rounded-xl border border-slate-200 text-sm text-slate-700 outline-none transition hover:border-slate-300 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10';

export default function FilterToolbar({
  search,
  selects = [],
  extraChips = [],
  shown,
  total,
  noun = 'item',
  right = null,
  embedded = false,
  ariaLabel = 'Filters',
}) {
  const selectChips = selects
    .filter((s) => s.chip !== false && s.value !== (s.allValue ?? 'All'))
    .map((s) => ({
      key: s.key,
      label: s.chipLabel ? s.chipLabel(s.value) : (s.options.find((o) => o.value === s.value)?.label || s.value),
      clear: () => s.onChange(s.allValue ?? 'All'),
    }));
  const searchChip = search?.value?.trim()
    ? [{ key: 'search', label: `“${search.value.trim()}”`, clear: () => search.onChange('') }]
    : [];
  const chips = [...searchChip, ...extraChips, ...selectChips];
  const clearAll = () => chips.forEach((c) => c.clear());
  const plural = (n) => `${noun}${n === 1 ? '' : 's'}`;

  return (
    <section
      aria-label={ariaLabel}
      className={embedded ? '' : 'overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-xs'}
    >
      <div className="flex flex-col gap-2.5 p-4 xl:flex-row xl:items-center">
        {search && (
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              aria-label={search.ariaLabel || 'Search'}
              className={`${fieldBase} w-full bg-slate-50/60 pl-10 pr-4 placeholder:text-slate-400 focus:bg-white`}
            />
          </div>
        )}
        {selects.length > 0 && (
          <div className={`grid grid-cols-2 gap-2.5 ${selects.length >= 3 ? 'sm:grid-cols-3' : ''} ${selects.length >= 4 ? 'lg:grid-cols-4' : ''} xl:flex xl:flex-nowrap`}>
            {selects.map((s) => (
              <select
                key={s.key}
                value={s.value}
                onChange={(e) => s.onChange(e.target.value)}
                aria-label={s.label}
                className={`${fieldBase} w-full min-w-0 truncate bg-white pl-3.5 pr-8 xl:w-44`}
              >
                <option value={s.allValue ?? 'All'}>{s.allLabel || `All ${lowerKeepAcronyms(s.label)}`}</option>
                {s.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
        <p className="mr-1 text-sm text-slate-500">
          Showing <span className="font-semibold text-slate-900">{Number(shown).toLocaleString()}</span> of {Number(total).toLocaleString()} {plural(total)}
        </p>
        {chips.map((chip) => (
          <span key={chip.key} className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-xs font-medium text-slate-700">
            <span className="truncate">{chip.label}</span>
            <button type="button" onClick={chip.clear} aria-label={`Remove filter ${chip.label}`} className="grid size-5 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700">
              <XIcon className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <div className="ml-auto flex items-center gap-3">
          {chips.length > 0 && (
            <button type="button" onClick={clearAll} className="text-sm font-medium text-teal-700 hover:text-teal-800 hover:underline">
              Clear all
            </button>
          )}
          {right}
        </div>
      </div>
    </section>
  );
}
