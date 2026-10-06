import { useCallback, useEffect, useState } from 'react';
import { CloudOffIcon, CloudUploadIcon, WifiIcon } from 'lucide-react';
import { listQueuedRepairVerifications, REPAIR_SYNC_EVENT } from '../../lib/offlineRepairVerifications';

/** Clickable workload counters shown under the sidebar links. */
export function SidebarTodaySummary({ metrics, onOpen }) {
  const rows = [
    { key: 'assigned', label: 'Assigned', n: metrics.assigned, dot: 'bg-blue-400' },
    { key: 'in-progress', label: 'In progress', n: metrics.inProgress, dot: 'bg-amber-400' },
    { key: 'needs-rework', label: 'Needs rework', n: metrics.needsRework, dot: 'bg-rose-400' },
  ];
  return (
    <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-800/40 p-3">
      <p className="px-0.5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Today</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.key}>
            <button
              type="button"
              onClick={() => onOpen(r.key)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs text-slate-300 transition hover:bg-slate-700/60 hover:text-white"
            >
              <span className={`size-2 shrink-0 rounded-full ${r.dot}`} aria-hidden="true" />
              <span className="flex-1">{r.label}</span>
              <span className="font-bold text-white">{r.n}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function timeLabel(date) {
  if (!date) return 'not yet this session';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Connection and offline-queue state. Repair photos taken without signal wait in
 * IndexedDB; this shows how many are still waiting and whether any were rejected.
 */
export function SidebarSyncStatus({ isOffline, collapsed }) {
  const [queued, setQueued] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [lastSync, setLastSync] = useState(null);

  const refresh = useCallback(async () => {
    const items = await listQueuedRepairVerifications();
    setQueued(items.filter((i) => i.status === 'queued').length);
    setRejected(items.filter((i) => i.status === 'rejected').length);
  }, []);

  useEffect(() => {
    refresh();
    const onSync = () => { setLastSync(new Date()); refresh(); };
    window.addEventListener(REPAIR_SYNC_EVENT, onSync);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    return () => {
      window.removeEventListener(REPAIR_SYNC_EVENT, onSync);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, [refresh]);

  const Icon = isOffline ? CloudOffIcon : queued ? CloudUploadIcon : WifiIcon;
  const tone = isOffline ? 'text-amber-300' : rejected ? 'text-rose-300' : 'text-emerald-300';
  const title = isOffline ? 'Offline' : 'Online';

  if (collapsed) {
    return (
      <div
        className="relative mb-2 flex justify-center py-2"
        title={`${title}${queued ? ` · ${queued} waiting to sync` : ''}${rejected ? ` · ${rejected} rejected` : ''}`}
      >
        <Icon className={`size-5 ${tone}`} aria-hidden="true" />
        {(queued > 0 || rejected > 0) && (
          <span className="absolute right-3 top-1 min-w-4 rounded-full bg-amber-400 px-1 text-center text-[9px] font-bold text-slate-900">
            {queued + rejected}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="mb-2 rounded-xl border border-slate-700 bg-slate-800/40 p-3" role="status">
      <div className="flex items-center gap-2">
        <Icon className={`size-4 shrink-0 ${tone}`} aria-hidden="true" />
        <p className="text-xs font-semibold text-white">{title}</p>
        <span className="ml-auto text-[10px] text-slate-400">Sync {timeLabel(lastSync)}</span>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
        {isOffline
          ? 'Work is saved on this device and uploads when you reconnect.'
          : queued > 0
            ? `${queued} repair verification${queued === 1 ? '' : 's'} waiting to upload.`
            : 'Everything is synced.'}
      </p>
      {rejected > 0 && (
        <p className="mt-1.5 text-[11px] font-semibold text-rose-300">
          {rejected} saved photo{rejected === 1 ? ' was' : 's were'} rejected. Open the report and retake.
        </p>
      )}
    </div>
  );
}
