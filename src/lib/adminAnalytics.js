import { normalizeRouteStatus } from './mapRouteUtils';
import { resolveCategory, SEVERITY_TAXONOMY } from './publicReportStatus';

/*
 * Admin analytics, computed from the records the dashboard already holds.
 *
 * Two clocks, because the data has two kinds of history:
 *   - Infrastructure (fmr_projects): only the funding year and, for most completed
 *     roads, a completion date. Historic target dates are mostly blank, so there is
 *     deliberately NO "planned vs actual schedule" here; it would be invented.
 *   - Operations (public reports, progress updates, proposals): real timestamps, so
 *     these get monthly series, rolling backlog and turnaround times.
 *
 * Everything is derived on the spot and nothing is estimated: when a figure cannot be
 * computed from the records, it is null and the UI says so.
 */

const DAY = 86400000;

/** Accepts ISO strings and "September 9, 2017"; returns epoch ms or null. */
export function parseDate(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const t = Date.parse(text);
  return Number.isFinite(t) ? t : null;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function median(values) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

const monthKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** The last n calendar months, oldest first, each with its start and end (ms). */
function monthRange(n, now) {
  const end = new Date(now);
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const start = new Date(end.getFullYear(), end.getMonth() - i, 1).getTime();
    const next = new Date(end.getFullYear(), end.getMonth() - i + 1, 1).getTime();
    out.push({ key: monthKey(start), start, end: Math.min(next - 1, now) });
  }
  return out;
}

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

/** Total of the last `period` values versus the `period` before; null if no baseline. */
function periodDelta(series, period) {
  if (series.length < period * 2) return null;
  const cur = series.slice(-period).reduce((a, b) => a + b, 0);
  const prev = series.slice(-period * 2, -period).reduce((a, b) => a + b, 0);
  return { cur, prev, abs: cur - prev, pct: prev > 0 ? ((cur - prev) / prev) * 100 : null };
}

const countBy = (items, keyFn) => {
  const out = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (k === null || k === undefined || k === '') continue;
    out.set(k, (out.get(k) || 0) + 1);
  }
  return out;
};

/* --------------------------- infrastructure --------------------------- */

function projectStats(projects, now) {
  const rows = (projects || []).map((p) => ({
    p,
    status: normalizeRouteStatus(p.status),
    year: Number.isFinite(Number(p.year_funded)) && Number(p.year_funded) > 1900 ? Number(p.year_funded) : null,
    km: num(p.project_length_km),
    done: parseDate(p.date_completed),
    target: parseDate(p.target_completion_date),
  }));

  const completed = rows.filter((r) => r.status === 'Completed');
  const ongoing = rows.filter((r) => r.status === 'On-Going');
  const proposed = rows.filter((r) => r.status === 'Proposed');
  const thisYear = new Date(now).getFullYear();

  // Funding-year cohorts: how many were funded each year, and where they stand now.
  const years = [];
  for (let y = thisYear - 9; y <= thisYear + 1; y += 1) years.push(y);
  const cohorts = years.map((year) => {
    const inYear = rows.filter((r) => r.year === year);
    const c = inYear.filter((r) => r.status === 'Completed').length;
    const o = inYear.filter((r) => r.status === 'On-Going').length;
    const pr = inYear.filter((r) => r.status === 'Proposed').length;
    return { year, funded: inYear.length, completed: c, ongoing: o, proposed: pr, km: inYear.reduce((s, r) => s + r.km, 0) };
  });

  // Completions by the year they were actually finished (parsed completion date).
  const doneByYear = new Map();
  const kmByYear = new Map();
  for (const r of completed) {
    if (!r.done) continue;
    const y = new Date(r.done).getFullYear();
    doneByYear.set(y, (doneByYear.get(y) || 0) + 1);
    kmByYear.set(y, (kmByYear.get(y) || 0) + r.km);
  }
  const delivery = years.filter((y) => y <= thisYear).map((year) => ({
    year,
    funded: cohorts.find((c) => c.year === year)?.funded || 0,
    completed: doneByYear.get(year) || 0,
    km: Number((kmByYear.get(year) || 0).toFixed(1)),
  }));

  const cycle = median(completed
    .filter((r) => r.done && r.year)
    .map((r) => new Date(r.done).getFullYear() - r.year)
    .filter((y) => y >= 0 && y <= 15));

  const byMunicipality = [...countBy(rows, (r) => r.p.municipality || 'Unspecified')]
    .map(([municipality, count]) => ({
      municipality,
      count,
      completed: rows.filter((r) => (r.p.municipality || 'Unspecified') === municipality && r.status === 'Completed').length,
      km: Number(rows.filter((r) => (r.p.municipality || 'Unspecified') === municipality).reduce((s, r) => s + r.km, 0).toFixed(1)),
    }))
    .sort((a, b) => b.count - a.count);

  const overdue = rows.filter((r) => r.status !== 'Completed' && r.target && r.target < now);

  // Money: only projects that carry a budget are analysable.
  const tracked = rows.filter((r) => num(r.p.total_budget) > 0);
  const budget = tracked.reduce((s, r) => s + num(r.p.total_budget), 0);
  const released = tracked.reduce((s, r) => s + num(r.p.funds_released), 0);

  const total = rows.length;
  const pct = (n) => (total ? (n / total) * 100 : 0);
  const coverage = [
    { key: 'coords', label: 'Mapped start point', n: rows.filter((r) => r.p.start_latitude !== null && r.p.start_latitude !== undefined && r.p.start_latitude !== '').length },
    { key: 'year', label: 'Funding year', n: rows.filter((r) => r.year).length },
    { key: 'barangay', label: 'Barangay', n: rows.filter((r) => String(r.p.barangay || '').trim()).length },
    { key: 'done', label: 'Completion date (completed roads)', n: completed.filter((r) => r.done).length, of: completed.length },
    { key: 'target', label: 'Target completion date', n: rows.filter((r) => r.target).length },
    { key: 'contractor', label: 'Contractor assigned', n: rows.filter((r) => r.p.contractor_id).length },
    { key: 'budget', label: 'Budget', n: tracked.length },
  ].map((c) => ({ ...c, of: c.of ?? total, pct: (c.of ?? total) ? (c.n / (c.of ?? total)) * 100 : 0 }));

  return {
    total,
    completed: completed.length,
    ongoing: ongoing.length,
    proposed: proposed.length,
    other: total - completed.length - ongoing.length - proposed.length,
    completionRate: total ? pct(completed.length) : 0,
    kmCompleted: Number(completed.reduce((s, r) => s + r.km, 0).toFixed(1)),
    kmTotal: Number(rows.reduce((s, r) => s + r.km, 0).toFixed(1)),
    cohorts,
    delivery,
    cycleYears: cycle,
    byMunicipality,
    overdue: overdue.length,
    budget: { projects: tracked.length, allocated: budget, released, rate: budget > 0 ? (released / budget) * 100 : null },
    budgetByProject: tracked
      .map((r) => ({ name: r.p.project_name, allocated: num(r.p.total_budget), released: num(r.p.funds_released) }))
      .sort((a, b) => b.allocated - a.allocated)
      .slice(0, 8),
    coverage,
    thisYear,
  };
}

/* ------------------------------ operations ------------------------------ */

function reportStats(reports, months, now) {
  const rows = (reports || []).map((r) => ({
    r,
    created: parseDate(r.created_at),
    resolved: parseDate(r.resolved_at),
    dismissed: parseDate(r.dismissed_at),
  })).filter((x) => x.created);

  const range = monthRange(months, now);
  const series = range.map((m) => {
    const filed = rows.filter((x) => x.created >= m.start && x.created <= m.end).length;
    const resolved = rows.filter((x) => x.resolved && x.resolved >= m.start && x.resolved <= m.end).length;
    // Still open at the end of the month: filed by then, not yet resolved or dismissed.
    const open = rows.filter((x) => x.created <= m.end
      && !(x.resolved && x.resolved <= m.end)
      && !(x.dismissed && x.dismissed <= m.end)).length;
    return { key: m.key, label: monthLabel(m.key), filed, resolved, open };
  });

  const solved = rows.filter((x) => x.resolved && x.resolved >= x.created);
  const days = solved.map((x) => (x.resolved - x.created) / DAY);
  const buckets = [
    { label: '1 week or less', test: (d) => d <= 7 },
    { label: '8 to 14 days', test: (d) => d > 7 && d <= 14 },
    { label: '15 to 30 days', test: (d) => d > 14 && d <= 30 },
    { label: 'Over 30 days', test: (d) => d > 30 },
  ].map((b) => ({ label: b.label, count: days.filter(b.test).length }));

  const open = rows.filter((x) => !x.resolved && !x.dismissed);
  const oldestOpen = open.length ? Math.max(...open.map((x) => (now - x.created) / DAY)) : null;

  const categories = [...countBy(rows, (x) => resolveCategory(x.r))]
    .map(([key, count]) => ({ key, label: SEVERITY_TAXONOMY[key]?.label || key, count }))
    .sort((a, b) => b.count - a.count);

  const hotspots = [...countBy(open, (x) => [x.r.barangay, x.r.municipality].filter(Boolean).join(', '))]
    .map(([place, count]) => ({ place, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const filedSeries = series.map((s) => s.filed);
  return {
    total: rows.length,
    series,
    open: open.length,
    resolvedTotal: solved.length,
    resolutionRate: rows.length ? (solved.length / rows.length) * 100 : null,
    medianDaysToResolve: median(days),
    withinTwoWeeks: days.length ? (days.filter((d) => d <= 14).length / days.length) * 100 : null,
    buckets,
    oldestOpenDays: oldestOpen,
    categories,
    hotspots,
    filedDelta: periodDelta(filedSeries.length >= 2 ? filedSeries : [], Math.floor(filedSeries.length / 2) || 1),
    firstMonth: rows.length ? monthKey(Math.min(...rows.map((x) => x.created))) : null,
  };
}

function reviewStats(updates, proposals, months, now) {
  const upd = (updates || []).map((u) => ({ u, sub: parseDate(u.submitted_at), rev: parseDate(u.reviewed_at) })).filter((x) => x.sub);
  const prop = (proposals || []).map((p) => ({ p, sub: parseDate(p.submitted_at), rev: parseDate(p.reviewed_at) })).filter((x) => x.sub);
  const range = monthRange(months, now);

  const updateSeries = range.map((m) => ({
    key: m.key,
    label: monthLabel(m.key),
    submitted: upd.filter((x) => x.sub >= m.start && x.sub <= m.end).length,
    reviewed: upd.filter((x) => x.rev && x.rev >= m.start && x.rev <= m.end).length,
  }));
  const proposalSeries = range.map((m) => ({
    key: m.key,
    label: monthLabel(m.key),
    submitted: prop.filter((x) => x.sub >= m.start && x.sub <= m.end).length,
    decided: prop.filter((x) => x.rev && x.rev >= m.start && x.rev <= m.end).length,
  }));

  const updDays = upd.filter((x) => x.rev && x.rev >= x.sub).map((x) => (x.rev - x.sub) / DAY);
  const propDays = prop.filter((x) => x.rev && x.rev >= x.sub).map((x) => (x.rev - x.sub) / DAY);
  const pendingUpdates = upd.filter((x) => !x.rev && String(x.u.status).toLowerCase() === 'pending');
  const funnel = [...countBy(prop, (x) => x.p.status)].map(([status, count]) => ({ status, count }));
  const approved = prop.filter((x) => String(x.p.status).toLowerCase() === 'approved').length;
  const rejected = prop.filter((x) => String(x.p.status).toLowerCase() === 'rejected').length;

  return {
    updateSeries,
    proposalSeries,
    updatesTotal: upd.length,
    updateMedianDays: median(updDays),
    pendingUpdates: pendingUpdates.length,
    oldestPendingDays: pendingUpdates.length ? Math.max(...pendingUpdates.map((x) => (now - x.sub) / DAY)) : null,
    proposalsTotal: prop.length,
    proposalMedianDays: median(propDays),
    funnel,
    approvalRate: approved + rejected > 0 ? (approved / (approved + rejected)) * 100 : null,
  };
}

/* ------------------------------- entry ------------------------------- */

/** Months from the earliest report, progress update or proposal to now (min 3, max 36). */
export function monthsSinceFirstRecord(data, now = Date.now()) {
  const stamps = [
    ...(data.reports || []).map((r) => parseDate(r.created_at)),
    ...(data.progressUpdates || []).map((u) => parseDate(u.submitted_at)),
    ...(data.proposals || []).map((p) => parseDate(p.submitted_at)),
  ].filter(Boolean);
  if (stamps.length === 0) return 6;
  const first = new Date(Math.min(...stamps));
  const end = new Date(now);
  const months = (end.getFullYear() - first.getFullYear()) * 12 + (end.getMonth() - first.getMonth()) + 1;
  return Math.min(36, Math.max(3, months));
}

const fmt1 = (n) => (n === null || n === undefined ? null : Number(n.toFixed(1)));

/**
 * @param {{projects, reports, progressUpdates, proposals}} data
 * @param {{months?: number, now?: number}} options  months = window for monthly series
 */
export function computeAdminAnalytics(data, { months = 12, now = Date.now() } = {}) {
  const infra = projectStats(data.projects, now);
  const reports = reportStats(data.reports, months, now);
  const review = reviewStats(data.progressUpdates, data.proposals, months, now);

  const lastYear = infra.delivery[infra.delivery.length - 1];
  const prevYear = infra.delivery[infra.delivery.length - 2];
  const yoy = (cur, prev) => ({ cur, prev, abs: cur - prev, pct: prev > 0 ? ((cur - prev) / prev) * 100 : null });

  const kpis = [
    {
      key: 'portfolio',
      label: 'FMR portfolio',
      value: infra.total,
      unit: 'projects',
      trend: infra.delivery.map((d) => ({ x: String(d.year), y: d.funded })),
      trendLabel: 'Funded per year',
      delta: lastYear && prevYear ? { ...yoy(lastYear.funded, prevYear.funded), label: `funded ${lastYear.year} vs ${prevYear.year}` } : null,
      polarity: 'up-good',
      foot: `${infra.completed} completed · ${infra.ongoing} on-going · ${infra.proposed} proposed`,
    },
    {
      key: 'delivered',
      label: 'Road length delivered',
      value: fmt1(infra.kmCompleted),
      unit: 'km',
      trend: infra.delivery.map((d) => ({ x: String(d.year), y: d.km })),
      trendLabel: 'Km completed per year',
      delta: lastYear && prevYear ? { ...yoy(lastYear.km, prevYear.km), label: `km completed ${lastYear.year} vs ${prevYear.year}` } : null,
      polarity: 'up-good',
      foot: `${infra.completionRate.toFixed(0)}% of ${infra.total} projects completed`,
    },
    {
      key: 'reports',
      label: 'Citizen reports filed',
      value: reports.series.reduce((s, m) => s + m.filed, 0),
      unit: `last ${months} mo`,
      trend: reports.series.map((m) => ({ x: m.label, y: m.filed })),
      trendLabel: 'Filed per month',
      delta: reports.filedDelta ? { ...reports.filedDelta, label: 'vs previous period' } : null,
      polarity: 'neutral',
      foot: `${reports.total} all time`,
    },
    {
      key: 'backlog',
      label: 'Open reports',
      value: reports.open,
      unit: 'unresolved',
      trend: reports.series.map((m) => ({ x: m.label, y: m.open })),
      trendLabel: 'Open at each month end',
      delta: reports.series.length >= 2
        ? { ...yoy(reports.series[reports.series.length - 1].open, reports.series[reports.series.length - 2].open), label: 'vs last month' }
        : null,
      polarity: 'down-good',
      foot: reports.oldestOpenDays !== null ? `Oldest open: ${Math.round(reports.oldestOpenDays)} days` : 'Nothing open',
    },
    {
      key: 'resolution',
      label: 'Median time to resolve',
      value: reports.medianDaysToResolve === null ? null : fmt1(reports.medianDaysToResolve),
      unit: 'days',
      trend: reports.series.map((m) => ({ x: m.label, y: m.resolved })),
      trendLabel: 'Resolved per month',
      delta: null,
      polarity: 'down-good',
      foot: reports.withinTwoWeeks === null
        ? 'No resolved reports yet'
        : `${reports.withinTwoWeeks.toFixed(0)}% resolved within 14 days · ${reports.resolutionRate.toFixed(0)}% of all reports resolved`,
    },
  ];

  // Plain-language findings, each one tied to a number above.
  const insights = [];
  const staleCohorts = infra.cohorts.filter((c) => c.year <= infra.thisYear && c.funded >= 5 && c.completed === 0);
  if (staleCohorts.length) {
    insights.push({ tone: 'warn', text: `${staleCohorts.map((c) => `${c.year} (${c.funded} projects)`).join(' and ')} funding ${staleCohorts.length === 1 ? 'cohort has' : 'cohorts have'} no completed roads yet.` });
  }
  if (reports.series.length >= 2) {
    const first = reports.series.find((s) => s.open > 0) || reports.series[0];
    const last = reports.series[reports.series.length - 1];
    if (last.open > first.open) insights.push({ tone: 'warn', text: `Open citizen reports grew from ${first.open} (${first.label}) to ${last.open} (${last.label}).` });
    else if (last.open < first.open) insights.push({ tone: 'good', text: `Open citizen reports fell from ${first.open} (${first.label}) to ${last.open} (${last.label}).` });
  }
  if (reports.hotspots[0]) insights.push({ tone: 'info', text: `${reports.hotspots[0].place} has the most open reports (${reports.hotspots[0].count}).` });
  if (review.pendingUpdates > 0 && review.oldestPendingDays !== null) {
    insights.push({ tone: 'warn', text: `${review.pendingUpdates} progress update${review.pendingUpdates === 1 ? '' : 's'} awaiting review; the oldest has waited ${Math.round(review.oldestPendingDays)} days.` });
  }
  const worstCoverage = [...infra.coverage].sort((a, b) => a.pct - b.pct)[0];
  if (worstCoverage && worstCoverage.pct < 50) {
    insights.push({ tone: 'info', text: `Data gap: only ${worstCoverage.pct.toFixed(0)}% of project records include "${worstCoverage.label}", which limits any analysis that depends on it.` });
  }

  return { months, now, infra, reports, review, kpis, insights };
}
