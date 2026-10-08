import { useMemo, useState } from 'react';
import { CircleAlertIcon, GaugeIcon, MapIcon, RotateCwIcon, UsersIcon, WheatIcon } from 'lucide-react';
import LguAnalyticsFilters from './LguAnalyticsFilters';
import LguAnalyticsOverview from './LguAnalyticsOverview';
import LguBarangayBreakdown from './LguBarangayBreakdown';
import LguHarvestAnalytics from './LguHarvestAnalytics';
import { AnalyticsSkeleton, PrimaryKpi, SecondaryKpi, SectionHeading, Sparkline, TrendCaption } from './analyticsParts';
import {
  applyAnalyticsFilters,
  buildAnalyticsBase,
  buildBarangayBreakdown,
  farmerRegistrationTrend,
  projectsFundedByYear,
  fmtInt,
  fmtKg,
  fmtPct,
  fmtTons,
  summarizeFarmers,
  summarizeHarvest,
  summarizeProjects,
} from '../../lib/lguAnalytics';

const SOURCE_LABELS = { projects: 'FMR projects', beneficiaries: 'farmer registry', harvest: 'harvest records' };

export default function LguAnalyticsTab({
  projects,
  beneficiaries,
  harvestLogs,
  loading = false,
  errors = {},
  onRetry,
}) {
  const [filters, setFilters] = useState({ year: 'all', barangay: 'all' });

  const base = useMemo(
    () => buildAnalyticsBase({ projects, beneficiaries, harvestLogs }),
    [projects, beneficiaries, harvestLogs]
  );

  // A selection that no longer exists after a refetch falls back to "all"
  // instead of quietly filtering everything out.
  const yearFilter = filters.year !== 'all' && !base.years.includes(Number(filters.year)) ? 'all' : filters.year;
  const barangayFilter = filters.barangay !== 'all' && !base.barangays.some((b) => b.key === filters.barangay) ? 'all' : filters.barangay;

  const filtered = useMemo(
    () => applyAnalyticsFilters(base, { year: yearFilter, barangay: barangayFilter }),
    [base, yearFilter, barangayFilter]
  );
  const projectSummary = useMemo(() => summarizeProjects(filtered.projectRows), [filtered]);
  const farmerSummary = useMemo(() => summarizeFarmers(filtered.farmerRows), [filtered]);
  const harvestSummary = useMemo(() => summarizeHarvest(filtered.harvestRows), [filtered]);
  const barangayRows = useMemo(() => buildBarangayBreakdown(filtered, base.names), [filtered, base.names]);
  const projectTrend = useMemo(() => projectsFundedByYear(filtered.projectRows), [filtered]);
  const farmerTrend = useMemo(() => farmerRegistrationTrend(filtered.farmerRows), [filtered]);
  const harvestTrend = useMemo(
    () => (harvestSummary.trend || []).map((m) => ({ label: m.label, value: m.kg })),
    [harvestSummary]
  );

  const projectsDown = Boolean(errors.projects);
  const farmersDown = Boolean(errors.beneficiaries);
  // Harvest is placed in a barangay through the farmer registry, so it's
  // only trustworthy when both sources loaded.
  const harvestDown = Boolean(errors.harvest) || farmersDown;
  const failedSources = Object.keys(SOURCE_LABELS).filter((k) => errors[k]).map((k) => SOURCE_LABELS[k]);
  const showSkeleton = loading && (projects || []).length === 0 && (beneficiaries || []).length === 0;

  const statusCount = (name) => projectSummary.statuses.find((s) => s.name === name)?.count || 0;
  const projectHint = projectSummary.total > 0
    ? [
        `${fmtInt(statusCount('Completed'))} completed`,
        `${fmtInt(statusCount('On-Going'))} on-going`,
        statusCount('Proposed') > 0 && `${fmtInt(statusCount('Proposed'))} proposed`,
      ].filter(Boolean).join(' · ')
    : 'No projects for this selection';
  const accomplishmentHint = projectSummary.measuredCount > 0
    ? `Engineer-certified, across ${fmtInt(projectSummary.measuredCount)} on-going & completed project${projectSummary.measuredCount === 1 ? '' : 's'}`
    : 'No certified accomplishment for this selection';
  const harvestHint = harvestSummary.records > 0
    ? `≈ ${fmtTons(harvestSummary.totalKg)} from ${fmtInt(harvestSummary.records)} farmer report${harvestSummary.records === 1 ? '' : 's'}`
    : 'No harvest reported for this selection';

  return (
    <div className="space-y-6">
      <LguAnalyticsFilters
        years={base.years}
        barangays={base.barangays}
        filters={{ year: yearFilter, barangay: barangayFilter }}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        onClear={() => setFilters({ year: 'all', barangay: 'all' })}
      />

      {failedSources.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span className="flex items-center gap-2">
            <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
            Couldn&rsquo;t load {failedSources.join(', ')}. Figures that depend on them are marked unavailable.
          </span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-800 transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/40"
            >
              <RotateCwIcon className="size-3.5" aria-hidden="true" />
              Retry
            </button>
          )}
        </div>
      )}

      {showSkeleton ? (
        <AnalyticsSkeleton />
      ) : (
        <>
          {/* Hierarchy: the two project-implementation figures are what the
              LGU is accountable for, so they lead at full size; farmer and
              harvest figures support them in a compact column. */}
          <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12">
            <div className="xl:col-span-4">
              <PrimaryKpi icon={MapIcon} label="Total FMR Projects" value={fmtInt(projectSummary.total)} hint={projectHint} unavailable={projectsDown}>
                <Sparkline data={projectTrend} height={56} format={(v) => `${fmtInt(v)} project${v === 1 ? '' : 's'} funded`} />
                <TrendCaption data={projectTrend} caption="Projects funded per year" />
              </PrimaryKpi>
            </div>
            <div className="xl:col-span-4">
              <PrimaryKpi
                icon={GaugeIcon}
                label="Avg. Physical Accomplishment"
                value={fmtPct(projectSummary.avgAccomplishment)}
                hint={accomplishmentHint}
                unavailable={projectsDown}
              >
                {projectSummary.avgAccomplishment !== null && (
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                    <div className="h-full rounded-full bg-teal-600" style={{ width: `${projectSummary.avgAccomplishment}%` }} />
                  </div>
                )}
                {/* Only current figures are loaded, not each project's history,
                    so a trend line here would be invented. */}
                <p className="text-[11px] text-slate-400">Current certified figures; trend not tracked</p>
              </PrimaryKpi>
            </div>
            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
              <SecondaryKpi
                icon={UsersIcon}
                label="Farmer Beneficiaries"
                value={fmtInt(farmerSummary.count)}
                hint="Validated, each farmer counted once"
                trend={farmerTrend}
                trendFormat={(v) => `${fmtInt(v)} validated farmers`}
                trendCaption="Running total by month registered"
                unavailable={farmersDown}
              />
              <SecondaryKpi
                icon={WheatIcon}
                label="Reported Harvest"
                value={harvestSummary.records > 0 ? fmtKg(harvestSummary.totalKg) : '—'}
                hint={harvestHint}
                trend={harvestTrend}
                trendFormat={fmtKg}
                trendCaption="Monthly reported harvest"
                unavailable={harvestDown}
              />
            </div>
          </section>

          <section>
            <SectionHeading
              title="Project Implementation"
              subtitle="Status and location of FMR projects. Accomplishment uses engineer-certified figures only."
            />
            <LguAnalyticsOverview summary={projectSummary} barangayRows={barangayRows} unavailable={projectsDown} />
          </section>

          <LguBarangayBreakdown rows={barangayRows} unavailable={projectsDown || farmersDown || harvestDown} />

          <section>
            <SectionHeading
              title="Farmer Beneficiaries & Reported Harvest"
              subtitle="Harvest as reported by farmers in this municipality. Not independently verified, and not linked to a specific FMR project."
            />
            <LguHarvestAnalytics summary={harvestSummary} unavailable={harvestDown} unattributedHarvest={base.unattributedHarvest} />
          </section>
        </>
      )}
    </div>
  );
}
