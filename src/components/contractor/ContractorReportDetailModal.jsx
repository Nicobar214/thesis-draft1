import { useEffect, useState } from 'react';
import {
  CalendarClockIcon,
  CheckIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  HardHatIcon,
  MapPinIcon,
  MessageSquareTextIcon,
  RouteIcon,
  ShieldCheckIcon,
  XIcon,
} from 'lucide-react';

import SeverityIcon from '../SeverityIcon';
import ZoomablePhoto from '../ui/ZoomablePhoto';
import PublicReportRouteMapPanel from '../publicReports/PublicReportRouteMapPanel';
import { buttonClass } from '../ui/Button';
import { MODAL_OVERLAY, MODAL_PANEL, ModalEffects } from '../ui/Modal';
import { HANDLER_REPORT_STEPS, handlerReportStatus } from '../../lib/handlerFollowUps';
import { formatPercentage } from '../../lib/percentageFormat';
import {
  SEVERITY_TAXONOMY,
  resolveCategory,
  resolveSpecificProblem,
  siteRatingLabel,
} from '../../lib/publicReportStatus';

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* A titled white card; the building block of the window. */
function Card({ icon: Icon, title, aside, children, tone = 'border-slate-200 bg-white' }) {
  return (
    <section className={`rounded-2xl border p-4 shadow-xs ${tone}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
          {Icon && <Icon className="size-4 text-slate-400" aria-hidden="true" />}
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/* Where the report is: DA review → inspection → assigned → repair → DA check → resolved. */
function StatusSteps({ statusKey }) {
  if (statusKey === 'closed') {
    return <p className="text-xs font-semibold text-slate-600">The DA closed this report without a repair.</p>;
  }
  const current = Math.max(0, HANDLER_REPORT_STEPS.findIndex((s) => s.keys.includes(statusKey)));
  return (
    <ol className="flex items-center">
      {HANDLER_REPORT_STEPS.map((step, i) => {
        const done = i < current || statusKey === 'resolved';
        const active = i === current && statusKey !== 'resolved';
        return (
          <li key={step.label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <span className={`grid size-6 place-items-center rounded-full text-[10px] font-bold ${
                done ? 'bg-emerald-600 text-white' : active ? 'bg-teal-600 text-white ring-4 ring-teal-100' : 'bg-slate-200 text-slate-500'
              }`}>
                {done ? <CheckIcon className="size-3.5" aria-hidden="true" /> : i + 1}
              </span>
              <span className={`whitespace-nowrap text-[10px] font-semibold ${active ? 'text-teal-700' : done ? 'text-slate-700' : 'text-slate-400'}`}>{step.label}</span>
            </div>
            {i < HANDLER_REPORT_STEPS.length - 1 && (
              <span className={`mx-1 mb-4 h-0.5 flex-1 rounded ${i < current || statusKey === 'resolved' ? 'bg-emerald-500' : 'bg-slate-200'}`} aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A citizen report on one of the contractor's roads. Order of reading:
 *   1. what the problem is and where it stands (header + progress);
 *   2. the evidence: the citizen's photo and words, and the map with the
 *      project's route and the report pin;
 *   3. the work: project, the DA engineer's findings, the repair job;
 *   4. the contractor's own remark.
 */
export default function ContractorReportDetailModal({ client, report, project, action, finding, onClose, onOpenProject, onSaveRemark }) {
  const [remark, setRemark] = useState(report?.contractor_remark || '');
  const [saving, setSaving] = useState(false);
  // Full project row + saved route, for the map.
  const [mapProject, setMapProject] = useState(null);
  const [route, setRoute] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!client || !project?.id) return undefined;
    Promise.all([
      client.from('fmr_projects').select('*').eq('id', project.id).maybeSingle(),
      client.from('project_routes').select('*').eq('project_id', project.id).maybeSingle(),
    ]).then(([p, r]) => {
      if (!alive) return;
      setMapProject(p.data || null);
      setRoute(r.data || null);
    });
    return () => { alive = false; };
  }, [client, project?.id]);

  if (!report) return null;

  const category = resolveCategory(report);
  const type = SEVERITY_TAXONOMY[category];
  const problem = resolveSpecificProblem(report)?.label || type?.label;
  const status = handlerReportStatus(report, action);
  const reference = String(report.id || '').slice(0, 8).toUpperCase();
  const place = [report.barangay && `Brgy. ${report.barangay}`, report.municipality].filter(Boolean).join(', ');
  const mapUrl = report.latitude != null && report.longitude != null
    ? `https://www.google.com/maps/search/?api=1&query=${report.latitude},${report.longitude}`
    : null;
  const remarkChanged = remark.trim() !== (report.contractor_remark || '').trim();
  const progress = Math.round(Number(project?.accomplishment || 0));

  const save = async () => {
    setSaving(true);
    try {
      await onSaveRemark(report.id, remark.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={MODAL_OVERLAY} onClick={onClose}>
      <ModalEffects onClose={onClose} />
      <div className={`${MODAL_PANEL} max-w-5xl`} role="dialog" aria-modal="true" aria-label="Citizen report details" onClick={(e) => e.stopPropagation()}>
        {/* 1. What it is, and where it stands */}
        <header className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3.5">
              <span className={`grid size-12 shrink-0 place-items-center rounded-2xl border ${type?.color || ''}`}>
                <SeverityIcon category={category} className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{type?.label}</p>
                <h2 className="truncate text-lg font-bold text-slate-900">{problem}</h2>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                  <span className="font-mono font-semibold text-slate-600">#{reference}</span>
                  <span>·</span>
                  <span>{fmtDate(report.created_at)}</span>
                  {place && <><span>·</span><span>{place}</span></>}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-start gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <XIcon className="size-5" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="mt-4">
            <StatusSteps statusKey={status.key} />
          </div>
        </header>

        <div className="grid flex-1 gap-5 overflow-y-auto bg-slate-50/70 p-5 lg:grid-cols-5">
          {/* 2. The evidence */}
          <div className="space-y-5 lg:col-span-3">
            <Card icon={MessageSquareTextIcon} title="Citizen's report">
              {report.photo_url && (
                <ZoomablePhoto
                  src={report.photo_url}
                  alt="Citizen's photo of the problem"
                  label="Citizen's on-site photo"
                  wrapperClassName="mb-3 w-full rounded-xl"
                  className="h-56 w-full rounded-xl border border-slate-200 object-cover"
                />
              )}
              <p className="text-sm leading-relaxed text-slate-700">
                {report.description ? <>&ldquo;{report.description}&rdquo;</> : <span className="italic text-slate-400">No description given.</span>}
              </p>
              {report.verification && (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                  <ShieldCheckIcon className="size-3.5" aria-hidden="true" /> GPS check: {report.verification}
                </p>
              )}
            </Card>

            <Card
              icon={RouteIcon}
              title="Location on the project road"
              aside={mapUrl && (
                <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline">
                  <MapPinIcon className="size-3.5" aria-hidden="true" /> Google Maps <ExternalLinkIcon className="size-3" aria-hidden="true" />
                </a>
              )}
            >
              <div className="-mx-1 overflow-hidden rounded-xl">
                <PublicReportRouteMapPanel
                  project={mapProject || project}
                  routeRecord={route}
                  reportLatitude={report.latitude}
                  reportLongitude={report.longitude}
                  heightClass="h-64"
                  title={null}
                />
              </div>
            </Card>
          </div>

          {/* 3–4. The work, then the contractor's remark */}
          <div className="space-y-5 lg:col-span-2">
            <Card icon={RouteIcon} title="Project">
              <button
                type="button"
                onClick={() => onOpenProject(project)}
                disabled={!project}
                className="group w-full text-left disabled:cursor-default"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900 group-hover:text-teal-700">{project?.project_name || report.project_name || 'Unlinked road'}</span>
                  {project && <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-slate-400 group-hover:text-teal-700" aria-hidden="true" />}
                </span>
                {project && (
                  <>
                    <span className="mt-1 block text-xs text-slate-500">{project.status || 'No status'} · {project.municipality}</span>
                    <span className="mt-3 flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <span className="block h-full rounded-full bg-teal-500" style={{ width: `${Math.min(100, progress)}%` }} />
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-slate-700">{formatPercentage(project.accomplishment ?? 0)}</span>
                    </span>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-teal-700">Open project details <ChevronRightIcon className="size-3.5" aria-hidden="true" /></span>
                  </>
                )}
              </button>
            </Card>

            {finding ? (
              <Card icon={ShieldCheckIcon} title="DA engineer's findings" tone="border-emerald-200 bg-emerald-50/40">
                <dl className="space-y-2.5 text-sm text-slate-800">
                  <div><dt className="text-xs font-semibold text-slate-500">Condition</dt><dd className="mt-0.5">{finding.condition_observed || '—'}</dd></div>
                  <div><dt className="text-xs font-semibold text-slate-500">Recommended action</dt><dd className="mt-0.5">{finding.recommended_action || '—'}</dd></div>
                  {finding.estimated_cost_range && (
                    <div>
                      <dt className="text-xs font-semibold text-slate-500">Estimated repair cost</dt>
                      <dd className="mt-0.5">{finding.estimated_cost_range} <span className="text-xs text-slate-400">(estimate only, not a payment)</span></dd>
                    </div>
                  )}
                  {siteRatingLabel(finding.site_rating) && (
                    <div><dt className="text-xs font-semibold text-slate-500">Road rating</dt><dd className="mt-0.5">{siteRatingLabel(finding.site_rating)} ({finding.site_rating}/5)</dd></div>
                  )}
                </dl>
                {finding.field_photo_url && (
                  <ZoomablePhoto
                    src={finding.field_photo_url}
                    alt="Engineer's photo"
                    label="Engineer's on-site photo"
                    wrapperClassName="mt-3 w-full"
                    className="h-32 w-full rounded-lg border border-emerald-200 object-cover"
                  />
                )}
              </Card>
            ) : (
              <Card icon={ShieldCheckIcon} title="DA engineer's findings">
                <p className="text-sm text-slate-500">Not inspected yet.</p>
              </Card>
            )}

            {action && action.status !== 'cancelled' && (
              <Card icon={HardHatIcon} title="Repair job" tone="border-orange-200 bg-orange-50/50">
                <p className="text-sm font-semibold text-slate-900">{status.label}</p>
                <dl className="mt-2 space-y-1 text-xs text-slate-600">
                  {action.target_date && (
                    <div className="flex items-center gap-1.5"><CalendarClockIcon className="size-3.5 text-slate-400" aria-hidden="true" /><dt>DA target</dt><dd className="font-semibold text-slate-800">{fmtDate(action.target_date)}</dd></div>
                  )}
                  {action.work_date && (
                    <div className="flex items-center gap-1.5"><CalendarClockIcon className="size-3.5 text-slate-400" aria-hidden="true" /><dt>Your work date</dt><dd className="font-semibold text-slate-800">{fmtDate(action.work_date)}</dd></div>
                  )}
                </dl>
                {action.status === 'planned' && (
                  <p className="mt-2 text-xs text-slate-500">Update it in Citizen Report Repairs.</p>
                )}
              </Card>
            )}

            <Card icon={MessageSquareTextIcon} title="Your remark">
              <textarea
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                rows={3}
                placeholder="e.g. Section is under warranty; crew scheduled next week"
                className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400">{report.contractor_remark_at ? `Saved ${fmtDate(report.contractor_remark_at)}` : 'Visible to the DA'}</span>
                <button type="button" onClick={save} disabled={saving || !remarkChanged} className={buttonClass('primary', 'sm')}>
                  {saving ? 'Saving...' : 'Save remark'}
                </button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
