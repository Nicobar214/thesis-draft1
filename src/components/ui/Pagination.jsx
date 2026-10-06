import { useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { getPaginationRange } from '../../lib/paginationUtils';

export const PAGE_SIZES = [10, 25, 50];

// Slices `items` into pages. Pass a `resetKey` that changes whenever the
// filters change so the list returns to page 1 instead of an empty page.
export function usePagination(items, resetKey = '', initialSize = 10) {
  const [state, setState] = useState({ page: 1, size: initialSize, key: resetKey });
  const page = state.key === resetKey ? state.page : 1;
  const totalPages = Math.max(1, Math.ceil(items.length / state.size));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * state.size;
  return {
    pageItems: items.slice(start, start + state.size),
    page: current,
    pageSize: state.size,
    totalPages,
    total: items.length,
    from: items.length === 0 ? 0 : start + 1,
    to: Math.min(start + state.size, items.length),
    setPage: (p) => setState((s) => ({ ...s, page: Math.min(Math.max(1, p), totalPages), key: resetKey })),
    setPageSize: (n) => setState({ page: 1, size: n, key: resetKey }),
  };
}

export default function Pagination({ pager, noun = 'item' }) {
  const { page, totalPages, total, from, to, pageSize, setPage, setPageSize } = pager;
  if (total === 0) return null;
  const btn = 'inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-lg text-xs font-medium border transition';
  return (
    <nav aria-label="Pagination" className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
      <div className="flex items-center gap-3">
        <span>
          Showing <strong className="text-slate-700">{from}–{to}</strong> of <strong className="text-slate-700">{total}</strong> {noun}{total !== 1 ? 's' : ''}
        </span>
        <label className="flex items-center gap-1.5">
          <span className="sr-only sm:not-sr-only">Rows</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} per page</option>)}
          </select>
        </label>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPage(page - 1)}
            disabled={page === 1}
            aria-label="Previous page"
            className={`${btn} border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <ChevronLeftIcon className="size-4" aria-hidden="true" />
          </button>
          {getPaginationRange(page, totalPages).map((p, i) =>
            p === '...' ? (
              <span key={`gap-${i}`} className="px-1 text-slate-400" aria-hidden="true">…</span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`Page ${p}`}
                className={`${btn} ${p === page ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {p}
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => setPage(page + 1)}
            disabled={page === totalPages}
            aria-label="Next page"
            className={`${btn} border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <ChevronRightIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </nav>
  );
}
