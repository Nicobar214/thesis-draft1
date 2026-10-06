import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ClockIcon, LandmarkIcon, Loader2Icon, MapPinIcon, RouteIcon, SearchIcon, XIcon } from 'lucide-react';
import { loadRecent, projectEntries, saveRecent, searchLocal, searchRemote } from '../../lib/placeSearch';

const TYPE_ICON = {
  barangay: MapPinIcon,
  municipality: LandmarkIcon,
  project: RouteIcon,
  place: MapPinIcon,
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function Highlight({ text, query }) {
  const q = query.trim();
  if (!q) return text;
  const parts = text.split(new RegExp(`(${escapeRegex(q)})`, 'i'));
  return parts.map((part, i) => (
    part.toLowerCase() === q.toLowerCase()
      ? <mark key={i} className="rounded-sm bg-teal-100 px-0 text-teal-900">{part}</mark>
      : part
  ));
}

/**
 * Place search for maps. Suggestions appear as you type, from local data first, so
 * barangays answer instantly. The web is asked only when local data is thin, after
 * the user pauses, once at a time, and its answer is cached.
 *
 * Works controlled (value + onChange, when the text also drives a filter) or on its
 * own. onSelect gets { lat, lng, zoom, label, type, bounds? }.
 */
export default function MapSearchBox({
  onSelect,
  projects,
  value,
  onChange,
  placeholder = 'Search a barangay, road or place...',
  className = '',
  inputClassName = '',
  autoFocus = false,
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState('');
  const query = controlled ? value : inner;
  const setQuery = useCallback((next) => {
    if (!controlled) setInner(next);
    onChange?.(next);
  }, [controlled, onChange]);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState([]);
  const [remote, setRemote] = useState({ query: '', results: [], loading: false });
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listId = useId();

  const extra = useMemo(() => projectEntries(projects), [projects]);
  const local = useMemo(() => searchLocal(query, extra), [query, extra]);
  const trimmed = query.trim();

  // Web fallback: only when local data is thin, after a pause, and cancellable.
  const wantsRemote = open && trimmed.length >= 3 && local.length < 4;
  useEffect(() => {
    if (!wantsRemote) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setRemote((prev) => ({ ...prev, query: trimmed, loading: true }));
      try {
        const results = await searchRemote(trimmed, controller.signal);
        if (!controller.signal.aborted) setRemote({ query: trimmed, results, loading: false });
      } catch {
        /* aborted by a newer keystroke */
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [wantsRemote, trimmed]);

  const remoteResults = useMemo(() => {
    if (remote.query !== trimmed) return [];
    const known = new Set(local.map((r) => r.label.toLowerCase()));
    return remote.results.filter((r) => !known.has(r.label.toLowerCase()));
  }, [remote, trimmed, local]);
  const remoteLoading = wantsRemote && (remote.query !== trimmed || remote.loading);

  const showRecent = open && !trimmed && recent.length > 0;
  const rows = showRecent ? recent : [...local, ...remoteResults];

  // Close on outside click.
  useEffect(() => {
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const choose = useCallback((result) => {
    if (!result) return;
    saveRecent(result);
    setOpen(false);
    inputRef.current?.blur();
    onSelect?.({ lat: result.lat, lng: result.lng, zoom: result.zoom ?? 14, label: result.label, type: result.type, bounds: result.bounds, approx: result.approx });
  }, [onSelect]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[active]) choose(rows[active]);
      else if (rows[0]) choose(rows[0]);
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  };

  const noMatch = open && trimmed.length >= 2 && rows.length === 0 && !remoteLoading;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open && (rows.length > 0 || noMatch)}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => {
            setRecent(loadRecent());
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className={`w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-9 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 ${inputClassName}`}
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center">
          {remoteLoading ? (
            <Loader2Icon className="size-4 animate-spin text-slate-400" aria-label="Searching online" />
          ) : query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setActive(0);
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {open && (rows.length > 0 || noMatch) && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-[1100] mt-1 max-h-72 min-w-[16rem] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 text-xs shadow-xl"
        >
          {showRecent && <li className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Recent</li>}
          {rows.map((r, i) => {
            const Icon = showRecent ? ClockIcon : TYPE_ICON[r.type] || MapPinIcon;
            return (
              <li
                key={r.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus so the click is not lost to blur
                  choose(r);
                }}
                className={`flex cursor-pointer items-start gap-2.5 px-3 py-2 ${i === active ? 'bg-teal-50' : ''}`}
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-800">
                    <Highlight text={r.label} query={showRecent ? '' : trimmed} />
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {r.sublabel}
                    {r.approx ? ' · approximate position' : ''}
                  </span>
                </span>
              </li>
            );
          })}
          {remoteLoading && rows.length > 0 && (
            <li className="px-3 py-1.5 text-[11px] text-slate-400">Looking for more places online...</li>
          )}
          {noMatch && (
            <li className="px-3 py-3 text-[11px] text-slate-500">
              No match for "{trimmed}". Try a barangay, road or municipality name.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
