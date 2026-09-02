/* ProjectSCurvePanel.jsx — physical vs financial accomplishment S-curve.
 *
 * Implements DA Region VI's monitoring process: DA compares verified physical
 * accomplishment (%) against financial disbursement (%) using progress
 * reports, billing documents and S-curves, and any significant variance is
 * subject to review.
 *
 * Fetches its own project_tasks (for the planned curve) so the caller only has
 * to pass what it already holds — the project, its progress updates and its
 * tranches. Renders nothing but honest empty states when a series has no data.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Legend,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts';
import { supabaseAdminPortal as supabase } from '../../lib/supabase';
import {
  buildSCurveSeries,
  computeVariance,
  classifyVariance,
  computeSlippage,
} from '../../lib/accomplishmentAnalytics';

const cardClass = 'bg-white border border-slate-200 rounded-2xl p-6 shadow-sm';

const fmtPct = (value) => (value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`);

export default function ProjectSCurvePanel({ project, progressUpdates = [], tranches = [] }) {
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);

  const projectId = project?.id;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!projectId) {
        if (!cancelled) { setTasks([]); setTasksLoading(false); }
        return;
      }
      setTasksLoading(true);
      const { data, error } = await supabase
        .from('project_tasks')
        .select('id, planned_start, planned_end, planned_weight_pct, status')
        .eq('project_id', projectId);
      if (cancelled) return;
      if (error) {
        console.error('S-curve: failed to load project_tasks', error);
        setTasks([]);
      } else {
        setTasks(data || []);
      }
      setTasksLoading(false);
    })();

    return () => { cancelled = true; };
  }, [projectId]);

  /* Only this project's updates; the caller passes the whole admin list. */
  const projectUpdates = useMemo(
    () => (progressUpdates || []).filter((u) => u.fmr_project_id === projectId),
    [progressUpdates, projectId]
  );

  const analysis = useMemo(
    () => buildSCurveSeries({ project, tasks, progressUpdates: projectUpdates, tranches }),
    [project, tasks, projectUpdates, tranches]
  );

  const { series, hasPlanned, hasPhysical, hasFinancial, latest, contractAmount } = analysis;

  const variance = computeVariance(latest?.physical, latest?.financial);
  const varianceClass = classifyVariance(variance);
  const slippage = computeSlippage(latest?.physical, latest?.planned);

  const noData = !series.length || (!hasPhysical && !hasFinancial && !hasPlanned);

  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Physical vs Financial Accomplishment</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            S-curve of planned, verified physical, and disbursed progress
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-semibold whitespace-nowrap ${varianceClass.tone}`}
          title={varianceClass.detail}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${varianceClass.dot}`} />
          {varianceClass.label}
        </span>
      </div>

      {/* Headline figures */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-5">
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Planned</p>
          <p className="text-xl font-bold text-slate-700 mt-1 font-mono">{fmtPct(latest?.planned)}</p>
        </div>
        <div className="rounded-xl border border-teal-100 bg-teal-50/50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-teal-600">Physical</p>
          <p className="text-xl font-bold text-teal-700 mt-1 font-mono">{fmtPct(latest?.physical)}</p>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Financial</p>
          <p className="text-xl font-bold text-indigo-700 mt-1 font-mono">{fmtPct(latest?.financial)}</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Variance</p>
          <p className="text-xl font-bold text-slate-700 mt-1 font-mono">
            {variance === null ? '—' : `${variance > 0 ? '+' : ''}${variance.toFixed(1)}`}
          </p>
        </div>
      </div>

      <p className="text-xs text-slate-500 -mt-1 mb-4">{varianceClass.detail}</p>

      {/* Chart */}
      {tasksLoading ? (
        <div className="h-72 grid place-items-center text-sm text-slate-400">Loading schedule…</div>
      ) : noData ? (
        <div className="h-40 grid place-items-center text-center px-6">
          <div>
            <p className="text-sm font-semibold text-slate-600">Not enough data to plot an S-curve yet</p>
            <p className="text-xs text-slate-400 mt-1">
              Needs at least an approved progress update with a reporting period, or a released tranche.
            </p>
          </div>
        </div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
              />
              <RechartsTooltip
                formatter={(value, name) => [value === null ? '—' : `${Number(value).toFixed(1)}%`, name]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                dataKey="planned" name="Planned" stroke="#94a3b8" strokeWidth={2}
                strokeDasharray="5 4" dot={false} connectNulls
              />
              <Line
                dataKey="physical" name="Physical (verified)" stroke="#0d9488" strokeWidth={3}
                dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls
              />
              <Line
                dataKey="financial" name="Financial (disbursed)" stroke="#4f46e5" strokeWidth={3}
                dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Footnotes — say plainly when a series is missing and why */}
      <div className="mt-4 space-y-1.5">
        {!hasPlanned && !tasksLoading && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            No planned curve: this project&rsquo;s schedule tasks have no planned weight assigned.
            Set a weight per task under Project Mgmt &rarr; Timeline to enable schedule comparison.
          </p>
        )}
        {!hasFinancial && (
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            {contractAmount > 0
              ? 'No financial curve yet: no tranche has been released with a release date.'
              : 'No financial curve: set a contract amount (or total budget) on this project.'}
          </p>
        )}
        {slippage !== null && (
          <p className="text-xs text-slate-500">
            Schedule slippage:{' '}
            <span className={slippage < 0 ? 'font-semibold text-rose-600' : 'font-semibold text-emerald-600'}>
              {slippage > 0 ? '+' : ''}{slippage.toFixed(1)} pts
            </span>{' '}
            {slippage < 0 ? 'behind' : 'ahead of'} the planned curve.
          </p>
        )}
        <p className="text-[11px] text-slate-400">
          Physical accomplishment counts approved progress updates only, and prefers the
          engineer-certified figure where one exists. Financial accomplishment is computed from
          actual tranche releases, not from physical progress.
        </p>
      </div>
    </div>
  );
}
