import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CircleCheckIcon,
  DatabaseIcon,
  InfoIcon,
  LightbulbIcon,
  MinusIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { computeAdminAnalytics, monthsSinceFirstRecord } from '../../lib/adminAnalytics';

const COLORS = {
  teal: '#0d9488',
  slate: '#94a3b8',
  slateDark: '#475569',
  amber: '#f59e0b',
  rose: '#e11d48',
  sky: '#0ea5e9',
  indigo: '#6366f1',
  emerald: '#10b981',
};
const STATUS_COLORS = { Completed: COLORS.emerald, 'On-Going': COLORS.amber, Proposed: COLORS.sky };

const axis = { fill: '#64748b', fontSize: 11 };
const tooltipStyle = { borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px rgba(15,23,42,.08)', fontSize: 12 };

const PERIODS = [
  { id: '6', label: '6 months', months: 6 },
  { id: '12', label: '12 months', months: 12 },
  { id: 'all', label: 'Since first record', months: null },
];

const SECTIONS = [
  { id: 'summary', label: 'Summary' },
  { id: 'delivery', label: 'Infrastructure delivery' },
  { id: 'reports', label: 'Citizen reports' },
  { id: 'workflow', label: 'Review workflow' },
  { id: 'funding', label: 'Funding' },
  { id: 'coverage', label: 'Data coverage' },
];

const fmtInt = (n) => (n === null || n === undefined ? '-' : Number(n).toLocaleString('en-US'));
const fmtPeso = (n) => `₱${(Number(n || 0) / 1_000_000).toFixed(1)}M`;

/** Days as a human duration: minutes and hours under a day, days above. */
function fmtDuration(days) {
  if (days === null || days === undefined) return '-';
  if (days < 1 / 24) return '<1 h';
  if (days < 1) return `${Math.round(days * 24)} h`;
  return `${days.toFixed(1)} d`;
}

/* ------------------------------ building blocks ------------------------------ */

const TAKEAWAY_TONES = {
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  good: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
};

/** Level 1: a numbered section with a one-line, data-driven takeaway so the headline is readable without opening the charts. */
function Section({ id, n, title, description, takeaway, children }) {
  return (
    <section id={`analytics-${id}`} className="scroll-mt-24 space-y-4">
      <div className="flex flex-col gap-2 border-b-2 border-slate-900/10 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white">{n}</span>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">{title}</h2>
            <p className="max-w-2xl text-sm text-slate-500">{description}</p>
          </div>
        </div>
        {takeaway && (
          <span className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border px-3 py-1 text-xs font-semibold sm:self-end ${TAKEAWAY_TONES[takeaway.tone] || TAKEAWAY_TONES.neutral}`}>
            {takeaway.tone === 'warn' && <TriangleAlertIcon className="size-3.5" aria-hidden="true" />}
            {takeaway.tone === 'good' && <CircleCheckIcon className="size-3.5" aria-hidden="true" />}
            {takeaway.text}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

/** Level 2: a chart card. `featured` marks the one panel per section that carries the main message. */
function Panel({ title, subtitle, children, className = '', action, featured = false }) {
  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-sm ${featured ? 'border-teal-300 ring-1 ring-teal-100' : 'border-slate-200'} ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            {featured && <span className="h-4 w-1 rounded-full bg-teal-600" aria-hidden="true" />}
            {title}
          </h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Empty({ children = 'No data for this view yet.' }) {
  return <div className="flex h-full min-h-32 items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">{children}</div>;
}

function Delta({ delta, polarity }) {
  if (!delta) return <span className="text-[11px] text-slate-400">No baseline yet</span>;
  const { abs, pct } = delta;
  const flat = abs === 0;
  const better = polarity === 'up-good' ? abs > 0 : polarity === 'down-good' ? abs < 0 : null;
  const tone = flat || better === null ? 'bg-slate-100 text-slate-600' : better ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700';
  const Icon = flat ? MinusIcon : abs > 0 ? ArrowUpRightIcon : ArrowDownRightIcon;
  const text = pct !== null && pct !== undefined ? `${abs > 0 ? '+' : ''}${pct.toFixed(0)}%` : `${abs > 0 ? '+' : ''}${abs}`;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>
      <Icon className="size-3" aria-hidden="true" />
      {text}
    </span>
  );
}

function Sparkline({ data, color, id }) {
  if (!data || data.length < 2) return <div className="h-12" />;
  return (
    <div className="h-12">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => l} formatter={(v) => [fmtInt(v), '']} separator="" />
          <Area type="monotone" dataKey="y" stroke={color} strokeWidth={2} fill={`url(#spark-${id})`} dot={false} isAnimationActive={false} />
          <XAxis dataKey="x" hide />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const KPI_COLORS = { portfolio: COLORS.teal, delivered: COLORS.emerald, reports: COLORS.indigo, backlog: COLORS.amber, resolution: COLORS.sky };

function KpiCard({ kpi }) {
  const color = KPI_COLORS[kpi.key] || COLORS.teal;
  const display = kpi.key === 'resolution'
    ? fmtDuration(kpi.value === null ? null : kpi.value)
    : kpi.value === null ? '-' : fmtInt(kpi.value);
  // Data-driven status: only a real, directional change earns a colour.
  const abs = kpi.delta?.abs ?? 0;
  const status = abs === 0 || kpi.polarity === 'neutral' || !kpi.polarity
    ? 'neutral'
    : (kpi.polarity === 'up-good' ? abs > 0 : abs < 0) ? 'good' : 'warn';
  const frame = {
    warn: 'border-amber-300 bg-amber-50/40 ring-1 ring-amber-200',
    good: 'border-emerald-200 bg-white',
    neutral: 'border-slate-200 bg-white',
  }[status];
  const bar = { warn: 'bg-amber-500', good: 'bg-emerald-500', neutral: 'bg-slate-200' }[status];
  return (
    <div className={`relative flex flex-col overflow-hidden rounded-2xl border p-4 pt-5 shadow-sm ${frame}`}>
      <span className={`absolute inset-x-0 top-0 h-1 ${bar}`} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{kpi.label}</p>
        <Delta delta={kpi.delta} polarity={kpi.polarity} />
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
        {display}
        {kpi.key !== 'resolution' && <span className="ml-1.5 text-xs font-medium text-slate-400">{kpi.unit}</span>}
      </p>
      <Sparkline data={kpi.trend} color={color} id={kpi.key} />
      <p className="text-[10px] uppercase tracking-wider text-slate-400">{kpi.trendLabel}</p>
      {kpi.delta?.label && <p className="text-[10px] text-slate-400">{kpi.delta.label}</p>}
      <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] leading-snug text-slate-500">{kpi.foot}</p>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars -- Icon is used as a JSX tag below
function Item({ i, Icon, cls }) {
  return (
    <li className="flex items-start gap-2 text-sm text-slate-700">
      <Icon className={`mt-0.5 size-4 shrink-0 ${cls}`} aria-hidden="true" />
      <span>{i.text}</span>
    </li>
  );
}

function InsightList({ insights }) {
  if (!insights.length) return null;
  const warn = insights.filter((i) => i.tone === 'warn');
  const good = insights.filter((i) => i.tone === 'good');
  const info = insights.filter((i) => i.tone !== 'warn' && i.tone !== 'good');
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <p className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 text-sm font-bold text-slate-900">
        <LightbulbIcon className="size-4 text-amber-500" aria-hidden="true" /> What the numbers say
        <span className="ml-auto text-[11px] font-medium text-slate-400">Generated from the data, most urgent first</span>
      </p>
      {warn.length > 0 && (
        <div className="border-l-4 border-amber-500 bg-amber-50/70 px-5 py-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-amber-700">Needs attention · {warn.length}</p>
          <ul className="grid gap-2.5 md:grid-cols-2">
            {warn.map((i, idx) => <Item key={idx} i={i} Icon={TriangleAlertIcon} cls="text-amber-600" />)}
          </ul>
        </div>
      )}
      {(good.length > 0 || info.length > 0) && (
        <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
          {good.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-emerald-700">Going well</p>
              <ul className="space-y-2">{good.map((i, idx) => <Item key={idx} i={i} Icon={CircleCheckIcon} cls="text-emerald-600" />)}</ul>
            </div>
          )}
          {info.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Good to know</p>
              <ul className="space-y-2">{info.map((i, idx) => <Item key={idx} i={i} Icon={InfoIcon} cls="text-sky-600" />)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BarList({ rows, valueKey = 'count', labelKey = 'label', color = COLORS.teal, suffix = '' }) {
  const max = Math.max(1, ...rows.map((r) => r[valueKey]));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r[labelKey]}>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate font-medium text-slate-700">{r[labelKey]}</span>
            <span className="shrink-0 tabular-nums text-slate-500">{fmtInt(r[valueKey])}{suffix}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full" style={{ width: `${(r[valueKey] / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------- tab --------------------------------- */

export default function AdminAnalyticsTab({ projects, reports, progressUpdates, proposals }) {
  const [period, setPeriod] = useState('all');
  const [now] = useState(() => Date.now()); // fixed at mount; keeps render pure

  const data = useMemo(() => ({ projects, reports, progressUpdates, proposals }), [projects, reports, progressUpdates, proposals]);
  const months = useMemo(() => {
    const chosen = PERIODS.find((p) => p.id === period);
    return chosen?.months ?? monthsSinceFirstRecord(data, now);
  }, [period, data, now]);
  const a = useMemo(() => computeAdminAnalytics(data, { months, now }), [data, months, now]);
  const { infra, reports: rep, review } = a;

  const statusData = [
    { name: 'Completed', value: infra.completed },
    { name: 'On-Going', value: infra.ongoing },
    { name: 'Proposed', value: infra.proposed },
  ].filter((d) => d.value > 0);

  const cohortRows = infra.cohorts
    .filter((c) => c.funded > 0)
    .map((c) => ({ year: String(c.year), Completed: c.completed, 'On-Going': c.ongoing, Proposed: c.proposed, funded: c.funded }));

  const scrollTo = (id) => document.getElementById(`analytics-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const hasReportData = rep.total > 0;

  // One-line, data-driven headline per section (level-1 hierarchy).
  const openKpi = a.kpis.find((k) => k.key === 'backlog');
  const lowestCoverage = infra.coverage.reduce((lo, c) => (lo === null || c.pct < lo.pct ? c : lo), null);
  const takeaways = {
    summary: null,
    delivery: infra.total
      ? { tone: infra.overdue > 0 ? 'warn' : infra.completionRate >= 50 ? 'good' : 'neutral', text: `${infra.completionRate.toFixed(0)}% of roads completed${infra.overdue > 0 ? ` · ${infra.overdue} overdue` : ''}` }
      : null,
    reports: hasReportData
      ? { tone: (openKpi?.value ?? 0) > 0 && (openKpi?.delta?.abs ?? 0) > 0 ? 'warn' : 'neutral', text: `${fmtInt(openKpi?.value ?? 0)} open of ${fmtInt(rep.total)} filed` }
      : null,
    workflow: { tone: review.pendingUpdates > 0 ? 'warn' : 'good', text: review.pendingUpdates > 0 ? `${review.pendingUpdates} update${review.pendingUpdates === 1 ? '' : 's'} awaiting review` : 'Review queue clear' },
    funding: { tone: 'neutral', text: `Partial data · ${infra.budget.projects} of ${fmtInt(infra.total)} projects` },
    coverage: lowestCoverage ? { tone: lowestCoverage.pct < 40 ? 'warn' : 'good', text: `Weakest field: ${lowestCoverage.label} (${lowestCoverage.pct.toFixed(0)}%)` } : null,
  };

  return (
    <div className="space-y-10">
      {/* Header + controls */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="max-w-3xl text-sm text-slate-500">
              Delivery of the FMR program, how citizens and engineers are responding, and how complete the records are. Computed live from the current data.
            </p>
          </div>
          <div role="group" aria-label="Period for monthly charts" className="flex shrink-0 rounded-xl border border-slate-200 bg-white p-0.5 text-xs">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriod(p.id)}
                aria-pressed={period === p.id}
                className={`rounded-lg px-3 py-1.5 font-semibold transition ${period === p.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <nav aria-label="Analytics sections" className="flex flex-wrap gap-1.5">
          {SECTIONS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollTo(s.id)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              <span className="mr-1.5 text-slate-400">{i + 1}</span>{s.label}
            </button>
          ))}
        </nav>
      </div>

      <InsightList insights={a.insights} />

      {/* 1. Summary */}
      <Section id="summary" n="1" title="Summary" takeaway={takeaways.summary} description={`Headline indicators. Sparklines show the trend; the arrow compares with the previous period. Monthly figures cover the last ${months} months.`}>
        <div className="grid grid-cols-1 gap-4 rounded-3xl bg-slate-100/70 p-3 sm:grid-cols-2 xl:grid-cols-5">
          {a.kpis.map((k) => <KpiCard key={k.key} kpi={k} />)}
        </div>
      </Section>

      {/* 2. Infrastructure delivery */}
      <Section id="delivery" n="2" title="Infrastructure delivery" takeaway={takeaways.delivery} description="What has been funded, what has been finished, and where it is. Grouped by funding year because that is the time record the program data keeps.">
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="Project status" subtitle={`${fmtInt(infra.total)} FMR projects in the portfolio`}>
            {statusData.length === 0 ? <Empty /> : (
              <div className="flex items-center gap-4">
                <div className="relative h-44 w-44 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="none">
                        {statusData.map((d) => <Cell key={d.name} fill={STATUS_COLORS[d.name]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-slate-900">{infra.completionRate.toFixed(0)}%</span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">completed</span>
                  </div>
                </div>
                <ul className="flex-1 space-y-2 text-xs">
                  {statusData.map((d) => (
                    <li key={d.name} className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full" style={{ background: STATUS_COLORS[d.name] }} />
                      <span className="flex-1 text-slate-600">{d.name}</span>
                      <span className="font-semibold tabular-nums text-slate-900">{fmtInt(d.value)}</span>
                    </li>
                  ))}
                  <li className="border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                    {fmtInt(infra.kmCompleted)} of {fmtInt(infra.kmTotal)} km built
                    {infra.overdue > 0 && <> · <span className="font-semibold text-rose-600">{infra.overdue} past target date</span></>}
                  </li>
                </ul>
              </div>
            )}
          </Panel>

          <Panel featured className="xl:col-span-2" title="Funded and completed per year" subtitle="Bars: projects funded in the year. Line: roads finished in the year (by completion date).">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={infra.delivery} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="year" tick={axis} />
                  <YAxis tick={axis} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="funded" name="Funded" fill={COLORS.slate} radius={[6, 6, 0, 0]} />
                  <Line dataKey="completed" name="Completed" stroke={COLORS.teal} strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel className="xl:col-span-2" title="Where each funding year stands" subtitle="Share of each year's projects that are completed, on-going or still proposed. A year stuck at 0% completed is a delivery backlog.">
            {cohortRows.length === 0 ? <Empty /> : (
              <div style={{ height: Math.max(180, cohortRows.length * 34 + 40) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cohortRows} layout="vertical" stackOffset="expand" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={axis} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                    <YAxis type="category" dataKey="year" tick={axis} width={42} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [fmtInt(v), name]} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Completed" stackId="s" fill={STATUS_COLORS.Completed} />
                    <Bar dataKey="On-Going" stackId="s" fill={STATUS_COLORS['On-Going']} />
                    <Bar dataKey="Proposed" stackId="s" fill={STATUS_COLORS.Proposed} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <Panel title="By municipality" subtitle="Projects (bar) and road length, top 8">
            {infra.byMunicipality.length === 0 ? <Empty /> : (
              <BarList
                rows={infra.byMunicipality.slice(0, 8).map((m) => ({ label: `${m.municipality} · ${fmtInt(m.km)} km`, count: m.count }))}
                color={COLORS.teal}
              />
            )}
          </Panel>
        </div>
      </Section>

      {/* 3. Citizen reports */}
      <Section id="reports" n="3" title="Citizen reports and responsiveness" takeaway={takeaways.reports} description="How many problems are being reported, how many are still open, and how quickly they are resolved.">
        {!hasReportData ? <Empty>No citizen reports yet.</Empty> : (
          <div className="grid gap-4 xl:grid-cols-3">
            <Panel featured className="xl:col-span-2" title="Filed and resolved per month" subtitle="Bars: reports filed. Line: reports resolved that month.">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rep.series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="label" tick={axis} />
                    <YAxis tick={axis} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="filed" name="Filed" fill={COLORS.indigo} radius={[6, 6, 0, 0]} />
                    <Line dataKey="resolved" name="Resolved" stroke={COLORS.emerald} strokeWidth={2.5} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Open reports over time" subtitle="Still unresolved at each month end. Rising means reports arrive faster than they are closed.">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={rep.series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="openGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS.amber} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={COLORS.amber} stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="label" tick={axis} />
                    <YAxis tick={axis} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Area type="monotone" dataKey="open" name="Open" stroke={COLORS.amber} strokeWidth={2.5} fill="url(#openGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="What is being reported" subtitle="By issue type">
              {rep.categories.length === 0 ? <Empty /> : <BarList rows={rep.categories} color={COLORS.indigo} />}
            </Panel>

            <Panel
              title="Time to resolve"
              subtitle={rep.resolvedTotal ? `${rep.resolvedTotal} resolved reports with a recorded resolution time` : 'No resolution times recorded yet'}
              action={rep.withinTwoWeeks !== null ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{rep.withinTwoWeeks.toFixed(0)}% within 14 d</span>
              ) : null}
            >
              {rep.resolvedTotal === 0 ? <Empty /> : (
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rep.buckets} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="label" tick={{ ...axis, fontSize: 10 }} interval={0} />
                      <YAxis tick={axis} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="count" name="Reports" fill={COLORS.sky} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>

            <Panel title="Where reports are still open" subtitle="Top 5 locations">
              {rep.hotspots.length === 0 ? <Empty>Nothing open.</Empty> : (
                <BarList rows={rep.hotspots.map((h) => ({ label: h.place, count: h.count }))} color={COLORS.amber} />
              )}
            </Panel>
          </div>
        )}
      </Section>

      {/* 4. Review workflow */}
      <Section id="workflow" n="4" title="Review workflow" takeaway={takeaways.workflow} description="How fast the review queues move: contractor progress updates and LGU road proposals.">
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel
            featured
            className="xl:col-span-2"
            title="Progress updates"
            subtitle="Bars: submitted. Line: reviewed that month."
            action={(
              <span className="text-[11px] text-slate-500">
                Median review {fmtDuration(review.updateMedianDays)}
                {review.pendingUpdates > 0 && <span className="ml-2 font-semibold text-amber-600">{review.pendingUpdates} waiting</span>}
              </span>
            )}
          >
            {review.updatesTotal === 0 ? <Empty>No progress updates yet.</Empty> : (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={review.updateSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="label" tick={axis} />
                    <YAxis tick={axis} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="submitted" name="Submitted" fill={COLORS.slate} radius={[6, 6, 0, 0]} />
                    <Line dataKey="reviewed" name="Reviewed" stroke={COLORS.teal} strokeWidth={2.5} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <Panel
            title="LGU road proposals"
            subtitle={review.proposalsTotal ? `${review.proposalsTotal} submitted` : 'No proposals yet'}
            action={review.approvalRate !== null ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{review.approvalRate.toFixed(0)}% approved</span>
            ) : null}
          >
            {review.proposalsTotal === 0 ? <Empty /> : (
              <div className="space-y-4">
                <BarList rows={review.funnel.map((f) => ({ label: f.status, count: f.count }))} color={COLORS.teal} />
                <div className="h-28">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={review.proposalSeries} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                      <XAxis dataKey="label" tick={{ ...axis, fontSize: 10 }} />
                      <YAxis tick={axis} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="submitted" name="Submitted" fill={COLORS.slate} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[11px] text-slate-500">Median decision time {fmtDuration(review.proposalMedianDays)}</p>
              </div>
            )}
          </Panel>
        </div>
      </Section>

      {/* 5. Funding */}
      <Section id="funding" n="5" title="Funding" takeaway={takeaways.funding} description="Budget and releases, for the projects that record a budget. Most older roads have no budget on file, so this is not the whole program.">
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel featured title="Release rate" subtitle={`${infra.budget.projects} project${infra.budget.projects === 1 ? '' : 's'} with a recorded budget`}>
            {infra.budget.projects === 0 ? <Empty>No budgets recorded.</Empty> : (
              <div className="space-y-4">
                <div>
                  <p className="text-3xl font-bold tracking-tight text-slate-900">{infra.budget.rate === null ? '-' : `${infra.budget.rate.toFixed(0)}%`}</p>
                  <p className="text-xs text-slate-500">of allocated funds released</p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.min(100, infra.budget.rate || 0)}%` }} />
                </div>
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div><dt className="text-slate-400">Allocated</dt><dd className="mt-0.5 font-semibold text-slate-900">{fmtPeso(infra.budget.allocated)}</dd></div>
                  <div><dt className="text-slate-400">Released</dt><dd className="mt-0.5 font-semibold text-slate-900">{fmtPeso(infra.budget.released)}</dd></div>
                </dl>
              </div>
            )}
          </Panel>

          <Panel className="xl:col-span-2" title="Budget and releases by project" subtitle="Largest allocations first">
            {infra.budgetByProject.length === 0 ? <Empty /> : (
              <div style={{ height: Math.max(180, infra.budgetByProject.length * 34 + 40) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={infra.budgetByProject} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={axis} tickFormatter={(v) => `₱${(v / 1_000_000).toFixed(0)}M`} />
                    <YAxis type="category" dataKey="name" tick={{ ...axis, fontSize: 10 }} width={150} tickFormatter={(v) => (v.length > 24 ? `${v.slice(0, 23)}…` : v)} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtPeso(v)} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="allocated" name="Allocated" fill={COLORS.slate} radius={[0, 4, 4, 0]} />
                    <Bar dataKey="released" name="Released" fill={COLORS.teal} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
        </div>
      </Section>

      {/* 6. Data coverage */}
      <Section id="coverage" n="6" title="Data coverage" takeaway={takeaways.coverage} description="How much of each record is filled in. Every figure above depends on these fields, so low coverage is a limit on what the analysis can claim.">
        <Panel
          title="Completeness of project records"
          subtitle={`${fmtInt(infra.total)} projects`}
          action={<DatabaseIcon className="size-4 text-slate-300" aria-hidden="true" />}
        >
          <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
            {infra.coverage.map((c) => {
              const tone = c.pct >= 80 ? COLORS.emerald : c.pct >= 40 ? COLORS.amber : COLORS.rose;
              return (
                <li key={c.key}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-medium text-slate-700">{c.label}</span>
                    <span className="tabular-nums text-slate-500">{fmtInt(c.n)} of {fmtInt(c.of)} · {c.pct.toFixed(0)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: tone }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      </Section>
    </div>
  );
}
