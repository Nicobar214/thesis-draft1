/* The facts a field engineer needs about an assignment, shown at the top of
 * the On-Site Field Inspection modal: what was reported, where, when, who fixes
 * it, and (once submitted) the engineer's own findings with their geotag. */
import { useEffect, useState } from 'react';
import { MapPinIcon } from 'lucide-react';
import { supabaseFieldEngineer as supabase } from '../../lib/supabase';
import { handlerFor, handlerLabel, resolveCategory, resolveSpecificProblem, SEVERITY_TAXONOMY, siteRatingLabel } from '../../lib/publicReportStatus';
import { formatDistance, haversineMeters, toPoint } from './routeGeometry';
import ZoomablePhoto from '../ui/ZoomablePhoto';

const fmtDateTime = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
};

function Detail({ label, children, wide = false }) {
  if (children == null || children === '' || children === false) return null;
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

function Card({ title, aside = null, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
        {aside}
      </div>
      {children}
    </section>
  );
}

/* The engineer's latest submitted inspection for the report (none while it is
 * still assigned or being inspected). */
function useSubmittedFinding(reportId) {
  const [state, setState] = useState({ reportId: null, finding: null });
  useEffect(() => {
    if (!reportId) return undefined;
    let active = true;
    supabase
      .from('public_report_field_findings')
      .select('*')
      .eq('report_id', reportId)
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (active) setState({ reportId, finding: data || null }); });
    return () => { active = false; };
  }, [reportId]);
  return state.reportId === reportId ? state.finding : null;
}

export default function FieldEngineerReportDetails({ report }) {
  const finding = useSubmittedFinding(report?.id);
  if (!report) return null;

  const category = resolveCategory(report);
  const type = SEVERITY_TAXONOMY[category];
  const problem = resolveSpecificProblem(report);
  const handler = handlerLabel(handlerFor(report));
  const sitePoint = toPoint(report.latitude, report.longitude);
  const inspectedPoint = finding ? toPoint(finding.inspection_latitude, finding.inspection_longitude) : null;
  const offset = sitePoint && inspectedPoint ? haversineMeters(sitePoint, inspectedPoint) : null;
  const rating = siteRatingLabel(finding?.site_rating);
  const mapsLink = sitePoint ? `https://www.google.com/maps?q=${sitePoint[0]},${sitePoint[1]}` : null;

  return (
    <div className="space-y-4">
      <Card
        title="Report details"
        aside={type && <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${type.color}`}>{type.label}</span>}
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Detail label="Problem">{problem?.label || type?.description}</Detail>
          <Detail label="Fixed by">{handler && `${handler}${handlerFor(report) === 'lgu' ? ' · minor issue' : ' · major issue'}`}</Detail>
          <Detail label="Citizen's description" wide>{report.description}</Detail>
          <Detail label="Location">
            {[report.street, report.barangay, report.municipality].filter(Boolean).join(', ') || 'Unknown location'}
          </Detail>
          <Detail label="Reported position">
            {sitePoint && (
              <a href={mapsLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-teal-700 hover:underline">
                <MapPinIcon className="size-3.5" aria-hidden="true" />
                {sitePoint[0].toFixed(6)}, {sitePoint[1].toFixed(6)}
                {report.geo_accuracy != null && <span className="text-slate-400"> · ±{Math.round(report.geo_accuracy)} m</span>}
              </a>
            )}
          </Detail>
          <Detail label="FMR project">{report.project_name}</Detail>
          <Detail label="Reported">{fmtDateTime(report.created_at)}</Detail>
          <Detail label="Assigned to you">{fmtDateTime(report.assigned_at)}</Detail>
          <Detail label="Resolved">{fmtDateTime(report.resolved_at)}</Detail>
        </dl>
      </Card>

      {finding && (
        <Card
          title={`Your inspection${finding.inspection_number > 1 ? ` #${finding.inspection_number}` : ''}`}
          aside={finding.validated_at
            ? <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Validated {fmtDateTime(finding.validated_at)}</span>
            : <span className="rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">Waiting on DA</span>}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Condition observed" wide>{finding.condition_observed}</Detail>
              <Detail label="Recommended action" wide>{finding.recommended_action}</Detail>
              <Detail label="Road condition">{rating && `${finding.site_rating}/5 · ${rating}`}</Detail>
              <Detail label="Estimated repair cost">
                {finding.estimated_cost_range && (
                  <>{finding.estimated_cost_range} <span className="text-xs text-slate-400">(estimate only)</span></>
                )}
              </Detail>
              <Detail label="Inspected">{fmtDateTime(finding.submitted_at)}</Detail>
              <Detail label="Your position">
                {inspectedPoint && (
                  <span className="font-mono text-xs">
                    {inspectedPoint[0].toFixed(6)}, {inspectedPoint[1].toFixed(6)}
                    {finding.gps_accuracy_meters != null && <span className="text-slate-400"> · ±{Math.round(finding.gps_accuracy_meters)} m</span>}
                  </span>
                )}
              </Detail>
              <Detail label="Distance from reported pin">{offset != null && formatDistance(offset)}</Detail>
              <Detail label="Certified">{fmtDateTime(finding.engineer_certified_at)}</Detail>
            </dl>
            {finding.field_photo_url && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Your on-site photo</p>
                <ZoomablePhoto
                  src={finding.field_photo_url}
                  alt="Your on-site inspection photo"
                  label="Engineer's on-site photo"
                  wrapperClassName="w-full rounded-lg"
                  className="h-40 w-full rounded-lg border border-slate-200 object-cover"
                />
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
