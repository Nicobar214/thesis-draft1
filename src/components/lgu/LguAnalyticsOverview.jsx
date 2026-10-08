import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList } from 'recharts';
import { Panel, EmptyState, UnavailableState } from './analyticsParts';
import { fmtInt } from '../../lib/lguAnalytics';

// Same status palette as AdminAnalyticsTab.jsx, so a status reads the same
// color in every role's analytics.
const STATUS_COLORS = { Completed: '#10b981', 'On-Going': '#f59e0b', Proposed: '#0ea5e9' };
const FALLBACK_COLOR = '#94a3b8';
const BAR_COLOR = '#0d9488';
const TOP_BARANGAYS = 8;
const tooltipStyle = { borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px rgba(15,23,42,.08)', fontSize: 12 };

function StatusDistribution({ summary, unavailable }) {
  const { total, statuses } = summary;
  return (
    <Panel title="Project Status Distribution" subtitle="FMR projects by current implementation status">
      {unavailable ? (
        <UnavailableState>Project records could not be loaded.</UnavailableState>
      ) : total === 0 ? (
        <EmptyState>No FMR projects available for the selected filters.</EmptyState>
      ) : (
        <div className="grid items-center gap-6 sm:grid-cols-[11rem_1fr]">
          <div className="relative mx-auto size-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statuses}
                  dataKey="count"
                  nameKey="name"
                  innerRadius="68%"
                  outerRadius="100%"
                  paddingAngle={statuses.length > 1 ? 2 : 0}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {statuses.map((s) => <Cell key={s.name} fill={STATUS_COLORS[s.name] || FALLBACK_COLOR} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`${fmtInt(v)} projects`, name]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-semibold tabular-nums text-slate-900">{fmtInt(total)}</span>
              <span className="text-[11px] text-slate-500">Total projects</span>
            </div>
          </div>

          <ul className="space-y-3.5">
            {statuses.map((s) => {
              const color = STATUS_COLORS[s.name] || FALLBACK_COLOR;
              return (
                <li key={s.name}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: color }} aria-hidden="true" />
                    <span className="flex-1 text-slate-700">{s.name}</span>
                    <span className="font-semibold tabular-nums text-slate-900">{fmtInt(s.count)}</span>
                    <span className="w-14 text-right text-xs tabular-nums text-slate-500">{s.pct.toFixed(1)}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                    <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: color }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function ProjectsByBarangay({ rows, unavailable }) {
  const located = rows.filter((r) => !r.unassigned && r.projects > 0).sort((a, b) => b.projects - a.projects);
  const shown = located.slice(0, TOP_BARANGAYS);
  const unassigned = rows.find((r) => r.unassigned)?.projects || 0;

  const subtitle = located.length > TOP_BARANGAYS
    ? `Top ${TOP_BARANGAYS} of ${located.length} barangays · full list in the breakdown below`
    : `${located.length} barangay${located.length === 1 ? '' : 's'} with recorded projects`;

  return (
    <Panel title="Projects by Barangay" subtitle={unavailable ? undefined : subtitle}>
      {unavailable ? (
        <UnavailableState>Project records could not be loaded.</UnavailableState>
      ) : shown.length === 0 ? (
        <EmptyState>No projects in this selection have a recorded barangay.</EmptyState>
      ) : (
        <>
          <div style={{ height: Math.max(160, shown.length * 34) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={shown} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f8fafc' }} formatter={(v) => [fmtInt(v), 'Projects']} />
                <Bar dataKey="projects" fill={BAR_COLOR} radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false}>
                  <LabelList dataKey="projects" position="right" style={{ fontSize: 11, fill: '#334155' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {unassigned > 0 && (
            <p className="mt-3 text-[11px] text-slate-500">
              {fmtInt(unassigned)} project{unassigned === 1 ? ' has' : 's have'} no recorded barangay and {unassigned === 1 ? 'is' : 'are'} not shown here.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

export default function LguAnalyticsOverview({ summary, barangayRows, unavailable }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <StatusDistribution summary={summary} unavailable={unavailable} />
      <ProjectsByBarangay rows={barangayRows} unavailable={unavailable} />
    </div>
  );
}
