/**
 * The one "Project Details" dialog for FMR projects.
 *
 * Used by both the FMR Projects page and the Map View, so a project always looks
 * the same wherever it is opened. Change it here and both pages follow.
 *
 *   <FmrProjectDetailDialog project={row} tranches={tranchesForRow} onClose={...} />
 */
import { createPortal } from 'react-dom';
import Icons from './Icons';
import { normalizeProjectName } from '../lib/projectHelpers';
import { getProjectBudgetSummary, formatPeso } from '../lib/budgetEstimate';
import { formatPercentage } from '../lib/percentageFormat';
import { normalizeUserProjectStatus, getStatusStyle } from '../lib/projectStatus';
import { MODAL_OVERLAY, MODAL_PANEL_SCROLL, ModalEffects } from './ui/Modal';
import { buttonClass } from './ui/Button';

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

function ProjectDetailBody({ project, tranches = [] }) {
  const style = getStatusStyle(project.status);
  const hasCoords = project.start_latitude && project.start_longitude;
  const budget = getProjectBudgetSummary(project, tranches);
  const utilizationPct = budget.totalBudget > 0 ? Math.min((budget.released / budget.totalBudget) * 100, 100) : 0;

  return (
    <div className="space-y-6 text-slate-800">
      {/* Progress bar */}
      {project.status !== 'Proposed' && (
        <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-700">Accomplishment</span>
            <span className="text-sm font-bold text-slate-900">{formatPercentage(project.accomplishment ?? 0)}</span>
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
            <span className="text-slate-700 font-bold">{formatPercentage(utilizationPct)}</span>
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

/** "Follow" control for the dialog footer: get notified as the project makes progress. */
function FollowControl({ follow }) {
  if (!follow?.available) return <span />;
  const { following, count, busy, onToggle } = follow;
  return (
    <div className="mr-auto flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={following}
        className={buttonClass(following ? 'secondary' : 'primary')}
      >
        {following ? 'Following ✓' : 'Follow this project'}
      </button>
      <span className="text-xs text-slate-500" aria-live="polite">
        {following
          ? 'You will be notified about its progress.'
          : count > 0
            ? `${count} ${count === 1 ? 'person follows' : 'people follow'} this project`
            : 'Get notified when it starts, passes each 10%, and finishes.'}
      </span>
    </div>
  );
}

export default function FmrProjectDetailDialog({ project, tranches = [], follow = null, onClose }) {
  if (!project || typeof document === 'undefined') return null;
  const status = normalizeUserProjectStatus(project.status);

  return createPortal(
    <div className={MODAL_OVERLAY} onClick={onClose}>
      <ModalEffects onClose={onClose} />
      <div
        className={`${MODAL_PANEL_SCROLL} relative max-w-5xl`}
        style={{ backgroundColor: '#f8fafc' }}
        role="dialog"
        aria-modal="true"
        aria-label="Project details"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-200/60 px-8 py-6 bg-white rounded-t-2xl">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Project Details</p>
            <h3 className="mt-1 text-xl sm:text-2xl font-bold text-slate-900 leading-snug">
              {normalizeProjectName(project)}
            </h3>
            <p className="mt-1 text-sm text-slate-500">DA-RAED Region VI &middot; Farm-to-Market Road Development Program</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border uppercase tracking-wider ${getStatusStyle(status).badge}`}>
              {status}
            </span>
            <button
              onClick={onClose}
              className="rounded-xl p-2.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              aria-label="Close dialog"
            >
              <Icons.X />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-8 space-y-6">
          <ProjectDetailBody project={project} tranches={tranches} />
        </div>

        {/* Modal Footer */}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200/60 px-8 py-5 bg-white">
          <FollowControl follow={follow} />
          <button type="button" onClick={onClose} className={buttonClass('secondary')}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
