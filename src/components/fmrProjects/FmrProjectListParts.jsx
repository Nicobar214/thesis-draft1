/* FmrProjectListParts.jsx — shared FMR project list presentation.
 *
 * Extracted from UserFMRProjects.jsx so the citizen and farmer portals
 * render projects identically instead of maintaining two copies of the same
 * table/card markup that could silently drift apart.
 */
import Icons from '../Icons';
import HierarchyKpis from '../ui/HierarchyKpis';
import { normalizeProjectName } from '../../lib/projectHelpers';
import { getProjectBudgetSummary, formatPeso } from '../../lib/budgetEstimate';
import { formatPercentage } from '../../lib/percentageFormat';
import { normalizeUserProjectStatus, getStatusStyle, getDaysDeltaFromToday, isProjectOverdue } from '../../lib/projectStatus';
import { CONTRACTOR_NOT_INDICATED, useProjectContractorMap } from '../../lib/projectContractors';

// Status palette for the KPI block -- the app-wide status colors (see
// getStatusStyle in lib/projectStatus.js and the analytics STATUS_COLORS).
const KPI_STATUS = {
  completed: { bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-600' },
  ongoing: { bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-600' },
  proposed: { bar: 'bg-sky-500', chip: 'bg-sky-50 text-sky-600' },
};

/**
 * FMR project KPI block with a visual hierarchy: one lead card (total,
 * completion rate, status split) and four compact supporting cards in a 2x2
 * beside it. Shared by the farmer, admin and LGU portals so they can't drift.
 *
 * stats: { total, completed, ongoing, proposed, totalKm }
 */
export function FmrProjectKpis({ stats, loading = false, scopeLabel = 'across the province' }) {
  const completionRate = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
  return (
    <HierarchyKpis
      loading={loading}
      ariaLabel="FMR project summary"
      lead={{
        label: 'Total FMR Projects',
        value: stats.total.toLocaleString(),
        note: <><span className="font-semibold text-emerald-700">{completionRate}% completed</span> {scopeLabel}</>,
        icon: <Icons.Road />,
        segments: [
          { label: 'Completed', value: stats.completed, bar: KPI_STATUS.completed.bar },
          { label: 'On-Going', value: stats.ongoing, bar: KPI_STATUS.ongoing.bar },
          { label: 'Proposed', value: stats.proposed, bar: KPI_STATUS.proposed.bar },
        ],
      }}
      items={[
        { icon: <Icons.Clock />, value: stats.ongoing.toLocaleString(), label: 'On-Going', hint: 'Under construction now', chip: KPI_STATUS.ongoing.chip },
        { icon: <Icons.CheckCircle />, value: stats.completed.toLocaleString(), label: 'Completed', hint: 'Finished and in use', chip: KPI_STATUS.completed.chip },
        { icon: <Icons.Lightbulb />, value: stats.proposed.toLocaleString(), label: 'Proposed', hint: 'Planned, not yet started', chip: KPI_STATUS.proposed.chip },
        { icon: <Icons.Ruler />, value: `${Number(stats.totalKm).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`, label: 'Total Road Length', hint: 'Across all projects', chip: 'bg-slate-100 text-slate-600' },
      ]}
    />
  );
}

export function StatCard({ icon, value, label, variant = 'default' }) {
  const variants = {
    default: 'bg-slate-100 text-slate-600',
    emerald: 'bg-emerald-100 text-teal-600',
    amber: 'bg-amber-100 text-amber-600',
    sky: 'bg-sky-100 text-sky-600',
    violet: 'bg-violet-100 text-violet-600',
  };

  return (
    <article className="bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs hover:shadow-md transition-shadow duration-300">
      <div className={`inline-flex items-center justify-center size-10 rounded-xl mb-3 ${variants[variant]}`}>
        {icon}
      </div>
      <p className="text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{label}</p>
    </article>
  );
}

export function ProjectSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/60 p-5 animate-pulse">
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1">
          <div className="h-5 w-3/4 bg-zinc-200 rounded mb-2" />
          <div className="h-4 w-1/2 bg-zinc-200 rounded" />
        </div>
        <div className="h-6 w-20 bg-zinc-200 rounded-full" />
      </div>
      <div className="h-1.5 bg-zinc-200 rounded-full mb-3" />
      <div className="flex gap-3">
        <div className="h-4 w-16 bg-zinc-200 rounded" />
        <div className="h-4 w-20 bg-zinc-200 rounded" />
      </div>
    </div>
  );
}

export function FMRProjectCard({ project, onClick, tranches = [] }) {
  const normalizedStatus = normalizeUserProjectStatus(project.status);
  const style = getStatusStyle(normalizedStatus);
  const name = normalizeProjectName(project);
  const contractorNames = useProjectContractorMap(); // shared, loaded once for all cards
  const contractorName = String(project.contractor || project.contractor_name || contractorNames?.get(String(project.id)) || '').trim();
  const daysDelta = getDaysDeltaFromToday(project.target_completion_date);
  const overdue = isProjectOverdue(project);
  const accomplishment = Number(project.accomplishment) || (normalizedStatus === 'Completed' ? 100 : 0);
  const budget = getProjectBudgetSummary(project, tranches);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs hover:shadow-md transition-shadow duration-300 ease-out flex flex-col justify-between"
    >
      <div className="space-y-3 w-full">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-slate-900 line-clamp-2 text-sm sm:text-base leading-snug">
              {name}
            </h3>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500 font-medium">
              <Icons.MapPin />
              <span className="truncate">{project.location ? `${project.location}, ` : ''}{project.municipality || 'Leon'}, {project.province || 'Iloilo'}</span>
            </div>
          </div>
          <span className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-extrabold border uppercase tracking-wider ${style.badge}`}>
            {normalizedStatus}
          </span>
        </div>

        {contractorName && (
          <p className="text-[11px] text-slate-500 truncate">
            Contractor: <span className="font-semibold text-slate-700">{contractorName}</span>
          </p>
        )}

        <div>
          <div className="flex items-center justify-between text-xs font-semibold mb-1">
            <span className="text-slate-500">Progress</span>
            <span className="text-slate-800 tabular-nums font-bold">{formatPercentage(accomplishment)}</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
            <div
              className={`h-full rounded-full ${style.bar} transition-all duration-500`}
              style={{ width: `${Math.min(accomplishment, 100)}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">Project Budget</span>
          <span className="font-bold text-slate-800 tabular-nums">
            {formatPeso(budget.totalBudget)}
            <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${budget.budgetIsEstimated ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
              {budget.budgetIsEstimated ? 'Est.' : 'Official'}
            </span>
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-3 mt-3 border-t border-slate-100 text-xs w-full">
        {project.year_funded && (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 font-bold text-[11px] border border-emerald-200/60">
            FY {project.year_funded}
          </span>
        )}
        {project.project_length_km > 0 && (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-[11px] border border-slate-200/60">
            <Icons.Ruler /> {project.project_length_km} km
          </span>
        )}
        {overdue ? (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-red-50 text-red-700 border border-red-200 font-bold text-[11px]">
            Overdue
          </span>
        ) : daysDelta !== null && normalizedStatus !== 'Completed' ? (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 font-semibold text-[11px]">
            {daysDelta < 0 ? `${Math.abs(daysDelta)}d overdue` : `${daysDelta}d left`}
          </span>
        ) : null}
      </div>
    </button>
  );
}

const thClass = 'px-6 py-4 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500';

export function SortableTh({ label, asc, desc, defaultDir = 'asc', sortBy, onSortChange }) {
  const isAsc = sortBy === asc;
  const isDesc = sortBy === desc;
  const next = isAsc ? desc : isDesc ? asc : (defaultDir === 'asc' ? asc : desc);

  return (
    <th scope="col" className={thClass}>
      <button
        type="button"
        onClick={() => onSortChange(next)}
        title={`Sort by ${label}`}
        className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-700 transition-colors"
      >
        {label}
        {(isAsc || isDesc) && <span className="text-teal-600">{isAsc ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}

export function PlainTh({ label }) {
  return <th scope="col" className={thClass}>{label}</th>;
}

export function FMRProjectTable({ projects, loading, onSelect, tranchesByProjectId = {}, sortBy, onSortChange }) {
  // Assigned contractors' names, one request for the whole table.
  const contractorNames = useProjectContractorMap();
  return (
    <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px]">
          <thead>
            <tr className="bg-slate-50/60 border-b border-slate-200/70">
              <SortableTh label="Project" asc="name-asc" desc="name-desc" defaultDir="asc" sortBy={sortBy} onSortChange={onSortChange} />
              <PlainTh label="Status" />
              <SortableTh label="Progress" asc="progress-asc" desc="progress-desc" defaultDir="desc" sortBy={sortBy} onSortChange={onSortChange} />
              <SortableTh label="Budget" asc="budget-asc" desc="budget-desc" defaultDir="desc" sortBy={sortBy} onSortChange={onSortChange} />
              <SortableTh label="Fiscal Year" asc="year-asc" desc="year-desc" defaultDir="desc" sortBy={sortBy} onSortChange={onSortChange} />
              <PlainTh label="Length" />
              <PlainTh label="Timeline" />
              <PlainTh label="Contractor" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4">
                      <div className="h-4 w-56 bg-zinc-200 rounded mb-2" />
                      <div className="h-3 w-36 bg-zinc-200 rounded" />
                    </td>
                    <td className="px-6 py-4"><div className="h-5 w-20 bg-zinc-200 rounded-full" /></td>
                    <td className="px-6 py-4"><div className="h-2 w-24 bg-zinc-200 rounded-full" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-24 bg-zinc-200 rounded" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-12 bg-zinc-200 rounded" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-14 bg-zinc-200 rounded" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-24 bg-zinc-200 rounded" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-28 bg-zinc-200 rounded" /></td>
                  </tr>
                ))
              : projects.map((project) => {
                  const normalizedStatus = normalizeUserProjectStatus(project.status);
                  const style = getStatusStyle(normalizedStatus);
                  const name = normalizeProjectName(project);
                  const contractorName = String(project.contractor || project.contractor_name || contractorNames?.get(String(project.id)) || '').trim();
                  const daysDelta = getDaysDeltaFromToday(project.target_completion_date);
                  const overdue = isProjectOverdue(project);
                  const accomplishment = Number(project.accomplishment) || (normalizedStatus === 'Completed' ? 100 : 0);
                  const budget = getProjectBudgetSummary(project, tranchesByProjectId[project.id] || []);

                  return (
                    <tr
                      key={project.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect(project)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelect(project);
                        }
                      }}
                      title="Click to view project details"
                      className="cursor-pointer transition-colors hover:bg-slate-50/60 focus:outline-none focus:bg-slate-50"
                    >
                      <td className="px-6 py-4 max-w-[320px]">
                        <p className="text-sm font-semibold text-slate-900 line-clamp-2 leading-snug">{name}</p>
                        <p className="mt-0.5 text-xs text-slate-500 truncate">
                          {project.location ? `${project.location}, ` : ''}{project.municipality || 'Leon'}, {project.province || 'Iloilo'}
                        </p>
                      </td>

                      <td className="px-6 py-4">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${style.badge}`}>
                          {normalizedStatus}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 min-w-[120px]">
                          <div className="h-2 flex-1 bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
                            <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${Math.min(accomplishment, 100)}%` }} />
                          </div>
                          <span className="text-xs font-bold text-slate-800 tabular-nums w-14 text-right">{formatPercentage(accomplishment)}</span>
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-bold text-slate-800 tabular-nums">{formatPeso(budget.totalBudget)}</span>
                        <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${budget.budgetIsEstimated ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {budget.budgetIsEstimated ? 'Est.' : 'Official'}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-sm text-slate-700 tabular-nums whitespace-nowrap">
                        {project.year_funded ? `FY ${project.year_funded}` : <span className="text-slate-300">—</span>}
                      </td>

                      <td className="px-6 py-4 text-sm text-slate-700 tabular-nums whitespace-nowrap">
                        {project.project_length_km > 0 ? `${project.project_length_km} km` : <span className="text-slate-300">—</span>}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        {project.target_completion_date && (
                          <p className="text-xs text-slate-600 tabular-nums">{project.target_completion_date}</p>
                        )}
                        {overdue ? (
                          <span className="mt-1 inline-block px-2 py-0.5 rounded-lg bg-red-50 text-red-700 border border-red-200 font-bold text-[11px]">
                            Overdue
                          </span>
                        ) : daysDelta !== null && normalizedStatus !== 'Completed' ? (
                          <span className="mt-1 inline-block px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 font-semibold text-[11px]">
                            {daysDelta}d left
                          </span>
                        ) : !project.target_completion_date ? (
                          <span className="text-slate-300">—</span>
                        ) : null}
                      </td>

                      <td className="px-6 py-4 text-sm text-slate-700 max-w-[200px]">
                        {contractorName
                          ? <span className="line-clamp-2">{contractorName}</span>
                          : <span className="text-xs italic text-slate-400">{contractorNames ? CONTRACTOR_NOT_INDICATED : '…'}</span>}
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
