import { useState } from 'react';
import { LayoutGridIcon, ListIcon } from 'lucide-react';

// Table is the default; the choice is remembered per page where storage allows.
export function useViewMode(storageKey) {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === 'cards' ? 'cards' : 'table';
    } catch {
      return 'table';
    }
  });
  const update = (next) => {
    setMode(next);
    try { localStorage.setItem(storageKey, next); } catch { /* storage unavailable */ }
  };
  return [mode, update];
}

export default function ViewToggle({ mode, onChange }) {
  const opts = [
    { id: 'table', label: 'Table view', Icon: ListIcon },
    { id: 'cards', label: 'Card view', Icon: LayoutGridIcon },
  ];
  return (
    <div role="group" aria-label="Layout" className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
      {opts.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={mode === id}
          aria-label={label}
          title={label}
          className={`p-1.5 rounded-md transition ${mode === id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
