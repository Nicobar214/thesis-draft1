/* BeneficiaryAnalytics.jsx — charts and insights on the admin Farmer
 * Beneficiaries page. Presentational only: every number comes from the
 * `analytics` summary (lib/beneficiaryAnalytics.js), already filtered.
 *
 * Layout:  Commodities  | Location (barangay or municipality)
 *          Road access  | Farmers by sex
 *          Registration trend (2/3) | Insights (1/3)
 */
import { useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { LightbulbIcon, CircleAlertIcon, CircleCheckIcon } from 'lucide-react';
import { NOT_RECORDED, formatPct, summarizeBeneficiaries, groupCommodities } from '../../lib/beneficiaryAnalytics';
import { getMunicipalities } from '../../data/iloiloLocations';

// Fixed by rank, so a commodity keeps the same color in the donut and legend.
const CROP_COLORS = ['#0f766e', '#d97706', '#0284c7', '#7c3aed', '#65a30d', '#db2777'];
const GROUPED_COLOR = '#94a3b8';
const MISSING_COLOR = '#cbd5e1';
const colorFor = (entry, index) => (entry.name === NOT_RECORDED ? MISSING_COLOR : entry.grouped ? GROUPED_COLOR : CROP_COLORS[index % CROP_COLORS.length]);

const card = 'rounded-2xl border border-slate-200/60 bg-white p-5 sm:p-6 shadow-xs';

function CardHeader({ title, description, right }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {right}
    </div>
  );
}

/** Label · count · share, with a bar. Used by every ranked list on the page. */
function ShareRow({ color = '#0f766e', name, count, share, max, rank, muted, highlight }) {
  const width = max ? (count / max) * 100 : share * 100;
  return (
    <li className={`${rank ? 'grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-3' : ''} ${highlight ? '-mx-2 rounded-lg bg-teal-50 px-2 py-1.5' : ''}`}>
      {rank && <span className={`text-sm font-semibold tabular-nums ${highlight ? 'text-teal-700' : 'text-slate-400'}`}>{rank}</span>}
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            {!rank && <span className="size-2.5 shrink-0 rounded-sm" style={{ background: color }} aria-hidden="true" />}
            <span className={`truncate ${highlight ? 'font-semibold text-teal-800' : muted || name === NOT_RECORDED ? 'text-slate-500' : 'text-slate-700'}`} title={name}>{name}</span>
          </span>
          <span className="shrink-0 text-slate-500 tabular-nums">
            <span className="font-semibold text-slate-900">{count.toLocaleString()}</span>
            <span className="inline-block w-14 text-right">{formatPct(share)}</span>
          </span>
        </div>
        <div className={`mt-1 overflow-hidden rounded-full bg-slate-100 ${rank ? 'h-2' : 'h-1.5'}`}>
          <div className="h-full rounded-full" style={{ width: `${width}%`, background: name === NOT_RECORDED ? MISSING_COLOR : color }} />
        </div>
      </div>
    </li>
  );
}

function CommodityCard({ analytics, groups }) {
  const [showAll, setShowAll] = useState(false);
  const hasTail = groups.some((g) => g.grouped);
  const rows = showAll
    ? groups.flatMap((g, i) => (g.grouped ? g.grouped.map((r) => ({ ...r, color: GROUPED_COLOR, muted: true })) : [{ ...g, color: colorFor(g, i) }]))
    : groups.map((g, i) => ({ ...g, color: colorFor(g, i) }));

  return (
    <section className={card} aria-label="Commodity distribution">
      <CardHeader title="Commodities" description={`${analytics.commodityTypes} recorded · one main commodity per farmer`} />
      <div className="mt-5 grid items-center gap-6 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="relative mx-auto size-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={groups} dataKey="count" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={1.5} stroke="none" isAnimationActive={false}>
                {groups.map((entry, index) => <Cell key={entry.name} fill={colorFor(entry, index)} />)}
              </Pie>
              <RechartsTooltip formatter={(value, name, item) => [`${Number(value).toLocaleString()} farmers · ${formatPct(item.payload.share)}`, name]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-slate-900 tabular-nums">{analytics.total.toLocaleString()}</span>
            <span className="text-xs text-slate-500">farmers</span>
          </div>
        </div>
        <div className="min-w-0">
          <ul className={`space-y-2.5 ${showAll ? 'max-h-72 overflow-y-auto pr-1' : ''}`}>
            {rows.map((row) => <ShareRow key={row.name} {...row} />)}
          </ul>
          {hasTail && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-sm font-medium text-teal-700 hover:text-teal-800 hover:underline">
              {showAll ? 'Show fewer' : `Show all ${analytics.commodityTypes}`}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

const LIMITS = [{ key: 5, label: 'Top 5' }, { key: 10, label: 'Top 10' }, { key: 0, label: 'All' }];

/** Barangays when the view is one municipality (the pilot case), else municipalities. */
/** A selected barangay, placed among all barangays of the whole registry. */
function BarangayContextCard({ name, overall }) {
  const all = overall.barangays.filter((b) => b.name !== NOT_RECORDED);
  const selected = all.find((b) => b.name === name);
  const rankOf = (b) => 1 + all.filter((x) => x.count > b.count).length; // ties share a rank
  const top = all.slice(0, 5);
  const rows = selected && !top.includes(selected) ? [...top, null, selected] : top;
  const max = all[0]?.count || 1;

  return (
    <section className={card} aria-label={`Brgy. ${name} in context`}>
      <CardHeader
        title={`Brgy. ${name} in Context`}
        description={selected
          ? `${selected.count.toLocaleString()} of ${overall.total.toLocaleString()} farmers · ranked #${rankOf(selected)} of ${all.length} barangays`
          : 'No farmers recorded in this barangay'}
      />
      <ol className="mt-5 space-y-3">
        {rows.map((row) => (row === null ? (
          <li key="gap" className="pl-11 text-xs text-slate-400">…</li>
        ) : (
          <ShareRow key={row.name} name={row.name} count={row.count} share={row.share} max={max} rank={`#${rankOf(row)}`} highlight={row.name === name} />
        )))}
      </ol>
      <p className="mt-4 text-xs text-slate-500">
        Barangays average {(overall.total / (all.length || 1)).toFixed(1)} farmers each.
      </p>
    </section>
  );
}

function LocationCard({ analytics, overall, selectedBarangay }) {
  const [limit, setLimit] = useState(5);
  if (selectedBarangay && overall) return <BarangayContextCard name={selectedBarangay} overall={overall} />;
  const singleMunicipality = analytics.coverage.withFarmers <= 1;
  const list = singleMunicipality ? analytics.barangays : analytics.municipalities;
  const shown = limit ? list.slice(0, limit) : list;
  const max = list[0]?.count || 1;
  const town = analytics.municipalities.find((m) => m.name !== NOT_RECORDED)?.name;
  const recorded = list.filter((r) => r.name !== NOT_RECORDED).length;

  return (
    <section className={card} aria-label={singleMunicipality ? 'Farmers per barangay' : 'Farmers per municipality'}>
      <CardHeader
        title={singleMunicipality ? 'Farmers per Barangay' : 'Farmers per Municipality'}
        description={singleMunicipality
          ? `${town ? `${town} · ` : ''}${recorded} barangay${recorded === 1 ? '' : 's'} with farmers`
          : `${recorded} of ${analytics.coverage.masterTotal || recorded} municipalities with farmers`}
        right={list.length > 5 && (
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="How many to show">
            {LIMITS.filter((l) => l.key === 0 || l.key === 5 || l.key < list.length).map((l) => (
              <button
                key={l.label}
                type="button"
                onClick={() => setLimit(l.key)}
                aria-pressed={limit === l.key}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${limit === l.key ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
      />
      <ol className={`mt-5 space-y-3 ${limit === 0 && list.length > 10 ? 'max-h-80 overflow-y-auto pr-1' : ''}`}>
        {shown.map((row, index) => <ShareRow key={row.name} {...row} rank={index + 1} max={max} />)}
      </ol>
    </section>
  );
}

function RoadAccessCard({ analytics }) {
  const { roadAccess, total } = analytics;
  const linkedShare = total ? roadAccess.linked / total : 0;
  const maxBand = Math.max(1, ...roadAccess.bands.map((b) => b.count));

  return (
    <section className={card} aria-label="Road access">
      <CardHeader title="Road Access" description="Linked FMR project and distance to it (approx.)" />
      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-slate-600">
            <span className="text-2xl font-bold text-slate-900 tabular-nums">{roadAccess.linked.toLocaleString()}</span>
            {' '}linked to an FMR project
          </p>
          <span className="text-sm font-semibold text-teal-700 tabular-nums">{formatPct(linkedShare)}</span>
        </div>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
          <div className="h-full bg-teal-600" style={{ width: `${linkedShare * 100}%` }} />
          <div className="h-full bg-amber-400" style={{ width: `${(1 - linkedShare) * 100}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-teal-600" />Linked {roadAccess.linked.toLocaleString()}</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-400" />Not linked {roadAccess.unlinked.toLocaleString()}</span>
        </div>
      </div>
      <ul className="mt-5 space-y-2.5 border-t border-slate-100 pt-4">
        {roadAccess.bands.map((band) => (
          <ShareRow key={band.key} name={band.label} count={band.count} share={band.share} max={maxBand} color="#0284c7" />
        ))}
        {roadAccess.distanceMissing > 0 && (
          <ShareRow name={NOT_RECORDED} count={roadAccess.distanceMissing} share={roadAccess.distanceMissing / (total || 1)} max={maxBand} />
        )}
      </ul>
    </section>
  );
}

function SexCard({ analytics }) {
  const { sex, total } = analytics;
  const rows = [
    { name: 'Female', count: sex.Female, color: '#db2777' },
    { name: 'Male', count: sex.Male, color: '#0284c7' },
    ...(sex[NOT_RECORDED] ? [{ name: NOT_RECORDED, count: sex[NOT_RECORDED], color: MISSING_COLOR }] : []),
  ].map((r) => ({ ...r, share: total ? r.count / total : 0 }));

  return (
    <section className={card} aria-label="Farmers by sex">
      <CardHeader title="Farmers by Sex" description="For gender-disaggregated reporting" />
      <div className="mt-5 grid grid-cols-2 gap-3">
        {rows.filter((r) => r.name !== NOT_RECORDED).map((r) => (
          <div key={r.name} className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="flex items-center gap-1.5 text-sm text-slate-600">
              <span className="size-2 rounded-full" style={{ background: r.color }} aria-hidden="true" />
              {r.name}
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{r.count.toLocaleString()}</p>
            <p className="text-xs text-slate-500 tabular-nums">{formatPct(r.share)}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        {rows.map((r) => <div key={r.name} className="h-full" style={{ width: `${r.share * 100}%`, background: r.color }} />)}
      </div>
      {sex[NOT_RECORDED] > 0 && (
        <p className="mt-2 text-xs text-slate-500">{sex[NOT_RECORDED].toLocaleString()} not recorded</p>
      )}
    </section>
  );
}

function TrendCard({ analytics }) {
  const multiYear = analytics.years.length > 1;
  const singleYear = analytics.years.length === 1 ? analytics.years[0] : null;
  const data = multiYear
    ? analytics.years.map((y) => ({ label: String(y.year), registered: y.registered, cumulative: y.cumulative }))
    : analytics.months.map((m) => ({ label: m.short, full: m.label, registered: m.registered, cumulative: m.cumulative }));
  const showChart = data.length > 1;

  return (
    <section className={`${card} lg:col-span-2`} aria-label="Registrations">
      <CardHeader
        title="Registrations"
        description={multiYear ? 'New farmers per year' : singleYear ? `By month · ${singleYear.year} only so far` : null}
        right={showChart && (
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-teal-700" aria-hidden="true" />New</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-slate-500" aria-hidden="true" />Running total</span>
          </div>
        )}
      />
      {data.length === 0 ? (
        <p className="mt-6 rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No registration dates recorded.</p>
      ) : !showChart ? (
        <div className="mt-5 flex items-baseline gap-3 rounded-xl bg-slate-50 px-5 py-4">
          <span className="text-3xl font-bold text-slate-900 tabular-nums">{data[0].registered.toLocaleString()}</span>
          <span className="text-sm text-slate-500">registered in {data[0].full || data[0].label}</span>
        </div>
      ) : (
        <div className="mt-4 h-60">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="new" tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
              <YAxis yAxisId="total" orientation="right" tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
              <RechartsTooltip
                labelFormatter={(label, items) => items?.[0]?.payload?.full || label}
                formatter={(value, name) => [Number(value).toLocaleString(), name === 'cumulative' ? 'Running total' : 'New']}
              />
              <Bar yAxisId="new" dataKey="registered" fill="#0f766e" radius={[5, 5, 0, 0]} maxBarSize={48} isAnimationActive={false} />
              <Line yAxisId="total" type="monotone" dataKey="cumulative" stroke="#64748b" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

/** Short statements read straight from the summary; nothing appears without data behind it. */
function buildInsights(a) {
  const out = [];
  if (a.leadingCommodity && a.leadingCommodity.names.length <= 2) {
    const { names, count, share } = a.leadingCommodity;
    out.push({ key: 'crop', text: <><strong>{names.join(' and ')}</strong>: main commodity of {count.toLocaleString()} farmer{count === 1 ? '' : 's'}{names.length > 1 ? ' each' : ''} ({formatPct(share)})</> });
  }
  const singleMunicipality = a.coverage.withFarmers <= 1;
  const topPlace = (singleMunicipality ? a.barangays : a.municipalities).find((m) => m.name !== NOT_RECORDED);
  const placesInView = (singleMunicipality ? a.barangays : a.municipalities).filter((m) => m.name !== NOT_RECORDED).length;
  if (topPlace && placesInView > 1) {
    out.push({ key: 'place', text: <><strong>{singleMunicipality ? `Brgy. ${topPlace.name}` : topPlace.name}</strong> has the most farmers: {topPlace.count.toLocaleString()} ({formatPct(topPlace.share)})</> });
  }
  if (a.roadAccess.unlinked > 0) {
    out.push({ key: 'road', text: <><strong>{a.roadAccess.unlinked.toLocaleString()} farmer{a.roadAccess.unlinked === 1 ? '' : 's'}</strong> {a.roadAccess.unlinked === 1 ? 'is' : 'are'} not linked to any FMR project</> });
  }
  if (a.yearOverYear) {
    const { from, to, change } = a.yearOverYear;
    out.push({ key: 'yoy', text: <>New registrations {change >= 0 ? 'up' : 'down'} <strong>{formatPct(Math.abs(change))}</strong> from {from} to {to}</> });
  }
  return out;
}

function InsightsCard({ analytics }) {
  const insights = buildInsights(analytics);
  const { missing } = analytics;
  const quality = [
    missing.crop && `${missing.crop.toLocaleString()} without a commodity`,
    missing.municipality && `${missing.municipality.toLocaleString()} without a municipality`,
    missing.area && `${missing.area.toLocaleString()} without a farm area`,
    missing.date && `${missing.date.toLocaleString()} without a registration date`,
  ].filter(Boolean);

  return (
    <section className={card} aria-label="Insights">
      <CardHeader title="Insights" />
      <ul className="mt-4 space-y-3">
        {insights.map((item) => (
          <li key={item.key} className="flex gap-2.5 text-sm leading-6 text-slate-600 [&_strong]:font-semibold [&_strong]:text-slate-900">
            <LightbulbIcon className="mt-1 size-4 shrink-0 text-amber-500" aria-hidden="true" />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 flex gap-2 border-t border-slate-100 pt-4 text-sm text-slate-600">
        {quality.length ? (
          <>
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
            <span>Missing data: {quality.join(', ')}</span>
          </>
        ) : (
          <>
            <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
            <span>No missing data</span>
          </>
        )}
      </p>
    </section>
  );
}

export default function BeneficiaryAnalytics({ analytics, commodityGroups, loading, isFiltered, onClearFilters, overall, selectedBarangay }) {
  if (loading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2" aria-busy="true">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-72 animate-pulse rounded-2xl border border-slate-200/60 bg-white" />)}
      </div>
    );
  }

  if (analytics.total === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
        <p className="text-sm font-semibold text-slate-900">{isFiltered ? 'No farmers match these filters' : 'No farmers registered yet'}</p>
        {isFiltered && (
          <button type="button" onClick={onClearFilters} className="mt-4 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Clear filters</button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <CommodityCard analytics={analytics} groups={commodityGroups} />
        <LocationCard analytics={analytics} overall={overall} selectedBarangay={selectedBarangay} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <RoadAccessCard analytics={analytics} />
        <SexCard analytics={analytics} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <TrendCard analytics={analytics} />
        <InsightsCard analytics={analytics} />
      </div>
    </div>
  );
}

/**
 * The four key cards (commodities, location, road access, sex) for any list of
 * normalized beneficiary rows. Used by the LGU portal, so both portals compute
 * them the same way.
 */
export function BeneficiaryKeyCards({ beneficiaries, loading = false }) {
  const analytics = useMemo(
    () => summarizeBeneficiaries(beneficiaries, { municipalityMaster: getMunicipalities() }),
    [beneficiaries],
  );
  const groups = useMemo(() => groupCommodities(analytics.commodities, 6), [analytics.commodities]);

  if (loading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2" aria-busy="true">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-72 animate-pulse rounded-2xl border border-slate-200/60 bg-white" />)}
      </div>
    );
  }
  if (analytics.total === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
        No registered farmers yet. Analytics appear once farmers are registered.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <CommodityCard analytics={analytics} groups={groups} />
        <LocationCard analytics={analytics} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <RoadAccessCard analytics={analytics} />
        <SexCard analytics={analytics} />
      </div>
    </div>
  );
}
