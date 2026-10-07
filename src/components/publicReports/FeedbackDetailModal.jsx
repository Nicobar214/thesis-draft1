import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleMarker, MapContainer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, MapPinIcon } from 'lucide-react';

import Modal from '../ui/Modal';
import BaseTiles from '../map/BaseTiles';
import CitizenReportTimeline from './CitizenReportTimeline';
import SupportReportControl from './SupportReportControl';
import { supabase } from '../../lib/supabase';
import { getCitizenStatus, resolveCategory, resolveSpecificProblem, SEVERITY_TAXONOMY } from '../../lib/publicReportStatus';
import { CITIZEN_STATUS_HEX } from '../../lib/useMyReports';

const FEEDBACK_TYPE_LABELS = {
  issue: 'Road Condition',
  suggestion: 'Maintenance Request',
  compliment: 'Project Appreciation',
  concern: 'Safety Hazard',
};

// Plain statements of what happens next, with no promised timeframes.
const NEXT_STEP = {
  submitted: 'Staff will look at your report next and decide whether a site visit is needed.',
  under_review: 'Staff are reviewing it. If a visit is needed, a field engineer will be assigned.',
  inspection_scheduled: 'A field engineer is assigned to check the site in person.',
  under_verification: 'The engineer\'s findings are being checked before the report is resolved.',
  resolved: 'This report is done. If the problem comes back, you can file a new one.',
  closed: 'It was closed without a site visit. If the road is still damaged, file a new report with fresh photos.',
};

function fmtDateTime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function verificationTone(v) {
  if (v === 'Verified On-Site') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (v === 'Needs Review') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800 break-words">{children}</dd>
    </div>
  );
}

/**
 * Full detail for one Community Feedback entry. `item` is the combined list row; `report`
 * is the citizen-view row behind it when the entry is (or links to) a road report, which
 * is what carries the photos' location, status stage, severity and milestone dates.
 * Mount with a `key` per entry so its fetched state starts fresh.
 */
export default function FeedbackDetailModal({ item, report, support = null, onSupportChange, items = [], onSelect, onClose }) {
  const [finding, setFinding] = useState(null);
  const [resolution, setResolution] = useState(null);
  const [photoIndex, setPhotoIndex] = useState(0);

  const reportId = report?.id || null;
  useEffect(() => {
    if (!reportId) return undefined;
    let alive = true;
    (async () => {
      const [findingRes, resolutionRes] = await Promise.allSettled([
        supabase.from('public_report_field_findings_citizen_view').select('*').eq('report_id', reportId).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('public_report_resolutions_citizen_view').select('*').eq('report_id', reportId).order('resolved_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (!alive) return;
      const row = (res) => (res.status === 'fulfilled' && !res.value.error ? res.value.data || null : null);
      setFinding(row(findingRes));
      setResolution(row(resolutionRes));
    })();
    return () => { alive = false; };
  }, [reportId]);

  const index = items.findIndex((x) => x.id === item.id);
  const prev = index > 0 ? items[index - 1] : null;
  const next = index >= 0 && index < items.length - 1 ? items[index + 1] : null;
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft' && prev) onSelect?.(prev);
      if (e.key === 'ArrowRight' && next) onSelect?.(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onSelect]);

  const photos = item.photo_urls || [];
  const place = [report?.street, item.barangay, item.municipality].filter(Boolean).join(', ');
  const lat = Number(report?.latitude ?? item.latitude);
  const lng = Number(report?.longitude ?? item.longitude);
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);

  const stage = report ? getCitizenStatus(report) : null;
  const pinColor = (stage && CITIZEN_STATUS_HEX[stage.key]) || '#0d9488';
  const category = useMemo(() => (report ? resolveCategory(report) : null), [report]);
  const problem = useMemo(() => (report ? resolveSpecificProblem(report) : null), [report]);
  const typeLabel = report && item._type === 'public_report' ? 'Road report' : FEEDBACK_TYPE_LABELS[item.type] || 'Feedback';

  return (
    <Modal
      onClose={onClose}
      size="xl"
      title={item.project_name || 'General Feedback'}
      description={place || undefined}
      footer={(
        <>
          {items.length > 1 && index >= 0 && (
            <div className="mr-auto flex items-center gap-1">
              <button type="button" onClick={() => prev && onSelect?.(prev)} disabled={!prev} aria-label="Previous entry" className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent">
                <ChevronLeftIcon className="size-4" aria-hidden="true" />
              </button>
              <span className="min-w-14 text-center text-xs tabular-nums text-slate-500">{index + 1} of {items.length}</span>
              <button type="button" onClick={() => next && onSelect?.(next)} disabled={!next} aria-label="Next entry" className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent">
                <ChevronRightIcon className="size-4" aria-hidden="true" />
              </button>
            </div>
          )}
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Close
          </button>
          {report && item._isMine && (
            <Link to={`/user/reports?report=${report.id}`} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
              Open in My Reports
            </Link>
          )}
        </>
      )}
    >
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* Left: what was reported */}
        <div className="space-y-5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">{typeLabel}</span>
            {stage && (
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${stage.tone}`}>{stage.label}</span>
            )}
            {!stage && item.status && (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-slate-700">{item.status}</span>
            )}
          </div>

          {photos.length > 0 && (
            <div className="space-y-2">
              <a href={photos[photoIndex]} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                <img src={photos[photoIndex]} alt={`Report photo ${photoIndex + 1} of ${photos.length}`} className="h-64 w-full object-cover" />
              </a>
              {photos.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-0.5">
                  {photos.map((url, i) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setPhotoIndex(i)}
                      aria-label={`Show photo ${i + 1}`}
                      aria-pressed={i === photoIndex}
                      className={`shrink-0 overflow-hidden rounded-lg border-2 ${i === photoIndex ? 'border-emerald-600' : 'border-transparent opacity-70 hover:opacity-100'}`}
                    >
                      <img src={url} alt="" className="size-14 object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {item._isMine ? 'What you wrote' : 'What was reported'}
            </p>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-800">{item.message || 'No description provided.'}</p>
          </div>

          {support && report && (
            <SupportReportControl
              reportId={report.id}
              count={support.count}
              mine={support.mine}
              canSupport={support.canSupport}
              onChange={(count, mine) => onSupportChange?.(report.id, count, mine)}
            />
          )}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-slate-100 pt-4">
            <Fact label="Filed">{fmtDateTime(item.created_at) || '-'}</Fact>
            {category && (
              <Fact label="Issue">
                {SEVERITY_TAXONOMY[category]?.label || category}
                {problem?.label && <span className="block text-xs text-slate-500">{problem.label}</span>}
              </Fact>
            )}
            {place && <Fact label="Location">{place}</Fact>}
            {item.verification && (
              <Fact label="Location check">
                <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${verificationTone(item.verification)}`}>{item.verification}</span>
              </Fact>
            )}
            {report?.geo_accuracy != null && Number.isFinite(Number(report.geo_accuracy)) && (
              <Fact label="GPS accuracy">About {Math.round(Number(report.geo_accuracy))} m</Fact>
            )}
          </dl>
        </div>

        {/* Right: where it is and how it is going */}
        <div className="space-y-5 min-w-0">
          {hasPoint && (
            <div className="space-y-2">
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <MapContainer
                  center={[lat, lng]}
                  zoom={16}
                  className="h-44 w-full z-0"
                  scrollWheelZoom={false}
                  zoomControl={false}
                  attributionControl={false}
                >
                  <BaseTiles basemap="street" />
                  <CircleMarker center={[lat, lng]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: pinColor, fillOpacity: 1 }} />
                </MapContainer>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <MapPinIcon className="size-3.5" aria-hidden="true" /> {lat.toFixed(5)}, {lng.toFixed(5)}
                </span>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
                >
                  Open in Google Maps <ExternalLinkIcon className="size-3" aria-hidden="true" />
                </a>
              </div>
            </div>
          )}

          {report && stage && NEXT_STEP[stage.key] && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-sky-700">What happens next</p>
              <p className="mt-1 text-sm text-sky-950">{NEXT_STEP[stage.key]}</p>
              {(stage.key === 'resolved' || stage.key === 'closed') && (
                <Link to="/user/reports?action=new" className="mt-2.5 inline-flex rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400">
                  File a new report
                </Link>
              )}
            </div>
          )}

          {report ? (
            <CitizenReportTimeline report={report} finding={finding} resolution={resolution} />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-800">Community feedback</p>
              <p className="mt-1">
                This entry is not linked to a road report, so there is no inspection progress to show. Its status is
                {' '}<span className="font-semibold capitalize">{item.status || 'pending'}</span>.
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
