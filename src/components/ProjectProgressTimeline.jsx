import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { buildProgressEntries, formatProgressDelta } from '../lib/projectProgress';
import { formatPercentage } from '../lib/percentageFormat';

const COLLAPSED_COUNT = 4;

/**
 * The approved progress updates of one project, newest first: the verified percentage,
 * the change since the update before it, and who vouched for the figure.
 *
 * Reads public.public_project_progress, which publishes only the public parts of an
 * update (see supabase_public_project_progress.sql). Renders nothing until that view
 * exists. Render with key={projectId} so switching projects starts clean.
 */
export default function ProjectProgressTimeline({ projectId }) {
  const [state, setState] = useState({ status: 'loading', rows: [] }); // loading | ready | unavailable
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('public_project_progress')
        .select('id, project_id, accomplishment, is_certified, photo_url, period_start, period_end, approved_at')
        .eq('project_id', projectId)
        .order('approved_at', { ascending: false })
        .limit(24);
      if (!alive) return;
      setState(error || !data ? { status: 'unavailable', rows: [] } : { status: 'ready', rows: data });
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  const entries = useMemo(() => buildProgressEntries(state.rows), [state.rows]);

  if (state.status === 'unavailable') return null;

  const visible = showAll ? entries : entries.slice(0, COLLAPSED_COUNT);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4">Progress updates</h4>

      {state.status === 'loading' && (
        <div className="space-y-3 animate-pulse" aria-hidden="true">
          <div className="h-12 rounded-xl bg-slate-100" />
          <div className="h-12 rounded-xl bg-slate-100" />
        </div>
      )}

      {state.status === 'ready' && entries.length === 0 && (
        <p className="text-sm text-slate-500">
          No progress updates have been published for this project yet. They appear here once the contractor reports
          progress and the DA approves it.
        </p>
      )}

      {entries.length > 0 && (
        <>
          <ol className="space-y-3">
            {visible.map((entry) => {
              const delta = formatProgressDelta(entry.delta);
              return (
                <li key={entry.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800">{entry.periodLabel}</p>
                      <span
                        className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          entry.isCertified ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {entry.isCertified ? 'Verified by site engineer' : 'Reported by contractor, approved by DA'}
                      </span>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-bold text-slate-900">{formatPercentage(entry.pct)}</p>
                      {delta && <p className="text-xs text-slate-500">{delta}</p>}
                    </div>
                  </div>

                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-teal-600" style={{ width: `${entry.pct}%` }} />
                  </div>

                  {entry.photoUrl && (
                    <a href={entry.photoUrl} target="_blank" rel="noopener noreferrer" className="mt-2.5 inline-block">
                      <img
                        src={entry.photoUrl}
                        alt={`Site photo for ${entry.periodLabel}`}
                        className="h-20 w-32 rounded-lg border border-slate-200 object-cover hover:opacity-90"
                      />
                    </a>
                  )}
                </li>
              );
            })}
          </ol>

          {entries.length > COLLAPSED_COUNT && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-3 text-xs font-semibold text-teal-700 hover:underline"
            >
              {showAll ? 'Show fewer' : `Show ${entries.length - COLLAPSED_COUNT} earlier updates`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
