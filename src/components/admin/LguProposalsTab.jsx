import { CameraIcon, CheckCircle2Icon, ChevronRightIcon, FileTextIcon, RotateCcwIcon, SearchCheckIcon, TriangleAlertIcon, XCircleIcon } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabaseAdminPortal as supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { MODAL_OVERLAY, MODAL_PANEL, ModalEffects } from '../ui/Modal';
import { buttonClass } from '../ui/Button';
import { getMunicipalities } from '../../data/iloiloLocations';
import { getCropData, computeProposalPriorityScores, scoreTone, rankTone, factorBarTone } from '../../lib/priorityScoring';
import { boundsFromPoints, getMunicipalityCentroid, getPendingDaysChip } from '../../lib/mapRouteUtils';
import { formatPeso } from '../../lib/budgetEstimate';
import { fetchProposalActivity, describeActionType, formatActivityActor } from '../../lib/proposalActivity';

const ATTACHMENTS_BUCKET = 'lgu-proposal-documents';

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const DUPLICATE_DISTANCE_METERS = 400;

function proposalStatusLabel(proposal) {
  if (proposal.status === 'Approved') {
    return proposal.fmr_project_id ? 'Published' : 'Validated — pending creation';
  }
  return proposal.status;
}

function StatusPill({ proposal }) {
  const tones = {
    Submitted: 'bg-sky-50 text-sky-700 border-sky-200',
    'Under Validation': 'bg-indigo-50 text-indigo-700 border-indigo-200',
    'Needs Revision': 'bg-orange-50 text-orange-700 border-orange-200',
    Approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Rejected: 'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${tones[proposal.status] || tones.Submitted}`}>
      {proposalStatusLabel(proposal)}
    </span>
  );
}

/* The DA review pipeline, in forward order. "Needs Revision" and "Rejected"
   are deliberately not part of this array: they're off-ramps a proposal can
   hit from "Under Validation" rather than steps every proposal passes
   through, so they get their own non-numbered row (PROPOSAL_OUTCOME_BUCKETS)
   instead of being numbered 4 and 5 as if rejection always follows approval. */
const PROPOSAL_STATUS_BUCKETS = [
  {
    key: 'Submitted',
    label: 'Submitted',
    hint: 'Newly submitted by the LGU, awaiting DA review',
    icon: FileTextIcon,
    bar: 'bg-sky-500',
    value: 'text-sky-700',
    activeRing: 'ring-sky-500/40 border-sky-400 bg-sky-50/60',
  },
  {
    key: 'Under Validation',
    label: 'Under Validation',
    hint: 'DA is actively reviewing feasibility',
    icon: SearchCheckIcon,
    bar: 'bg-indigo-500',
    value: 'text-indigo-700',
    activeRing: 'ring-indigo-500/40 border-indigo-400 bg-indigo-50/60',
  },
  {
    key: 'Approved',
    label: 'Approved',
    hint: 'Validated as feasible — logged as a project or awaiting creation',
    icon: CheckCircle2Icon,
    bar: 'bg-emerald-500',
    value: 'text-emerald-700',
    activeRing: 'ring-emerald-500/40 border-emerald-400 bg-emerald-50/60',
  },
];

const PROPOSAL_OUTCOME_BUCKETS = [
  {
    key: 'Needs Revision',
    label: 'Needs Revision',
    hint: 'Sent back to the LGU for changes, then resubmitted for validation',
    icon: RotateCcwIcon,
    bar: 'bg-orange-500',
    value: 'text-orange-700',
    activeRing: 'ring-orange-500/40 border-orange-400 bg-orange-50/60',
  },
  {
    key: 'Rejected',
    label: 'Rejected',
    hint: 'Not feasible — closed without becoming a project',
    icon: XCircleIcon,
    bar: 'bg-red-500',
    value: 'text-red-700',
    activeRing: 'ring-red-500/40 border-red-400 bg-red-50/60',
  },
];

function ActivityIcon({ type }) {
  const baseClass = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border';
  const toneClass = {
    submitted: 'border-sky-200 bg-sky-50 text-sky-700',
    resubmitted: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    validated: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    rejected: 'border-red-200 bg-red-50 text-red-700',
    revision_requested: 'border-orange-200 bg-orange-50 text-orange-700',
    published: 'border-teal-200 bg-teal-50 text-teal-700',
    activity: 'border-slate-200 bg-white text-slate-500',
  }[type] || 'border-slate-200 bg-white text-slate-500';

  const iconPaths = {
    submitted: <path strokeLinecap="round" strokeLinejoin="round" d="M12 15V4m0 0 4 4m-4-4-4 4M5 20h14" />,
    resubmitted: <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 8.25H21V3.75M21 8.25l-2.1-2.1a8.25 8.25 0 0 0-13.4 2.8M7.5 15.75H3v4.5m0-4.5 2.1 2.1a8.25 8.25 0 0 0 13.4-2.8" />,
    validated: <path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4.5 4.5L19 7" />,
    rejected: <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />,
    revision_requested: <path strokeLinecap="round" strokeLinejoin="round" d="m16.5 4.5 3 3L8 19H5v-3L16.5 4.5Z" />,
    published: <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h5l10-6v12L9 12H4Zm5 0v5.5" />,
    activity: <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  };

  return (
    <span className={`${baseClass} ${toneClass}`} aria-hidden="true">
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {iconPaths[type] || iconPaths.activity}
      </svg>
    </span>
  );
}

function RouteAutoZoom({ points, fallbackCenter }) {
  const map = useMap();

  useEffect(() => {
    const validPoints = (points || []).filter(([lat, lng]) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)));
    if (validPoints.length >= 2) {
      const bounds = boundsFromPoints(validPoints);
      if (bounds) {
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16, animate: false });
      }
      return;
    }
    if (validPoints.length === 1) {
      map.setView(validPoints[0], 15, { animate: false });
      return;
    }
    if (fallbackCenter) {
      map.setView(fallbackCenter, 12, { animate: false });
    }
  }, [points, fallbackCenter, map]);

  return null;
}

function InfoCard({ label, value, helper }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1.5 text-base font-semibold text-slate-900">{value ?? 'N/A'}</p>
      {helper && <p className="mt-1 text-xs text-slate-500">{helper}</p>}
    </div>
  );
}

function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function minDistanceMeters(proposal, project) {
  const pPoints = [
    [proposal.start_latitude, proposal.start_longitude],
    [proposal.end_latitude, proposal.end_longitude],
  ].filter(([lat, lng]) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)));
  const cPoints = [
    [project.start_latitude, project.start_longitude],
    [project.end_latitude, project.end_longitude],
  ].filter(([lat, lng]) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)));
  if (pPoints.length === 0 || cPoints.length === 0) return Infinity;

  let best = Infinity;
  pPoints.forEach(([lat1, lng1]) => {
    cPoints.forEach(([lat2, lng2]) => {
      const d = haversineMeters(Number(lat1), Number(lng1), Number(lat2), Number(lng2));
      if (d < best) best = d;
    });
  });
  return best;
}

// Combines a text-similarity signal with a geographic-proximity signal --
// either one firing is enough to warn the reviewer, and the reason string
// tells them which (so "same road, different name" and "similar name,
// different road" read as distinctly different warnings).
function findPossibleDuplicate(proposal, fmrProjects) {
  const candidates = (fmrProjects || []).filter((p) => p.municipality === proposal.municipality);
  if (candidates.length === 0) return null;

  const proposalWords = new Set(normalizeForMatch(`${proposal.project_name} ${proposal.barangay}`));

  let best = null;
  candidates.forEach((project) => {
    const projectWords = new Set(normalizeForMatch(`${project.project_name} ${project.location}`));
    const shared = [...proposalWords].filter((w) => projectWords.has(w)).length;
    const textRatio = proposalWords.size && projectWords.size
      ? shared / Math.min(proposalWords.size, projectWords.size)
      : 0;
    const distanceMeters = minDistanceMeters(proposal, project);
    const nameMatch = textRatio >= 0.5;
    const geoMatch = distanceMeters <= DUPLICATE_DISTANCE_METERS;
    if (!nameMatch && !geoMatch) return;

    const candidate = {
      project,
      textRatio,
      distanceMeters,
      nameMatch,
      geoMatch,
      reason: nameMatch && geoMatch ? 'both' : geoMatch ? 'location' : 'name',
    };

    // Prefer geo matches (stronger signal) over name-only, then the closer/tighter one.
    if (
      !best ||
      (candidate.geoMatch && !best.geoMatch) ||
      (candidate.geoMatch === best.geoMatch && candidate.distanceMeters < best.distanceMeters)
    ) {
      best = candidate;
    }
  });

  return best;
}

function LguProposalReviewModal({ proposal, fmrProjects, priorityEntry, onClose, onValidate, onReject, onRequestRevision, onCreateProject }) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState('');
  const [signedUrls, setSignedUrls] = useState({});
  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const isPending = proposal.status === 'Submitted' || proposal.status === 'Under Validation';

  const cropData = useMemo(() => getCropData(proposal.municipality), [proposal.municipality]);
  const duplicate = useMemo(() => findPossibleDuplicate(proposal, fmrProjects), [proposal, fmrProjects]);
  const pendingChip = getPendingDaysChip(proposal.submitted_at, proposal.status);

  useEffect(() => {
    let alive = true;
    setActivityLoading(true);
    fetchProposalActivity(proposal.id)
      .then((rows) => { if (alive) setActivity(rows); })
      .catch(() => { if (alive) setActivity([]); })
      .finally(() => { if (alive) setActivityLoading(false); });
    return () => { alive = false; };
  }, [proposal.id]);

  const hasStart = Number.isFinite(Number(proposal.start_latitude)) && Number.isFinite(Number(proposal.start_longitude));
  const hasEnd = Number.isFinite(Number(proposal.end_latitude)) && Number.isFinite(Number(proposal.end_longitude));
  const waypoints = Array.isArray(proposal.route_waypoints) ? proposal.route_waypoints : [];

  const routePoints = useMemo(() => {
    const points = [];
    if (hasStart) points.push([Number(proposal.start_latitude), Number(proposal.start_longitude)]);
    waypoints.forEach((wp) => {
      const lat = Number(wp?.lat ?? wp?.[0]);
      const lng = Number(wp?.lng ?? wp?.[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng]);
    });
    if (hasEnd) points.push([Number(proposal.end_latitude), Number(proposal.end_longitude)]);
    return points;
  }, [proposal, hasStart, hasEnd]);

  const mapCenter = routePoints[0] || getMunicipalityCentroid(proposal.municipality);

  const openAttachment = async (path) => {
    if (!path) return;
    if (signedUrls[path]) {
      window.open(signedUrls[path], '_blank', 'noopener,noreferrer');
      return;
    }
    const { data } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path, 3600);
    if (data?.signedUrl) {
      setSignedUrls((prev) => ({ ...prev, [path]: data.signedUrl }));
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const runAction = async (action) => {
    if (action !== 'validate' && !notes.trim()) {
      notify('Please add review notes explaining the decision.');
      return;
    }
    setBusy(action);
    try {
      if (action === 'validate') await onValidate(proposal, notes.trim() || null);
      if (action === 'reject') await onReject(proposal, notes.trim());
      if (action === 'revision') await onRequestRevision(proposal, notes.trim());
      onClose();
    } finally {
      setBusy('');
    }
  };

  return (
    <div className={MODAL_OVERLAY} onClick={onClose}>
      <ModalEffects onClose={onClose} />
      <div className={`${MODAL_PANEL} max-w-5xl`} role="dialog" aria-modal="true" aria-label={`Review proposal: ${proposal.project_name}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">LGU Project Proposal</p>
            <h3 className="mt-1 text-xl font-bold text-slate-900">{proposal.project_name}</h3>
            <p className="mt-1 text-sm text-slate-500">{proposal.barangay || 'N/A'}, {proposal.municipality} &middot; submitted by {proposal.submitted_by_name || 'LGU'} on {new Date(proposal.submitted_at).toLocaleDateString()}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill proposal={proposal} />
            {pendingChip && (
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${pendingChip.className}`}>{pendingChip.text}</span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoCard label="Road Type" value={proposal.road_type || 'N/A'} />
            <InfoCard label="Estimated Length" value={`${proposal.estimated_length_km || 0} km`} />
            <InfoCard label="Requested Budget" value={proposal.estimated_budget ? formatPeso(proposal.estimated_budget) : 'Not specified'} />
            <InfoCard label="Target Funding Year" value={proposal.target_funding_year || 'N/A'} />
            <InfoCard label="Beneficiary Farmers" value={proposal.beneficiary_farmers_count || 0} />
            <InfoCard label="Total Farm Area Served" value={proposal.beneficiary_households_count ? `${proposal.beneficiary_households_count} ha` : '0 ha'} />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Proposed Road Location</h4>
            {routePoints.length > 0 ? (
              <>
                <div className="mt-3 flex flex-wrap gap-3 text-xs font-mono">
                  <span className={hasStart ? 'px-2 py-1 rounded-md bg-emerald-50 text-emerald-700' : 'px-2 py-1 rounded-md bg-slate-50 text-slate-400'}>
                    Start: {hasStart ? `${Number(proposal.start_latitude).toFixed(5)}, ${Number(proposal.start_longitude).toFixed(5)}` : 'not set'}
                  </span>
                  <span className={hasEnd ? 'px-2 py-1 rounded-md bg-rose-50 text-rose-700' : 'px-2 py-1 rounded-md bg-slate-50 text-slate-400'}>
                    End: {hasEnd ? `${Number(proposal.end_latitude).toFixed(5)}, ${Number(proposal.end_longitude).toFixed(5)}` : 'not set'}
                  </span>
                  {waypoints.length > 0 && (
                    <span className="px-2 py-1 rounded-md bg-teal-50 text-teal-700">{waypoints.length} waypoint{waypoints.length > 1 ? 's' : ''}</span>
                  )}
                </div>
                <div className="mt-3 rounded-xl overflow-hidden border border-slate-200" style={{ height: '220px' }}>
                  <MapContainer center={mapCenter} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true} dragging={true}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors' />
                    <RouteAutoZoom points={routePoints} fallbackCenter={mapCenter} />
                    {routePoints.length >= 2 && (
                      <Polyline positions={routePoints} pathOptions={{ color: '#0d9488', weight: 4, opacity: 0.9 }} />
                    )}
                    {hasStart && (
                      <Marker
                        position={[Number(proposal.start_latitude), Number(proposal.start_longitude)]}
                        icon={L.divIcon({ className: 'proposal-start', html: '<div style="width:14px;height:14px;background:#059669;border:2px solid #fff;border-radius:9999px;"></div>', iconSize: [14, 14], iconAnchor: [7, 7] })}
                      />
                    )}
                    {hasEnd && (
                      <Marker
                        position={[Number(proposal.end_latitude), Number(proposal.end_longitude)]}
                        icon={L.divIcon({ className: 'proposal-end', html: '<div style="width:10px;height:10px;background:#f97316;border:2px solid #fff;border-radius:9999px;box-shadow:0 0 0 1px rgba(194,65,12,.6),0 1px 3px rgba(0,0,0,.25);"></div>', iconSize: [10, 10], iconAnchor: [5, 5] })}
                      />
                    )}
                  </MapContainer>
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-500">The LGU did not pin exact start/end coordinates for this proposal.</p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Justification</h4>
            <p className="mt-2 text-sm text-slate-700">{proposal.justification}</p>
            {proposal.description && (
              <>
                <h4 className="mt-4 text-sm font-bold text-slate-900 uppercase tracking-wide">Additional Description</h4>
                <p className="mt-2 text-sm text-slate-700">{proposal.description}</p>
              </>
            )}
          </div>

          {(proposal.photo_url || proposal.document_url) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Attachments</h4>
              <div className="mt-3 flex flex-wrap gap-2">
                {proposal.photo_url && (
                  <button type="button" onClick={() => openAttachment(proposal.photo_url)} className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200">
                    <CameraIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />View Road Photo
                  </button>
                )}
                {proposal.document_url && (
                  <button type="button" onClick={() => openAttachment(proposal.document_url)} className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200">
                    <FileTextIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />{proposal.document_name || 'View Document'}
                  </button>
                )}
              </div>
            </div>
          )}



          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Activity History</h4>
            <div className="mt-3 space-y-3">
              {activityLoading ? (
                <p className="text-sm text-slate-500">Loading history…</p>
              ) : activity.length === 0 ? (
                <p className="text-sm text-slate-500">No activity recorded yet.</p>
              ) : (
                activity.map((log) => {
                  const { label, icon } = describeActionType(log.action_type);
                  return (
                    <div key={log.id} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                      <div className="flex gap-3">
                        <ActivityIcon type={icon} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm font-semibold text-slate-900">{label}</p>
                            <p className="text-xs font-medium text-slate-500">{new Date(log.created_at).toLocaleString()}</p>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{formatActivityActor(log)}</p>
                          {log.description && <p className="mt-2 text-sm text-slate-600">{log.description}</p>}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {duplicate && (
            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-orange-700"><TriangleAlertIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />Possible Duplicate</p>
              <p className="mt-1 text-sm text-orange-900">
                {duplicate.reason === 'location' &&
                  `An existing project "${duplicate.project.project_name}" is only ~${Math.round(duplicate.distanceMeters)}m away (status: ${duplicate.project.status}). Same location — likely the same road.`}
                {duplicate.reason === 'name' &&
                  `An existing project "${duplicate.project.project_name}" in ${duplicate.project.municipality} has a similar name (status: ${duplicate.project.status}). Review the description to confirm this isn't a rename.`}
                {duplicate.reason === 'both' &&
                  `An existing project "${duplicate.project.project_name}" matches both name and location (~${Math.round(duplicate.distanceMeters)}m away, status: ${duplicate.project.status}). High confidence duplicate.`}
              </p>
            </div>
          )}

          {isPending ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
              <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wide">DA Validation Decision</h4>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Review Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Feasibility notes, required for Reject / Request Revision"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:ring-1 focus:ring-teal-500 outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs text-slate-500 max-w-xs">
                  Validate marks this as feasible and takes you to the standard Add New Project form to log the official record yourself.
                </p>
                {/* Decision order: destructive, cautionary, then the primary action last. */}
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => runAction('reject')}
                  className={buttonClass('danger', 'md', 'ml-auto')}
                >
                  {busy === 'reject' ? 'Rejecting…' : 'Reject'}
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => runAction('revision')}
                  className={buttonClass('warning')}
                >
                  {busy === 'revision' ? 'Sending…' : 'Request Revision'}
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => runAction('validate')}
                  className={buttonClass('primary')}
                >
                  {busy === 'validate' ? 'Validating…' : 'Validate'}
                </button>
              </div>
            </div>
          ) : proposal.status === 'Approved' && !proposal.fmr_project_id ? (
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-indigo-800">This proposal was validated but hasn't been logged as a project yet.</p>
              <button
                type="button"
                onClick={() => { onCreateProject(proposal); onClose(); }}
                className={buttonClass('primary', 'md', 'shrink-0')}
              >
                Create Project From This Proposal
              </button>
            </div>
          ) : proposal.status === 'Approved' ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
              Published as fmr_projects.id={proposal.fmr_project_id} and now visible to the public.
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
              This proposal was {proposal.status.toLowerCase()}{proposal.review_notes ? `: ${proposal.review_notes}` : '.'}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button type="button" onClick={onClose} className={buttonClass('secondary')}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * focusProposalId: optional. When set (e.g. from a notification) the review
 * modal for that proposal opens as soon as the list has loaded; onFocusHandled
 * lets the parent reset it.
 */
export default function LguProposalsTab({ proposals, fmrProjects, loading, onValidate, onReject, onRequestRevision, onCreateProject, focusProposalId, onFocusHandled }) {
  const [statusFilter, setStatusFilter] = useState('All');
  const [municipalityFilter, setMunicipalityFilter] = useState('All');
  const [sortBy, setSortBy] = useState('newest');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!focusProposalId || loading) return;
    const match = (proposals || []).find((p) => p.id === focusProposalId);
    if (match) setSelected(match);
    else notify('That proposal is no longer in the list.', 'warning');
    onFocusHandled?.();
  }, [focusProposalId, loading, proposals, onFocusHandled]);

  const priorityByProposalId = useMemo(() => {
    const scored = computeProposalPriorityScores(proposals || []);
    return new Map(scored.map((r) => [r.proposal.id, r]));
  }, [proposals]);

  const statusCounts = useMemo(() => {
    const counts = { All: (proposals || []).length };
    (proposals || []).forEach((p) => { counts[p.status] = (counts[p.status] || 0) + 1; });
    return counts;
  }, [proposals]);

  const filtered = useMemo(() => {
    return (proposals || []).filter((p) => {
      const matchesStatus = statusFilter === 'All' || p.status === statusFilter;
      const matchesMuni = municipalityFilter === 'All' || p.municipality === municipalityFilter;
      return matchesStatus && matchesMuni;
    });
  }, [proposals, statusFilter, municipalityFilter]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sortBy === 'oldest_pending') {
      list.sort((a, b) => {
        const aPending = a.status === 'Submitted' || a.status === 'Under Validation';
        const bPending = b.status === 'Submitted' || b.status === 'Under Validation';
        if (aPending !== bPending) return aPending ? -1 : 1;
        return new Date(a.submitted_at) - new Date(b.submitted_at);
      });
    } else if (sortBy === 'priority') {
      list.sort((a, b) => (priorityByProposalId.get(b.id)?.score ?? -1) - (priorityByProposalId.get(a.id)?.score ?? -1));
    } else {
      list.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
    }
    return list;
  }, [filtered, sortBy, priorityByProposalId]);

  if (loading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading LGU proposals...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">LGU Project Proposals</h2>
            <p className="text-sm text-slate-500 mt-0.5">Farm-to-Market Road proposals submitted by municipalities, pending DA feasibility validation.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={municipalityFilter} onChange={(e) => setMunicipalityFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="All">All Municipalities</option>
              {getMunicipalities().map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="newest">Sort: Newest First</option>
              <option value="oldest_pending">Sort: Oldest Pending First</option>
            </select>
          </div>
        </div>

        {/* Status cards double as the filter, laid out as the pipeline the DA
            actually runs: Submitted -> Under Validation -> Approved, numbered
            and chevron-connected. "Needs Revision" and "Rejected" are
            off-ramps from Under Validation rather than later steps, so they
            sit in their own unnumbered row instead of implying every proposal
            passes through rejection after approval. */}
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Validation pipeline &middot; 3 steps
            </p>
            <button
              type="button"
              onClick={() => setStatusFilter('All')}
              aria-pressed={statusFilter === 'All'}
              className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === 'All'
                  ? 'border-slate-800 bg-slate-800 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              All proposals ({statusCounts.All || 0})
            </button>
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-2 sm:gap-3">
            {PROPOSAL_STATUS_BUCKETS.map((bucket, idx) => {
              const active = statusFilter === bucket.key;
              const count = statusCounts[bucket.key] || 0;
              const Icon = bucket.icon;
              return (
                <Fragment key={bucket.key}>
                  <button
                    type="button"
                    onClick={() => setStatusFilter(bucket.key)}
                    aria-pressed={active}
                    title={bucket.hint}
                    className={`relative min-w-0 rounded-xl border bg-white pl-3 pr-2.5 pt-5 pb-3 text-left shadow-sm transition-all ${
                      active
                        ? `ring-2 ${bucket.activeRing}`
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60'
                    }`}
                  >
                    <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 rounded-t-xl ${bucket.bar}`} />
                    <span
                      aria-hidden="true"
                      className={`absolute -top-2.5 left-3 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white shadow ${bucket.bar}`}
                    >
                      {idx + 1}
                    </span>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`block text-2xl font-semibold leading-none tabular-nums ${count === 0 ? 'text-slate-300' : bucket.value}`}>
                        {count}
                      </span>
                      <Icon className={`size-4 shrink-0 ${count === 0 ? 'text-slate-300' : bucket.value}`} aria-hidden="true" />
                    </div>
                    <span className="mt-1.5 block truncate text-xs font-semibold leading-tight text-slate-700">
                      {bucket.label}
                    </span>
                  </button>
                  {idx < PROPOSAL_STATUS_BUCKETS.length - 1 && (
                    <span aria-hidden="true" className="flex items-center justify-center text-slate-300">
                      <ChevronRightIcon className="size-4" aria-hidden="true" />
                    </span>
                  )}
                </Fragment>
              );
            })}
          </div>

          <div className="mt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Other outcomes &middot; off the main path
            </p>
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              {PROPOSAL_OUTCOME_BUCKETS.map((bucket) => {
                const active = statusFilter === bucket.key;
                const count = statusCounts[bucket.key] || 0;
                const Icon = bucket.icon;
                return (
                  <button
                    key={bucket.key}
                    type="button"
                    onClick={() => setStatusFilter(active ? 'All' : bucket.key)}
                    aria-pressed={active}
                    title={bucket.hint}
                    className={`relative overflow-hidden rounded-lg border bg-white pl-4 pr-3 py-2.5 text-left shadow-sm transition-colors ${
                      active
                        ? `ring-2 ${bucket.activeRing}`
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60'
                    }`}
                  >
                    <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${bucket.bar}`} />
                    <div className="flex items-center justify-between gap-2">
                      <span className={`block text-xl font-semibold leading-none tabular-nums ${count === 0 ? 'text-slate-300' : bucket.value}`}>
                        {count}
                      </span>
                      <Icon className={`size-4 shrink-0 ${count === 0 ? 'text-slate-300' : bucket.value}`} aria-hidden="true" />
                    </div>
                    <span className="mt-1 block text-[11px] font-medium leading-tight text-slate-600">
                      {bucket.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">No LGU proposals match the current filters.</div>
      ) : (
        <div className="space-y-3">
          {sorted.map((p) => {
            const pendingChip = getPendingDaysChip(p.submitted_at, p.status);
            return (
              <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex items-center gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{p.project_name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {p.barangay || 'N/A'}, {p.municipality} &middot; {p.submitted_by_name || 'LGU'} &middot; {new Date(p.submitted_at).toLocaleDateString()}
                      {p.revision_count > 0 ? ` · rev. ${p.revision_count}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <StatusPill proposal={p} />
                  {pendingChip && (
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${pendingChip.className}`}>{pendingChip.text}</span>
                  )}
                  {p.status === 'Approved' && !p.fmr_project_id && (
                    <button
                      type="button"
                      onClick={() => onCreateProject(p)}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
                    >
                      Create Project
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelected(p)}
                    className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold"
                  >
                    Review
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <LguProposalReviewModal
          proposal={selected}
          fmrProjects={fmrProjects}
          priorityEntry={priorityByProposalId.get(selected.id)}
          onClose={() => setSelected(null)}
          onValidate={onValidate}
          onReject={onReject}
          onRequestRevision={onRequestRevision}
          onCreateProject={onCreateProject}
        />
      )}
    </div>
  );
}
