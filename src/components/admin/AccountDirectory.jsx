import { useMemo, useState } from 'react';
import { SearchIcon, XIcon } from 'lucide-react';
import Pagination, { usePagination } from '../ui/Pagination';

/**
 * A searchable, paged list of staff accounts (field engineers, contractors,
 * LGUs) on the DA profile, so the list stays usable as more are registered.
 *
 *   <AccountDirectory items={lgus} noun="LGU account" searchText={(a) => ...} renderItem={(a) => ...} />
 *
 * searchText(item) returns the text to match (name, email, phone, municipality…).
 */
export default function AccountDirectory({ items = [], noun = 'account', searchText, renderItem, pageSize = 5, placeholder }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? items.filter((item) => String(searchText?.(item) || '').toLowerCase().includes(q)) : items),
    [items, q, searchText],
  );
  const pager = usePagination(filtered, q, pageSize);

  if (items.length === 0) return null;

  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder || 'Search name, email or phone'}
            aria-label={`Search ${noun}s`}
            className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-slate-400 hover:text-slate-600"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <span className="hidden shrink-0 text-xs text-slate-500 sm:inline">
          {q ? `${filtered.length} of ${items.length}` : items.length} {noun}{items.length === 1 ? '' : 's'}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No {noun}s match “{query}”.</p>
      ) : (
        <div className="space-y-3">{pager.pageItems.map((item) => renderItem(item))}</div>
      )}

      {filtered.length > pageSize && <Pagination pager={pager} noun={noun} />}
    </div>
  );
}
