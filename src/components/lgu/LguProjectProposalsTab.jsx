import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { supabase } from '../../lib/supabase';
import { getBarangays } from '../../data/iloiloLocations';
import { getMunicipalityCentroid, fetchRoadAlignedPolyline, getPendingDaysChip } from '../../lib/mapRouteUtils';
import { DA_FMR_RATE_PER_KM, formatPeso } from '../../lib/budgetEstimate';
import { fetchProposalActivity, describeActionType, formatActivityActor } from '../../lib/proposalActivity';

const ROAD_TYPES = ['Concreting', 'Opening/Construction', 'Rehabilitation', 'Widening', 'Others'];
const ATTACHMENTS_BUCKET = 'lgu-proposal-documents';

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function polylineDistanceKm(points) {
  if (!points || points.length < 2) return 0;
  let totalMeters = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [lat1, lng1] = points[i];
    const [lat2, lng2] = points[i + 1];
    if ([lat1, lng1, lat2, lng2].every((v) => Number.isFinite(v))) {
      totalMeters += haversineMeters(lat1, lng1, lat2, lng2);
    }
  }
  return totalMeters / 1000;
}

function MapClickPicker({ onPick }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

function MapCenterController({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center && center[0] && center[1]) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);
  return null;
}

function statusTone(status) {
  switch (status) {
    case 'Approved': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'Rejected': return 'bg-red-50 text-red-700 border-red-200';
    case 'Needs Revision': return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'Under Validation': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    default: return 'bg-sky-50 text-sky-700 border-sky-200'; // Submitted
  }
}

const emptyForm = {
  project_name: '',
  road_type: 'Concreting',
  justification: '',
  description: '',
  estimated_length_km: '',
  estimated_budget: '',
  target_funding_year: String(new Date().getFullYear() + 1),
  beneficiary_farmers_count: '',
  beneficiary_households_count: '',
  barangay: '',
  start_latitude: '',
  start_longitude: '',
  end_latitude: '',
  end_longitude: '',
};

export default function LguProjectProposalsTab({ user, profile, municipalityScope, beneficiaries = [] }) {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [pickMode, setPickMode] = useState('start');
  const [routeWaypoints, setRouteWaypoints] = useState([]);
  const [snapping, setSnapping] = useState(false);
  const [searchCenter, setSearchCenter] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [documentFile, setDocumentFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [signedUrls, setSignedUrls] = useState({});
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  const [historyByProposalId, setHistoryByProposalId] = useState({});
  const [historyLoadingId, setHistoryLoadingId] = useState(null);
  const [activeSubTab, setActiveSubTab] = useState('form');
  const [selectedProposalForModal, setSelectedProposalForModal] = useState(null);

  const fetchProposals = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('lgu_project_proposals')
        .select('*')
        .eq('municipality', municipalityScope || '')
        .order('submitted_at', { ascending: false });
      if (error) throw error;
      setProposals(data || []);
    } catch (err) {
      console.error('Error fetching proposals:', err.message);
    } finally {
      setLoading(false);
    }
  }, [user, municipalityScope]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  const resolveSignedUrl = async (path) => {
    if (!path) return null;
    if (signedUrls[path]) return signedUrls[path];
    try {
      const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path, 3600);
      if (error) throw error;
      if (data?.signedUrl) {
        setSignedUrls((prev) => ({ ...prev, [path]: data.signedUrl }));
        return data.signedUrl;
      }
    } catch (err) {
      console.error('Failed to get signed url:', err.message);
    }
    return null;
  };

  const toggleHistory = async (proposalId) => {
    if (expandedHistoryId === proposalId) {
      setExpandedHistoryId(null);
      return;
    }
    setExpandedHistoryId(proposalId);
    if (!historyByProposalId[proposalId]) {
      setHistoryLoadingId(proposalId);
      try {
        const rows = await fetchProposalActivity(proposalId);
        setHistoryByProposalId((prev) => ({ ...prev, [proposalId]: rows }));
      } catch {
        setHistoryByProposalId((prev) => ({ ...prev, [proposalId]: [] }));
      } finally {
        setHistoryLoadingId(null);
      }
    }
  };

  const notifyAdmins = async (type, title, message, proposalId) => {
    try {
      const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin');
      if (!Array.isArray(admins) || admins.length === 0) return;
      const rows = admins.map((adm) => ({
        user_id: adm.id,
        type,
        title,
        message,
        proposal_id: proposalId,
        is_read: false,
        created_at: new Date().toISOString(),
      }));
      await supabase.from('notifications').insert(rows);
    } catch (err) {
      console.error('Failed to notify admins:', err.message);
    }
  };

  const uploadAttachment = async (file, kind) => {
    if (!file) return null;
    const ext = (file.name?.split('.').pop() || (kind === 'photo' ? 'jpg' : 'pdf')).toLowerCase();
    const path = `${municipalityScope || 'unassigned'}/${Date.now()}-${kind}.${ext}`;
    const { error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (error) throw error;
    return path;
  };

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setPhotoFile(null);
    setDocumentFile(null);
    setPickMode('start');
    setRouteWaypoints([]);
  };

  const startResubmit = (proposal) => {
    setEditingId(proposal.id);
    setForm({
      project_name: proposal.project_name || '',
      road_type: 'Concreting',
      justification: proposal.justification || '',
      description: proposal.description || '',
      estimated_length_km: proposal.estimated_length_km ? String(proposal.estimated_length_km) : '',
      estimated_budget: proposal.estimated_budget ? String(proposal.estimated_budget) : '',
      target_funding_year: proposal.target_funding_year ? String(proposal.target_funding_year) : String(new Date().getFullYear() + 1),
      beneficiary_farmers_count: proposal.beneficiary_farmers_count ? String(proposal.beneficiary_farmers_count) : '',
      beneficiary_households_count: proposal.beneficiary_households_count ? String(proposal.beneficiary_households_count) : '',
      barangay: proposal.barangay || '',
      start_latitude: proposal.start_latitude ? String(proposal.start_latitude) : '',
      start_longitude: proposal.start_longitude ? String(proposal.start_longitude) : '',
      end_latitude: proposal.end_latitude ? String(proposal.end_latitude) : '',
      end_longitude: proposal.end_longitude ? String(proposal.end_longitude) : '',
    });
    const waypointsRaw = Array.isArray(proposal.route_waypoints) ? proposal.route_waypoints : [];
    setRouteWaypoints(
      waypointsRaw
        .map((pt) => {
          const lat = Number(pt?.lat ?? pt?.[0]);
          const lng = Number(pt?.lng ?? pt?.[1]);
          return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
        })
        .filter(Boolean)
    );
    setActiveSubTab('form');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSnapToRoad = async () => {
    const sLat = Number(form.start_latitude);
    const sLng = Number(form.start_longitude);
    const eLat = Number(form.end_latitude);
    const eLng = Number(form.end_longitude);

    if (![sLat, sLng, eLat, eLng].every(Number.isFinite)) {
      alert('Please set both Start and End points on the map first.');
      return;
    }

    setSnapping(true);
    try {
      const snappedPoints = await fetchRoadAlignedPolyline([
        [sLat, sLng],
        ...routeWaypoints.map((w) => [w.lat, w.lng]),
        [eLat, eLng],
      ]);

      if (snappedPoints && snappedPoints.length >= 2) {
        const first = snappedPoints[0];
        const last = snappedPoints[snappedPoints.length - 1];
        const middle = snappedPoints.slice(1, snappedPoints.length - 1).map((pt) => ({ lat: pt[0], lng: pt[1] }));

        setRouteWaypoints(middle);
        setForm((c) => ({
          ...c,
          start_latitude: first[0].toFixed(6),
          start_longitude: first[1].toFixed(6),
          end_latitude: last[0].toFixed(6),
          end_longitude: last[1].toFixed(6),
          estimated_length_km: polylineDistanceKm(snappedPoints).toFixed(2),
        }));
        alert('Snapped successfully to road alignment!');
      } else {
        alert('Could not find a road connection between the coordinates.');
      }
    } catch (err) {
      alert(`Failed to connect coordinates to the road network: ${err.message}`);
    } finally {
      setSnapping(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;

    if (!form.project_name.trim() || !form.justification.trim()) {
      alert('Project name and justification are required.');
      return;
    }

    setSubmitting(true);
    try {
      let photoPath = null;
      let documentPath = null;
      if (photoFile) photoPath = await uploadAttachment(photoFile, 'photo');
      if (documentFile) documentPath = await uploadAttachment(documentFile, 'document');

      const basePayload = {
        project_name: form.project_name.trim(),
        municipality: municipalityScope || '',
        barangay: form.barangay,
        location: form.barangay,
        road_type: form.road_type,
        justification: form.justification.trim(),
        description: form.description.trim(),
        estimated_length_km: form.estimated_length_km ? Number(form.estimated_length_km) : 0,
        estimated_budget: form.estimated_budget ? Number(form.estimated_budget) : null,
        target_funding_year: form.target_funding_year ? parseInt(form.target_funding_year) : null,
        beneficiary_farmers_count: form.beneficiary_farmers_count ? parseInt(form.beneficiary_farmers_count) : 0,
        beneficiary_households_count: form.beneficiary_households_count ? parseInt(form.beneficiary_households_count) : 0,
        start_latitude: form.start_latitude ? Number(form.start_latitude) : null,
        start_longitude: form.start_longitude ? Number(form.start_longitude) : null,
        end_latitude: form.end_latitude ? Number(form.end_latitude) : null,
        end_longitude: form.end_longitude ? Number(form.end_longitude) : null,
        route_waypoints: routeWaypoints
          .map((w) => ({ lat: Number(w.lat), lng: Number(w.lng) }))
          .filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng)),
        updated_at: new Date().toISOString(),
      };
      if (photoPath) basePayload.photo_url = photoPath;
      if (documentPath) {
        basePayload.document_url = documentPath;
        basePayload.document_name = documentFile?.name || null;
      }

      if (editingId) {
        const current = proposals.find((p) => p.id === editingId);
        const { error } = await supabase
          .from('lgu_project_proposals')
          .update({
            ...basePayload,
            status: 'Submitted',
            revision_count: (current?.revision_count || 0) + 1,
          })
          .eq('id', editingId)
          .eq('submitted_by', user.id);
        if (error) throw error;

        await supabase.from('lgu_project_proposal_activity_logs').insert({
          proposal_id: editingId,
          action_type: 'resubmitted',
          description: 'LGU edited and resubmitted the proposal.',
          actor_name: profile?.full_name || user.email,
          actor_email: user.email,
        });

        await notifyAdmins(
          'lgu_proposal_resubmitted',
          'LGU proposal resubmitted',
          `${municipalityScope || 'An LGU'} resubmitted "${basePayload.project_name}" after revision.`,
          editingId
        );
        alert('Proposal resubmitted for DA validation.');
      } else {
        const { data: inserted, error } = await supabase
          .from('lgu_project_proposals')
          .insert({
            ...basePayload,
            submitted_by: user.id,
            submitted_by_name: profile?.full_name || user.email,
          })
          .select('id')
          .single();
        if (error) throw error;

        await supabase.from('lgu_project_proposal_activity_logs').insert({
          proposal_id: inserted.id,
          action_type: 'submitted',
          description: 'LGU submitted a new project proposal.',
          actor_name: profile?.full_name || user.email,
          actor_email: user.email,
        });

        await notifyAdmins(
          'lgu_proposal_submitted',
          'New LGU project proposal',
          `${municipalityScope || 'An LGU'} submitted a new proposal: "${basePayload.project_name}".`,
          inserted.id
        );
        alert('Proposal submitted to DA for validation.');
      }

      resetForm();
      await fetchProposals();
      setActiveSubTab('list');
    } catch (err) {
      alert(`Error saving proposal: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const daEstimate = useMemo(() => {
    const km = Number(form.estimated_length_km);
    if (!Number.isFinite(km) || km <= 0) return null;
    return km * DA_FMR_RATE_PER_KM;
  }, [form.estimated_length_km]);

  const routePoints = useMemo(() => {
    const pts = [];
    if (form.start_latitude && form.start_longitude) {
      pts.push([Number(form.start_latitude), Number(form.start_longitude)]);
    }
    routeWaypoints.forEach((wp) => {
      pts.push([Number(wp.lat), Number(wp.lng)]);
    });
    if (form.end_latitude && form.end_longitude) {
      pts.push([Number(form.end_latitude), Number(form.end_longitude)]);
    }
    return pts;
  }, [form.start_latitude, form.start_longitude, routeWaypoints]);

  const modalRoutePoints = useMemo(() => {
    if (!selectedProposalForModal) return [];
    const pts = [];
    if (selectedProposalForModal.start_latitude && selectedProposalForModal.start_longitude) {
      pts.push([Number(selectedProposalForModal.start_latitude), Number(selectedProposalForModal.start_longitude)]);
    }
    const wps = Array.isArray(selectedProposalForModal.route_waypoints) ? selectedProposalForModal.route_waypoints : [];
    wps.forEach((wp) => {
      const lat = Number(wp?.lat ?? wp?.[0]);
      const lng = Number(wp?.lng ?? wp?.[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        pts.push([lat, lng]);
      }
    });
    if (selectedProposalForModal.end_latitude && selectedProposalForModal.end_longitude) {
      pts.push([Number(selectedProposalForModal.end_latitude), Number(selectedProposalForModal.end_longitude)]);
    }
    return pts;
  }, [selectedProposalForModal]);

  const mapCenter = useMemo(() => {
    if (searchCenter) return searchCenter;
    if (form.start_latitude && form.start_longitude) return [Number(form.start_latitude), Number(form.start_longitude)];
    return getMunicipalityCentroid(municipalityScope);
  }, [searchCenter, form.start_latitude, form.start_longitude, municipalityScope]);

  return (
    <div className="space-y-6">
      {/* Clickable Sub-Nav Bar */}
      <div className="flex border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveSubTab('form')}
          className={`border-b-2 px-6 py-3 text-sm font-bold transition-all ${
            activeSubTab === 'form'
              ? 'border-teal-600 text-teal-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {editingId ? 'Edit Proposal' : 'Submit New Proposal'}
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('list')}
          className={`border-b-2 px-6 py-3 text-sm font-bold transition-all flex items-center gap-2 ${
            activeSubTab === 'list'
              ? 'border-teal-600 text-teal-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Proposed Projects</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
            activeSubTab === 'list' ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-600'
          }`}>
            {proposals.length}
          </span>
        </button>
      </div>

      {activeSubTab === 'form' ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="border-b border-slate-100 pb-3 mb-4">
            <h3 className="text-lg font-semibold text-slate-900">
              {editingId ? 'Edit & Resubmit Proposal' : 'Propose a New FMR Project'}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Submit a Farm-to-Market Road proposal for {municipalityScope || 'your municipality'}. DA will review it for feasibility before it becomes an official project.
            </p>
          </div>

          {editingId && (() => {
            const current = proposals.find((p) => p.id === editingId);
            return current?.review_notes ? (
              <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-3">
                <p className="text-xs font-semibold uppercase text-orange-700">DA Requested Revision</p>
                <p className="mt-1 text-sm text-orange-800">{current.review_notes}</p>
              </div>
            ) : null;
          })()}

          <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column: Form Info */}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Project Name *</label>
                <input
                  required
                  type="text"
                  value={form.project_name}
                  onChange={(e) => setForm((c) => ({ ...c, project_name: e.target.value }))}
                  placeholder="e.g. Concreting of Brgy. Example FMR"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-teal-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Road Type</label>
                  <input
                    type="text"
                    disabled
                    value="Concreting"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-500 outline-none cursor-not-allowed font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Barangay</label>
                  <select
                    value={form.barangay}
                    onChange={(e) => {
                      const selectedBrgy = e.target.value;
                      const brgyFarmers = beneficiaries.filter(
                        (b) =>
                          String(b.barangay || '').toLowerCase() === String(selectedBrgy || '').toLowerCase() &&
                          String(b.municipality || '').toLowerCase() === String(municipalityScope || '').toLowerCase()
                      );
                      const totalFarmers = brgyFarmers.length;
                      const totalArea = brgyFarmers.reduce((sum, b) => sum + Number(b.farmAreaHa || 0), 0);

                      setForm((c) => ({
                        ...c,
                        barangay: selectedBrgy,
                        beneficiary_farmers_count: String(totalFarmers),
                        beneficiary_households_count: totalArea > 0 ? totalArea.toFixed(2) : '',
                      }));
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-teal-500 outline-none"
                  >
                    <option value="">Select Barangay</option>
                    {getBarangays(municipalityScope).map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Justification *</label>
                <textarea
                  required
                  value={form.justification}
                  onChange={(e) => setForm((c) => ({ ...c, justification: e.target.value }))}
                  rows={3}
                  placeholder="Why is this road needed? e.g. serves 300 farmers, only access route to market during rainy season..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-teal-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Additional Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-teal-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Estimated Length (km)</label>
                  <input
                    type="number" step="any" min="0"
                    value={form.estimated_length_km}
                    onChange={(e) => setForm((c) => ({ ...c, estimated_length_km: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-teal-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Target Funding Year</label>
                  <input
                    type="number"
                    value={form.target_funding_year}
                    onChange={(e) => setForm((c) => ({ ...c, target_funding_year: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-teal-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Requested Budget (₱)</label>
                <input
                  type="number" step="any" min="0"
                  value={form.estimated_budget}
                  onChange={(e) => setForm((c) => ({ ...c, estimated_budget: e.target.value }))}
                  placeholder="Leave blank if unknown"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-teal-500 outline-none"
                />
                {daEstimate ? (
                  <p className="text-xs text-slate-400 mt-1">DA reference estimate at ₱15M/km: {formatPeso(daEstimate)}</p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Beneficiary Farmers</label>
                  <input
                    type="number" min="0"
                    value={form.beneficiary_farmers_count}
                    onChange={(e) => setForm((c) => ({ ...c, beneficiary_farmers_count: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-teal-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Total Farm Area Served (ha)</label>
                  <input
                    type="number" step="any" min="0"
                    value={form.beneficiary_households_count}
                    onChange={(e) => setForm((c) => ({ ...c, beneficiary_households_count: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-teal-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Road Photo</label>
                  <input
                    type="file" accept="image/*"
                    onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-slate-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-teal-50 file:text-teal-700 file:text-xs file:font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">SB Resolution / Document (PDF)</label>
                  <input
                    type="file" accept="application/pdf"
                    onChange={(e) => setDocumentFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-slate-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-teal-50 file:text-teal-700 file:text-xs file:font-semibold"
                  />
                </div>
              </div>
            </div>

            {/* Right Column: Coordinates & Leaflet Map Picker */}
            <div className="space-y-4 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Start Latitude</label>
                    <input
                      type="number" step="any"
                      value={form.start_latitude}
                      onChange={(e) => setForm((c) => ({ ...c, start_latitude: e.target.value }))}
                      placeholder="Click map or type"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-teal-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Start Longitude</label>
                    <input
                      type="number" step="any"
                      value={form.start_longitude}
                      onChange={(e) => setForm((c) => ({ ...c, start_longitude: e.target.value }))}
                      placeholder="Click map or type"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-teal-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">End Latitude</label>
                    <input
                      type="number" step="any"
                      value={form.end_latitude}
                      onChange={(e) => setForm((c) => ({ ...c, end_latitude: e.target.value }))}
                      placeholder="Click map or type"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-teal-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">End Longitude</label>
                    <input
                      type="number" step="any"
                      value={form.end_longitude}
                      onChange={(e) => setForm((c) => ({ ...c, end_longitude: e.target.value }))}
                      placeholder="Click map or type"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-teal-500 outline-none"
                    />
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden mt-2">
                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-slate-700">Proposed Road Route (optional)</span>
                      <span className="text-[11px] font-mono text-slate-500">
                        {form.start_latitude && form.start_longitude ? (
                          <span className="text-emerald-700">Start: {Number(form.start_latitude).toFixed(5)}, {Number(form.start_longitude).toFixed(5)}</span>
                        ) : (
                          <span className="text-slate-400">Start: not set</span>
                        )}
                        {' · '}
                        {form.end_latitude && form.end_longitude ? (
                          <span className="text-rose-700">End: {Number(form.end_latitude).toFixed(5)}, {Number(form.end_longitude).toFixed(5)}</span>
                        ) : (
                          <span className="text-slate-400">End: not set</span>
                        )}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => setPickMode('start')} className={`px-2 py-1 rounded text-[11px] font-semibold border ${pickMode === 'start' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-600'}`}>Set Start</button>
                      <button type="button" onClick={() => setPickMode('end')} className={`px-2 py-1 rounded text-[11px] font-semibold border ${pickMode === 'end' ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-600'}`}>Set End</button>
                      <button type="button" onClick={() => setPickMode('waypoint')} className={`px-2 py-1 rounded text-[11px] font-semibold border ${pickMode === 'waypoint' ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-slate-200 text-slate-600'}`}>Add Waypoint</button>
                      <button
                        type="button"
                        disabled={snapping}
                        onClick={handleSnapToRoad}
                        className="px-2 py-1 rounded text-[11px] font-semibold border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 disabled:opacity-50"
                      >
                        {snapping ? 'Snapping…' : '⚡ Snap to Road'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setForm((c) => ({ ...c, start_latitude: '', start_longitude: '', end_latitude: '', end_longitude: '' })); setRouteWaypoints([]); }}
                        className="px-2 py-1 rounded text-[11px] font-semibold border border-red-200 bg-red-50 text-red-600"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  
                  {/* Search Bar inside Map */}
                  <div className="p-3 bg-white border-b border-slate-100 flex gap-2">
                    <input
                      type="text"
                      placeholder="Search barangay or location (e.g. Bucari)..."
                      id="proposalMapSearchInput"
                      className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          document.getElementById('proposalMapSearchBtn')?.click();
                        }
                      }}
                    />
                    <button
                      type="button"
                      id="proposalMapSearchBtn"
                      onClick={async () => {
                        const queryVal = document.getElementById('proposalMapSearchInput')?.value?.trim();
                        if (!queryVal) return;
                        try {
                          const query = `${queryVal}, Iloilo, Philippines`;
                          const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
                          const res = await fetch(url, {
                            headers: {
                              'Accept-Language': 'en',
                              'User-Agent': 'KalsaTrack-Route-Builder-Search'
                            }
                          });
                          if (!res.ok) throw new Error();
                          const data = await res.json();
                          if (data && data.length > 0) {
                            setSearchCenter([Number(data[0].lat), Number(data[0].lon)]);
                          } else {
                            alert('Location not found. Try adding the municipality name.');
                          }
                        } catch (err) {
                          console.error(err);
                          alert('Error searching location.');
                        }
                      }}
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition-colors"
                    >
                      Search
                    </button>
                  </div>

                  <div style={{ height: '420px', width: '100%' }}>
                    <MapContainer center={mapCenter} zoom={12} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors' />
                      <MapClickPicker
                        onPick={(lat, lng) => {
                          if (pickMode === 'start') {
                            setForm((c) => ({ ...c, start_latitude: lat.toFixed(6), start_longitude: lng.toFixed(6) }));
                          } else if (pickMode === 'end') {
                            setForm((c) => ({ ...c, end_latitude: lat.toFixed(6), end_longitude: lng.toFixed(6) }));
                          } else {
                            setRouteWaypoints((prev) => [...prev, { lat: lat.toFixed(6), lng: lng.toFixed(6) }]);
                          }
                        }}
                      />
                      <MapCenterController center={mapCenter} />
                      {form.start_latitude && form.start_longitude && (
                        <Marker
                          position={[Number(form.start_latitude), Number(form.start_longitude)]}
                          icon={L.divIcon({ className: 'proposal-start', html: '<div style="width:14px;height:14px;background:#059669;border:2px solid #fff;border-radius:9999px;"></div>', iconSize: [14, 14], iconAnchor: [7, 7] })}
                        />
                      )}
                      {routeWaypoints.map((wp, idx) => (
                        <Marker
                          key={`wp-${idx}`}
                          position={[Number(wp.lat), Number(wp.lng)]}
                          icon={L.divIcon({ className: 'proposal-waypoint', html: '<div style="width:10px;height:10px;background:#0d9488;border:2px solid #fff;border-radius:9999px;"></div>', iconSize: [10, 10], iconAnchor: [5, 5] })}
                        />
                      ))}
                      {form.end_latitude && form.end_longitude && (
                        <Marker
                          position={[Number(form.end_latitude), Number(form.end_longitude)]}
                          icon={L.divIcon({ className: 'proposal-end', html: '<div style="width:14px;height:14px;background:#e11d48;border:2px solid #fff;border-radius:3px;"></div>', iconSize: [14, 14], iconAnchor: [7, 7] })}
                        />
                      )}
                      {routePoints.length >= 2 && (
                        <Polyline
                          positions={routePoints}
                          pathOptions={{ color: '#0f766e', weight: 4, opacity: 0.75 }}
                        />
                      )}
                      {searchCenter && (
                        <Marker
                          position={searchCenter}
                          icon={new L.Icon({
                            iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
                            shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
                            iconSize: [25, 41],
                            iconAnchor: [12, 41],
                          })}
                        >
                          <Popup>
                            <div className="p-1 text-xs">
                              <p className="font-bold text-slate-800">Searched Location</p>
                              <p className="text-slate-500 mt-0.5">Start placing points near here.</p>
                            </div>
                          </Popup>
                        </Marker>
                      )}
                    </MapContainer>
                  </div>
                  {routeWaypoints.length > 0 && (
                    <div className="px-4 py-2 border-t border-slate-200 bg-white flex items-center justify-between">
                      <span className="text-xs text-slate-500">{routeWaypoints.length} waypoint{routeWaypoints.length > 1 ? 's' : ''} added</span>
                      <button type="button" onClick={() => setRouteWaypoints([])} className="text-xs font-semibold text-red-600 hover:underline">Clear waypoints</button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-grow px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition"
                >
                  {submitting ? 'Submitting…' : editingId ? 'Resubmit Proposal' : 'Submit Proposal to DA'}
                </button>
                {editingId && (
                  <button type="button" onClick={resetForm} className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      ) : (
        /* Proposals list in full width card grid */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {loading ? (
            <div className="col-span-full rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 text-center">Loading your proposals...</div>
          ) : proposals.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 text-center">No proposals submitted yet.</div>
          ) : (
            proposals.map((p) => (
              <article key={p.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <button
                        type="button"
                        onClick={() => setSelectedProposalForModal(p)}
                        className="text-left text-base font-bold text-slate-900 hover:text-teal-600 transition"
                      >
                        {p.project_name}
                      </button>
                      <p className="text-xs text-slate-500 mt-0.5">{p.barangay || 'N/A'}, {p.municipality} • Submitted {new Date(p.submitted_at).toLocaleDateString()}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span className={`px-2.5 py-0.5 rounded-full border text-xs font-semibold capitalize ${statusTone(p.status)}`}>
                        {p.status}{p.revision_count > 0 ? ` (rev. ${p.revision_count})` : ''}
                      </span>
                      {(() => {
                        const chip = getPendingDaysChip(p.submitted_at, p.status);
                        return chip ? (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${chip.className}`}>{chip.text}</span>
                        ) : null;
                      })()}
                    </div>
                  </div>

                  <div className="bg-slate-50 rounded-xl p-3.5 space-y-2.5 text-xs text-slate-700">
                    <p className="line-clamp-3"><span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px] block mb-0.5">Justification</span>{p.justification}</p>
                    {p.description && <p className="line-clamp-2"><span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px] block mb-0.5">Description</span>{p.description}</p>}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {p.estimated_length_km > 0 && (
                      <div className="rounded-lg bg-slate-50 p-2 text-center">
                        <p className="text-slate-500 font-medium">Length</p>
                        <p className="font-bold text-slate-800">{p.estimated_length_km} km</p>
                      </div>
                    )}
                    {p.estimated_budget && (
                      <div className="rounded-lg bg-slate-50 p-2 text-center">
                        <p className="text-slate-500 font-medium">Budget Requested</p>
                        <p className="font-bold text-slate-800 truncate">{formatPeso(p.estimated_budget)}</p>
                      </div>
                    )}
                    {p.target_funding_year && (
                      <div className="rounded-lg bg-slate-50 p-2 text-center">
                        <p className="text-slate-500 font-medium">Funding Year</p>
                        <p className="font-bold text-slate-800">FY {p.target_funding_year}</p>
                      </div>
                    )}
                    {p.beneficiary_farmers_count > 0 && (
                      <div className="rounded-lg bg-slate-50 p-2 text-center">
                        <p className="text-slate-500 font-medium">Farmers Serviced</p>
                        <p className="font-bold text-slate-800">{p.beneficiary_farmers_count}</p>
                      </div>
                    )}
                  </div>

                  {p.status === 'Needs Revision' && p.review_notes && (
                    <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs">
                      <p className="font-semibold uppercase text-orange-700">DA Revision Notes</p>
                      <p className="mt-1 text-orange-850 leading-relaxed">{p.review_notes}</p>
                    </div>
                  )}

                  {p.status === 'Rejected' && p.review_notes && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs">
                      <p className="font-semibold uppercase text-red-700">Rejection Reason</p>
                      <p className="mt-1 text-red-850 leading-relaxed">{p.review_notes}</p>
                    </div>
                  )}

                  {p.status === 'Approved' && (
                    <div className="rounded-xl border border-emerald-250 bg-emerald-50 p-3 text-xs text-emerald-800 font-medium">
                      Approved and now live as an official FMR project.
                    </div>
                  )}
                </div>

                <div className="space-y-2 border-t border-slate-100 pt-3">
                  {(p.photo_url || p.document_url) && (
                    <div className="flex flex-wrap gap-1.5">
                      {p.photo_url && (
                        <button
                          type="button"
                          onClick={async () => {
                            const url = await resolveSignedUrl(p.photo_url);
                            if (url) window.open(url, '_blank', 'noopener,noreferrer');
                          }}
                          className="text-[10px] font-bold px-2 py-1 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200"
                        >
                          View Photo
                        </button>
                      )}
                      {p.document_url && (
                        <button
                          type="button"
                          onClick={async () => {
                            const url = await resolveSignedUrl(p.document_url);
                            if (url) window.open(url, '_blank', 'noopener,noreferrer');
                          }}
                          className="text-[10px] font-bold px-2 py-1 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200"
                        >
                          View Document
                        </button>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    {p.status === 'Needs Revision' && (
                      <button
                        onClick={() => startResubmit(p)}
                        className="px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold"
                      >
                        Edit & Resubmit
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedProposalForModal(p)}
                      className="px-3 py-1.5 rounded-lg bg-teal-50 border border-teal-200 text-teal-700 text-xs font-semibold hover:bg-teal-100 transition"
                    >
                      View Details
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleHistory(p.id)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-650 text-xs font-semibold hover:bg-slate-50 transition"
                    >
                      {expandedHistoryId === p.id ? 'Hide History' : 'View History'}
                    </button>
                  </div>

                  {expandedHistoryId === p.id && (
                    <div className="space-y-2 pt-2 border-t border-slate-50 mt-1 max-h-[220px] overflow-y-auto pr-1">
                      {historyLoadingId === p.id ? (
                        <p className="text-xs text-slate-500">Loading history…</p>
                      ) : (historyByProposalId[p.id] || []).length === 0 ? (
                        <p className="text-xs text-slate-500">No activity recorded yet.</p>
                      ) : (
                        (historyByProposalId[p.id] || []).map((log) => {
                          const { label, icon } = describeActionType(log.action_type);
                          return (
                            <div key={log.id} className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-xs">
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                <p className="font-semibold text-slate-900">{icon} {label}</p>
                                <p className="text-[10px] font-medium text-slate-400">{new Date(log.created_at).toLocaleString()}</p>
                              </div>
                              <p className="mt-0.5 text-[10px] text-slate-400 font-medium">{formatActivityActor(log)}</p>
                              {log.description && <p className="mt-1 text-[11px] text-slate-600 leading-relaxed">{log.description}</p>}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      )}

      {/* Detail Modal Dialog */}
      {selectedProposalForModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-100 flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 p-5 bg-slate-50/50">
              <div>
                <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${statusTone(selectedProposalForModal.status)}`}>
                  {selectedProposalForModal.status}
                </span>
                <h3 className="mt-1 text-lg font-bold text-slate-900 leading-snug">{selectedProposalForModal.project_name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProposalForModal(null)}
                className="rounded-lg border border-slate-200 bg-white p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content (Scrollable) */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm text-slate-700">
              {/* Basic Info Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 border-b border-slate-100 pb-5">
                <div>
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Barangay</p>
                  <p className="mt-1 font-semibold text-slate-800">{selectedProposalForModal.barangay || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Road Type</p>
                  <p className="mt-1 font-semibold text-slate-800">{selectedProposalForModal.road_type || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Submitted At</p>
                  <p className="mt-1 font-semibold text-slate-800">{new Date(selectedProposalForModal.submitted_at).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Length</p>
                  <p className="mt-1 font-bold text-slate-800">{selectedProposalForModal.estimated_length_km || '0'} km</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Requested Budget</p>
                  <p className="mt-1 font-bold text-slate-800">{selectedProposalForModal.estimated_budget ? formatPeso(selectedProposalForModal.estimated_budget) : 'N/A'}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Target Year</p>
                  <p className="mt-1 font-bold text-slate-800">FY {selectedProposalForModal.target_funding_year || 'N/A'}</p>
                </div>
              </div>

              {/* Justification & Description */}
              <div className="space-y-4 border-b border-slate-100 pb-5">
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Justification</p>
                  <p className="mt-1 text-slate-800 leading-relaxed whitespace-pre-wrap">{selectedProposalForModal.justification}</p>
                </div>
                {selectedProposalForModal.description && (
                  <div className="bg-slate-50 rounded-xl p-4">
                    <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Additional Description</p>
                    <p className="mt-1 text-slate-800 leading-relaxed whitespace-pre-wrap">{selectedProposalForModal.description}</p>
                  </div>
                )}
              </div>

              {/* Beneficiary Stats */}
              <div className="grid grid-cols-2 gap-4 border-b border-slate-100 pb-5 text-center">
                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                  <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Beneficiary Farmers</p>
                  <p className="mt-1 text-xl font-extrabold text-slate-800">{selectedProposalForModal.beneficiary_farmers_count || '0'}</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                  <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Total Farm Area Served</p>
                  <p className="mt-1 text-xl font-extrabold text-slate-800">
                    {selectedProposalForModal.beneficiary_households_count ? `${selectedProposalForModal.beneficiary_households_count} ha` : '0 ha'}
                  </p>
                </div>
              </div>

              {/* Route coordinates */}
              {(selectedProposalForModal.start_latitude || selectedProposalForModal.end_latitude) && (
                <div className="border-b border-slate-100 pb-5">
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2.5">Route Map & GPS Coordinates</p>
                  
                  {/* Map Preview in Modal */}
                  <div className="w-full h-[240px] rounded-xl overflow-hidden border border-slate-200 shadow-inner mb-3.5 relative z-0">
                    <MapContainer
                      center={[Number(selectedProposalForModal.start_latitude), Number(selectedProposalForModal.start_longitude)]}
                      zoom={14}
                      style={{ height: '100%', width: '100%' }}
                      scrollWheelZoom={false}
                    >
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors' />
                      
                      {selectedProposalForModal.start_latitude && selectedProposalForModal.start_longitude && (
                        <Marker
                          position={[Number(selectedProposalForModal.start_latitude), Number(selectedProposalForModal.start_longitude)]}
                          icon={L.divIcon({ className: 'modal-start', html: '<div style="width:14px;height:14px;background:#059669;border:2px solid #fff;border-radius:9999px;"></div>', iconSize: [14, 14], iconAnchor: [7, 7] })}
                        />
                      )}
                      
                      {Array.isArray(selectedProposalForModal.route_waypoints) && selectedProposalForModal.route_waypoints.map((wp, idx) => {
                        const lat = Number(wp?.lat ?? wp?.[0]);
                        const lng = Number(wp?.lng ?? wp?.[1]);
                        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                        return (
                          <Marker
                            key={`modal-wp-${idx}`}
                            position={[lat, lng]}
                            icon={L.divIcon({ className: 'modal-waypoint', html: '<div style="width:10px;height:10px;background:#0d9488;border:2px solid #fff;border-radius:9999px;"></div>', iconSize: [10, 10], iconAnchor: [5, 5] })}
                          />
                        );
                      })}

                      {selectedProposalForModal.end_latitude && selectedProposalForModal.end_longitude && (
                        <Marker
                          position={[Number(selectedProposalForModal.end_latitude), Number(selectedProposalForModal.end_longitude)]}
                          icon={L.divIcon({ className: 'modal-end', html: '<div style="width:14px;height:14px;background:#e11d48;border:2px solid #fff;border-radius:3px;"></div>', iconSize: [14, 14], iconAnchor: [7, 7] })}
                        />
                      )}

                      {modalRoutePoints.length >= 2 && (
                        <Polyline
                          positions={modalRoutePoints}
                          pathOptions={{ color: '#0f766e', weight: 4, opacity: 0.8 }}
                        />
                      )}
                      
                      <MapCenterController center={[Number(selectedProposalForModal.start_latitude), Number(selectedProposalForModal.start_longitude)]} />
                    </MapContainer>
                  </div>

                  <div className="grid grid-cols-2 gap-3 font-mono text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <div>
                      <p className="text-slate-400 font-semibold uppercase text-[10px]">Start Point</p>
                      <p className="mt-0.5">{selectedProposalForModal.start_latitude}, {selectedProposalForModal.start_longitude}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 font-semibold uppercase text-[10px]">End Point</p>
                      <p className="mt-0.5">{selectedProposalForModal.end_latitude}, {selectedProposalForModal.end_longitude}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Attachments */}
              {(selectedProposalForModal.photo_url || selectedProposalForModal.document_url) && (
                <div className="border-b border-slate-100 pb-5">
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Attached Documents</p>
                  <div className="flex gap-2">
                    {selectedProposalForModal.photo_url && (
                      <button
                        type="button"
                        onClick={async () => {
                          const url = await resolveSignedUrl(selectedProposalForModal.photo_url);
                          if (url) window.open(url, '_blank', 'noopener,noreferrer');
                        }}
                        className="text-xs px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 font-semibold transition"
                      >
                        View Road Photo
                      </button>
                    )}
                    {selectedProposalForModal.document_url && (
                      <button
                        type="button"
                        onClick={async () => {
                          const url = await resolveSignedUrl(selectedProposalForModal.document_url);
                          if (url) window.open(url, '_blank', 'noopener,noreferrer');
                        }}
                        className="text-xs px-3 py-1.5 rounded-xl bg-slate-100 text-slate-750 hover:bg-slate-200 font-semibold transition"
                      >
                        View Supporting PDF
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-100 p-4 bg-slate-50/50 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedProposalForModal(null)}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white transition shadow"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
