import { useEffect, useState } from 'react';
import { CloudOffIcon, WifiIcon } from 'lucide-react';

const TONES = {
  amber: 'bg-amber-400',
  rose: 'bg-rose-400',
  sky: 'bg-sky-400',
  emerald: 'bg-emerald-400',
};

/**
 * Work waiting on the signed-in role, each row a shortcut to where it is handled.
 * rows: [{ key, label, count, tone, onClick }]
 */
export function AttentionSummary({ rows, title = 'Needs attention' }) {
  return (
    <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-800/40 p-3">
      <p className="px-0.5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.key}>
            <button
              type="button"
              onClick={r.onClick}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs text-slate-300 transition hover:bg-slate-700/60 hover:text-white"
            >
              <span className={`size-2 shrink-0 rounded-full ${TONES[r.tone] || TONES.sky}`} aria-hidden="true" />
              <span className="flex-1">{r.label}</span>
              <span className={`font-bold ${r.count > 0 && r.tone === 'rose' ? 'text-rose-300' : 'text-white'}`}>{r.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Online/offline state for portals that have no offline queue of their own. */
export function ConnectionStatus({ collapsed }) {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const Icon = online ? WifiIcon : CloudOffIcon;
  const tone = online ? 'text-emerald-300' : 'text-amber-300';

  if (collapsed) {
    return (
      <div className="mb-3 flex justify-center" title={online ? 'Online' : 'Offline'}>
        <Icon className={`size-5 ${tone}`} aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-xl border border-slate-700 bg-slate-800/40 px-3 py-2.5" role="status">
      <div className="flex items-center gap-2">
        <Icon className={`size-4 shrink-0 ${tone}`} aria-hidden="true" />
        <p className="text-xs font-semibold text-white">{online ? 'Online' : 'Offline'}</p>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-slate-400">
        {online
          ? 'Live updates are on. Reports and decisions refresh automatically.'
          : 'You are offline. Changes cannot be saved until you reconnect.'}
      </p>
    </div>
  );
}
