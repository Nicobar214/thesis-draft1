import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '../../lib/supabase';
import { getMunicipalities } from '../../data/iloiloLocations';
import { getCropData, computeProposalPriorityScores, scoreTone, rankTone, factorBarTone } from '../../lib/priorityScoring';
import { getMunicipalityCentroid, getPendingDaysChip } from '../../lib/mapRouteUtils';
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
      alert('Please add review notes explaining the decision.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
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
                        icon={L.divIcon({ className: 'proposal-end', html: '<div style="width:14px;height:14px;background:#e11d48;border:2px solid #fff;border-radius:3px;"></div>', iconSize: [14, 14], iconAnchor: [7, 7] })}
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
                    📷 View Road Photo
                  </button>
                )}
                {proposal.document_url && (
                  <button type="button" onClick={() => openAttachment(proposal.document_url)} className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200">
                    📄 {proposal.document_name || 'View Document'}
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
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm font-semibold text-slate-900">{icon} {label}</p>
                        <p className="text-xs font-medium text-slate-500">{new Date(log.created_at).toLocaleString()}</p>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{formatActivityActor(log)}</p>
                      {log.description && <p className="mt-2 text-sm text-slate-600">{log.description}</p>}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {duplicate && (
            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-orange-700">⚠ Possible Duplicate</p>
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
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => runAction('validate')}
                  className="ml-auto px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {busy === 'validate' ? 'Validating…' : 'Validate'}
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => runAction('revision')}
                  className="px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {busy === 'revision' ? 'Sending…' : 'Request Revision'}
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => runAction('reject')}
                  className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {busy === 'reject' ? 'Rejecting…' : 'Reject'}
                </button>
              </div>
            </div>
          ) : proposal.status === 'Approved' && !proposal.fmr_project_id ? (
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-indigo-800">This proposal was validated but hasn't been logged as a project yet.</p>
              <button
                type="button"
                onClick={() => { onCreateProject(proposal); onClose(); }}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shrink-0"
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

        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LguProposalsTab({ proposals, fmrProjects, loading, onValidate, onReject, onRequestRevision, onCreateProject }) {
  const [statusFilter, setStatusFilter] = useState('All');
  const [municipalityFilter, setMunicipalityFilter] = useState('All');
  const [sortBy, setSortBy] = useState('newest');
  const [selected, setSelected] = useState(null);

  const priorityByProposalId = useMemo(() => {
    const scored = computeProposalPriorityScores(proposals || []);
    return new Map(scored.map((r) => [r.proposal.id, r]));
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
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              {['All', 'Submitted', 'Under Validation', 'Needs Revision', 'Approved', 'Rejected'].map((s) => (
                <option key={s} value={s}>{s === 'All' ? 'All Statuses' : s}</option>
              ))}
            </select>
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
