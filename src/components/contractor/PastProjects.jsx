/* "Past projects" on My Projects: projects this contractor no longer holds because
 * their contract was terminated and the project reassigned (contractor_past_terms,
 * supabase_overdue_v2.sql). Read-only: their own period, % range and days late.
 * Shows nothing when there are none. */
import { useEffect, useState } from 'react';
import { HistoryIcon } from 'lucide-react';
import { fmtDay } from '../../lib/delayCases';

export default function PastProjects({ client }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let alive = true;
    client.rpc('contractor_past_terms').then(({ data, error }) => { if (alive) setRows(error ? [] : data || []); });
    return () => { alive = false; };
  }, [client]);

  if (!rows.length) return null;
  return (
    <section className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm" aria-label="Past projects">
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <HistoryIcon className="size-4 text-slate-500" aria-hidden="true" /> Past projects
        <span className="font-normal text-slate-500">· terminated and reassigned</span>
      </h2>
      <ul className="mt-3 divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={`${r.project_id}-${r.term_no}`} className="py-3 text-sm">
            <p className="font-semibold text-slate-900">{r.project_name}{r.municipality ? <span className="font-normal text-slate-500"> · {r.municipality}</span> : null}</p>
            <p className="mt-0.5 text-slate-600">
              {fmtDay(r.started_on)} – {fmtDay(r.ended_on)} · {Number(r.start_percent || 0)}% → {Number(r.end_percent || 0)}%
              {r.days_late != null && <span className="font-semibold text-rose-700"> · {r.days_late} day(s) late</span>}
            </p>
            {r.end_reason && <p className="mt-0.5 text-xs text-slate-500">DA: “{r.end_reason}”</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
