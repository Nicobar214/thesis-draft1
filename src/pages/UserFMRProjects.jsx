import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';

import Icons from '../components/Icons';
import UserLayout from '../components/UserLayout';
import { normalizeProjectName } from '../lib/projectHelpers';
import { getProjectBudgetSummary, formatPeso } from '../lib/budgetEstimate';
import { getPaginationRange } from '../lib/paginationUtils';
/* â”€â”€â”€ Icons â”€â”€â”€ */

function normalizeUserProjectStatus(status) {
  const lower = String(status || '').toLowerCase().replace(/[-\s]/g, '');
  if (lower === 'ongoing') return 'On-Going';
  if (lower === 'proposed' || lower === 'pending') return 'Proposed';
  if (lower === 'completed') return 'Completed';
  return status || 'Proposed';
}

function parseDateOnly(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    return new Date(y, mo, d);
  }
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function getDaysDeltaFromToday(targetDateValue) {
  const targetDate = parseDateOnly(targetDateValue);
  if (!targetDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function isProjectOverdue(project) {
  const status = normalizeUserProjectStatus(project?.status);
  if (status === 'Completed') return false;
  const delta = getDaysDeltaFromToday(project?.target_completion_date);
  return typeof delta === 'number' && delta < 0;
}

/* â”€â”€â”€ Status Style Helper â”€â”€â”€ */
function getStatusStyle(status) {
  const styles = {
    'Completed':  { badge: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
    'On-Going':   { badge: 'bg-amber-100 text-amber-700',     bar: 'bg-amber-500',   dot: 'bg-amber-500' },
    'Proposed':   { badge: 'bg-sky-100 text-sky-700',          bar: 'bg-sky-500',     dot: 'bg-sky-500' },
  };
  return styles[status] || styles['Proposed'];
}

/* â”€â”€â”€ Stat Card â”€â”€â”€ */
function StatCard({ icon, value, label, variant = 'default' }) {
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

/* ——— Project List Card ——— */
function FMRProjectCard({ project, onClick, tranches = [] }) {
  const normalizedStatus = normalizeUserProjectStatus(project.status);
  const style = getStatusStyle(normalizedStatus);
  const name = normalizeProjectName(project);
  const contractorName = String(project.contractor || project.contractor_name || '').trim();
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
        {/* Top Header & Status Badge */}
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

        {/* Accomplishment Progress Bar */}
        <div>
          <div className="flex items-center justify-between text-xs font-semibold mb-1">
            <span className="text-slate-500">Progress</span>
            <span className="text-slate-800 tabular-nums font-bold">{accomplishment}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
            <div
              className={`h-full rounded-full ${style.bar} transition-all duration-500`}
              style={{ width: `${Math.min(accomplishment, 100)}%` }}
            />
          </div>
        </div>

        {/* Budget summary */}
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

      {/* Footer Metadata Chips */}
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

/* â”€â”€â”€ Skeleton â”€â”€â”€ */
function ProjectSkeleton() {
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

/* ——— Sortable Column Header ———
   Writes into the same `sortBy` state the sort dropdown uses, so the two stay in sync. */
const thClass = 'px-6 py-4 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500';

function SortableTh({ label, asc, desc, defaultDir = 'asc', sortBy, onSortChange }) {
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

function PlainTh({ label }) {
  return <th scope="col" className={thClass}>{label}</th>;
}

/* ——— Project Table (default view) ——— */
function FMRProjectTable({ projects, loading, onSelect, tranchesByProjectId = {}, sortBy, onSortChange }) {
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
                  const contractorName = String(project.contractor || project.contractor_name || '').trim();
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
                          <span className="text-xs font-bold text-slate-800 tabular-nums w-9 text-right">{accomplishment}%</span>
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
                          : <span className="text-slate-300">—</span>}
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

/* â”€â”€â”€ Detail Item â”€â”€â”€ */
function DetailItem({ icon, label, value }) {
  return (
    <div className="flex items-start gap-2.5 p-3 bg-slate-50 rounded-xl">
      <div className="size-8 bg-white rounded-lg grid place-items-center text-slate-400 border border-slate-100 shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-400 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-medium text-slate-800 break-words">{value}</p>
      </div>
    </div>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   FMR PROJECT DETAIL VIEW
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function FMRProjectDetail({ project, onBack, tranches = [], isModal = false }) {
  const style = getStatusStyle(project.status);
  const hasCoords = project.start_latitude && project.start_longitude;
  const name = normalizeProjectName(project);
  const budget = getProjectBudgetSummary(project, tranches);
  const utilizationPct = budget.totalBudget > 0 ? Math.min((budget.released / budget.totalBudget) * 100, 100) : 0;

  if (isModal) {
    return (
      <div className="space-y-6 text-slate-800">
        {/* Progress bar */}
        {project.status !== 'Proposed' && (
          <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-slate-700">Accomplishment</span>
              <span className="text-sm font-bold text-slate-900">{project.accomplishment || 0}%</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
              <div className={`h-full rounded-full ${style.bar} transition-all duration-500`} style={{ width: `${project.accomplishment || 0}%` }} />
            </div>
          </div>
        )}

        {/* Specifications Grid Card */}
        <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">Specifications</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <DetailItem icon={<Icons.MapPin />} label="Location" value={project.location || 'N/A'} />
            <DetailItem icon={<Icons.Building />} label="Municipality" value={project.municipality || 'N/A'} />
            <DetailItem icon={<Icons.MapPinLg />} label="Province" value={`${project.province}, ${project.region}`} />
            
            {project.year_funded && (
              <DetailItem icon={<Icons.Calendar />} label="Year Funded" value={project.year_funded} />
            )}
            {project.target_completion_date && (
              <DetailItem icon={<Icons.Calendar />} label="Target Completion" value={project.target_completion_date} />
            )}
            {project.date_completed && (
              <DetailItem icon={<Icons.Calendar />} label="Date Completed" value={project.date_completed} />
            )}
            {project.project_length_km > 0 && (
              <DetailItem icon={<Icons.Ruler />} label="Road Length" value={`${project.project_length_km} km`} />
            )}
            {project.remarks && (
              <DetailItem icon={<Icons.Lightbulb />} label="Remarks" value={project.remarks} />
            )}
          </div>
        </div>

        {/* Coordinates Section */}
        {hasCoords && (
          <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
            <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2 text-sm sm:text-base">
              <Icons.MapPinLg /> GPS Coordinates
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                <p className="text-xs text-teal-600 font-medium uppercase tracking-wider mb-1">Start Point</p>
                <p className="text-sm font-mono text-emerald-800">
                  {project.start_latitude?.toFixed(6)}, {project.start_longitude?.toFixed(6)}
                </p>
              </div>
              <div className="p-4 bg-rose-50 rounded-xl border border-rose-100">
                <p className="text-xs text-rose-600 font-medium uppercase tracking-wider mb-1">End Point</p>
                <p className="text-sm font-mono text-rose-800">
                  {project.end_latitude?.toFixed(6)}, {project.end_longitude?.toFixed(6)}
                </p>
              </div>
            </div>
            <a
              href={`https://www.google.com/maps/dir/${project.start_latitude},${project.start_longitude}/${project.end_latitude},${project.end_longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded-xl transition-colors shadow-xs"
            >
              <Icons.ExternalLink /> View Route on Google Maps
            </a>
          </div>
        )}

        {/* Project Budget */}
        <div className="bg-white rounded-2xl border border-slate-200/60 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2 text-sm sm:text-base">
              <Icons.Money /> Project Budget
            </h2>
            {project.funding_source && (
              <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
                {project.funding_source}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/60">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-slate-500 uppercase tracking-wider">Total Budget</p>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${budget.budgetIsEstimated ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {budget.budgetIsEstimated ? 'Estimated' : 'Official'}
                </span>
              </div>
              <p className="text-base sm:text-lg font-bold text-slate-900">{formatPeso(budget.totalBudget)}</p>
            </div>
            <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-amber-700 uppercase tracking-wider">Funds Utilized</p>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${budget.utilizationIsEstimated ? 'bg-amber-200 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
                  {budget.utilizationIsEstimated ? 'Estimated' : 'Official'}
                </span>
              </div>
              <p className="text-base sm:text-lg font-bold text-amber-900">{formatPeso(budget.released)}</p>
            </div>
            <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
              <p className="text-xs text-emerald-700 uppercase tracking-wider mb-1">Funds Remaining</p>
              <p className="text-base sm:text-lg font-bold text-emerald-900">{formatPeso(budget.remaining)}</p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-medium mb-1.5">
              <span className="text-slate-500">Utilization</span>
              <span className="text-slate-700 font-bold">{utilizationPct.toFixed(0)}%</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${utilizationPct}%` }} />
            </div>
          </div>

          {(budget.budgetIsEstimated || budget.utilizationIsEstimated) && (
            <p className="text-xs text-slate-400 leading-relaxed">
              Figures marked "Estimated" are computed from the DA-BAFE 2026 indicative rate of ₱15M per kilometer and this project's reported physical progress, following the standard government mobilization/progress/retention release schedule.
            </p>
          )}
        </div>

        {/* Source Info */}
        <div className="p-5 bg-sky-50 rounded-2xl border border-sky-100">
          <p className="font-medium text-sky-900 mb-1">Data Source</p>
          <p className="text-sm text-sky-700 leading-relaxed">
            Department of Agriculture - Regional Agricultural Engineering Division (RAED), Regional Field Office VI - Western Visayas.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      {!isModal && (
        <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors">
          <Icons.ArrowLeft /> Back to FMR Projects
        </button>
      )}

      {/* Project Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
        <div className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
            <div className="flex-1">
              <h1 className="text-xl font-semibold text-slate-900 leading-snug">{name}</h1>
              <p className="text-sm text-slate-400 mt-1">
                DA-RAED Region VI &middot; Farm-to-Market Road Development Program
              </p>
            </div>
            <span className={`self-start px-3 py-1.5 rounded-full text-sm font-medium ${style.badge}`}>
              {project.status}
            </span>
          </div>

          {/* Progress bar */}
          {project.status !== 'Proposed' && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-slate-700">Accomplishment</span>
                <span className="text-sm font-semibold text-slate-900">{project.accomplishment || 0}%</span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${style.bar} transition-all`} style={{ width: `${project.accomplishment || 0}%` }} />
              </div>
            </div>
          )}

          {/* Detail Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <DetailItem icon={<Icons.MapPin />} label="Location" value={project.location || 'N/A'} />
            <DetailItem icon={<Icons.Building />} label="Municipality" value={project.municipality || 'N/A'} />
            <DetailItem icon={<Icons.MapPinLg />} label="Province" value={`${project.province}, ${project.region}`} />
            
            {project.year_funded && (
              <DetailItem icon={<Icons.Calendar />} label="Year Funded" value={project.year_funded} />
            )}
            {project.target_completion_date && (
              <DetailItem icon={<Icons.Calendar />} label="Target Completion" value={project.target_completion_date} />
            )}
            {project.date_completed && (
              <DetailItem icon={<Icons.Calendar />} label="Date Completed" value={project.date_completed} />
            )}
            {project.project_length_km > 0 && (
              <DetailItem icon={<Icons.Ruler />} label="Road Length" value={`${project.project_length_km} km`} />
            )}
            {project.remarks && (
              <DetailItem icon={<Icons.Lightbulb />} label="Remarks" value={project.remarks} />
            )}
          </div>
        </div>

        {/* Coordinates Section (for completed projects with GPS data) */}
        {hasCoords && (
          <div className="border-t border-slate-100 p-6">
            <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Icons.MapPinLg /> GPS Coordinates
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                <p className="text-xs text-teal-600 font-medium uppercase tracking-wider mb-1">Start Point</p>
                <p className="text-sm font-mono text-emerald-800">
                  {project.start_latitude?.toFixed(6)}, {project.start_longitude?.toFixed(6)}
                </p>
              </div>
              <div className="p-4 bg-rose-50 rounded-xl border border-rose-100">
                <p className="text-xs text-rose-600 font-medium uppercase tracking-wider mb-1">End Point</p>
                <p className="text-sm font-mono text-rose-800">
                  {project.end_latitude?.toFixed(6)}, {project.end_longitude?.toFixed(6)}
                </p>
              </div>
            </div>
            <a
              href={`https://www.google.com/maps/dir/${project.start_latitude},${project.start_longitude}/${project.end_latitude},${project.end_longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded-xl transition-colors"
            >
              <Icons.ExternalLink /> View Route on Google Maps
            </a>
          </div>
        )}
      </div>

      {/* Project Budget */}
      <div className="bg-white rounded-2xl border border-slate-200/60 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2">
            <Icons.Money /> Project Budget
          </h2>
          {project.funding_source && (
            <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
              {project.funding_source}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/60">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Total Budget</p>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${budget.budgetIsEstimated ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {budget.budgetIsEstimated ? 'Estimated' : 'Official'}
              </span>
            </div>
            <p className="text-lg font-bold text-slate-900">{formatPeso(budget.totalBudget)}</p>
          </div>
          <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-amber-700 uppercase tracking-wider">Funds Utilized</p>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${budget.utilizationIsEstimated ? 'bg-amber-200 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
                {budget.utilizationIsEstimated ? 'Estimated' : 'Official'}
              </span>
            </div>
            <p className="text-lg font-bold text-amber-900">{formatPeso(budget.released)}</p>
          </div>
          <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
            <p className="text-xs text-emerald-700 uppercase tracking-wider mb-1">Funds Remaining</p>
            <p className="text-lg font-bold text-emerald-900">{formatPeso(budget.remaining)}</p>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs font-medium mb-1.5">
            <span className="text-slate-500">Utilization</span>
            <span className="text-slate-700 font-bold">{utilizationPct.toFixed(0)}%</span>
          </div>
          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${utilizationPct}%` }} />
          </div>
        </div>

        {(budget.budgetIsEstimated || budget.utilizationIsEstimated) && (
          <p className="text-xs text-slate-400 leading-relaxed">
            Figures marked "Estimated" are computed from the DA-BAFE 2026 indicative rate of ₱15M per kilometer and this project's reported physical progress, following the standard government mobilization/progress/retention release schedule — not confirmed disbursement records. They will update once DA-RAED enters official figures.
          </p>
        )}
      </div>

      {/* Source Info */}
      <div className="p-5 bg-sky-50 rounded-2xl border border-sky-100">
        <p className="font-medium text-sky-900 mb-1">Data Source</p>
        <p className="text-sm text-sky-700 leading-relaxed">
          Department of Agriculture - Regional Agricultural Engineering Division (RAED), Regional Field Office VI - Western Visayas.
          Farm-to-Market Road Development Program (FMRDP).
        </p>
      </div>
    </div>
  );
}

/* â”€â”€â”€ Status Filter Tabs â”€â”€â”€ */
const statusFilters = ['On-Going', 'Proposed', 'Completed', 'Overdue'];

const VIEW_MODE_STORAGE_KEY = 'fmr-projects-view';
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50];

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   MAIN FMR PROJECTS PAGE
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
export default function UserFMRProjects({ embedded = false } = {}) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('On-Going');
  const [yearFilter, setYearFilter] = useState('All');
  const [municipalityFilter, setMunicipalityFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState('latest');
  const [selectedProject, setSelectedProject] = useState(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [reportCountByProject, setReportCountByProject] = useState({});
  const [tranchesByProjectId, setTranchesByProjectId] = useState({});
  // Tabular is the default presentation for FMR records; cards remain opt-in.
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'cards' ? 'cards' : 'table';
    } catch {
      return 'table';
    }
  });
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const projectsPerPage = viewMode === 'table' ? rowsPerPage : (embedded ? 6 : 9);

  const getProjectDate = (project) => {
    const candidates = [
      project.updated_at,
      project.created_at,
      project.date_completed,
      project.target_completion_date,
    ];
    for (const value of candidates) {
      if (!value) continue;
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
  };

  const inDateRange = (projectDate, from, to) => {
    if (!projectDate) return !from && !to;
    if (from) {
      const fromDate = new Date(`${from}T00:00:00`);
      if (projectDate < fromDate) return false;
    }
    if (to) {
      const toDate = new Date(`${to}T23:59:59`);
      if (projectDate > toDate) return false;
    }
    return true;
  };

  // Fetch FMR projects from Supabase
  useEffect(() => {
    fetchFMRProjects();
    const channel = supabase
      .channel('user-fmr-projects')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fmr_projects' }, fetchFMRProjects)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_tranches' }, fetchFMRProjects)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  useEffect(() => {
    if (embedded) return undefined;
    const onScroll = () => setShowBackToTop(window.scrollY > 400);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, [embedded]);

  const layoutProps = embedded
    ? {
        requireAuth: false,
        showSidebar: false,
        showHeader: false,
        rootClassName: 'bg-transparent',
        mainClassName: 'min-h-0',
        contentClassName: 'px-0 py-0 pt-0',
      }
    : {};

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      // Storage unavailable (private mode) - the preference just won't persist.
    }
  }, [viewMode]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, yearFilter, municipalityFilter, dateFrom, dateTo, sortBy, rowsPerPage, viewMode]);

  async function fetchFMRProjects() {
    try {
      setFetchError(null);
      const [{ data, error }, { data: reportsData, error: reportsError }, { data: tranchesData }] = await Promise.all([
        supabase
          .from('fmr_projects')
          .select('*')
          .order('status', { ascending: true })
          .order('accomplishment', { ascending: false }),
        supabase
          .from('public_reports')
          .select('project_name'),
        supabase
          .from('project_tranches')
          .select('*')
          .order('tranche_order', { ascending: true }),
      ]);

      if (error) {
        setFetchError(error.message);
        throw error;
      }

      if (!reportsError && Array.isArray(reportsData)) {
        const counts = reportsData.reduce((acc, row) => {
          const key = normalizeProjectName({ project_name: row?.project_name || '' }).toLowerCase().trim();
          if (!key) return acc;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});
        setReportCountByProject(counts);
      }

      const tMap = {};
      (tranchesData || []).forEach((t) => {
        if (!tMap[t.project_id]) tMap[t.project_id] = [];
        tMap[t.project_id].push(t);
      });
      setTranchesByProjectId(tMap);

      setProjects(data || []);
    } catch (e) {
      setFetchError(e.message || 'Failed to load FMR projects.');
    } finally {
      setLoading(false);
    }
  }

  // Compute stats
  const stats = {
    total: projects.length,
    ongoing: projects.filter(p => normalizeUserProjectStatus(p.status) === 'On-Going').length,
    proposed: projects.filter(p => normalizeUserProjectStatus(p.status) === 'Proposed').length,
    completed: projects.filter(p => normalizeUserProjectStatus(p.status) === 'Completed').length,
    overdue: projects.filter((p) => isProjectOverdue(p)).length,
    totalKm: projects.reduce((sum, p) => sum + (p.project_length_km || 0), 0).toFixed(2),
  };

  const completionRate = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;

  const getReportedCount = (project) => {
    const key = normalizeProjectName(project).toLowerCase().trim();
    return reportCountByProject[key] || 0;
  };

  const yearOptions = [...new Set(projects.map((p) => Number(p.year_funded)).filter((y) => y && !Number.isNaN(y)))].sort((a, b) => b - a);
  const municipalityOptions = [...new Set(projects.map((p) => p.municipality).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  // Filter logic
  const filtered = projects.filter(p => {
    const name = (p.project_name || '').toLowerCase();
    const loc = (p.location || '').toLowerCase();
    const muni = (p.municipality || '').toLowerCase();
    const q = search.toLowerCase();

    const matchesSearch = !q || name.includes(q) || loc.includes(q) || muni.includes(q);
    const matchesStatus = statusFilter === 'Overdue'
      ? isProjectOverdue(p)
      : normalizeUserProjectStatus(p.status) === statusFilter;
    const matchesYear = yearFilter === 'All' || String(Number(p.year_funded)) === yearFilter;
    const matchesMunicipality = municipalityFilter === 'All' || p.municipality === municipalityFilter;
    const matchesDate = inDateRange(getProjectDate(p), dateFrom, dateTo);
    return matchesSearch && matchesStatus && matchesYear && matchesMunicipality && matchesDate;
  }).sort((a, b) => {
    if (sortBy === 'name-asc') {
      return (a.project_name || '').localeCompare(b.project_name || '');
    }
    if (sortBy === 'name-desc') {
      return (b.project_name || '').localeCompare(a.project_name || '');
    }
    if (sortBy === 'progress-desc') {
      return (Number(b.accomplishment) || 0) - (Number(a.accomplishment) || 0);
    }
    if (sortBy === 'progress-asc') {
      return (Number(a.accomplishment) || 0) - (Number(b.accomplishment) || 0);
    }
    if (sortBy === 'budget-desc' || sortBy === 'budget-asc') {
      const aBudget = getProjectBudgetSummary(a, tranchesByProjectId[a.id] || []).totalBudget || 0;
      const bBudget = getProjectBudgetSummary(b, tranchesByProjectId[b.id] || []).totalBudget || 0;
      return sortBy === 'budget-desc' ? bBudget - aBudget : aBudget - bBudget;
    }
    if (sortBy === 'year-desc' || sortBy === 'year-asc') {
      const aYear = Number(a.year_funded) || 0;
      const bYear = Number(b.year_funded) || 0;
      return sortBy === 'year-desc' ? bYear - aYear : aYear - bYear;
    }
    if (sortBy === 'reported-desc') {
      return getReportedCount(b) - getReportedCount(a);
    }
    const aDate = getProjectDate(a)?.getTime() || 0;
    const bDate = getProjectDate(b)?.getTime() || 0;
    return bDate - aDate;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / projectsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedProjects = filtered.slice(
    (safeCurrentPage - 1) * projectsPerPage,
    safeCurrentPage * projectsPerPage
  );

  const handleExportCsv = () => {
    const rows = filtered.map((p) => {
      const status = normalizeUserProjectStatus(p.status);
      const reportedCount = getReportedCount(p);
      const daysDelta = getDaysDeltaFromToday(p.target_completion_date);
      const timeline =
        status !== 'Completed' && typeof daysDelta === 'number'
          ? (daysDelta < 0 ? `${Math.abs(daysDelta)} days overdue` : `${daysDelta} days remaining`)
          : '';

      return {
        project_name: normalizeProjectName(p),
        municipality: p.municipality || '',
        province: p.province || '',
        status,
        fiscal_year: p.year_funded || '',
        accomplishment: Number(p.accomplishment) || 0,
        contractor: p.contractor || p.contractor_name || '',
        target_completion_date: p.target_completion_date || '',
        overdue: isProjectOverdue(p) ? 'Yes' : 'No',
        countdown: timeline,
        most_reported_count: reportedCount,
      };
    });

    const headers = Object.keys(rows[0] || {
      project_name: '', municipality: '', province: '', status: '', fiscal_year: '', accomplishment: '',
      contractor: '', target_completion_date: '', overdue: '', countdown: '', most_reported_count: ''
    });

    const escapeCsv = (value) => {
      const str = String(value ?? '');
      if (str.includes('"') || str.includes(',') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((h) => escapeCsv(row[h])).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `fmr-projects-${statusFilter.toLowerCase()}-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // If a project is selected, detail view will open in a modal overlay rendered below

  return (
    <UserLayout {...layoutProps}>
      <div className="space-y-6">
        {/* Header */}
        <section>
          <div className="flex items-center gap-3 mb-1">
            <div className="size-10 bg-emerald-100 rounded-xl grid place-items-center text-teal-600">
              <Icons.Road />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">FMR Projects</h1>
              <p className="text-slate-500 text-sm">Farm-to-Market Road Development Program - DA RAED Region VI</p>
            </div>
          </div>
        </section>

        {/* Stats Grid */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-5 border border-slate-200/60 animate-pulse">
                <div className="size-10 bg-zinc-200 rounded-xl mb-3" />
                <div className="h-8 w-12 bg-zinc-200 rounded mb-2" />
                <div className="h-4 w-20 bg-zinc-200 rounded" />
              </div>
            ))
          ) : (
            <>
              <StatCard icon={<Icons.Road />} value={stats.total} label="Total Projects" variant="emerald" />
              <StatCard icon={<Icons.Clock />} value={stats.ongoing} label="On-Going" variant="amber" />
              <StatCard icon={<Icons.Lightbulb />} value={stats.pending} label="Pending" variant="violet" />
              <StatCard icon={<Icons.CheckCircle />} value={stats.completed} label="Completed" variant="sky" />
              <StatCard icon={<Icons.Ruler />} value={`${stats.totalKm} km`} label="Total Road Length" variant="default" />
            </>
          )}
        </section>

        {!loading && (
          <section className="bg-white rounded-2xl border border-slate-200/60 p-5">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6">
              <div className="flex-1">
                <div className="h-7 w-full rounded-xl overflow-hidden border border-slate-100 flex bg-slate-100">
                  <div
                    className="h-full bg-teal-500 text-white text-[11px] font-semibold flex items-center justify-center whitespace-nowrap"
                    style={{ width: `${stats.total ? (stats.completed / stats.total) * 100 : 0}%` }}
                  >
                    {stats.total ? `${Math.round((stats.completed / stats.total) * 100)}%` : '0%'}
                  </div>
                  <div
                    className="h-full bg-amber-500 text-white text-[11px] font-semibold flex items-center justify-center whitespace-nowrap"
                    style={{ width: `${stats.total ? (stats.ongoing / stats.total) * 100 : 0}%` }}
                  >
                    {stats.total ? `${Math.round((stats.ongoing / stats.total) * 100)}%` : '0%'}
                  </div>
                  <div
                    className="h-full bg-slate-400 text-white text-[11px] font-semibold flex items-center justify-center whitespace-nowrap"
                    style={{ width: `${stats.total ? (stats.pending / stats.total) * 100 : 0}%` }}
                  >
                    {stats.total ? `${Math.round((stats.pending / stats.total) * 100)}%` : '0%'}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-teal-500" />Completed</span>
                  <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-amber-500" />On-Going</span>
                  <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-slate-400" />Pending</span>
                </div>
              </div>
              <p className="text-sm font-bold text-slate-800 whitespace-nowrap">Overall Completion Rate: {completionRate}%</p>
            </div>
          </section>
        )}

        {/* Error banner */}
        {fetchError && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            <Icons.Warning />
            <div>
              <p className="font-medium">Unable to load FMR projects</p>
              <p className="mt-0.5 text-red-600">{fetchError}</p>
              <p className="mt-1 text-xs text-red-500">
                Make sure the <code className="bg-red-100 px-1 py-0.5 rounded">fmr_projects</code> table exists.
                Run the SQL in <code className="bg-red-100 px-1 py-0.5 rounded">supabase_fmr_projects_migration.sql</code> in your Supabase SQL Editor.
              </p>
            </div>
          </div>
        )}

        {/* Search & Filters */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Icons.Search />
            </div>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, municipality, location..."
              className="w-full pl-10 pr-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-shadow"
            />
          </div>

          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="px-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none min-w-[140px]"
          >
            <option value="All">All Years</option>
            {yearOptions.map((year) => (
              <option key={year} value={String(year)}>FY {year}</option>
            ))}
          </select>

          <select
            value={municipalityFilter}
            onChange={(e) => setMunicipalityFilter(e.target.value)}
            className="px-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none min-w-[170px]"
          >
            <option value="All">All Municipalities</option>
            {municipalityOptions.map((municipality) => (
              <option key={municipality} value={municipality}>{municipality}</option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none min-w-[170px]"
          >
            <option value="latest">Sort: Latest</option>
            <option value="name-asc">Sort: Name A-Z</option>
            <option value="name-desc">Sort: Name Z-A</option>
            <option value="progress-desc">Sort: Progress High to Low</option>
            <option value="progress-asc">Sort: Progress: Low to High</option>
            <option value="budget-desc">Sort: Budget High to Low</option>
            <option value="budget-asc">Sort: Budget Low to High</option>
            <option value="year-desc">Sort: Fiscal Year Newest</option>
            <option value="year-asc">Sort: Fiscal Year Oldest</option>
            <option value="reported-desc">Sort: Most Reported</option>
          </select>

          <button
            onClick={handleExportCsv}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white shadow-sm whitespace-nowrap"
            title="Export currently visible list"
          >
            Export CSV
          </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Start Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                max={dateTo || undefined}
                aria-label="Start Date"
                title="Start Date"
                className="w-full px-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">End Date</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                min={dateFrom || undefined}
                aria-label="End Date"
                title="End Date"
                className="w-full px-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
              />
            </div>
          </div>

          {/* Status filter pills */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {statusFilters.map(s => {
              const count =
                s === 'On-Going'
                  ? stats.ongoing
                  : s === 'Proposed'
                  ? stats.proposed
                  : s === 'Completed'
                  ? stats.completed
                  : stats.overdue;
              return (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setCurrentPage(1); }}
                  className={`px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                    statusFilter === s
                      ? s === 'Overdue'
                        ? 'bg-red-600 text-white shadow-sm'
                        : 'bg-teal-600 text-white shadow-sm'
                      : s === 'Overdue'
                      ? 'bg-white text-red-600 border border-red-200 hover:bg-red-50'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {s} {!loading && <span className="text-xs opacity-75">({count})</span>}
                </button>
              );
            })}
          </div>

          {(search || statusFilter !== 'On-Going' || yearFilter !== 'All' || municipalityFilter !== 'All' || dateFrom || dateTo || sortBy !== 'latest') && (
            <div className="flex justify-end">
              <button
                onClick={() => {
                  setSearch('');
                  setStatusFilter('On-Going');
                  setYearFilter('All');
                  setMunicipalityFilter('All');
                  setDateFrom('');
                  setDateTo('');
                  setSortBy('latest');
                  setCurrentPage(1);
                }}
                className="px-3 py-2 rounded-lg text-sm font-medium text-teal-700 hover:text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-100 transition-colors"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>

        {/* Results count + view toggle */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-400">{filtered.length} project{filtered.length !== 1 ? 's' : ''} found</p>
          <div className="flex gap-1.5 p-1 bg-slate-100 rounded-2xl w-fit">
            {[
              { id: 'table', label: 'Table', icon: <Icons.List /> },
              { id: 'cards', label: 'Cards', icon: <Icons.Dashboard /> },
            ].map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setViewMode(v.id)}
                aria-pressed={viewMode === v.id}
                title={`${v.label} view`}
                className={`px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-all duration-200 ${
                  viewMode === v.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {v.icon}
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* Projects list - tabular by default, cards on request */}
        {!loading && filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/60 py-16 text-center">
            <div className="mx-auto size-14 bg-slate-100 rounded-xl grid place-items-center text-slate-400 mb-3">
              <Icons.Road />
            </div>
            <p className="font-medium text-slate-900">
              {search || statusFilter !== 'On-Going' ? 'No matching FMR projects' : 'No FMR projects loaded'}
            </p>
            <p className="text-sm text-slate-500 mt-1">
              {search || statusFilter !== 'On-Going'
                ? 'Try adjusting your search or filters'
                : 'Run the SQL migration to load DA-RAED data'}
            </p>
          </div>
        ) : viewMode === 'table' ? (
          <FMRProjectTable
            projects={paginatedProjects}
            loading={loading}
            onSelect={setSelectedProject}
            tranchesByProjectId={tranchesByProjectId}
            sortBy={sortBy}
            onSortChange={setSortBy}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => <ProjectSkeleton key={i} />)
              : paginatedProjects.map(p => (
                  <FMRProjectCard key={p.id} project={p} onClick={() => setSelectedProject(p)} tranches={tranchesByProjectId[p.id] || []} />
                ))}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <p className="text-sm text-slate-500">
                Showing <span className="font-semibold text-slate-700">{(safeCurrentPage - 1) * projectsPerPage + 1}</span> to{' '}
                <span className="font-semibold text-slate-700">{Math.min(safeCurrentPage * projectsPerPage, filtered.length)}</span> of{' '}
                <span className="font-semibold text-slate-700">{filtered.length}</span> project{filtered.length !== 1 ? 's' : ''}
              </p>
              {viewMode === 'table' && (
                <select
                  value={rowsPerPage}
                  onChange={(e) => setRowsPerPage(Number(e.target.value))}
                  aria-label="Rows per page"
                  title="Rows per page"
                  className="px-3 py-2 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                >
                  {ROWS_PER_PAGE_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n} / page</option>
                  ))}
                </select>
              )}
            </div>
            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={safeCurrentPage === 1}
                  className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-white hover:border-slate-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                {getPaginationRange(safeCurrentPage, totalPages).map((page, idx) => (
                  page === '...' ? (
                    <span key={`dots-${idx}`} className="px-3 py-2 text-slate-400 text-sm font-semibold select-none">...</span>
                  ) : (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                        safeCurrentPage === page
                          ? 'bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-lg shadow-teal-500/25'
                          : 'border border-slate-200 hover:bg-white hover:border-slate-300 shadow-sm'
                      }`}
                    >
                      {page}
                    </button>
                  )
                ))}
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={safeCurrentPage === totalPages}
                  className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-white hover:border-slate-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}

        {/* Source Footer */}
        {!loading && projects.length > 0 && (
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-center">
            <p className="text-xs text-slate-400">
              Data from Department of Agriculture - RAED Region VI &middot; Farm-to-Market Road Development Program (FMRDP)
            </p>
          </div>
        )}

        {!embedded && showBackToTop && (
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="fixed bottom-6 right-6 z-20 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium shadow-lg"
          >
            Back to top
          </button>
        )}
      </div>

      {selectedProject && createPortal(
        <>
          <style>{`
            @keyframes modal-backdrop-in {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes modal-content-in {
              from { opacity: 0; transform: scale(0.96) translateY(12px); }
              to { opacity: 1; transform: scale(1) translateY(0); }
            }
            .modal-backdrop-animate {
              animation: modal-backdrop-in 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }
            .modal-content-animate {
              animation: modal-content-in 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }
          `}</style>
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm modal-backdrop-animate"
            onClick={() => setSelectedProject(null)}
          >
            <div
              className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-slate-50 shadow-2xl relative modal-content-animate"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between gap-4 border-b border-slate-200/60 px-8 py-6 bg-white rounded-t-2xl">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Project Details</p>
                  <h3 className="mt-1 text-xl sm:text-2xl font-bold text-slate-900 leading-snug">
                    {normalizeProjectName(selectedProject)}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">DA-RAED Region VI &middot; Farm-to-Market Road Development Program</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border uppercase tracking-wider ${getStatusStyle(normalizeUserProjectStatus(selectedProject.status)).badge}`}>
                    {normalizeUserProjectStatus(selectedProject.status)}
                  </span>
                  <button
                    onClick={() => setSelectedProject(null)}
                    className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors shadow-xs"
                    aria-label="Close modal"
                  >
                    <Icons.X />
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="p-8 space-y-6">
                <FMRProjectDetail
                  project={selectedProject}
                  onBack={() => setSelectedProject(null)}
                  tranches={tranchesByProjectId[selectedProject.id] || []}
                  isModal={true}
                />
              </div>

              {/* Modal Footer */}
              <div className="flex justify-end gap-3 border-t border-slate-200/60 px-8 py-5 bg-white">
                <button
                  type="button"
                  onClick={() => setSelectedProject(null)}
                  className="rounded-xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </UserLayout>
  );
}



