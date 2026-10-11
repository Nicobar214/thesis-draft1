import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CloudOffIcon, WifiIcon } from 'lucide-react';
import { getCitizenStatus } from '../lib/publicReportStatus';
import { useMyReports } from '../lib/useMyReports';

/** The citizen's report counts, each linking to My Reports pre-filtered. */
export function SidebarReportSummary() {
  const { reports } = useMyReports();

  const counts = useMemo(() => {
    const c = { submitted: 0, in_progress: 0, resolved: 0 };
    reports.forEach((r) => {
      const key = getCitizenStatus(r).key;
      if (key === 'submitted') c.submitted += 1;
      else if (key === 'resolved') c.resolved += 1;
      else if (key !== 'closed') c.in_progress += 1;
    });
    return c;
  }, [reports]);

  const rows = [
    { status: 'submitted', label: 'Awaiting review', n: counts.submitted, dot: 'bg-amber-400' },
    { status: 'in_progress', label: 'In progress', n: counts.in_progress, dot: 'bg-sky-400' },
    { status: 'resolved', label: 'Resolved', n: counts.resolved, dot: 'bg-emerald-400' },
  ];

  return (
    <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-800/40 p-3">
      <p className="px-0.5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">My reports</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.status}>
            <Link
              to={`/user/reports?status=${r.status}`}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-slate-300 transition hover:bg-slate-700/60 hover:text-white"
            >
              <span className={`size-2 shrink-0 rounded-full ${r.dot}`} aria-hidden="true" />
              <span className="flex-1">{r.label}</span>
              <span className="font-bold text-white">{r.n}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Connection state plus reports saved on this device while offline. */
export function SidebarConnectionStatus({ collapsed }) {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const Icon = !online ? CloudOffIcon : WifiIcon;
  const tone = !online ? 'text-amber-400' : 'text-emerald-400';

  if (collapsed) {
    return (
      <div className="relative flex justify-center py-2" title={online ? 'Online' : 'Offline'}>
        <Icon className={`size-5 ${tone} ${online ? 'animate-pulse' : ''}`} aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-slate-800/50 px-3 py-2.5" role="status">
      <div className="flex items-center gap-2">
        <Icon className={`size-4 shrink-0 ${tone} ${online ? 'animate-pulse' : ''}`} aria-hidden="true" />
        <p className="text-xs font-semibold text-white">{online ? 'Online' : 'Offline'}</p>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-slate-400">
        {!online
          ? 'Reports you submit are saved on this device and sent when you reconnect.'
          : 'Everything is up to date.'}
      </p>
    </div>
  );
}
