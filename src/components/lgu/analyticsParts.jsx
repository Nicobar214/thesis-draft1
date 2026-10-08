import { useId } from 'react';
import { CircleAlertIcon } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, Tooltip } from 'recharts';

const SPARK_COLOR = '#0d9488';

/** A small axis-free trend line. Renders nothing for fewer than 2 points. */
export function Sparkline({ data, height = 48, format = (v) => v }) {
  const gradientId = useId().replace(/:/g, '');
  if (!data || data.length < 2) return null;
  return (
    <div style={{ height }} className="w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SPARK_COLOR} stopOpacity={0.22} />
              <stop offset="100%" stopColor={SPARK_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            cursor={{ stroke: '#cbd5e1' }}
            contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 11, padding: '4px 8px' }}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.label}
            formatter={(v) => [format(v), '']}
            separator=""
          />
          <Area type="monotone" dataKey="value" stroke={SPARK_COLOR} strokeWidth={1.75} fill={`url(#${gradientId})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendCaption({ data, caption }) {
  if (!data || data.length < 2) {
    return <p className="text-[11px] text-slate-400">Not enough history for a trend yet</p>;
  }
  return <p className="text-[11px] text-slate-500">{caption} · {data[0].label} – {data[data.length - 1].label}</p>;
}

/** Headline metric: largest type, room for a trend or progress visual. */
export function PrimaryKpi({ icon, label, value, hint, unavailable = false, children }) {
  const Icon = icon;
  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {unavailable ? <span className="text-lg font-medium text-slate-400">Unavailable</span> : value}
      </p>
      {hint && <p className="mt-1.5 text-xs leading-snug text-slate-500">{hint}</p>}
      {!unavailable && children && <div className="mt-auto space-y-1.5 pt-4">{children}</div>}
    </div>
  );
}

/** Supporting metric: compact, value and sparkline side by side. */
export function SecondaryKpi({ icon, label, value, hint, trend, trendFormat, trendCaption, unavailable = false }) {
  const Icon = icon;
  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
        <p className="text-xs font-medium text-slate-500">{label}</p>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xl font-semibold tracking-tight text-slate-900 tabular-nums">
            {unavailable ? <span className="text-sm font-medium text-slate-400">Unavailable</span> : value}
          </p>
          {hint && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{hint}</p>}
        </div>
        {!unavailable && (
          <div className="w-28 shrink-0">
            <Sparkline data={trend} height={36} format={trendFormat} />
          </div>
        )}
      </div>
      {!unavailable && <div className="mt-1.5"><TrendCaption data={trend} caption={trendCaption} /></div>}
    </div>
  );
}

export function SectionHeading({ title, subtitle }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
    </div>
  );
}

export function Panel({ title, subtitle, action, children, className = '' }) {
  return (
    <div className={`flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function KpiCard({ icon, label, value, hint, unavailable = false }) {
  const Icon = icon;
  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {unavailable ? <span className="text-base font-medium text-slate-400">Unavailable</span> : value}
      </p>
      {hint && <p className="mt-1 text-xs leading-snug text-slate-500">{hint}</p>}
    </div>
  );
}

export function EmptyState({ children }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center rounded-xl border border-dashed border-slate-200 px-4 text-center text-xs text-slate-500">
      {children}
    </div>
  );
}

export function UnavailableState({ children = 'This data could not be loaded.' }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center gap-2 rounded-xl border border-dashed border-rose-200 bg-rose-50/40 px-4 text-center text-xs text-rose-700">
      <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
      {children}
    </div>
  );
}

export function AnalyticsSkeleton() {
  const block = 'animate-pulse rounded-2xl border border-slate-200 bg-white';
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading analytics">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12">
        {[0, 1].map((i) => (
          <div key={i} className={`${block} h-56 p-5 xl:col-span-4`}>
            <div className="h-3 w-32 rounded bg-slate-100" />
            <div className="mt-5 h-9 w-24 rounded bg-slate-100" />
          </div>
        ))}
        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
          {[0, 1].map((i) => <div key={i} className={`${block} h-[6.6rem]`} />)}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className={`${block} h-72`} />
        <div className={`${block} h-72`} />
      </div>
      <div className={`${block} h-64`} />
    </div>
  );
}
