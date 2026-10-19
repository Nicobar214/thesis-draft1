import { XIcon } from 'lucide-react';

/**
 * A date box for filters, with a dependable way to clear it.
 *
 * The phone date picker's own Reset/Clear button is unreliable: on iOS Safari
 * (and some Android browsers) it empties the box without firing `change`, so the
 * filter kept the old date and the date reappeared on the next render. Here the
 * box's real value is also read on `input` and `blur`, and an × button clears it.
 *
 * onChange receives the value string ('' when cleared), not the event.
 */
export default function DateFilterInput({
  value,
  onChange,
  min,
  max,
  label,
  icon = null,
  className = '',
  inputClassName = '',
}) {
  const sync = (e) => {
    const next = e.target.value || '';
    if (next !== (value || '')) onChange(next);
  };

  return (
    <div className={`relative ${className}`}>
      {icon && (
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400">{icon}</span>
      )}
      <input
        type="date"
        value={value || ''}
        onChange={sync}
        onInput={sync}
        onBlur={sync}
        min={min || undefined}
        max={max || undefined}
        aria-label={label}
        title={label}
        className={`${icon ? 'pl-11' : 'pl-4'} ${value ? 'pr-10' : 'pr-3'} ${inputClassName}`}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={`Clear ${label || 'date'}`}
          title={`Clear ${label || 'date'}`}
          className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg bg-white text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <XIcon className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
