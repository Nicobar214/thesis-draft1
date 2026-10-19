/* SearchableSelect.jsx — a dropdown you can type into to narrow a long list.
 *
 * Click or focus to open a scrollable list; typing filters it. Arrow keys move,
 * Enter picks, Escape closes. Typing an exact option and leaving the field
 * also picks it. `required` works with normal form validation.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';

export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Search or select...',
  required = false,
  ariaLabel,
  id,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const listId = useId();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, query]);

  // Keep the highlighted option visible while moving with the arrow keys.
  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const openList = () => {
    if (open) return;
    setActive(Math.max(0, options.indexOf(value)));
    setOpen(true);
  };

  const pick = (option) => {
    onChange(option);
    setOpen(false);
    setQuery('');
  };

  const onBlur = () => {
    const typed = query.trim().toLowerCase();
    const exact = typed && options.find((o) => o.toLowerCase() === typed);
    if (exact) onChange(exact);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openList();
      else setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open) {
      // Picks the option instead of submitting the form.
      e.preventDefault();
      if (matches[active]) pick(matches[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div className={`relative ${className}`}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        required={required}
        value={open ? query : value}
        placeholder={open && value ? value : placeholder}
        onFocus={openList}
        onClick={openList}
        onChange={(e) => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true); }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-9 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
      />
      <ChevronDownIcon
        className={`pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        aria-hidden="true"
      />
      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-400">No match for "{query}"</li>
          ) : matches.map((option, i) => (
            <li
              key={option}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={option === value}
              // mousedown, not click: picking must happen before the input blurs.
              onMouseDown={(e) => { e.preventDefault(); pick(option); }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? 'bg-emerald-50 text-emerald-900' : 'text-slate-700'} ${option === value ? 'font-semibold' : ''}`}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
