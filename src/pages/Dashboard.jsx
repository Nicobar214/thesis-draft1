/* Dashboard.jsx - Complete Functional Rewrite with Supabase Integration */
import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import L from 'leaflet';
import { supabase, supabaseAdmin } from '../lib/supabase';
import { getMunicipalities, getBarangays } from '../data/iloiloLocations';
import { MapContainer, TileLayer, CircleMarker, Polyline, Marker, Popup, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet.heat';
import {
  buildRoutePoints,
  boundsFromPoints,
  fetchRoadAlignedPolyline,
  getProjectBarangay,
  getRouteStatusTheme,
  getTargetDateChip,
  isOverdueProject,
  getJitteredCentroid,
  geocodeFmrLocation,
} from '../lib/mapRouteUtils';
import {
  estimateProjectBudget,
  buildDisbursementTranches,
  summarizeTranches,
  realTranchesToScheduleShape,
} from '../lib/budgetEstimate';
import ProjectTrancheTimeline from '../components/budget/ProjectTrancheTimeline';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area,
  Legend,
} from 'recharts';
import 'leaflet/dist/leaflet.css';
import PublicReportRouteMapPanel from '../components/publicReports/PublicReportRouteMapPanel';
import AdminWorkflowControls from '../components/publicReports/AdminWorkflowControls';
import LguEscalationPanel from '../components/publicReports/LguEscalationPanel';
import PriorityTab from '../components/admin/PriorityTab';
import FarmerBeneficiariesTab from '../components/admin/FarmerBeneficiariesTab';
import LguProposalsTab from '../components/admin/LguProposalsTab';
import ProjectSchedulingTab from '../components/admin/ProjectSchedulingTab';
import { computePriorityScores } from '../lib/priorityScoring';
import { buildFarmerBeneficiaries } from '../utils/farmerBeneficiaryData';
import Icons from '../components/Icons';
import Logo from '../components/Logo';
import { getPaginationRange } from '../lib/paginationUtils';

function normalizeFmrStatus(s) {
  if (!s) return '';
  const lower = s.toLowerCase().replace(/[-\s]/g, '');
  if (lower === 'ongoing') return 'On-Going';
  if (lower === 'proposed') return 'Proposed';
  return s;
}

function getFmrStatusColor(status) {
  switch (normalizeFmrStatus(status)) {
    case 'Completed': return { fill: '#10b981', stroke: '#059669' };
    case 'On-Going': return { fill: '#f59e0b', stroke: '#d97706' };
    case 'Proposed': return { fill: '#3b82f6', stroke: '#2563eb' };
    default: return { fill: '#6b7280', stroke: '#4b5563' };
  }
}

function parseDateOnly(dateValue) {
  if (!dateValue) return null;

  if (dateValue instanceof Date) {
    if (Number.isNaN(dateValue.getTime())) return null;
    const normalized = new Date(dateValue);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  }

  const raw = String(dateValue).trim();
  if (!raw) return null;

  // Handle yyyy-mm-dd safely in local time (avoid UTC offset surprises).
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]) - 1;
    const day = Number(isoMatch[3]);
    return new Date(year, month, day);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function isPastDate(dateValue, todayDate) {
  const date = parseDateOnly(dateValue);
  if (!date) return false;
  return date < todayDate;
}

function calculateRoadLengthKm(startLat, startLng, endLat, endLng) {
  const R = 6371000; // meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(endLat - startLat);
  const dLng = toRad(endLng - startLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(startLat)) * Math.cos(toRad(endLat)) * Math.sin(dLng / 2) ** 2;
  const meters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return meters / 1000;
}

function calculateSnappedPolylineDistanceKm(points) {
  if (!points || points.length < 2) return 0;
  let totalMeters = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const lat1 = Array.isArray(p1) ? p1[0] : (p1.lat ?? p1.latitude);
    const lng1 = Array.isArray(p1) ? p1[1] : (p1.lng ?? p1.longitude);
    const lat2 = Array.isArray(p2) ? p2[0] : (p2.lat ?? p2.latitude);
    const lng2 = Array.isArray(p2) ? p2[1] : (p2.lng ?? p2.longitude);

    if (
      Number.isFinite(Number(lat1)) && Number.isFinite(Number(lng1)) &&
      Number.isFinite(Number(lat2)) && Number.isFinite(Number(lng2))
    ) {
      totalMeters += haversineMeters(Number(lat1), Number(lng1), Number(lat2), Number(lng2));
    }
  }
  return totalMeters / 1000;
}


// Accepts plain decimals and values like "10.82492N" or "122.53211E".
function parseCoordinate(value) {
  if (value === null || value === undefined) return NaN;
  const raw = String(value).trim();
  if (!raw) return NaN;

  const normalized = raw.replace(/,/g, '.').toUpperCase();
  const match = normalized.match(/^([+-]?\d+(?:\.\d+)?)(?:\s*([NSEW]))?$/);
  if (!match) return NaN;

  let num = Number(match[1]);
  if (Number.isNaN(num)) return NaN;

  const dir = match[2] || '';
  if (dir === 'S' || dir === 'W') num = -Math.abs(num);
  return num;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getDistanceBand(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) {
    return { tone: 'text-slate-600 bg-slate-100 border-slate-200', label: 'Distance unavailable', emoji: '⚪' };
  }

  if (distanceMeters <= 50) {
    return { tone: 'text-emerald-700 bg-emerald-50 border-emerald-200', label: 'within 50m', emoji: '🟢' };
  }

  if (distanceMeters <= 200) {
    return { tone: 'text-amber-700 bg-amber-50 border-amber-200', label: '50-200m', emoji: '🟡' };
  }

  return { tone: 'text-red-700 bg-red-50 border-red-200', label: 'over 200m', emoji: '🔴' };
}

function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) return 'N/A';
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)}m`;
  return `${(distanceMeters / 1000).toFixed(2)}km`;
}

function calculateCredibilityScore({ accuracy, distanceMeters, isVerifiedUser, photoGpsMatch }) {
  let accuracyScore = 5;
  if (Number.isFinite(accuracy)) {
    if (accuracy <= 10) accuracyScore = 30;
    else if (accuracy <= 25) accuracyScore = 26;
    else if (accuracy <= 50) accuracyScore = 22;
    else if (accuracy <= 100) accuracyScore = 14;
    else accuracyScore = 8;
  }

  let distanceScore = 8;
  if (Number.isFinite(distanceMeters)) {
    if (distanceMeters <= 50) distanceScore = 35;
    else if (distanceMeters <= 200) distanceScore = 22;
    else distanceScore = 10;
  }

  const identityScore = isVerifiedUser ? 20 : 10;
  const photoMatchScore = photoGpsMatch ? 15 : 3;

  const score = Math.max(0, Math.min(100, accuracyScore + distanceScore + identityScore + photoMatchScore));
  let label = 'Low';
  let tone = 'bg-red-500';

  if (score >= 70) {
    label = 'High';
    tone = 'bg-emerald-500';
  } else if (score >= 40) {
    label = 'Medium';
    tone = 'bg-amber-500';
  }

  return { score, label, tone };
}

function PublicReportLocationComparisonMap({ officialPoint, reportPoint }) {
  const points = [];
  if (officialPoint) points.push([officialPoint.lat, officialPoint.lng]);
  if (reportPoint) points.push([reportPoint.lat, reportPoint.lng]);

  if (points.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        Location comparison is unavailable because one or both points are missing.
      </div>
    );
  }

  const center = points.length === 2
    ? [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2]
    : points[0];

  return (
    <div className="h-64 overflow-hidden rounded-xl border border-slate-200">
      <MapContainer center={center} zoom={15} style={{ height: '100%', width: '100%' }} scrollWheelZoom className="z-0">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {officialPoint && (
          <CircleMarker center={[officialPoint.lat, officialPoint.lng]} radius={8} pathOptions={{ color: '#059669', weight: 2, fillOpacity: 0.9 }}>
            <Popup>Official project location</Popup>
          </CircleMarker>
        )}
        {reportPoint && (
          <CircleMarker center={[reportPoint.lat, reportPoint.lng]} radius={8} pathOptions={{ color: '#dc2626', weight: 2, fillOpacity: 0.9 }}>
            <Popup>Citizen photo/report location</Popup>
          </CircleMarker>
        )}
        {officialPoint && reportPoint && (
          <Polyline positions={[[officialPoint.lat, officialPoint.lng], [reportPoint.lat, reportPoint.lng]]} pathOptions={{ color: '#334155', dashArray: '6 6', weight: 2 }} />
        )}
        <AdminFitBounds points={points} />
      </MapContainer>
    </div>
  );
}

/* ─── Map bounds fitter for admin ─── */
function AdminFitBounds({ points, filterKey }) {
  const map = useMap();
  const lastKeyRef = useRef('');

  useEffect(() => {
    if (!points || points.length === 0) return;

    if (filterKey === undefined || lastKeyRef.current !== filterKey) {
      if (filterKey !== undefined) {
        lastKeyRef.current = filterKey;
      }
      const bounds = boundsFromPoints(points);
      if (bounds) {
        map.fitBounds(bounds, { padding: [30, 30] });
      }
    }
  }, [points, filterKey, map]);
  return null;
}

function MapSearchController({ searchCoords }) {
  const map = useMap();
  useEffect(() => {
    if (searchCoords) {
      map.flyTo(searchCoords, 16);
    }
  }, [searchCoords, map]);
  return null;
}

function SelectedProjectMapController({ selectedProject }) {
  const map = useMap();

  useEffect(() => {
    if (!selectedProject) return;

    const startLat = Number(selectedProject.start_latitude || selectedProject.startLatitude);
    const startLng = Number(selectedProject.start_longitude || selectedProject.startLongitude);
    const endLat = Number(selectedProject.end_latitude || selectedProject.endLatitude);
    const endLng = Number(selectedProject.end_longitude || selectedProject.endLongitude);

    if (Number.isFinite(startLat) && Number.isFinite(startLng)) {
      if (Number.isFinite(endLat) && Number.isFinite(endLng)) {
        const bounds = L.latLngBounds([startLat, startLng], [endLat, endLng]);
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      } else {
        map.flyTo([startLat, startLng], 15);
      }
    }
  }, [selectedProject, map]);

  return null;
}

function EditModalMapController({ projectId, startLat, startLng, endLat, endLng }) {
  const map = useMap();
  const lastIdRef = useRef(null);

  useEffect(() => {
    if (!projectId || lastIdRef.current === projectId) return;
    lastIdRef.current = projectId;

    const sLat = parseFloat(startLat);
    const sLng = parseFloat(startLng);
    const eLat = parseFloat(endLat);
    const eLng = parseFloat(endLng);

    if (Number.isFinite(sLat) && Number.isFinite(sLng)) {
      if (Number.isFinite(eLat) && Number.isFinite(eLng)) {
        const bounds = L.latLngBounds([sLat, sLng], [eLat, eLng]);
        map.fitBounds(bounds, { padding: [40, 40] });
      } else {
        map.setView([sLat, sLng], 14);
      }
    }
  }, [projectId, startLat, startLng, endLat, endLng, map]);

  return null;
}


function ReportHeatmapLayer({ visible, points }) {
  const map = useMap();

  useEffect(() => {
    if (!visible || !Array.isArray(points) || points.length === 0) return undefined;

    const layer = L.heatLayer(points, {
      radius: 22,
      blur: 18,
      maxZoom: 15,
      gradient: {
        0.2: '#2563eb',
        0.55: '#facc15',
        1.0: '#ef4444',
      },
    }).addTo(map);

    return () => {
      map.removeLayer(layer);
    };
  }, [visible, points, map]);

  return null;
}

function FarmerHeatmapLayer({ visible, points }) {
  const map = useMap();

  useEffect(() => {
    if (!visible || !map || !window.L || !window.L.heatLayer || !points || points.length === 0) return undefined;

    const layer = window.L.heatLayer(points, {
      radius: 30,
      blur: 20,
      maxZoom: 15,
      gradient: { 0.2: '#86efac', 0.5: '#fcd34d', 0.8: '#fca5a5', 1.0: '#ef4444' }
    }).addTo(map);

    return () => {
      map.removeLayer(layer);
    };
  }, [map, visible, points]);

  return null;
}

function RouteEditorMapClick({ onPickPoint }) {
  useMapEvents({
    click(event) {
      onPickPoint(event.latlng);
    },
  });

  return null;
}

const enterpriseCardClass = 'bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow';

const formatPeso = (amount) => `₱${Number(amount || 0).toLocaleString()}`;

const ADMIN_FMR_VIEW_MODE_KEY = 'admin-fmr-projects-view';
const FMR_ROWS_PER_PAGE_OPTIONS = [10, 25, 50];

function getFmrStatusStyle(status) {
  if (status === 'Completed') return { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500', dot: 'bg-emerald-500' };
  if (status === 'On-Going') return { badge: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-500', dot: 'bg-amber-500' };
  return { badge: 'bg-sky-50 text-sky-700 border-sky-200', bar: 'bg-sky-500', dot: 'bg-sky-500' };
}

const fmrThClass = 'px-6 py-4 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500';

/* Sortable header - writes into the same fmrProjectSortBy the sort dropdown uses. */
function FmrSortableTh({ label, asc, desc, defaultDir = 'asc', sortBy, onSortChange }) {
  const isAsc = sortBy === asc;
  const isDesc = sortBy === desc;
  const next = isAsc ? desc : isDesc ? asc : (defaultDir === 'asc' ? asc : desc);

  return (
    <th scope="col" className={fmrThClass}>
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

/* Admin FMR projects table - the default view for the Projects tab. */
function AdminFmrProjectTable({ projects, sortBy, onSortChange, onOpenDetail, onEdit, onAssign, onDelete }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px]">
          <thead>
            <tr className="bg-slate-50/60 border-b border-slate-200/70">
              <FmrSortableTh label="Project" asc="name-asc" desc="name-desc" defaultDir="asc" sortBy={sortBy} onSortChange={onSortChange} />
              <th scope="col" className={fmrThClass}>Status</th>
              <FmrSortableTh label="Fiscal Year" asc="year-asc" desc="year-desc" defaultDir="desc" sortBy={sortBy} onSortChange={onSortChange} />
              <FmrSortableTh label="Accomplishment" asc="progress-asc" desc="progress-desc" defaultDir="desc" sortBy={sortBy} onSortChange={onSortChange} />
              <th scope="col" className={fmrThClass}>Length</th>
              <th scope="col" className={fmrThClass}>Completed</th>
              <th scope="col" className="px-6 py-4 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {projects.map((project) => {
              const status = normalizeFmrStatus(project.status);
              const statusStyle = getFmrStatusStyle(status);

              return (
                <tr
                  key={project.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenDetail(project)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpenDetail(project);
                    }
                  }}
                  title="Click to view project details"
                  className="cursor-pointer transition-colors hover:bg-slate-50/60 focus:outline-none focus:bg-slate-50"
                >
                  <td className="px-6 py-4 max-w-[320px]">
                    <p className="text-sm font-semibold text-slate-900 line-clamp-2 leading-snug">{project.project_name}</p>
                    <p className="mt-0.5 text-xs text-slate-500 truncate">
                      {project.municipality}{project.province ? `, ${project.province}` : ', Iloilo'}
                    </p>
                  </td>

                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-semibold whitespace-nowrap ${statusStyle.badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                      {status}
                    </span>
                  </td>

                  <td className="px-6 py-4 text-sm text-slate-700 tabular-nums whitespace-nowrap">
                    {project.year_funded ? `FY ${project.year_funded}` : <span className="text-slate-300">—</span>}
                  </td>

                  <td className="px-6 py-4">
                    {status === 'Proposed' ? (
                      <span className="text-slate-300">—</span>
                    ) : (
                      <div className="flex items-center gap-2 min-w-[130px]">
                        <div className="h-2 flex-1 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${statusStyle.bar}`} style={{ width: `${Math.min(project.accomplishment || 0, 100)}%` }} />
                        </div>
                        <span className="text-xs font-bold text-slate-700 tabular-nums w-9 text-right">{project.accomplishment || 0}%</span>
                      </div>
                    )}
                  </td>

                  <td className="px-6 py-4 text-sm text-slate-700 tabular-nums whitespace-nowrap">
                    {project.project_length_km > 0 ? `${project.project_length_km} km` : <span className="text-slate-300">—</span>}
                  </td>

                  <td className="px-6 py-4 text-sm text-slate-700 tabular-nums whitespace-nowrap">
                    {project.date_completed || <span className="text-slate-300">—</span>}
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={(event) => { event.stopPropagation(); onEdit(project); }}
                        title="Edit project"
                        aria-label={`Edit ${project.project_name}`}
                        className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                      </button>
                      <button
                        onClick={(event) => { event.stopPropagation(); onAssign(project); }}
                        title="Assign contractor"
                        aria-label={`Assign contractor to ${project.project_name}`}
                        className="p-2 bg-amber-50 hover:bg-amber-100 border border-amber-200/60 rounded-lg text-amber-700 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" /></svg>
                      </button>
                      <button
                        onClick={(event) => { event.stopPropagation(); onDelete(project); }}
                        title="Delete project"
                        aria-label={`Delete ${project.project_name}`}
                        className="p-2 bg-red-50 hover:bg-red-100 border border-red-200/60 rounded-lg text-red-600 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                      </button>
                    </div>
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

function EmptyState({ title, description, buttonLabel, onButtonClick }) {
  return (
    <div className="py-12 px-6 text-center flex flex-col items-center justify-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 2.5h7m-7 4h7m-7-8h7" />
        </svg>
      </div>
      <p className="text-base font-bold text-slate-900">{title}</p>
      <p className="text-sm text-slate-500 mt-1 max-w-md">{description}</p>
      {buttonLabel && onButtonClick && (
        <button
          onClick={onButtonClick}
          className="mt-5 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors"
        >
          {buttonLabel}
        </button>
      )}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();

  // State management
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('projects');
  const [showSidebar, setShowSidebar] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [adminIdentity, setAdminIdentity] = useState({ full_name: 'Administrator', email: '', role: 'System Administrator' });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortField, setSortField] = useState('projectName');
  const [sortDirection, setSortDirection] = useState('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [notification, setNotification] = useState(null);
  const projectsPerPage = 5;

  // Public reports state (admin view)
  const [publicReports, setPublicReports] = useState([]);
  const [publicReportsLoading, setPublicReportsLoading] = useState(false);
  const [publicReportFilter, setPublicReportFilter] = useState('pending');
  const [publicReportCategoryFilter, setPublicReportCategoryFilter] = useState('all'); // now used for verification filter
  const [publicReportAssignedFilter, setPublicReportAssignedFilter] = useState('all');
  const [publicReportViewMode, setPublicReportViewMode] = useState('grid');
  const [publicReportSearch, setPublicReportSearch] = useState('');
  const [publicReportDateFrom, setPublicReportDateFrom] = useState('');
  const [publicReportDateTo, setPublicReportDateTo] = useState('');
  const [selectedPublicReport, setSelectedPublicReport] = useState(null);
  const [publicReportMunicipalityFilter, setPublicReportMunicipalityFilter] = useState('all');
  const [publicReportBarangayFilter, setPublicReportBarangayFilter] = useState('all');
  const [publicReportStreetFilter, setPublicReportStreetFilter] = useState('all');
  const [publicReportProjectFilter, setPublicReportProjectFilter] = useState('');
  const [publicReportsAnalyticsOpen, setPublicReportsAnalyticsOpen] = useState(true);
  const [publicReportsTrendView, setPublicReportsTrendView] = useState('weekly');
  const [publicReportsLocationSort, setPublicReportsLocationSort] = useState({ key: 'total', direction: 'desc' });
  const [publicReportActivityLogs, setPublicReportActivityLogs] = useState([]);
  const [publicReportActivityLoading, setPublicReportActivityLoading] = useState(false);
  const [similarNearbyReports, setSimilarNearbyReports] = useState([]);
  const [similarReportsLoading, setSimilarReportsLoading] = useState(false);
  const [adminPrivateNote, setAdminPrivateNote] = useState('');
  const [adminPrivateNoteSaving, setAdminPrivateNoteSaving] = useState(false);
  const [adminUserId, setAdminUserId] = useState('');
  const [selectedReportLguDecision, setSelectedReportLguDecision] = useState(null);
  const [escalations, setEscalations] = useState([]);
  const [selectedFieldFinding, setSelectedFieldFinding] = useState(null);
  const [selectedResolution, setSelectedResolution] = useState(null);
  const [rejectReasonDraft, setRejectReasonDraft] = useState('');
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [findingActionSaving, setFindingActionSaving] = useState(false);

  // Field engineer state
  const [fieldEngineers, setFieldEngineers] = useState([]);
  const [assigningEngineer, setAssigningEngineer] = useState(false);

  // FMR Projects state (synced from user side - DA data)
  const [fmrProjects, setFmrProjects] = useState([]);
  const [fmrLoading, setFmrLoading] = useState(false);
  const [adminMapSearch, setAdminMapSearch] = useState('');
  const [adminMapStatusFilter, setAdminMapStatusFilter] = useState('On-Going');
  const [adminMapYearFilter, setAdminMapYearFilter] = useState('All');
  const [adminMapMunicipalityFilter, setAdminMapMunicipalityFilter] = useState('All');
  const [adminMapShowOverdueOnly, setAdminMapShowOverdueOnly] = useState(false);
  const [adminMapShowHeatmap, setAdminMapShowHeatmap] = useState(false);
  const [adminMapSelectedProject, setAdminMapSelectedProject] = useState(null);
  const [adminMapProgressEdit, setAdminMapProgressEdit] = useState(null);
  const [routeByProjectId, setRouteByProjectId] = useState({});
  const [reportCountByProjectId, setReportCountByProjectId] = useState({});
  const [reportHeatPoints, setReportHeatPoints] = useState([]);
  const [adminSnappedRouteByProjectId, setAdminSnappedRouteByProjectId] = useState({});
  const fmrProjectsRef = useRef([]);
  const [geocodingStatus, setGeocodingStatus] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const hasStartedGeocodingRef = useRef(false);

  // Farmer beneficiaries state
  const [farmerBeneficiaries, setFarmerBeneficiaries] = useState([]);
  const [farmerBeneficiariesLoading, setFarmerBeneficiariesLoading] = useState(false);

  const [farmerCropFilter, setFarmerCropFilter] = useState('All');

  const farmerCropOptions = useMemo(() => {
    const crops = new Set((farmerBeneficiaries || []).map((f) => f.crop).filter(Boolean));
    return ['All', ...[...crops].sort()];
  }, [farmerBeneficiaries]);

  const cropFilteredFarmerBeneficiaries = useMemo(() => {
    if (farmerCropFilter === 'All') return farmerBeneficiaries || [];
    return (farmerBeneficiaries || []).filter((f) => f.crop === farmerCropFilter);
  }, [farmerBeneficiaries, farmerCropFilter]);

  const farmerHeatPoints = useMemo(() => {
    return cropFilteredFarmerBeneficiaries
      .map((f) => {
        const lat = f.farmLatitude || f.gps?.lat;
        const lng = f.farmLongitude || f.gps?.lng;
        return lat && lng ? [Number(lat), Number(lng), 1.0] : null;
      })
      .filter(Boolean);
  }, [cropFilteredFarmerBeneficiaries]);

  // Project Management tab states
  const [pmSubTab, setPmSubTab] = useState('budget');
  const [pmSearchInput, setPmSearchInput] = useState('');
  const [pmSearch, setPmSearch] = useState('');
  const [pmMunicipalityFilter, setPmMunicipalityFilter] = useState('All');
  const [pmModeFilter, setPmModeFilter] = useState('All');
  const [pmStatusFilter, setPmStatusFilter] = useState('All');
  const [selectedFmrPmProject, setSelectedFmrPmProject] = useState(null);
  const [pmBudgetPage, setPmBudgetPage] = useState(1);


  // FMR CRUD state (edit / delete)
  const [showFmrEditModal, setShowFmrEditModal] = useState(false);
  const [showFmrDeleteModal, setShowFmrDeleteModal] = useState(false);
  const [selectedFmrProject, setSelectedFmrProject] = useState(null);
  const emptyFmrForm = {
    project_name: '', status: 'Proposed', year_funded: '', municipality: '', province: 'Iloilo',
    accomplishment: '', project_length_km: '', start_latitude: '', start_longitude: '',
    end_latitude: '', end_longitude: '', date_completed: '', target_completion_date: '', location: '', remarks: '',
    total_budget: '', funds_released: '', funding_source: ''
  };
  const [fmrFormData, setFmrFormData] = useState(emptyFmrForm);
  const [fmrRouteMode, setFmrRouteMode] = useState('waypoint');
  const [fmrRouteWaypoints, setFmrRouteWaypoints] = useState([]);

  // Map Search States inside modals
  const [createMapSearchQuery, setCreateMapSearchQuery] = useState('');
  const [createMapSearchCoords, setCreateMapSearchCoords] = useState(null);
  const [editMapSearchQuery, setEditMapSearchQuery] = useState('');
  const [editMapSearchCoords, setEditMapSearchCoords] = useState(null);

  const handleCreateMapSearch = async () => {
    const q = createMapSearchQuery.trim();
    if (!q) return;
    try {
      const query = `${q}, Iloilo, Philippines`;
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
        setCreateMapSearchCoords([Number(data[0].lat), Number(data[0].lon)]);
      } else {
        showNotification('Location not found. Try adding the municipality name.', 'error');
      }
    } catch {
      showNotification('Error searching location.', 'error');
    }
  };

  const handleEditMapSearch = async () => {
    const q = editMapSearchQuery.trim();
    if (!q) return;
    try {
      const query = `${q}, Iloilo, Philippines`;
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
        setEditMapSearchCoords([Number(data[0].lat), Number(data[0].lon)]);
      } else {
        showNotification('Location not found. Try adding the municipality name.', 'error');
      }
    } catch {
      showNotification('Error searching location.', 'error');
    }
  };

  // Projects Tab Mini-Map Search States
  const [projectsMapSearchQuery, setProjectsMapSearchQuery] = useState('');
  const [projectsMapSearchCoords, setProjectsMapSearchCoords] = useState(null);

  const handleProjectsMapSearch = async () => {
    const q = projectsMapSearchQuery.trim();
    if (!q) return;
    try {
      const query = `${q}, Iloilo, Philippines`;
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
      const res = await fetch(url, {
        headers: {
          'Accept-Language': 'en',
          'User-Agent': 'KalsaTrack-Projects-Map-Search'
        }
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data && data.length > 0) {
        setProjectsMapSearchCoords([Number(data[0].lat), Number(data[0].lon)]);
      } else {
        showNotification('Location not found. Try adding the municipality name.', 'error');
      }
    } catch {
      showNotification('Error searching location.', 'error');
    }
  };

  // Main Map Tab Search States
  const [mainMapGeopSearchQuery, setMainMapGeopSearchQuery] = useState('');
  const [mainMapGeopSearchCoords, setMainMapGeopSearchCoords] = useState(null);

  const handleMainMapGeopSearch = async () => {
    const q = mainMapGeopSearchQuery.trim();
    if (!q) return;
    try {
      const query = `${q}, Iloilo, Philippines`;
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
      const res = await fetch(url, {
        headers: {
          'Accept-Language': 'en',
          'User-Agent': 'KalsaTrack-Main-Map-Search'
        }
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data && data.length > 0) {
        setMainMapGeopSearchCoords([Number(data[0].lat), Number(data[0].lon)]);
      } else {
        showNotification('Location not found. Try adding the municipality name.', 'error');
      }
    } catch {
      showNotification('Error searching location.', 'error');
    }
  };

  const [newProjectRouteMode, setNewProjectRouteMode] = useState('waypoint');
  const [newProjectRouteWaypoints, setNewProjectRouteWaypoints] = useState([]);

  // FMR projects-tab filter state
  const [fmrProjectSearch, setFmrProjectSearch] = useState('');
  const [fmrProjectStatusFilter, setFmrProjectStatusFilter] = useState('On-Going');
  const [fmrProjectYearFilter, setFmrProjectYearFilter] = useState('All');
  const [fmrProjectDateFrom, setFmrProjectDateFrom] = useState('');
  const [fmrProjectDateTo, setFmrProjectDateTo] = useState('');
  const [fmrProjectSortBy, setFmrProjectSortBy] = useState('latest');
  const [fmrProjectCurrentPage, setFmrProjectCurrentPage] = useState(1);
  // Tabular is the default presentation for FMR records; cards remain opt-in.
  const [fmrViewMode, setFmrViewMode] = useState(() => {
    try {
      return localStorage.getItem(ADMIN_FMR_VIEW_MODE_KEY) === 'cards' ? 'cards' : 'table';
    } catch {
      return 'table';
    }
  });
  const [fmrRowsPerPage, setFmrRowsPerPage] = useState(10);
  const fmrProjectsPerPage = fmrViewMode === 'table' ? fmrRowsPerPage : 9;
  const [selectedProjectDetail, setSelectedProjectDetail] = useState(null);

  // Contractor state
  const [contractors, setContractors] = useState([]);
  const [lgus, setLgus] = useState([]);
  const [progressUpdates, setProgressUpdates] = useState([]);
  const [progressUpdatesLoading, setProgressUpdatesLoading] = useState(false);
  const [progressUpdatesLastSyncedAt, setProgressUpdatesLastSyncedAt] = useState(null);
  const [lguProposals, setLguProposals] = useState([]);
  const [lguProposalsLoading, setLguProposalsLoading] = useState(false);
  const [pendingProposalLink, setPendingProposalLink] = useState(null);
  const [assignContractorModal, setAssignContractorModal] = useState(null); // holds fmr project
  const [assigningContractor, setAssigningContractor] = useState(false);
  const [selectedContractorId, setSelectedContractorId] = useState('');
  const [newProjectContractorId, setNewProjectContractorId] = useState('');

  // Markets & supply chain map layers states
  const [markets, setMarkets] = useState([]);
  const [showFarmerDots, setShowFarmerDots] = useState(false);
  const [showFarmerHeatmap, setShowFarmerHeatmap] = useState(false);
  const [showMarketsMap, setShowMarketsMap] = useState(true);
  const [selectedFarmerForPath, setSelectedFarmerForPath] = useState(null);

  // Reports tab state (split sections + per-section pagination)
  const [reportsSectionFilter, setReportsSectionFilter] = useState('ongoing');
  const [reportsPageBySection, setReportsPageBySection] = useState({ completed: 1, delayed: 1, ongoing: 1, pending: 1 });
  const reportsPerSectionPage = 8;
  const [reportsSearch, setReportsSearch] = useState('');
  const [reportsYearFilter, setReportsYearFilter] = useState('All');
  const [reportsMunicipalityFilter, setReportsMunicipalityFilter] = useState('All');
  const [reportsSortBy, setReportsSortBy] = useState('latest');
  const [reportsDateFrom, setReportsDateFrom] = useState('');
  const [reportsDateTo, setReportsDateTo] = useState('');

  // Project reports viewer state (admin: see public reports linked to a project)
  const [projectFeedbackModal, setProjectFeedbackModal] = useState(null); // holds the project object
  const [projectLinkedReports, setProjectLinkedReports] = useState([]);
  const [projectFeedbackLoading, setProjectFeedbackLoading] = useState(false);

  // Form state
  const emptyForm = {
    projectName: '',
    projectCode: '',
    region: 'Region VI – Western Visayas',
    barangay: '',
    municipality: '',
    province: 'Iloilo',
    startLatitude: '',
    startLongitude: '',
    endLatitude: '',
    endLongitude: '',
    roadLength: '',
    roadWidth: '',
    totalBudget: '',
    disbursedAmount: '',
    budgetSource: '',
    contractor: '',
    startDate: '',
    expectedEndDate: '',
    roadType: '',
    status: 'Planning',
    progress: 0,
    description: ''
  };

  const generateNextProjectCode = () => {
    const prefix = 'FMR-2026-R6-';
    let maxNum = 0;
    (projects || []).forEach(p => {
      const code = p.project_code || '';
      if (code.startsWith(prefix)) {
        const numPart = code.substring(prefix.length);
        const num = parseInt(numPart, 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    });
    const nextNum = maxNum + 1;
    const padded = String(nextNum).padStart(3, '0');
    return `${prefix}${padded}`;
  };

  const [formData, setFormData] = useState(emptyForm);

  // Show notification helper
  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const normalizeFarmerBeneficiaryRow = useCallback((row) => {
    if (!row) return null;
    const farmLatitude = row.farm_latitude !== undefined && row.farm_latitude !== null
      ? Number(row.farm_latitude)
      : (row.gps && row.gps.lat !== undefined ? Number(row.gps.lat) : null);
    const farmLongitude = row.farm_longitude !== undefined && row.farm_longitude !== null
      ? Number(row.farm_longitude)
      : (row.gps && row.gps.lng !== undefined ? Number(row.gps.lng) : null);

    return {
      id: row.id,
      beneficiaryId: row.beneficiary_id || row.beneficiaryId || row.id,
      fullName: row.full_name || row.fullName || 'Unnamed Farmer',
      rsbsaNumber: row.rsbsa_number || row.rsbsaNumber || '',
      controlNo: row.control_no || row.controlNo || '',
      firstName: row.first_name || row.firstName || '',
      middleName: row.middle_name || row.middleName || '',
      lastName: row.last_name || row.lastName || '',
      extName: row.ext_name || row.extName || '',
      birthday: row.birthday || row.birthday || '',
      gender: row.gender || row.gender || '',
      agency: row.agency || row.agency || 'DA',
      farmLatitude,
      farmLongitude,
      nearestMarketId: row.nearest_market_id || row.nearestMarketId || null,
      contactNumber: row.contact_number || row.contactNumber || '',
      municipality: row.municipality || '',
      barangay: row.barangay || '',
      crop: row.crop || '',
      farmAreaHa: Number(row.farm_area_ha ?? row.farmAreaHa ?? 0),
      estimatedYield: Number(row.estimated_yield ?? row.estimatedYield ?? 0),
      linkedProjectId: row.linked_project_id || row.linkedProjectId || '',
      linkedProject: row.linked_project_name || row.linkedProject || '',
      linkedProjects: row.linked_project_name ? [row.linked_project_name] : row.linkedProjects || [],
      linkedProjectStatus: row.linked_project_status || row.linkedProjectStatus || '',
      distanceToFmrKm: Number(row.distance_to_fmr_km ?? row.distanceToFmrKm ?? 0),
      serviceArea: row.service_area || row.serviceArea || '',
      benefitReason: row.benefit_reason || row.benefitReason || '',
      beneficiaryStatus: row.beneficiary_status || row.beneficiaryStatus || 'Under Review',
      validationStatus: row.validation_status || row.validationStatus || 'For Verification',
      submittedByLgu: row.submitted_by_lgu || row.submittedByLgu || row.created_by_name || 'LGU',
      createdByUserId: row.created_by_user_id || row.createdByUserId || '',
      createdByName: row.created_by_name || row.createdByName || '',
      adminRemarks: row.admin_remarks || row.adminRemarks || '',
      supportingDocuments: Array.isArray(row.supporting_documents) ? row.supporting_documents : row.supportingDocuments || [],
      validationHistory: Array.isArray(row.validation_history) ? row.validation_history : row.validationHistory || [],
      gps: row.gps || { lat: farmLatitude, lng: farmLongitude },
      submittedDate: row.submitted_date ? new Date(row.submitted_date) : row.submittedDate ? new Date(row.submittedDate) : new Date(),
      lastUpdated: row.last_updated ? new Date(row.last_updated) : row.updated_at ? new Date(row.updated_at) : row.lastUpdated ? new Date(row.lastUpdated) : new Date(),
    };
  }, []);

  const loadFallbackFarmerBeneficiaries = useCallback(() => buildFarmerBeneficiaries(fmrProjectsRef.current, 84), []);

  const fetchFarmerBeneficiaries = useCallback(async () => {
    setFarmerBeneficiariesLoading(true);
    try {
      const { data, error } = await supabase
        .from('farmer_beneficiaries')
        .select('*')
        .order('submitted_date', { ascending: false });

      if (error) throw error;

      setFarmerBeneficiaries((data || []).map(normalizeFarmerBeneficiaryRow).filter(Boolean));
    } catch (err) {
      console.error('Error fetching farmer beneficiaries:', err.message);
      setFarmerBeneficiaries(loadFallbackFarmerBeneficiaries().map(normalizeFarmerBeneficiaryRow).filter(Boolean));
    } finally {
      setFarmerBeneficiariesLoading(false);
    }
  }, [loadFallbackFarmerBeneficiaries, normalizeFarmerBeneficiaryRow]);

  // Fetch projects from Supabase
  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchErr) throw fetchErr;

      setProjects(data || []);
    } catch (err) {
      console.error('Error fetching projects:', err.message);
      setError(`Failed to load projects: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch public reports from Supabase
  const fetchPublicReports = useCallback(async () => {
    setPublicReportsLoading(true);
    try {
      const { data, error: fetchErr } = await supabase
        .from('public_reports')
        .select('*')
        .order('created_at', { ascending: false });
      if (fetchErr) throw fetchErr;
      setPublicReports(data || []);

      // Notify LGU for critical unresolved threshold (>=5) per project per day.
      const unresolvedCounts = {};
      (data || []).forEach((row) => {
        if (row.status === 'resolved') return;
        const key = row.project_id || row.project_name || `${row.municipality || 'unknown'}::${row.barangay || 'unknown'}`;
        unresolvedCounts[key] = unresolvedCounts[key] || {
          project_key: key,
          municipality: row.municipality || null,
          label: row.project_name || row.project_id || 'project',
          count: 0,
        };
        unresolvedCounts[key].count += 1;
      });

      const criticalEntries = Object.values(unresolvedCounts).filter((entry) => entry.count >= 5);
      await Promise.all(
        criticalEntries.map(async (entry) => {
          try {
            const todayStr = new Date().toISOString().slice(0, 10);
            const { data: existingLog } = await supabase
              .from('lgu_project_alert_logs')
              .select('id')
              .eq('project_key', entry.project_key)
              .eq('threshold_value', 5)
              .eq('alert_date', todayStr)
              .maybeSingle();

            if (existingLog) return;

            const { error: logErr } = await supabase
              .from('lgu_project_alert_logs')
              .insert({
                project_key: entry.project_key,
                municipality: entry.municipality,
                threshold_value: 5,
                alert_date: todayStr,
              });

            if (logErr) return;

            const { data: lguUsers } = await supabase
              .from('profiles')
              .select('id, municipality')
              .eq('role', 'lgu');

            const recipients = (lguUsers || []).filter((u) => !entry.municipality || !u.municipality || u.municipality === entry.municipality);
            if (recipients.length === 0) return;

            await supabase.from('notifications').insert(
              recipients.map((u) => ({
                user_id: u.id,
                type: 'lgu_threshold_alert',
                title: 'Critical unresolved reports',
                message: `${entry.label} has ${entry.count} unresolved reports in your jurisdiction.`,
                is_read: false,
                created_at: new Date().toISOString(),
              }))
            );
          } catch {
            // Non-blocking alert path.
          }
        })
      );
    } catch (err) {
      console.error('Error fetching public reports:', err.message);
    } finally {
      setPublicReportsLoading(false);
    }
  }, []);

  const fetchEscalations = useCallback(async () => {
    try {
      const { data, error: fetchErr } = await supabase
        .from('public_report_lgu_escalations')
        .select('*')
        .order('created_at', { ascending: false });
      if (fetchErr) throw fetchErr;
      setEscalations(data || []);
    } catch (err) {
      console.error('Error fetching escalations:', err.message);
      setEscalations([]);
    }
  }, []);

  // Fetch field engineers from profiles
  const [feLoadError, setFeLoadError] = useState('');
  const fetchFieldEngineers = useCallback(async () => {
    setFeLoadError('');
    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('get_field_engineers_secure');
      if (!rpcErr && Array.isArray(rpcData)) {
        console.log('Field engineers loaded via RPC:', rpcData.length, rpcData);
        setFieldEngineers(rpcData);
        if (rpcData.length === 0) {
          setFeLoadError('No field engineers found. Go to Settings -> Field Engineers to register one.');
        }
        return;
      }

      const rpcMessage = String(rpcErr?.message || '');
      const rpcMissing = rpcMessage.toLowerCase().includes('does not exist');
      if (!rpcMissing && rpcErr) {
        console.error('Error fetching field engineers via RPC:', rpcErr);
        setFeLoadError(`Failed to load engineers via secure RPC: ${rpcMessage}. Re-run supabase_fix_missing_fe_profiles.sql in SQL Editor.`);
        return;
      }

      const { data, error: fetchErr } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone, role, created_at')
        .order('created_at', { ascending: false });
      if (fetchErr) {
        console.error('Error fetching field engineers:', fetchErr);
        const msg = String(fetchErr.message || 'Unknown error');
        if (msg.toLowerCase().includes('infinite recursion')) {
          setFeLoadError('Failed to load engineers: profiles RLS recursion detected. Run supabase_fix_missing_fe_profiles.sql in SQL Editor, then refresh this page.');
        } else {
          setFeLoadError(`Failed to load engineers: ${msg}. Run supabase_complete_fe_setup.sql in SQL Editor.`);
        }
        return;
      }

      const normalizeRole = (role) =>
        String(role || '')
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, '_');

      const engineersByRole = (data || [])
        .filter((profile) => normalizeRole(profile.role) === 'field_engineer')
        .sort((a, b) => {
          const aName = (a.full_name || a.email || '').toLowerCase();
          const bName = (b.full_name || b.email || '').toLowerCase();
          return aName.localeCompare(bName);
        });

      let engineers = engineersByRole;

      // Fallback for legacy datasets where FE accounts were created but role was not set correctly.
      if (engineers.length === 0) {
        const fallbackProfiles = (data || [])
          .filter((profile) => {
            const role = normalizeRole(profile.role);
            return role !== 'admin' && profile.id && (profile.full_name || profile.email);
          })
          .sort((a, b) => {
            const aName = (a.full_name || a.email || '').toLowerCase();
            const bName = (b.full_name || b.email || '').toLowerCase();
            return aName.localeCompare(bName);
          });

        if (fallbackProfiles.length > 0) {
          engineers = fallbackProfiles;
          setFeLoadError('No profiles are tagged as field_engineer. Showing non-admin profiles as fallback. Update profile roles to field_engineer for accurate assignment.');
        }
      }

      console.log('Field engineers loaded:', engineers.length, engineers);
      setFieldEngineers(engineers);
      if (engineers.length === 0) {
        setFeLoadError('No field engineers found in profiles. If you created users directly in Auth, run supabase_fix_missing_fe_profiles.sql, then refresh.');
      }
    } catch (err) {
      console.error('Error fetching field engineers:', err.message);
      setFeLoadError(`Error: ${err.message}`);
    }
  }, []);

  // Count each field engineer's active (not-yet-resolved) assignments, used to
  // recommend a realistic inspection date instead of piling everything on day one.
  const engineerWorkloads = useMemo(() => {
    const counts = {};
    publicReports.forEach((r) => {
      if (r.assigned_engineer_id && r.status !== 'resolved') {
        counts[r.assigned_engineer_id] = (counts[r.assigned_engineer_id] || 0) + 1;
      }
    });
    return counts;
  }, [publicReports]);

  // Assign field engineer to a public report
  const assignEngineerToReport = async (reportId, engineerId) => {
    setAssigningEngineer(true);
    try {
      const engineer = fieldEngineers.find(e => e.id === engineerId);
      if (!engineer) {
        showNotification('Selected engineer not found. Refresh and try again.', 'error');
        return;
      }
      const updatePayload = {
        assigned_engineer_id: engineerId,
        assigned_engineer_name: engineer.full_name || engineer.email || '',
        assigned_at: new Date().toISOString(),
        engineer_status: 'assigned',
      };
      const { data: updated, error } = await supabase
        .from('public_reports')
        .update(updatePayload)
        .eq('id', reportId)
        .select();
      if (error) {
        console.error('Assignment DB error:', error);
        if (error.message?.includes('column') || error.code === '42703') {
          showNotification('Database columns missing. Run supabase_complete_fe_setup.sql first.', 'error');
        } else {
          showNotification(`Failed to assign: ${error.message}`, 'error');
        }
        return;
      }
      if (!updated || updated.length === 0) {
        showNotification('No report was updated. The report may have been deleted.', 'error');
        return;
      }
      await fetchPublicReports();
      showNotification(`Report assigned to ${engineer.full_name || engineer.email}`);
      const report = publicReports.find((r) => r.id === reportId) || selectedPublicReport;
      await addPublicReportActivity(
        reportId,
        'engineer_assigned',
        `Assigned field engineer: ${engineer.full_name || engineer.email || 'Engineer'}`,
        { engineer_id: engineerId }
      );
      if (report) {
        await createReportNotification(report, 'public_report_assignment', 'A field engineer has been assigned to your report.');
        await createEngineerAssignmentNotification(reportId, engineerId, report.project_name || report.municipality || 'Public report');
      }
    } catch (err) {
      console.error('Failed to assign engineer:', err.message);
      showNotification(`Failed to assign: ${err.message}`, 'error');
    } finally {
      setAssigningEngineer(false);
    }
  };

  // Unassign field engineer from a public report
  const unassignEngineerFromReport = async (reportId) => {
    try {
      const { error } = await supabase
        .from('public_reports')
        .update({
          assigned_engineer_id: null,
          assigned_engineer_name: '',
          assigned_at: null,
          engineer_status: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', reportId);
      if (error) throw error;
      await fetchPublicReports();
      showNotification('Engineer unassigned from report');
      const report = publicReports.find((r) => r.id === reportId) || selectedPublicReport;
      await addPublicReportActivity(reportId, 'engineer_unassigned', 'Unassigned field engineer from report');
      if (report) {
        await createReportNotification(report, 'public_report_assignment', 'The assigned field engineer for your report was removed.');
      }
    } catch (err) {
      console.error('Failed to unassign engineer:', err.message);
      showNotification(`Failed to unassign: ${err.message}`, 'error');
    }
  };

  // Fetch FMR projects (DA data - synced from user side)
  const fetchFmrProjects = useCallback(async () => {
    setFmrLoading(true);
    try {
      const { data, error: fetchErr } = await supabase
        .from('fmr_projects')
        .select('*')
        .order('year_funded', { ascending: false });
      if (fetchErr) throw fetchErr;
      const rows = data || [];
      fmrProjectsRef.current = rows;
      setFmrProjects(rows);
    } catch (err) {
      console.error('Error fetching FMR projects:', err.message);
    } finally {
      setFmrLoading(false);
    }
  }, []);

  // Real, persisted budget release tranches (project_tranches table) --
  // read-only fallback to the RA-9184 estimate in budgetEstimate.js is
  // used per-project wherever these are empty for that project.
  const [projectTranches, setProjectTranches] = useState([]);

  const fetchProjectTranches = useCallback(async () => {
    try {
      const { data, error: fetchErr } = await supabase
        .from('project_tranches')
        .select('*')
        .order('tranche_order', { ascending: true });
      if (fetchErr) throw fetchErr;
      setProjectTranches(data || []);
    } catch (err) {
      console.error('Error fetching project tranches:', err.message);
    }
  }, []);

  const tranchesByProjectId = useMemo(() => {
    const map = {};
    (projectTranches || []).forEach((t) => {
      if (!map[t.project_id]) map[t.project_id] = [];
      map[t.project_id].push(t);
    });
    return map;
  }, [projectTranches]);

  const handleInitializeTranches = useCallback(async (projectId) => {
    const { error: rpcErr } = await supabase.rpc('initialize_project_tranches', { p_project_id: projectId });
    if (rpcErr) throw rpcErr;
    await fetchProjectTranches();
  }, [fetchProjectTranches]);

  const handleReleaseTranche = useCallback(async (trancheId, { amount, date, notes }) => {
    const { error: rpcErr } = await supabase.rpc('release_project_tranche', {
      p_tranche_id: trancheId,
      p_released_amount: amount,
      p_released_date: date,
      p_notes: notes || null,
    });
    if (rpcErr) throw rpcErr;
    await Promise.all([fetchProjectTranches(), fetchFmrProjects()]);
  }, [fetchProjectTranches, fetchFmrProjects]);

  const fetchProjectRoutes = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('project_routes').select('*');
      if (error) {
        setRouteByProjectId({});
        return;
      }

      const next = {};
      (data || []).forEach((route) => {
        if (!route?.project_id) return;
        next[route.project_id] = route;
      });
      setRouteByProjectId(next);
    } catch {
      setRouteByProjectId({});
    }
  }, []);

  const fetchMapReportData = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('public_reports')
        .select('project_id, project_name, latitude, longitude, status');
      if (error) return;

      const byName = {};
      fmrProjectsRef.current.forEach((p) => {
        const nameKey = String(p.project_name || '').trim().toLowerCase();
        if (nameKey) byName[nameKey] = p.id;
      });

      const counts = {};
      const unresolvedByLocation = {};
      (data || []).forEach((report) => {
        let projectId = report.project_id;
        if (!projectId && report.project_name) {
          projectId = byName[String(report.project_name).trim().toLowerCase()] || null;
        }

        if (projectId) {
          counts[projectId] = (counts[projectId] || 0) + 1;
        }

        if (report.status === 'resolved') return;
        const lat = Number(report.latitude);
        const lng = Number(report.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const key = `${lat.toFixed(4)}:${lng.toFixed(4)}`;
        unresolvedByLocation[key] = unresolvedByLocation[key] || { lat, lng, count: 0 };
        unresolvedByLocation[key].count += 1;
      });

      const maxCount = Math.max(1, ...Object.values(unresolvedByLocation).map((item) => item.count));
      const heat = Object.values(unresolvedByLocation).map((item) => [item.lat, item.lng, Math.min(1, item.count / maxCount)]);

      setReportCountByProjectId(counts);
      setReportHeatPoints(heat);
    } catch {
      setReportCountByProjectId({});
      setReportHeatPoints([]);
    }
  }, []);

  const upsertProjectRoute = useCallback(async (projectId, startLat, startLng, endLat, endLng, waypoints) => {
    if (!projectId) return;

    const cleanedWaypoints = (waypoints || [])
      .map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

    const payload = {
      project_id: projectId,
      start_latitude: parseCoordinate(startLat),
      start_longitude: parseCoordinate(startLng),
      end_latitude: parseCoordinate(endLat),
      end_longitude: parseCoordinate(endLng),
      route_points: cleanedWaypoints,
      updated_at: new Date().toISOString(),
    };

    const hasCoordinates =
      Number.isFinite(payload.start_latitude) &&
      Number.isFinite(payload.start_longitude) &&
      Number.isFinite(payload.end_latitude) &&
      Number.isFinite(payload.end_longitude);

    if (!hasCoordinates) {
      throw new Error('Route was not saved: start/end coordinates are missing or invalid. Set both the Start and End points on the map before saving.');
    }

    const { error } = await supabase.from('project_routes').upsert(payload, { onConflict: 'project_id' });
    if (error) throw error;
  }, []);

  // Fetch contractor profiles
  const fetchContractors = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .eq('role', 'contractor')
        .order('full_name', { ascending: true });
      if (error) throw error;
      setContractors(data || []);
    } catch (err) {
      console.error('Error fetching contractors:', err.message);
    }
  }, []);

  // Fetch LGU profiles
  const fetchLgus = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone, municipality, created_at')
        .eq('role', 'lgu')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setLgus(data || []);
    } catch (err) {
      console.error('Error fetching LGUs:', err.message);
    }
  }, []);

  // Fetch market locations
  const fetchMarkets = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('market_locations')
        .select('*')
        .order('market_name', { ascending: true });
      if (error) throw error;
      setMarkets(data || []);
    } catch (err) {
      console.error('Error fetching markets:', err.message);
    }
  }, []);

  // Fetch all LGU project proposals
  const fetchLguProposals = useCallback(async () => {
    setLguProposalsLoading(true);
    try {
      const { data, error } = await supabase
        .from('lgu_project_proposals')
        .select('*')
        .order('submitted_at', { ascending: false });
      if (error) throw error;
      setLguProposals(data || []);
    } catch (err) {
      console.error('Error fetching LGU project proposals:', err.message);
    } finally {
      setLguProposalsLoading(false);
    }
  }, []);

  // Fetch all progress_updates with project info
  const fetchProgressUpdates = useCallback(async () => {
    setProgressUpdatesLoading(true);
    try {
      const { data, error } = await supabase
        .from('progress_updates')
        .select('id, fmr_project_id, contractor_id, reported_accomplishment, remarks, photo_url, status, submitted_at, reviewed_at, fmr_projects(project_name, municipality, accomplishment)')
        .order('submitted_at', { ascending: false });
      if (error) throw error;
      setProgressUpdates(data || []);
      setProgressUpdatesLastSyncedAt(new Date());
    } catch (err) {
      console.error('Error fetching progress updates:', err.message);
    } finally {
      setProgressUpdatesLoading(false);
    }
  }, []);

  // Assign contractor to FMR project
  const assignContractorToProject = async (projectId, contractorId) => {
    setAssigningContractor(true);
    try {
      const { error } = await supabase
        .from('fmr_projects')
        .update({ contractor_id: contractorId || null })
        .eq('id', projectId);
      if (error) throw error;
      await fetchFmrProjects();
      const contractor = contractors.find(c => c.id === contractorId);
      showNotification(contractorId
        ? `Contractor ${contractor?.full_name || contractor?.email || ''} assigned`
        : 'Contractor unassigned');
      setAssignContractorModal(null);
      setSelectedContractorId('');
    } catch (err) {
      console.error('Assign contractor error:', err.message);
      showNotification(`Failed: ${err.message}`, 'error');
    } finally {
      setAssigningContractor(false);
    }
  };

  // Approve progress update (and bump fmr_projects.accomplishment)
  const approveProgressUpdate = async (update) => {
    try {
      const { error } = await supabase.rpc('approve_progress_update_admin', {
        progress_update_id: update.id,
      });
      if (error) throw error;

      await Promise.all([fetchProgressUpdates(), fetchFmrProjects()]);
      showNotification('Progress update approved');
    } catch (err) {
      console.error('Approve error:', err.message);
      if (err.message?.includes('approve_progress_update_admin')) {
        showNotification('Failed: run supabase_progress_update_admin_actions.sql in Supabase SQL Editor, then try again.', 'error');
      } else if (err.message?.includes('invalid input syntax for type integer')) {
        showNotification('Failed: fmr_projects.accomplishment still uses INTEGER. Run supabase_fix_fmr_accomplishment_numeric.sql in Supabase SQL Editor, then try again.', 'error');
      } else {
        showNotification(`Failed: ${err.message}`, 'error');
      }
    }
  };

  // Reject progress update
  const rejectProgressUpdate = async (updateId) => {
    try {
      const { error } = await supabase.rpc('reject_progress_update_admin', {
        progress_update_id: updateId,
      });
      if (error) throw error;
      await fetchProgressUpdates();
      showNotification('Progress update rejected');
    } catch (err) {
      console.error('Reject error:', err.message);
      if (err.message?.includes('reject_progress_update_admin')) {
        showNotification('Failed: run supabase_progress_update_admin_actions.sql in Supabase SQL Editor, then try again.', 'error');
      } else {
        showNotification(`Failed: ${err.message}`, 'error');
      }
    }
  };

  // Notify a single LGU user (the proposal's submitter) rather than the
  // whole municipality — createLguNotification (below) is municipality-wide.
  const notifyProposalSubmitter = async (proposal, type, title, message) => {
    try {
      await supabase.from('notifications').insert({
        user_id: proposal.submitted_by,
        type,
        title,
        message,
        proposal_id: proposal.id,
        is_read: false,
        created_at: new Date().toISOString(),
      });
    } catch {
      // Keep admin workflows running if the notification path is unavailable.
    }
  };

  // Approve an LGU project proposal: creates the real, publicly-visible
  // fmr_projects row (status chosen by the admin) and links the proposal to it.
  // Opens the standard "Add New Project" form pre-filled from a validated
  // LGU proposal, and remembers the proposal so handleAddProject can link
  // it back once the officer actually submits the form (see pendingProposalLink).
  const openAddProjectFromProposal = (proposal) => {
    const lengthKm = Number(proposal.estimated_length_km || 0);
    const calculatedBudget = lengthKm > 0 ? String(Math.round(lengthKm * 15000000)) : (proposal.estimated_budget ? String(proposal.estimated_budget) : '');
    const nextCode = generateNextProjectCode();

    setFormData({
      ...emptyForm,
      projectName: proposal.project_name || '',
      projectCode: nextCode,
      municipality: proposal.municipality || '',
      barangay: proposal.barangay || '',
      province: proposal.province || 'Iloilo',
      startLatitude: proposal.start_latitude != null ? String(proposal.start_latitude) : '',
      startLongitude: proposal.start_longitude != null ? String(proposal.start_longitude) : '',
      endLatitude: proposal.end_latitude != null ? String(proposal.end_latitude) : '',
      endLongitude: proposal.end_longitude != null ? String(proposal.end_longitude) : '',
      roadLength: proposal.estimated_length_km ? String(proposal.estimated_length_km) : '',
      totalBudget: calculatedBudget,
      budgetSource: 'DA',
      expectedEndDate: proposal.target_funding_year ? `${proposal.target_funding_year}-12-31` : '',
      roadType: 'Concrete',
      description: [proposal.justification, proposal.description].filter(Boolean).join(' — '),
    });
    const waypoints = Array.isArray(proposal.route_waypoints)
      ? proposal.route_waypoints
        .map((w) => ({ lat: Number(w?.lat ?? w?.[0]), lng: Number(w?.lng ?? w?.[1]) }))
        .filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng))
      : [];
    setNewProjectRouteWaypoints(waypoints);
    setNewProjectContractorId('');
    setPendingProposalLink({ id: proposal.id, submitted_by: proposal.submitted_by, project_name: proposal.project_name });
    setActiveTab('projects');
    setShowAddModal(true);
  };

  // DA validates a proposal's feasibility. This does NOT create the
  // fmr_projects row -- per the DA officer's actual process, validation and
  // project creation are separate deliberate steps. It redirects the admin
  // to the standard Add New Project form, pre-filled, so they log the
  // official record themselves; the project only becomes public once they
  // submit that form.
  const validateLguProposal = async (proposal, notes) => {
    try {
      const { error } = await supabase.rpc('validate_lgu_project_proposal', {
        p_proposal_id: proposal.id,
        p_reviewer_notes: notes,
      });
      if (error) throw error;

      await fetchLguProposals();
      await notifyProposalSubmitter(
        proposal,
        'lgu_proposal_validated',
        'Project proposal validated',
        `Your proposal "${proposal.project_name}" passed DA feasibility validation. DA is now logging it as an official project.`
      );
      showNotification('Proposal validated. Complete the project details to publish it.');
      openAddProjectFromProposal(proposal);
    } catch (err) {
      console.error('Validate proposal error:', err.message);
      if (err.message?.includes('validate_lgu_project_proposal')) {
        showNotification('Failed: run supabase_lgu_project_proposal_actions.sql in Supabase SQL Editor, then try again.', 'error');
      } else {
        showNotification(`Failed: ${err.message}`, 'error');
      }
    }
  };

  const rejectLguProposal = async (proposal, notes) => {
    try {
      const { error } = await supabase.rpc('reject_lgu_project_proposal', {
        p_proposal_id: proposal.id,
        p_reviewer_notes: notes,
      });
      if (error) throw error;
      await fetchLguProposals();
      await notifyProposalSubmitter(
        proposal,
        'lgu_proposal_rejected',
        'Project proposal rejected',
        `Your proposal "${proposal.project_name}" was rejected by DA. Reason: ${notes}`
      );
      showNotification('Proposal rejected.');
    } catch (err) {
      console.error('Reject proposal error:', err.message);
      if (err.message?.includes('reject_lgu_project_proposal')) {
        showNotification('Failed: run supabase_lgu_project_proposal_actions.sql in Supabase SQL Editor, then try again.', 'error');
      } else {
        showNotification(`Failed: ${err.message}`, 'error');
      }
    }
  };

  const requestLguProposalRevision = async (proposal, notes) => {
    try {
      const { error } = await supabase.rpc('request_lgu_project_proposal_revision', {
        p_proposal_id: proposal.id,
        p_reviewer_notes: notes,
      });
      if (error) throw error;
      await fetchLguProposals();
      await notifyProposalSubmitter(
        proposal,
        'lgu_proposal_revision_requested',
        'Revision requested on your proposal',
        `DA requested changes to "${proposal.project_name}": ${notes}`
      );
      showNotification('Revision requested from the LGU.');
    } catch (err) {
      console.error('Request revision error:', err.message);
      if (err.message?.includes('request_lgu_project_proposal_revision')) {
        showNotification('Failed: run supabase_lgu_project_proposal_actions.sql in Supabase SQL Editor, then try again.', 'error');
      } else {
        showNotification(`Failed: ${err.message}`, 'error');
      }
    }
  };

  // If the public report belongs to a registered user, create/update a
  // feedback entry so it appears on their Community Feedback page.
  const syncFeedbackStatus = async (report, newStatus) => {
    if (!report || !report.user_id) return;

    const { data: existingFb } = await supabase
      .from('feedbacks')
      .select('id')
      .eq('public_report_id', report.id)
      .maybeSingle();

    if (existingFb) {
      await supabase
        .from('feedbacks')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', existingFb.id);
    } else {
      await supabase.from('feedbacks').insert([{
        user_id: report.user_id,
        user_email: report.contact_info || null,
        project_id: report.project_id || null,
        project_name: report.project_name || null,
        type: 'issue',
        message: report.description,
        photo_urls: report.photo_url ? [report.photo_url] : [],
        latitude: report.latitude || null,
        longitude: report.longitude || null,
        status: newStatus,
        public_report_id: report.id,
        source: 'public_report',
      }]);
    }
  };

  // Update public report status (admin action) — 'pending'/'reviewed' only.
  // 'resolved' can only be set via finalizeResolution() below, which requires
  // the field engineer's findings to have been DA-validated first.
  const updatePublicReportStatus = async (reportId, newStatus) => {
    try {
      const { error } = await supabase
        .from('public_reports')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', reportId);
      if (error) throw error;

      const report = publicReports.find(r => r.id === reportId);
      await syncFeedbackStatus(report, newStatus);

      await fetchPublicReports();
      setSelectedPublicReport((prev) => (prev?.id === reportId ? { ...prev, status: newStatus } : prev));
      showNotification(`Public report marked as ${newStatus}`);
      await addPublicReportActivity(reportId, 'status_updated', `Status changed to ${newStatus}`);
      if (report) {
        await createReportNotification(report, 'public_report_status', `Your public report status is now ${newStatus}.`);
      }
    } catch (err) {
      console.error('Failed to update public report:', err.message);
      showNotification(`Failed to update: ${err.message}`, 'error');
    }
  };

  // DA admin validates the field engineer's on-site findings as accurate —
  // this is the only action that unlocks the ability to mark a report resolved.
  const validateFieldFinding = async (reportId) => {
    if (!reportId) return;
    setFindingActionSaving(true);
    try {
      const { error } = await supabase
        .from('public_reports')
        .update({ engineer_status: 'validated', verification: 'Verified On-Site', updated_at: new Date().toISOString() })
        .eq('id', reportId);
      if (error) throw error;

      const report = publicReports.find(r => r.id === reportId);
      await addPublicReportActivity(reportId, 'finding_validated', 'DA admin validated the field engineer findings');
      if (report) {
        await createReportNotification(report, 'public_report_field_update', 'DA admin validated the field inspection findings for your report.');
        if (report.assigned_engineer_id) {
          await supabase.from('notifications').insert({
            user_id: report.assigned_engineer_id,
            type: 'public_report_finding_validated',
            title: 'Findings validated',
            message: `DA admin validated your findings for report ${String(reportId).slice(0, 8)}.`,
            report_id: reportId,
            is_read: false,
          });
        }
      }

      await fetchPublicReports();
      await loadLatestFieldFinding(reportId);
      setSelectedPublicReport((prev) => (prev?.id === reportId ? { ...prev, engineer_status: 'validated', verification: 'Verified On-Site' } : prev));
      showNotification('Field finding validated');
    } catch (err) {
      console.error('Failed to validate finding:', err.message);
      showNotification(`Failed to validate: ${err.message}`, 'error');
    } finally {
      setFindingActionSaving(false);
    }
  };

  // DA admin rejects the field engineer's findings and sends the report back
  // for re-inspection. A reason is required so the engineer knows what to fix.
  const rejectFieldFinding = async (reportId, reason) => {
    if (!reportId || !reason?.trim()) {
      showNotification('A reason is required to reject findings', 'error');
      return;
    }
    setFindingActionSaving(true);
    try {
      const { error } = await supabase
        .from('public_reports')
        .update({ engineer_status: 'rejected', verification: 'Needs Review', updated_at: new Date().toISOString() })
        .eq('id', reportId);
      if (error) throw error;

      const report = publicReports.find(r => r.id === reportId);
      await addPublicReportActivity(reportId, 'finding_rejected', `DA admin rejected field findings: ${reason.trim()}`);
      if (report) {
        await createReportNotification(report, 'public_report_field_update', 'DA admin requested additional field re-inspection for your report.');
        if (report.assigned_engineer_id) {
          await supabase.from('notifications').insert({
            user_id: report.assigned_engineer_id,
            type: 'public_report_finding_rejected',
            title: 'Findings rejected — re-inspection needed',
            message: `DA admin rejected your findings for report ${String(reportId).slice(0, 8)}: ${reason.trim()}`,
            report_id: reportId,
            is_read: false,
          });
        }
      }

      await fetchPublicReports();
      await loadLatestFieldFinding(reportId);
      setSelectedPublicReport((prev) => (prev?.id === reportId ? { ...prev, engineer_status: 'rejected', verification: 'Needs Review' } : prev));
      setShowRejectReason(false);
      setRejectReasonDraft('');
      showNotification('Field finding rejected and sent back for re-inspection');
    } catch (err) {
      console.error('Failed to reject finding:', err.message);
      showNotification(`Failed to reject: ${err.message}`, 'error');
    } finally {
      setFindingActionSaving(false);
    }
  };

  // The only path allowed to set status: 'resolved'. Requires a DA-validated
  // field finding and a mandatory resolution summary (see AdminWorkflowControls).
  const finalizeResolution = async (reportId, summary) => {
    if (!reportId || !summary?.trim()) return;
    const report = publicReports.find(r => r.id === reportId);
    if (report?.engineer_status !== 'validated') {
      showNotification('Resolution requires DA validation of field findings first', 'error');
      return;
    }

    try {
      const { error } = await supabase
        .from('public_reports')
        .update({ status: 'resolved', updated_at: new Date().toISOString() })
        .eq('id', reportId);
      if (error) throw error;

      await syncFeedbackStatus(report, 'resolved');
      await fetchPublicReports();
      await loadLatestResolution(reportId);
      setSelectedPublicReport((prev) => (prev?.id === reportId ? { ...prev, status: 'resolved' } : prev));
      await addPublicReportActivity(reportId, 'resolved_with_summary', summary.trim());
      await createReportNotification(report, 'public_report_status', 'Your public report status is now resolved.');
      await createLguNotification(
        report.municipality,
        'lgu_resolution_summary',
        'Project report resolved',
        `Report ${String(report.id).slice(0, 8)} in ${report.municipality || 'your jurisdiction'} has been marked resolved.`,
        report.id
      );
    } catch (err) {
      console.error('Failed to finalize resolution:', err.message);
      showNotification(`Failed to resolve: ${err.message}`, 'error');
    }
  };

  // Fetch all public reports linked to a specific project
  const openProjectFeedbackModal = async (project) => {
    setProjectFeedbackModal(project);
    setProjectFeedbackLoading(true);
    setProjectLinkedReports([]);
    try {
      const { data, error } = await supabase
        .from('public_reports')
        .select('*')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (data) setProjectLinkedReports(data);
    } catch (err) {
      console.error('Failed to fetch project reports:', err);
    } finally {
      setProjectFeedbackLoading(false);
    }
  };

  // Ensure the admin has a profile row (needed for is_admin() RLS function)
  const ensureAdminProfile = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Keep this list aligned with AdminAuthPage.
      const adminEmails = ['gab@gmail.com'];
      const currentEmail = (user.email || '').toLowerCase();
      const isAllowedAdmin = adminEmails.includes(currentEmail);

      if (!isAllowedAdmin) {
        // Never auto-promote non-admin accounts.
        return;
      }

      // Check if admin profile already exists
      const { data: existing } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('id', user.id)
        .maybeSingle();

      if (existing && existing.role === 'admin') return; // already set

      // Upsert admin profile directly
      const { error: upsertErr } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || 'Admin',
          role: 'admin',
        }, { onConflict: 'id' });

      if (upsertErr) {
        console.warn('Admin profile upsert failed:', upsertErr);
        // Last resort: direct insert
        const { error: insertErr } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            email: user.email,
            full_name: user.user_metadata?.full_name || 'Admin',
            role: 'admin',
          });
        if (insertErr) {
          console.error('All admin profile creation attempts failed:', insertErr);
          console.error('You need to run supabase_complete_fe_setup.sql AND manually insert admin profile');
        }
      } else {
        console.log('Admin profile ensured successfully');
      }
    } catch (err) {
      console.error('ensureAdminProfile error:', err);
    }
  }, []);

  const fetchAdminIdentity = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setAdminUserId(user.id || '');
      setAdminIdentity({
        full_name: user.user_metadata?.full_name || user.user_metadata?.name || 'Administrator',
        email: user.email || '',
        role: user.user_metadata?.role === 'admin' ? 'System Administrator' : 'System Administrator',
      });
    } catch (err) {
      console.error('Failed to fetch admin identity:', err);
    }
  }, []);

  const loadPublicReportActivity = useCallback(async (reportId) => {
    if (!reportId) {
      setPublicReportActivityLogs([]);
      return;
    }

    setPublicReportActivityLoading(true);
    try {
      const { data, error } = await supabase
        .from('public_report_activity_logs')
        .select('*')
        .eq('report_id', reportId)
        .order('created_at', { ascending: true });

      if (error) {
        setPublicReportActivityLogs([]);
        return;
      }

      setPublicReportActivityLogs(data || []);
    } catch {
      setPublicReportActivityLogs([]);
    } finally {
      setPublicReportActivityLoading(false);
    }
  }, []);

  const addPublicReportActivity = useCallback(async (reportId, actionType, description, metadata = {}) => {
    if (!reportId) return;

    try {
      await supabase
        .from('public_report_activity_logs')
        .insert({
          report_id: reportId,
          action_type: actionType,
          description,
          metadata,
          actor_name: adminIdentity.full_name || 'Administrator',
          actor_email: adminIdentity.email || null,
          created_at: new Date().toISOString(),
        });
      await loadPublicReportActivity(reportId);
    } catch {
      // Keep existing admin actions working even when the log table is missing.
    }
  }, [adminIdentity.email, adminIdentity.full_name, loadPublicReportActivity]);

  const createReportNotification = useCallback(async (report, eventType, message) => {
    if (!report?.user_id) return;

    try {
      await supabase
        .from('notifications')
        .insert({
          user_id: report.user_id,
          type: eventType,
          title: 'Public report update',
          message,
          report_id: report.id,
          is_read: false,
          created_at: new Date().toISOString(),
        });
    } catch {
      // Notification table may not exist in some deployments.
    }
  }, []);

  const createEngineerAssignmentNotification = useCallback(async (reportId, engineerId, contextLabel) => {
    if (!reportId || !engineerId) return;

    try {
      await supabase
        .from('notifications')
        .insert({
          user_id: engineerId,
          type: 'field_engineer_assignment',
          title: 'New field assignment',
          message: `You have been assigned to inspect ${contextLabel || 'a public report'}.`,
          report_id: reportId,
          is_read: false,
          created_at: new Date().toISOString(),
        });
    } catch {
      // Notification table may not exist in some deployments.
    }
  }, []);

  const createLguNotification = useCallback(async (municipality, type, title, message, reportId = null) => {
    try {
      const { data: lguUsers } = await supabase
        .from('profiles')
        .select('id, municipality')
        .eq('role', 'lgu');

      const recipients = (lguUsers || []).filter((user) => !municipality || !user.municipality || user.municipality === municipality);
      if (recipients.length === 0) return;

      await supabase.from('notifications').insert(
        recipients.map((recipient) => ({
          user_id: recipient.id,
          type,
          title,
          message,
          report_id: reportId,
          is_read: false,
          created_at: new Date().toISOString(),
        }))
      );
    } catch {
      // Keep admin workflows running if LGU notification path is unavailable.
    }
  }, []);

  const loadLatestLguDecision = useCallback(async (reportId) => {
    if (!reportId) {
      setSelectedReportLguDecision(null);
      return;
    }

    try {
      const { data } = await supabase
        .from('public_report_lgu_decisions')
        .select('*')
        .eq('report_id', reportId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      setSelectedReportLguDecision(data || null);
    } catch {
      setSelectedReportLguDecision(null);
    }
  }, []);

  const loadLatestFieldFinding = useCallback(async (reportId) => {
    if (!reportId) {
      setSelectedFieldFinding(null);
      return;
    }

    try {
      const { data } = await supabase
        .from('public_report_field_findings')
        .select('*')
        .eq('report_id', reportId)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      setSelectedFieldFinding(data || null);
    } catch {
      setSelectedFieldFinding(null);
    }
  }, []);

  const loadLatestResolution = useCallback(async (reportId) => {
    if (!reportId) {
      setSelectedResolution(null);
      return;
    }

    try {
      const { data } = await supabase
        .from('public_report_resolutions')
        .select('*')
        .eq('report_id', reportId)
        .order('resolved_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      setSelectedResolution(data || null);
    } catch {
      setSelectedResolution(null);
    }
  }, []);

  const escalateReportToLgu = useCallback(async (report, reason) => {
    if (!report?.id || !reason) return;

    const payload = {
      report_id: report.id,
      municipality: report.municipality || null,
      barangay: report.barangay || null,
      project_id: report.project_id || null,
      project_name: report.project_name || null,
      escalation_reason: reason,
      escalation_status: 'for_action',
      escalated_by: adminUserId || null,
      escalated_by_name: adminIdentity.full_name || 'Administrator',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('public_report_lgu_escalations').insert(payload);
    if (error) throw error;

    await addPublicReportActivity(report.id, 'escalated_to_lgu', `Escalated to LGU: ${reason}`);
    await createLguNotification(
      report.municipality,
      'lgu_escalation',
      'Report escalated for LGU action',
      `Admin escalated report ${String(report.id).slice(0, 8)} for endorsement/review.`,
      report.id
    );
  }, [adminIdentity.full_name, adminUserId, addPublicReportActivity, createLguNotification]);

  const loadAdminPrivateNote = useCallback(async (reportId) => {
    if (!reportId) {
      setAdminPrivateNote('');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('public_report_admin_notes')
        .select('note')
        .eq('report_id', reportId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        setAdminPrivateNote('');
        return;
      }

      setAdminPrivateNote(data?.note || '');
    } catch {
      setAdminPrivateNote('');
    }
  }, []);

  const saveAdminPrivateNote = useCallback(async () => {
    if (!selectedPublicReport?.id || !adminUserId) return;

    setAdminPrivateNoteSaving(true);
    try {
      const tag = `[${new Date().toLocaleString()}] ${adminIdentity.full_name || 'Administrator'}:`;
      const taggedNote = `${tag}\n${adminPrivateNote}`.trim();
      const payload = {
        report_id: selectedPublicReport.id,
        admin_user_id: adminUserId,
        note: taggedNote,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('public_report_admin_notes')
        .upsert(payload, { onConflict: 'report_id,admin_user_id' });

      if (error) throw error;
      showNotification('Private note saved', 'success');
      await addPublicReportActivity(selectedPublicReport.id, 'admin_note', 'Updated internal admin notes');
    } catch (err) {
      showNotification(`Failed to save note: ${err.message}`, 'error');
    } finally {
      setAdminPrivateNoteSaving(false);
    }
  }, [selectedPublicReport, adminUserId, adminPrivateNote, addPublicReportActivity, adminIdentity.full_name]);

  const loadSimilarNearbyReports = useCallback(async (report) => {
    if (!report?.id || !Number.isFinite(Number(report.latitude)) || !Number.isFinite(Number(report.longitude))) {
      setSimilarNearbyReports([]);
      return;
    }

    setSimilarReportsLoading(true);
    try {
      let query = supabase
        .from('public_reports')
        .select('id, project_name, full_name, status, created_at, latitude, longitude')
        .neq('id', report.id);

      if (report.project_id) {
        query = query.eq('project_id', report.project_id);
      } else if (report.project_name) {
        query = query.ilike('project_name', report.project_name);
      }

      const { data, error } = await query.order('created_at', { ascending: false }).limit(200);
      if (error) {
        setSimilarNearbyReports([]);
        return;
      }

      const reportLat = Number(report.latitude);
      const reportLng = Number(report.longitude);
      const nearby = (data || [])
        .map((row) => {
          const lat = Number(row.latitude);
          const lng = Number(row.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          const distanceMeters = haversineMeters(reportLat, reportLng, lat, lng);
          return distanceMeters <= 100 ? { ...row, distanceMeters } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.distanceMeters - b.distanceMeters);

      setSimilarNearbyReports(nearby);
    } catch {
      setSimilarNearbyReports([]);
    } finally {
      setSimilarReportsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedPublicReport?.id) {
      setPublicReportActivityLogs([]);
      setSimilarNearbyReports([]);
      setAdminPrivateNote('');
      setSelectedReportLguDecision(null);
      setSelectedFieldFinding(null);
      setSelectedResolution(null);
      setShowRejectReason(false);
      setRejectReasonDraft('');
      return;
    }

    loadPublicReportActivity(selectedPublicReport.id);
    loadAdminPrivateNote(selectedPublicReport.id);
    loadSimilarNearbyReports(selectedPublicReport);
    loadLatestLguDecision(selectedPublicReport.id);
    loadLatestFieldFinding(selectedPublicReport.id);
    loadLatestResolution(selectedPublicReport.id);
    setShowRejectReason(false);
    setRejectReasonDraft('');
  }, [selectedPublicReport, loadPublicReportActivity, loadAdminPrivateNote, loadSimilarNearbyReports, loadLatestLguDecision, loadLatestFieldFinding, loadLatestResolution]);

  useEffect(() => {
    fmrProjectsRef.current = fmrProjects;
  }, [fmrProjects]);

  // Background FMR projects geocoder queue
  useEffect(() => {
    if (!fmrProjects || fmrProjects.length === 0 || isGeocoding) return;
    if (hasStartedGeocodingRef.current) return;

    // Identify projects with missing coordinates (either null, 0, or empty)
    const unmapped = fmrProjects.filter(p => !p.start_latitude || !p.start_longitude);
    if (unmapped.length === 0) {
      setGeocodingStatus('');
      return;
    }

    hasStartedGeocodingRef.current = true;
    let active = true;
    const runQueue = async () => {
      setIsGeocoding(true);
      setGeocodingStatus(`Auto-geocoding missing project coordinates (0/${unmapped.length})...`);

      for (let i = 0; i < unmapped.length; i++) {
        if (!active) break;
        const project = unmapped[i];

        setGeocodingStatus(`Geocoding project ${i + 1}/${unmapped.length}: ${project.project_name}...`);

        // nominatim rate limit: 1 request per second
        await new Promise(resolve => setTimeout(resolve, 1100));

        try {
          const coords = await geocodeFmrLocation(project.municipality, project.location);
          if (coords && active) {
            // Update Supabase directly. Since realtime is active, this will update fmrProjects list
            const { error } = await supabase
              .from('fmr_projects')
              .update({
                start_latitude: coords[0],
                start_longitude: coords[1],
                // Provide a default offset endpoint so route building works
                end_latitude: coords[0] + 0.0005,
                end_longitude: coords[1] + 0.0005,
                remarks: project.remarks
                  ? `${project.remarks} (Auto-geocoded to Barangay center)`
                  : 'Auto-geocoded to Barangay center'
              })
              .eq('id', project.id);

            if (error) {
              console.error('Failed to sync coordinates to Supabase:', error.message);
            }
          }
        } catch (err) {
          console.error('Error during automatic geocoding:', err);
        }
      }

      if (active) {
        setGeocodingStatus('All project coordinates successfully auto-geocoded!');
        setIsGeocoding(false);
        // Refresh in case realtime updates missed any
        fetchFmrProjects();
        setTimeout(() => {
          if (active) setGeocodingStatus('');
        }, 4000);
      }
    };

    runQueue();

    return () => {
      active = false;
    };
  }, [fmrProjects, isGeocoding, fetchFmrProjects]);

  useEffect(() => {
    if (!fmrProjects || fmrProjects.length === 0) return undefined;

    let cancelled = false;
    async function snapAdminRoutes() {
      const toSnap = fmrProjects.filter((p) => {
        const route = buildRoutePoints(p, routeByProjectId[p.id]);
        return route.hasPolyline && !route.hasRouteRecord;
      });

      const snappedEntries = await Promise.all(
        toSnap.map(async (project) => {
          const route = buildRoutePoints(project, routeByProjectId[project.id]);
          const snapped = await fetchRoadAlignedPolyline(route.points);
          return [project.id, snapped];
        })
      );

      if (cancelled) return;
      setAdminSnappedRouteByProjectId((prev) => {
        const next = { ...prev };
        snappedEntries.forEach(([projectId, points]) => {
          next[projectId] = points;
        });
        return next;
      });
    }

    snapAdminRoutes();
    return () => {
      cancelled = true;
    };
  }, [fmrProjects, routeByProjectId]);

  useEffect(() => {
    fetchAdminIdentity();
    ensureAdminProfile().then(() => {
      fetchProjects();
      fetchPublicReports();
      fetchEscalations();
      fetchFmrProjects();
      fetchProjectTranches();
      fetchFarmerBeneficiaries();
      fetchMarkets();
      fetchProjectRoutes();
      fetchMapReportData();
      fetchFieldEngineers();
      fetchContractors();
      fetchLgus();
      fetchProgressUpdates();
      fetchLguProposals();
    });

    // Real-time subscription for projects
    const projectChannel = supabase
      .channel('admin-projects-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => fetchProjects())
      .subscribe();

    // Real-time subscription for public reports
    const publicReportsChannel = supabase
      .channel('admin-public-reports-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'public_reports' }, () => { fetchPublicReports(); fetchMapReportData(); })
      .subscribe();

    const escalationsChannel = supabase
      .channel('admin-escalations-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'public_report_lgu_escalations' }, () => fetchEscalations())
      .subscribe();

    // Real-time subscription for FMR projects
    const fmrChannel = supabase
      .channel('admin-fmr-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fmr_projects' }, () => { fetchFmrProjects(); fetchMapReportData(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_routes' }, () => fetchProjectRoutes())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_tranches' }, () => fetchProjectTranches())
      .subscribe();

    const farmerBeneficiariesChannel = supabase
      .channel('admin-farmer-beneficiaries-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'farmer_beneficiaries' }, () => fetchFarmerBeneficiaries())
      .subscribe();

    const marketsChannel = supabase
      .channel('admin-markets-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'market_locations' }, () => fetchMarkets())
      .subscribe();

    // Real-time subscription for profiles (field engineers + contractors)
    const profilesChannel = supabase
      .channel('admin-profiles-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => { fetchFieldEngineers(); fetchContractors(); fetchLgus(); })
      .subscribe();

    // Real-time subscription for progress updates
    const progressUpdatesChannel = supabase
      .channel('admin-progress-updates-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'progress_updates' }, () => fetchProgressUpdates())
      .subscribe();

    // Real-time subscription for LGU project proposals
    const lguProposalsChannel = supabase
      .channel('admin-lgu-proposals-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lgu_project_proposals' }, () => fetchLguProposals())
      .subscribe();

    return () => {
      supabase.removeChannel(projectChannel);
      supabase.removeChannel(publicReportsChannel);
      supabase.removeChannel(escalationsChannel);
      supabase.removeChannel(fmrChannel);
      supabase.removeChannel(farmerBeneficiariesChannel);
      supabase.removeChannel(marketsChannel);
      supabase.removeChannel(profilesChannel);
      supabase.removeChannel(progressUpdatesChannel);
      supabase.removeChannel(lguProposalsChannel);
    };
  }, [fetchProjects, fetchPublicReports, fetchEscalations, fetchFmrProjects, fetchProjectTranches, fetchFarmerBeneficiaries, fetchMarkets, fetchProjectRoutes, fetchMapReportData, fetchFieldEngineers, fetchContractors, fetchLgus, fetchProgressUpdates, fetchLguProposals, ensureAdminProfile, fetchAdminIdentity]);

  useEffect(() => {
    fetchMapReportData();
  }, [fmrProjects, fetchMapReportData]);

  useEffect(() => {
    try {
      localStorage.setItem(ADMIN_FMR_VIEW_MODE_KEY, fmrViewMode);
    } catch {
      // Storage unavailable (private mode) - the preference just won't persist.
    }
  }, [fmrViewMode]);

  useEffect(() => {
    setFmrProjectCurrentPage(1);
  }, [fmrProjectSearch, fmrProjectStatusFilter, fmrProjectYearFilter, fmrProjectDateFrom, fmrProjectDateTo, fmrProjectSortBy, fmrRowsPerPage, fmrViewMode]);

  const unifiedProjects = useMemo(() => {
    const mappedFmr = fmrProjects.map((p) => {
      const normalizedStatus = normalizeFmrStatus(p.status) || 'Proposed';
      const mappedStatus =
        normalizedStatus === 'On-Going'
          ? 'In Progress'
          : normalizedStatus === 'Proposed'
            ? 'Planning'
            : normalizedStatus;

      const startLat = Number(p.start_latitude);
      const startLng = Number(p.start_longitude);
      const endLat = Number(p.end_latitude);
      const endLng = Number(p.end_longitude);
      const centerLat = !Number.isNaN(startLat) && !Number.isNaN(endLat) ? (startLat + endLat) / 2 : startLat;
      const centerLng = !Number.isNaN(startLng) && !Number.isNaN(endLng) ? (startLng + endLng) / 2 : startLng;

      const remarksText = p.remarks || '';
      const codeMatch = remarksText.match(/FMR Code:\s*([^|]+)/i);

      return {
        id: `fmr-${p.id}`,
        projectName: p.project_name || 'Unnamed FMR Project',
        projectCode: codeMatch ? codeMatch[1].trim() : `FMR-${p.id}`,
        municipality: p.municipality || '',
        province: p.province || 'Iloilo',
        latitude: Number.isNaN(centerLat) ? null : centerLat,
        longitude: Number.isNaN(centerLng) ? null : centerLng,
        roadLength: Number(p.project_length_km || 0),
        contractor: '',
        totalBudget: 0,
        status: mappedStatus,
        progress: Number(p.accomplishment || 0),
        source: p.source || 'DA-RAED Region VI',
        _source: 'fmr',
        _raw: p,
      };
    });

    const mappedProjects = projects.map((p) => ({ ...p, source: p.source || 'LGU', _source: 'projects' }));
    return [...mappedProjects, ...mappedFmr];
  }, [projects, fmrProjects]);

  // Filter and search projects
  const filteredProjects = useMemo(() => {
    const filtered = unifiedProjects.filter(project => {
      const matchesSearch = project.projectName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        project.projectCode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        project.municipality?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        project.contractor?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        project.source?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus = statusFilter === 'all' || project.status === statusFilter;

      return matchesSearch && matchesStatus;
    });

    const sorted = [...filtered].sort((a, b) => {
      const aValue = a?.[sortField];
      const bValue = b?.[sortField];

      if (typeof aValue === 'number' || typeof bValue === 'number') {
        const first = Number(aValue || 0);
        const second = Number(bValue || 0);
        return sortDirection === 'asc' ? first - second : second - first;
      }

      const first = (aValue || '').toString().toLowerCase();
      const second = (bValue || '').toString().toLowerCase();
      if (first < second) return sortDirection === 'asc' ? -1 : 1;
      if (first > second) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [unifiedProjects, searchQuery, statusFilter, sortField, sortDirection]);

  // Pagination
  const totalPages = Math.ceil(filteredProjects.length / projectsPerPage);
  const paginatedProjects = filteredProjects.slice(
    (currentPage - 1) * projectsPerPage,
    currentPage * projectsPerPage
  );

  // Calculate metrics
  const metrics = useMemo(() => {
    const totalProjects = unifiedProjects.length;
    const inProgress = unifiedProjects.filter(p => p.status === 'In Progress').length;
    const completed = unifiedProjects.filter(p => p.status === 'Completed').length;
    const totalBudget = unifiedProjects.reduce((sum, p) => sum + (p.totalBudget || 0), 0);
    const disbursed = unifiedProjects.reduce((sum, p) => sum + (p.disbursedAmount || 0), 0);
    const avgProgress = unifiedProjects.length > 0
      ? Math.round(unifiedProjects.reduce((sum, p) => sum + (p.progress || 0), 0) / unifiedProjects.length)
      : 0;
    const totalReports = publicReports.length;

    return { totalProjects, inProgress, completed, totalBudget, disbursed, avgProgress, totalReports };
  }, [unifiedProjects, publicReports]);
  const pendingPublicReportsCount = useMemo(() => publicReports.filter(r => r.status === 'pending').length, [publicReports]);
  const topPriorityProjects = useMemo(
    () => computePriorityScores(fmrProjects, publicReports, escalations).slice(0, 3),
    [fmrProjects, publicReports, escalations]
  );
  const priorityRankById = useMemo(() => {
    const map = new Map();
    topPriorityProjects.forEach((entry) => {
      if (entry.project?.id) map.set(entry.project.id, entry.rank);
    });
    return map;
  }, [topPriorityProjects]);

  const analyticsProjectsByMunicipality = useMemo(() => {
    const counts = fmrProjects.reduce((acc, p) => {
      const municipality = p.municipality || 'Unspecified';
      acc[municipality] = (acc[municipality] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts)
      .map(([municipality, count]) => ({ municipality, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [fmrProjects]);

  const analyticsStatusDistribution = useMemo(() => {
    const statuses = ['Completed', 'On-Going', 'Proposed'];
    return statuses
      .map((status) => ({ name: status, value: fmrProjects.filter((p) => normalizeFmrStatus(p.status) === status).length }))
      .filter((entry) => entry.value > 0);
  }, [fmrProjects]);

  const analyticsProjectsPerMonth = useMemo(() => {
    const monthly = fmrProjects.reduce((acc, project) => {
      const year = Number(project.year_funded);
      if (!year || Number.isNaN(year)) return acc;
      const key = `${year}-01`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return Object.keys(monthly)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => ({
        month: key,
        projects: monthly[key],
      }));
  }, [fmrProjects]);

  const analyticsBudgetDisbursedOverTime = useMemo(() => {
    const monthly = fmrProjects.reduce((acc, project) => {
      const year = Number(project.year_funded);
      if (!year || Number.isNaN(year)) return acc;
      const key = `${year}-01`;
      if (!acc[key]) acc[key] = { month: key, budget: 0, disbursed: 0 };

      const budgetValue = Number(
        project.total_budget ?? project.totalBudget ?? project.budget ?? project.project_cost ?? project.cost ?? project.allocated_budget ?? 0
      );
      const disbursedValue = Number(
        project.disbursed_amount ?? project.disbursedAmount ?? project.spent_amount ?? project.released_amount ?? 0
      );

      acc[key].budget += Number.isNaN(budgetValue) ? 0 : budgetValue;
      acc[key].disbursed += Number.isNaN(disbursedValue) ? 0 : disbursedValue;
      return acc;
    }, {});
    return Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month));
  }, [fmrProjects]);

  const formatMonthKey = (monthKey) => {
    const [year, month] = monthKey.split('-').map(Number);
    if (!year || !month) return monthKey;
    return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  };

  const getPillTone = (status) => {
    const map = {
      Planning: { dot: 'bg-slate-500', badge: 'bg-slate-50 text-slate-700 border-slate-200' },
      Bidding: { dot: 'bg-violet-500', badge: 'bg-violet-50 text-violet-700 border-violet-200' },
      'In Progress': { dot: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
      'On Hold': { dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
      Completed: { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
      Cancelled: { dot: 'bg-red-500', badge: 'bg-red-50 text-red-700 border-red-200' },
      Active: { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
      Pending: { dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
      Verified: { dot: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
      Inactive: { dot: 'bg-slate-500', badge: 'bg-slate-50 text-slate-700 border-slate-200' },
      Unverified: { dot: 'bg-red-500', badge: 'bg-red-50 text-red-700 border-red-200' },
      Approved: { dot: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
      Released: { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
      Delayed: { dot: 'bg-red-500', badge: 'bg-red-50 text-red-700 border-red-200' },
      Low: { dot: 'bg-slate-400', badge: 'bg-slate-50 text-slate-700 border-slate-200' },
      Medium: { dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
      High: { dot: 'bg-orange-500', badge: 'bg-orange-50 text-orange-700 border-orange-200' },
      Critical: { dot: 'bg-red-600', badge: 'bg-red-50 text-red-700 border-red-200' },
      pending: { dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
      reviewed: { dot: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
      resolved: { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
      Proposed: { dot: 'bg-sky-500', badge: 'bg-sky-50 text-sky-700 border-sky-200' },
      'On-Going': { dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
    };
    return map[status] || { dot: 'bg-slate-500', badge: 'bg-slate-50 text-slate-700 border-slate-200' };
  };

  const renderStatusPill = (status, label) => {
    const tone = getPillTone(status);
    return (
      <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-semibold ${tone.badge}`}>
        <span className={`w-2 h-2 rounded-full ${tone.dot}`} />
        {label || status}
      </span>
    );
  };

  const inDateRange = (dateValue, from, to) => {
    if (!dateValue) return false;
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return false;
    if (from) {
      const fromDate = new Date(from);
      fromDate.setHours(0, 0, 0, 0);
      if (date < fromDate) return false;
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      if (date > toDate) return false;
    }
    return true;
  };

  const toggleProjectSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection('asc');
  };

  const exportRowsToCsv = (rows, fileName) => {
    if (!rows.length) {
      showNotification('Nothing to export for current filters.', 'error');
      return;
    }
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showNotification('CSV export complete.');
  };

  useEffect(() => {
    const handle = setTimeout(() => setPmSearch(pmSearchInput.trim()), 350);
    return () => clearTimeout(handle);
  }, [pmSearchInput]);



  // Classify FMR projects for Reports tab: Completed, Delayed, Ongoing
  const classifiedFmrProjects = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const completedProjects = [];
    const delayedProjects = [];
    const ongoingProjects = [];
    const pendingProjects = [];

    fmrProjects.forEach(p => {
      const status = normalizeFmrStatus(p.status);
      const accomplishment = Number(p.accomplishment || 0);
      const isCompleted = status === 'Completed' || accomplishment >= 100 || Boolean(p.date_completed);
      const isDelayed = !isCompleted && isPastDate(p.target_completion_date, today);

      if (status === 'Proposed' && !isCompleted) {
        pendingProjects.push(p);
        return;
      }

      if (isCompleted) {
        completedProjects.push(p);
      } else if (isDelayed) {
        delayedProjects.push(p);
      } else {
        ongoingProjects.push(p);
      }
    });

    return { completedProjects, delayedProjects, ongoingProjects, pendingProjects };
  }, [fmrProjects]);

  useEffect(() => {
    const sectionSizes = {
      completed: classifiedFmrProjects.completedProjects.length,
      delayed: classifiedFmrProjects.delayedProjects.length,
      ongoing: classifiedFmrProjects.ongoingProjects.length,
      pending: classifiedFmrProjects.pendingProjects.length,
    };

    setReportsPageBySection((prev) => {
      const next = { ...prev };
      let changed = false;

      Object.entries(sectionSizes).forEach(([key, totalItems]) => {
        const maxPage = Math.max(1, Math.ceil(totalItems / reportsPerSectionPage));
        const current = prev[key] || 1;
        if (current > maxPage) {
          next[key] = maxPage;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [
    classifiedFmrProjects.completedProjects.length,
    classifiedFmrProjects.delayedProjects.length,
    classifiedFmrProjects.ongoingProjects.length,
    classifiedFmrProjects.pendingProjects.length,
    reportsPerSectionPage,
  ]);

  // Form handlers
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const next = { ...prev, [name]: value };
      // Reset barangay when municipality changes
      if (name === 'municipality') next.barangay = '';

      // Auto-calculate road length from start/end coordinates on create form.
      if (
        name === 'startLatitude' ||
        name === 'startLongitude' ||
        name === 'endLatitude' ||
        name === 'endLongitude'
      ) {
        const startLat = parseCoordinate(name === 'startLatitude' ? value : next.startLatitude);
        const startLng = parseCoordinate(name === 'startLongitude' ? value : next.startLongitude);
        const endLat = parseCoordinate(name === 'endLatitude' ? value : next.endLatitude);
        const endLng = parseCoordinate(name === 'endLongitude' ? value : next.endLongitude);

        if (
          !Number.isNaN(startLat) &&
          !Number.isNaN(startLng) &&
          !Number.isNaN(endLat) &&
          !Number.isNaN(endLng)
        ) {
          const computedKm = calculateRoadLengthKm(startLat, startLng, endLat, endLng);
          next.roadLength = computedKm.toFixed(2);
          next.totalBudget = String(Math.round(computedKm * 15000000));
        } else {
          next.roadLength = '';
          next.totalBudget = '';
        }
      }

      if (name === 'roadLength') {
        const lengthKm = Number(value || 0);
        if (lengthKm > 0) {
          next.totalBudget = String(Math.round(lengthKm * 15000000));
        } else {
          next.totalBudget = '';
        }
      }

      return next;
    });
  };

  const handleAddProject = async (e) => {
    e.preventDefault();

    const enteredCode = (formData.projectCode || '').trim();
    if (!enteredCode) {
      showNotification('FMR code is required.', 'error');
      return;
    }

    const startLat = parseCoordinate(formData.startLatitude);
    const startLng = parseCoordinate(formData.startLongitude);
    const endLat = parseCoordinate(formData.endLatitude);
    const endLng = parseCoordinate(formData.endLongitude);

    if (
      Number.isNaN(startLat) ||
      Number.isNaN(startLng) ||
      Number.isNaN(endLat) ||
      Number.isNaN(endLng)
    ) {
      showNotification('Invalid coordinates. Use decimal format, e.g. 10.82492 or 122.53211E.', 'error');
      return;
    }

    const computedRoadLengthKm = Number(calculateRoadLengthKm(startLat, startLng, endLat, endLng).toFixed(2));

    // FMR master payload: save directly to fmr_projects for validity in FMR datasets.
    const fmrPayload = {
      project_name: formData.projectName,
      status: 'On-Going',
      year_funded: formData.startDate ? new Date(formData.startDate).getFullYear() : new Date().getFullYear(),
      municipality: formData.municipality,
      province: formData.province,
      accomplishment: 0,
      project_length_km: computedRoadLengthKm,
      start_latitude: startLat,
      start_longitude: startLng,
      end_latitude: endLat,
      end_longitude: endLng,
      target_completion_date: formData.expectedEndDate || null,
      location: formData.barangay,
      contractor_id: newProjectContractorId || null,
      total_budget: formData.totalBudget ? parseFloat(formData.totalBudget) : null,
      funds_released: formData.disbursedAmount ? parseFloat(formData.disbursedAmount) : null,
      funding_source: 'DA',
      remarks: [
        `FMR Code: ${enteredCode}`,
        `Road Type: Concrete`,
        formData.contractor ? `Contractor: ${formData.contractor}` : null,
        formData.description ? `Description: ${formData.description}` : null,
      ].filter(Boolean).join(' | '),
    };

    try {
      const { data: inserted, error } = await supabase.from('fmr_projects').insert([fmrPayload]).select('id').single();
      if (error) throw error;
      await upsertProjectRoute(
        inserted?.id,
        startLat,
        startLng,
        endLat,
        endLng,
        newProjectRouteWaypoints
      );
      await fetchFmrProjects();
      await fetchProjectRoutes();

      if (pendingProposalLink && inserted?.id) {
        try {
          await supabase
            .from('lgu_project_proposals')
            .update({ fmr_project_id: inserted.id, updated_at: new Date().toISOString() })
            .eq('id', pendingProposalLink.id);
          await supabase.from('lgu_project_proposal_activity_logs').insert({
            proposal_id: pendingProposalLink.id,
            action_type: 'published',
            description: `Created fmr_projects.id=${inserted.id} from validated proposal.`,
            actor_name: adminIdentity.full_name || 'Administrator',
            actor_email: adminIdentity.email || null,
          });
          await notifyProposalSubmitter(
            pendingProposalLink,
            'lgu_proposal_published',
            'Your project is now live',
            `"${pendingProposalLink.project_name}" has been created and is now visible to the public.`
          );
          await fetchLguProposals();
        } catch (linkErr) {
          console.error('Failed to link proposal to new project:', linkErr.message);
        }
        setPendingProposalLink(null);
      }

      setShowAddModal(false);
      setFormData(emptyForm);
      setNewProjectContractorId('');
      setNewProjectRouteWaypoints([]);
      showNotification('FMR project created successfully!');
    } catch (err) {
      console.error('Failed to create project:', err.message);
      showNotification(`Failed to save FMR project: ${err.message}`, 'error');
    }
  };

  const handleEditProject = async (e) => {
    e.preventDefault();

    // Build update payload — exclude `id` and `created_at` (identity/system columns)
    const updatedProject = {
      projectName: formData.projectName,
      projectCode: formData.projectCode,
      region: formData.region,
      province: formData.province,
      municipality: formData.municipality,
      barangay: formData.barangay,
      latitude: parseFloat(formData.latitude) || 0,
      longitude: parseFloat(formData.longitude) || 0,
      roadLength: parseFloat(formData.roadLength) || 0,
      roadWidth: parseFloat(formData.roadWidth) || 0,
      roadType: formData.roadType,
      totalBudget: parseFloat(formData.totalBudget) || 0,
      budgetSource: formData.budgetSource,
      disbursedAmount: parseFloat(formData.disbursedAmount) || 0,
      contractor: formData.contractor,
      startDate: formData.startDate,
      expectedEndDate: formData.expectedEndDate,
      status: formData.status,
      progress: parseInt(formData.progress) || 0,
      description: formData.description,
      updated_at: new Date().toISOString()
    };

    try {
      const { error } = await supabase
        .from('projects')
        .update(updatedProject)
        .eq('id', selectedProject.id);
      if (error) throw error;
      await fetchProjects();
      setShowEditModal(false);
      setSelectedProject(null);
      setFormData(emptyForm);
      showNotification('Project updated successfully!');
    } catch (err) {
      console.error('Failed to update project:', err.message);
      showNotification(`Failed to update project: ${err.message}`, 'error');
    }
  };

  const handleDeleteProject = async () => {
    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', selectedProject.id);
      if (error) throw error;
      await fetchProjects();
      setShowDeleteModal(false);
      setSelectedProject(null);
      showNotification('Project deleted successfully!', 'error');
    } catch (err) {
      console.error('Failed to delete project:', err.message);
      showNotification(`Failed to delete project: ${err.message}`, 'error');
    }
  };

  const openEditModal = (project) => {
    setSelectedProject(project);
    setFormData({
      ...project,
      totalBudget: project.totalBudget?.toString() || '',

      disbursedAmount: project.disbursedAmount?.toString() || '',
      roadLength: project.roadLength?.toString() || '',
      roadWidth: project.roadWidth?.toString() || '',
      latitude: project.latitude?.toString() || '',
      longitude: project.longitude?.toString() || '',
      progress: project.progress?.toString() || '0'
    });
    setShowEditModal(true);
  };

  const openDeleteModal = (project) => {
    setSelectedProject(project);
    setShowDeleteModal(true);
  };

  const openProjectDetailModal = (project) => {
    setSelectedProjectDetail(project);
  };

  const formatProjectDetailDate = (value) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // ─── FMR CRUD Handlers ───
  const handleFmrInputChange = (e) => {
    const { name, value } = e.target;
    setFmrFormData(prev => {
      const next = { ...prev, [name]: value };

      if (
        name === 'start_latitude' ||
        name === 'start_longitude' ||
        name === 'end_latitude' ||
        name === 'end_longitude'
      ) {
        const sLat = parseCoordinate(name === 'start_latitude' ? value : next.start_latitude);
        const sLng = parseCoordinate(name === 'start_longitude' ? value : next.start_longitude);
        const eLat = parseCoordinate(name === 'end_latitude' ? value : next.end_latitude);
        const eLng = parseCoordinate(name === 'end_longitude' ? value : next.end_longitude);

        if (!Number.isNaN(sLat) && !Number.isNaN(sLng) && !Number.isNaN(eLat) && !Number.isNaN(eLng)) {
          if (fmrRouteWaypoints && fmrRouteWaypoints.length > 0) {
            const points = [[sLat, sLng], ...fmrRouteWaypoints.map(w => [w.lat, w.lng]), [eLat, eLng]];
            next.project_length_km = calculateSnappedPolylineDistanceKm(points).toFixed(2);
          } else {
            next.project_length_km = calculateRoadLengthKm(sLat, sLng, eLat, eLng).toFixed(2);
          }
        } else {
          next.project_length_km = '';
        }
      }

      return next;
    });
  };

  const handleNewProjectRoutePick = ({ lat, lng }) => {
    if (newProjectRouteMode === 'start') {
      setFormData((prev) => {
        const next = { ...prev, startLatitude: lat.toFixed(6), startLongitude: lng.toFixed(6) };
        const sLat = parseCoordinate(next.startLatitude);
        const sLng = parseCoordinate(next.startLongitude);
        const eLat = parseCoordinate(next.endLatitude);
        const eLng = parseCoordinate(next.endLongitude);
        if (!Number.isNaN(sLat) && !Number.isNaN(sLng) && !Number.isNaN(eLat) && !Number.isNaN(eLng)) {
          const points = [[sLat, sLng], ...newProjectRouteWaypoints.map(w => [w.lat, w.lng]), [eLat, eLng]];
          next.roadLength = calculateSnappedPolylineDistanceKm(points).toFixed(2);
        } else {
          next.roadLength = '';
        }
        return next;
      });
      return;
    }
    if (newProjectRouteMode === 'end') {
      setFormData((prev) => {
        const next = { ...prev, endLatitude: lat.toFixed(6), endLongitude: lng.toFixed(6) };
        const sLat = parseCoordinate(next.startLatitude);
        const sLng = parseCoordinate(next.startLongitude);
        const eLat = parseCoordinate(next.endLatitude);
        const eLng = parseCoordinate(next.endLongitude);
        if (!Number.isNaN(sLat) && !Number.isNaN(sLng) && !Number.isNaN(eLat) && !Number.isNaN(eLng)) {
          const points = [[sLat, sLng], ...newProjectRouteWaypoints.map(w => [w.lat, w.lng]), [eLat, eLng]];
          next.roadLength = calculateSnappedPolylineDistanceKm(points).toFixed(2);
        } else {
          next.roadLength = '';
        }
        return next;
      });
      return;
    }
    if (newProjectRouteMode === 'waypoint') {
      const newPt = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
      setNewProjectRouteWaypoints((prev) => {
        const nextWaypoints = [...prev, newPt];
        setFormData((curr) => {
          const sLat = parseCoordinate(curr.startLatitude);
          const sLng = parseCoordinate(curr.startLongitude);
          const eLat = parseCoordinate(curr.endLatitude);
          const eLng = parseCoordinate(curr.endLongitude);
          if (!Number.isNaN(sLat) && !Number.isNaN(sLng) && !Number.isNaN(eLat) && !Number.isNaN(eLng)) {
            const points = [[sLat, sLng], ...nextWaypoints.map(w => [w.lat, w.lng]), [eLat, eLng]];
            return { ...curr, roadLength: calculateSnappedPolylineDistanceKm(points).toFixed(2) };
          }
          return curr;
        });
        return nextWaypoints;
      });
    }
  };

  const handleFmrRoutePick = ({ lat, lng }) => {
    if (fmrRouteMode === 'start') {
      setFmrFormData((prev) => {
        const next = { ...prev, start_latitude: lat.toFixed(6), start_longitude: lng.toFixed(6) };
        const sLat = parseCoordinate(next.start_latitude);
        const sLng = parseCoordinate(next.start_longitude);
        const eLat = parseCoordinate(next.end_latitude);
        const eLng = parseCoordinate(next.end_longitude);
        if (!Number.isNaN(sLat) && !Number.isNaN(sLng) && !Number.isNaN(eLat) && !Number.isNaN(eLng)) {
          const points = [[sLat, sLng], ...fmrRouteWaypoints.map(w => [w.lat, w.lng]), [eLat, eLng]];
          next.project_length_km = calculateSnappedPolylineDistanceKm(points).toFixed(2);
        } else {
          next.project_length_km = '';
        }
        return next;
      });
      return;
    }
    if (fmrRouteMode === 'end') {
      setFmrFormData((prev) => {
        const next = { ...prev, end_latitude: lat.toFixed(6), end_longitude: lng.toFixed(6) };
        const sLat = parseCoordinate(next.start_latitude);
        const sLng = parseCoordinate(next.start_longitude);
        const eLat = parseCoordinate(next.end_latitude);
        const eLng = parseCoordinate(next.end_longitude);
        if (!Number.isNaN(sLat) && !Number.isNaN(sLng) && !Number.isNaN(eLat) && !Number.isNaN(eLng)) {
          const points = [[sLat, sLng], ...fmrRouteWaypoints.map(w => [w.lat, w.lng]), [eLat, eLng]];
          next.project_length_km = calculateSnappedPolylineDistanceKm(points).toFixed(2);
        } else {
          next.project_length_km = '';
        }
        return next;
      });
      return;
    }
    if (fmrRouteMode === 'waypoint') {
      const newPt = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
      setFmrRouteWaypoints((prev) => {
        const nextWaypoints = [...prev, newPt];
        setFmrFormData((curr) => {
          const sLat = parseCoordinate(curr.start_latitude);
          const sLng = parseCoordinate(curr.start_longitude);
          const eLat = parseCoordinate(curr.end_latitude);
          const eLng = parseCoordinate(curr.end_longitude);
          if (!Number.isNaN(sLat) && !Number.isNaN(sLng) && !Number.isNaN(eLat) && !Number.isNaN(eLng)) {
            const points = [[sLat, sLng], ...nextWaypoints.map(w => [w.lat, w.lng]), [eLat, eLng]];
            return { ...curr, project_length_km: calculateSnappedPolylineDistanceKm(points).toFixed(2) };
          }
          return curr;
        });
        return nextWaypoints;
      });
    }
  };


  const openFmrEditModal = (project) => {
    setSelectedFmrProject(project);
    const route = routeByProjectId[project.id] || null;
    const waypointsRaw = route?.route_points || route?.waypoints || route?.points || [];
    const waypoints = Array.isArray(waypointsRaw)
      ? waypointsRaw
        .map((point) => {
          const lat = Number(point?.lat ?? point?.latitude ?? point?.[0]);
          const lng = Number(point?.lng ?? point?.longitude ?? point?.[1]);
          return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
        })
        .filter(Boolean)
      : [];
    setFmrRouteWaypoints(waypoints);

    setFmrFormData({
      project_name: project.project_name || '',
      status: normalizeFmrStatus(project.status) || 'Proposed',
      year_funded: project.year_funded?.toString() || '',
      municipality: project.municipality || '',
      province: project.province || 'Iloilo',
      accomplishment: project.accomplishment?.toString() || '',
      project_length_km: project.project_length_km?.toString() || '',
      start_latitude: project.start_latitude?.toString() || '',
      start_longitude: project.start_longitude?.toString() || '',
      end_latitude: project.end_latitude?.toString() || '',
      end_longitude: project.end_longitude?.toString() || '',
      date_completed: project.date_completed || '',
      target_completion_date: project.target_completion_date || '',
      location: project.location || '',
      remarks: project.remarks || '',
      total_budget: project.total_budget?.toString() || '',
      funds_released: project.funds_released?.toString() || '',
      funding_source: project.funding_source || '',
    });
    setShowFmrEditModal(true);
  };

  const openFmrDeleteModal = (project) => {
    setSelectedFmrProject(project);
    setShowFmrDeleteModal(true);
  };

  const handleEditFmrProject = async (e) => {
    e.preventDefault();
    const payload = {
      project_name: fmrFormData.project_name,
      status: fmrFormData.status,
      year_funded: fmrFormData.year_funded ? parseInt(fmrFormData.year_funded) : null,
      municipality: fmrFormData.municipality,
      province: fmrFormData.province,
      accomplishment: fmrFormData.accomplishment ? parseFloat(fmrFormData.accomplishment) : null,
      project_length_km: fmrFormData.project_length_km ? parseFloat(fmrFormData.project_length_km) : null,
      start_latitude: fmrFormData.start_latitude ? parseFloat(fmrFormData.start_latitude) : null,
      start_longitude: fmrFormData.start_longitude ? parseFloat(fmrFormData.start_longitude) : null,
      end_latitude: fmrFormData.end_latitude ? parseFloat(fmrFormData.end_latitude) : null,
      end_longitude: fmrFormData.end_longitude ? parseFloat(fmrFormData.end_longitude) : null,
      date_completed: fmrFormData.date_completed || null,
      target_completion_date: fmrFormData.target_completion_date || null,
      location: fmrFormData.location,
      remarks: fmrFormData.remarks,
      total_budget: fmrFormData.total_budget ? parseFloat(fmrFormData.total_budget) : null,
      funds_released: fmrFormData.funds_released ? parseFloat(fmrFormData.funds_released) : null,
      funding_source: fmrFormData.funding_source || null,
    };
    try {
      const { error } = await supabase.from('fmr_projects').update(payload).eq('id', selectedFmrProject.id);
      if (error) throw error;

      await upsertProjectRoute(
        selectedFmrProject.id,
        fmrFormData.start_latitude,
        fmrFormData.start_longitude,
        fmrFormData.end_latitude,
        fmrFormData.end_longitude,
        fmrRouteWaypoints
      );

      await fetchFmrProjects();
      await fetchProjectRoutes();
      setShowFmrEditModal(false);
      setSelectedFmrProject(null);
      setFmrFormData(emptyFmrForm);
      setFmrRouteWaypoints([]);
      showNotification('FMR project updated successfully!');
    } catch (err) {
      console.error('Failed to update FMR project:', err.message);
      showNotification(`Failed to update FMR project: ${err.message}`, 'error');
    }
  };

  const handleDeleteFmrProject = async () => {
    try {
      const { error } = await supabase.from('fmr_projects').delete().eq('id', selectedFmrProject.id);
      if (error) throw error;
      await fetchFmrProjects();
      setShowFmrDeleteModal(false);
      setSelectedFmrProject(null);
      showNotification('FMR project deleted successfully!', 'error');
    } catch (err) {
      console.error('Failed to delete FMR project:', err.message);
      showNotification(`Failed to delete FMR project: ${err.message}`, 'error');
    }
  };

  const handleSaveAdminMapProgress = async () => {
    if (!adminMapProgressEdit?.id) return;
    const nextProgress = Number(adminMapProgressEdit.accomplishment);
    if (!Number.isFinite(nextProgress) || nextProgress < 0 || nextProgress > 100) {
      showNotification('Progress must be between 0 and 100.', 'error');
      return;
    }

    try {
      const { error } = await supabase
        .from('fmr_projects')
        .update({ accomplishment: nextProgress })
        .eq('id', adminMapProgressEdit.id);
      if (error) throw error;

      await fetchFmrProjects();
      setAdminMapProgressEdit(null);
      showNotification('Project progress updated successfully.');
    } catch (err) {
      showNotification(`Failed to update progress: ${err.message}`, 'error');
    }
  };

  // Format currency
  const formatCurrency = (amount) => {
    if (!amount) return '₱0';
    if (amount >= 1000000) {
      return `₱${(amount / 1000000).toFixed(1)}M`;
    }
    return `₱${amount.toLocaleString()}`;
  };

  const newProjectRoutePreview = useMemo(() => {
    const points = [];
    const sLat = parseCoordinate(formData.startLatitude);
    const sLng = parseCoordinate(formData.startLongitude);
    const eLat = parseCoordinate(formData.endLatitude);
    const eLng = parseCoordinate(formData.endLongitude);
    if (!Number.isNaN(sLat) && !Number.isNaN(sLng)) points.push([sLat, sLng]);
    newProjectRouteWaypoints.forEach((point) => {
      const lat = Number(point.lat);
      const lng = Number(point.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng]);
    });
    if (!Number.isNaN(eLat) && !Number.isNaN(eLng)) points.push([eLat, eLng]);
    return points;
  }, [formData.startLatitude, formData.startLongitude, formData.endLatitude, formData.endLongitude, newProjectRouteWaypoints]);

  const fmrRoutePreview = useMemo(() => {
    const points = [];
    const sLat = parseCoordinate(fmrFormData.start_latitude);
    const sLng = parseCoordinate(fmrFormData.start_longitude);
    const eLat = parseCoordinate(fmrFormData.end_latitude);
    const eLng = parseCoordinate(fmrFormData.end_longitude);
    if (!Number.isNaN(sLat) && !Number.isNaN(sLng)) points.push([sLat, sLng]);
    fmrRouteWaypoints.forEach((point) => {
      const lat = Number(point.lat);
      const lng = Number(point.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng]);
    });
    if (!Number.isNaN(eLat) && !Number.isNaN(eLng)) points.push([eLat, eLng]);
    return points;
  }, [fmrFormData.start_latitude, fmrFormData.start_longitude, fmrFormData.end_latitude, fmrFormData.end_longitude, fmrRouteWaypoints]);

  const navItems = [
    { id: 'projects', label: 'All Projects', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
    { id: 'map', label: 'Map View', icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7' },
    { id: 'analytics', label: 'Analytics', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
    { id: 'farmers', label: 'Farmer Beneficiaries', icon: 'M18 18.72a2.01 2.01 0 01-1.8 2.28H7.6a2.01 2.01 0 01-1.8-2.28l.75-5.4a3 3 0 012.97-2.58h4.96a3 3 0 012.97 2.58l.54 5.4zM12 13.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9z' },
    { id: 'project-mgmt', label: 'Project Mgmt', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
    { id: 'priorities', label: 'Priorities', icon: 'M12 6.75a.75.75 0 01.75.75v3.75H16.5a.75.75 0 010 1.5h-3.75v3.75a.75.75 0 01-1.5 0v-3.75H7.5a.75.75 0 010-1.5h3.75V7.5a.75.75 0 01.75-.75z' },
    { id: 'reports', label: 'Reports', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { id: 'public-reports', label: 'Public Reports', icon: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418', badgeCount: pendingPublicReportsCount },
    { id: 'progress-updates', label: 'Progress Updates', icon: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', badgeCount: progressUpdates.filter(u => u.status === 'pending').length },
    { id: 'lgu-proposals', label: 'LGU Proposals', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', badgeCount: lguProposals.filter(p => p.status === 'Submitted' || p.status === 'Under Validation').length },
  ];

  // Handle sign out
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/admin');
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-[100] px-6 py-3 rounded-lg shadow-lg text-white font-medium transition-all ${notification.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
          }`}>
          {notification.message}
        </div>
      )}

      {/* Sidebar Toggle Button (Mobile) */}
      <button
        className="fixed top-4 left-4 z-50 bg-teal-600 text-white rounded-lg p-2.5 shadow-lg lg:hidden"
        onClick={() => setShowSidebar(s => !s)}
      >
        {showSidebar ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>

      {/* Sidebar Overlay (Mobile) */}
      {showSidebar && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 ${sidebarCollapsed ? 'w-20' : 'w-72'} bg-gradient-to-b from-slate-950 to-slate-900 text-white flex flex-col transition-all duration-300 ease-in-out ${showSidebar ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } border-r border-slate-800/60 shadow-xl`}>
        {/* Logo */}
        <div className="px-5 py-6 border-b border-slate-800/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3.5 overflow-hidden">
              {sidebarCollapsed ? (
                <Logo variant="glyph" tone="light" className="size-10" alt="KalsaTrack" />
              ) : (
                <div className="flex flex-col gap-1">
                  <Logo tone="light" className="h-8" />
                  <p className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">FMR Portal v1.0</p>
                </div>
              )}
            </div>
            {/* Collapse Toggle Button */}
            <button
              onClick={() => setSidebarCollapsed(c => !c)}
              className="hidden lg:flex w-7.5 h-7.5 bg-slate-850 hover:bg-teal-600 border border-slate-700/50 rounded-lg items-center justify-center text-slate-400 hover:text-white transition-all duration-200"
              style={{ width: '30px', height: '30px' }}
            >
              <svg className={`w-3.5 h-3.5 transition-transform duration-355 ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-6 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <p className={`px-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest select-none transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'h-0 mb-0 opacity-0 overflow-hidden' : 'h-auto mb-3 opacity-100'
            }`}>
            Main Menu
          </p>
          <div className="space-y-1.5">
            {navItems.map(item => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={`relative w-full flex items-center ${sidebarCollapsed ? 'justify-center px-2 py-3' : 'gap-4.5 px-4 py-3'} rounded-xl text-left transition-all duration-250 group ${isActive
                      ? 'bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-md shadow-teal-500/15 font-semibold'
                      : 'text-slate-400 hover:bg-slate-800/65 hover:text-white'
                    }`}
                >
                  {/* Left Indicator Stripe */}
                  <span className={`absolute left-0 w-1 bg-white rounded-r-full transition-all duration-300 ${isActive ? 'top-2.5 bottom-2.5 opacity-100 scale-100' : 'top-1/2 bottom-1/2 opacity-0 scale-50'
                    }`} />

                  <svg className={`${sidebarCollapsed ? 'w-6 h-6' : 'w-5.5 h-5.5'} flex-shrink-0 transition-transform duration-200 group-hover:scale-105`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={isActive ? 2.25 : 1.75} d={item.icon} />
                  </svg>

                  <span className={`text-[13.5px] font-medium flex-grow flex items-center justify-between transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-0 opacity-0 max-w-0 overflow-hidden' : 'w-auto opacity-100 max-w-[200px]'
                    }`}>
                    <span className="truncate">{item.label}</span>
                    {item.badgeCount > 0 && (
                      <span className={`min-w-[18px] h-4.5 px-1.5 flex items-center justify-center text-[9px] font-extrabold rounded-full transition-all duration-200 ${isActive ? 'bg-white text-teal-600' : 'bg-red-500 text-white'
                        }`}>
                        {item.badgeCount}
                      </span>
                    )}
                  </span>

                  {sidebarCollapsed && item.badgeCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 min-w-[15px] h-4 flex items-center justify-center text-[8px] font-black bg-red-500 text-white rounded-full shadow border border-slate-950 animate-pulse">
                      {item.badgeCount}
                    </span>
                  )}
                </button>
              );
            })}

            <div className="my-5 border-t border-slate-800/60 mx-2"></div>
            <p className={`px-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest select-none transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'h-0 mb-0 opacity-0 overflow-hidden' : 'h-auto mb-3 opacity-100'
              }`}>
              System
            </p>

            <button
              onClick={() => setActiveTab('settings')}
              title={sidebarCollapsed ? 'Settings' : undefined}
              className={`relative w-full flex items-center ${sidebarCollapsed ? 'justify-center px-2 py-3 mt-1.5' : 'gap-4.5 px-4 py-3'} rounded-xl text-left transition-all duration-250 group ${activeTab === 'settings'
                  ? 'bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-md shadow-teal-500/15 font-semibold'
                  : 'text-slate-400 hover:bg-slate-800/65 hover:text-white'
                }`}
            >
              <span className={`absolute left-0 w-1 bg-white rounded-r-full transition-all duration-300 ${activeTab === 'settings' ? 'top-2.5 bottom-2.5 opacity-100 scale-100' : 'top-1/2 bottom-1/2 opacity-0 scale-50'
                }`} />

              <svg className={`${sidebarCollapsed ? 'w-6 h-6' : 'w-5.5 h-5.5'} flex-shrink-0 transition-transform duration-200 group-hover:scale-105`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={activeTab === 'settings' ? 2.25 : 1.75} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={activeTab === 'settings' ? 2.25 : 1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className={`text-[13.5px] font-medium transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-0 opacity-0 max-w-0 overflow-hidden' : 'w-auto opacity-100 max-w-[200px]'
                }`}>
                Settings
              </span>
            </button>
          </div>
        </nav>

        {/* User Profile */}
        <div className={`${sidebarCollapsed ? 'p-2.5' : 'p-5'} border-t border-slate-800/60 bg-slate-900/60`}>
          <div className="flex items-center gap-3 px-1.5 py-2 overflow-hidden">
            <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl flex items-center justify-center font-extrabold text-sm shadow-md shadow-teal-500/20 flex-shrink-0 text-white select-none">
              {(adminIdentity.full_name || 'A').charAt(0).toUpperCase()}
            </div>
            <div className={`transition-all duration-300 ease-in-out flex flex-col ${sidebarCollapsed ? 'w-0 opacity-0 overflow-hidden' : 'w-auto opacity-100 flex-grow'
              }`}>
              <p className="font-bold text-[13.5px] text-white truncate leading-snug">{adminIdentity.full_name}</p>
              <p className="text-[11px] text-slate-500 mt-0.5 truncate">{adminIdentity.email}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            title={sidebarCollapsed ? 'Sign Out' : undefined}
            className={`w-full mt-3 bg-slate-800 hover:bg-red-500/10 text-slate-300 hover:text-red-400 rounded-xl transition-all duration-300 text-xs font-bold border border-slate-700/50 hover:border-red-500/20 flex items-center justify-center ${sidebarCollapsed ? 'px-2 py-3 gap-0' : 'px-4 py-2.5 gap-2'
              }`}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className={`transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-0 opacity-0 overflow-hidden max-w-0' : 'w-auto opacity-100 max-w-[200px]'
              }`}>
              Sign Out
            </span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className={`flex-1 min-h-screen transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-72'} ml-0`}>
        {/* Header */}
        <header className="bg-gradient-to-br from-slate-50 to-slate-100 backdrop-blur-lg border-b border-slate-200/50 sticky top-0 z-20">
          <div className="px-6 sm:px-10 py-4 sm:py-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="pl-12 lg:pl-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                {activeTab === 'projects' && 'FMR Projects'}
                {activeTab === 'map' && 'Map View'}
                {activeTab === 'analytics' && 'Analytics'}
                {activeTab === 'farmers' && 'Farmer Beneficiaries'}
                {activeTab === 'priorities' && 'Priorities'}
                {activeTab === 'reports' && 'Reports'}
                {activeTab === 'public-reports' && 'Public Reports'}
                {activeTab === 'progress-updates' && 'Progress Updates'}
                {activeTab === 'lgu-proposals' && 'LGU Proposals'}
                {activeTab === 'settings' && 'Settings'}
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                {activeTab === 'projects' && 'Manage all Farm-to-Market Road projects'}
                {activeTab === 'map' && 'Geographic visualization of projects'}
                {activeTab === 'analytics' && 'Project performance metrics and trends'}
                {activeTab === 'farmers' && 'LGU-submitted farmer beneficiaries linked to FMR project service areas for DA review'}
                {activeTab === 'priorities' && 'Weighted ranking of FMR project urgency'}
                {activeTab === 'reports' && 'Generate and view project reports'}
                {activeTab === 'public-reports' && 'Location-verified reports submitted from the public landing page'}
                {activeTab === 'progress-updates' && 'Review contractor-submitted progress updates for FMR projects'}
                {activeTab === 'lgu-proposals' && 'Validate LGU-submitted Farm-to-Market Road project proposals for feasibility'}
                {activeTab === 'settings' && 'Configure system preferences'}
              </p>
            </div>
            {activeTab === 'projects' && (
              <button
                onClick={() => {
                  const nextCode = generateNextProjectCode();
                  setFormData({
                    ...emptyForm,
                    projectCode: nextCode,
                    roadType: 'Concrete',
                    budgetSource: 'DA',
                  });
                  setNewProjectRouteWaypoints([]);
                  setNewProjectRouteMode('waypoint');
                  setShowAddModal(true);
                }}
                className="bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white px-6 py-3 rounded-xl font-semibold text-sm flex items-center gap-2.5 transition-all duration-200 shadow-lg shadow-teal-500/25 hover:shadow-xl hover:shadow-teal-500/30"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Project
              </button>
            )}
          </div>
        </header>

        {/* Content Area */}
        <div className="p-6 sm:p-10">
          {/* Error Banner */}
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800">{error}</p>
                <p className="text-xs text-red-600 mt-1">Make sure the projects table exists in Supabase. Run the SQL migration file if needed.</p>
              </div>
              <button onClick={() => { setError(null); fetchProjects(); }} className="text-xs font-medium text-red-700 hover:text-red-900 underline">
                Retry
              </button>
            </div>
          )}

          {/* Dashboard Tab */}
          {activeTab === 'dashboard' && (
            <>
              {/* Metrics Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-8 mb-10">
                <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <div className="flex items-start justify-between mb-5">
                    <div className="w-14 h-14 bg-gradient-to-br from-teal-50 to-teal-100 rounded-2xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-teal-700 bg-teal-50 px-2.5 py-1.5 rounded-lg tracking-wider">TOTAL</span>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 tracking-tight">{metrics.totalProjects}</p>
                  <p className="text-sm text-slate-500 mt-2 font-medium">Total Projects</p>
                </div>

                <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <div className="flex items-start justify-between mb-5">
                    <div className="w-14 h-14 bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 px-2.5 py-1.5 rounded-lg tracking-wider">ONGOING</span>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 tracking-tight">{metrics.inProgress}</p>
                  <p className="text-sm text-slate-500 mt-2 font-medium">In Progress</p>
                  <p className="text-xs text-slate-400 mt-1">{metrics.avgProgress}% avg. completion</p>
                </div>

                <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <div className="flex items-start justify-between mb-5">
                    <div className="w-14 h-14 bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1.5 rounded-lg tracking-wider">DONE</span>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 tracking-tight">{metrics.completed}</p>
                  <p className="text-sm text-slate-500 mt-2 font-medium">Completed</p>
                </div>

                <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <div className="flex items-start justify-between mb-5">
                    <div className="w-14 h-14 bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg tracking-wider">BUDGET</span>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 tracking-tight">{formatCurrency(metrics.totalBudget)}</p>
                  <p className="text-sm text-slate-500 mt-2 font-medium">Total Allocated</p>
                  <p className="text-xs text-slate-400 mt-1">{formatCurrency(metrics.disbursed)} disbursed</p>
                </div>
              </div>

              {/* Reports Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-8 mb-10">
                <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <div className="flex items-start justify-between mb-5">
                    <div className="w-14 h-14 bg-gradient-to-br from-violet-50 to-violet-100 rounded-2xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-violet-700 bg-violet-50 px-2.5 py-1.5 rounded-lg tracking-wider">REPORTS</span>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 tracking-tight">{metrics.totalReports}</p>
                  <p className="text-sm text-slate-500 mt-2 font-medium">Public Reports Submitted</p>
                  <p className="text-xs text-slate-400 mt-1">{publicReports.filter(r => r.status === 'pending').length} pending review</p>
                </div>

                <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <div className="flex items-start justify-between mb-5">
                    <div className="w-14 h-14 bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1.5 rounded-lg tracking-wider">PRIORITY</span>
                  </div>
                  <p className="text-lg font-semibold text-slate-900">Top 3 Prioritized Projects</p>
                  {topPriorityProjects.length === 0 ? (
                    <p className="text-xs text-slate-400 mt-2">Not enough data to rank projects yet.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {topPriorityProjects.map((entry) => {
                        const scoreNum = Number(entry.score) || 0;
                        const badgeClasses = `inline-flex items-center justify-center w-6 h-6 rounded-lg text-xs font-bold ${scoreNum >= 80 ? 'bg-orange-100 text-orange-800' : scoreNum >= 60 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                          }`;
                        const scoreClasses = `${scoreNum >= 80 ? 'text-orange-700 font-bold' : scoreNum >= 60 ? 'text-amber-700 font-semibold' : 'text-slate-500 font-semibold'}`;
                        const barColor = entry.rank === 1 ? 'bg-red-500' : entry.rank === 2 ? 'bg-orange-500' : 'bg-yellow-400';

                        return (
                          <li key={entry.project?.id || entry.rank} className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <span className={badgeClasses}>#{entry.rank}</span>
                                <span className="text-slate-700">{entry.project?.project_name || 'Unnamed project'}</span>
                              </div>
                              <span className={`text-xs ${scoreClasses}`}>{`${entry.score}%`}</span>
                            </div>
                            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                              <div className={`${barColor} h-full`} style={{ width: `${scoreNum}%` }} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              {/* DA FMR Projects Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-8 mb-10">
                <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <div className="flex items-start justify-between mb-5">
                    <div className="w-14 h-14 bg-gradient-to-br from-cyan-50 to-cyan-100 rounded-2xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-cyan-700 bg-cyan-50 px-2.5 py-1.5 rounded-lg tracking-wider">DA-FMR</span>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 tracking-tight">{fmrProjects.length}</p>
                  <p className="text-sm text-slate-500 mt-2 font-medium">DA FMR Projects</p>
                </div>
                <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <div className="flex items-start justify-between mb-5">
                    <div className="w-14 h-14 bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1.5 rounded-lg tracking-wider">FMR</span>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 tracking-tight">{fmrProjects.filter(p => normalizeFmrStatus(p.status) === 'Completed').length}</p>
                  <p className="text-sm text-slate-500 mt-2 font-medium">FMR Completed</p>
                </div>
                <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <div className="flex items-start justify-between mb-5">
                    <div className="w-14 h-14 bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg tracking-wider">FMR</span>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 tracking-tight">{fmrProjects.filter(p => normalizeFmrStatus(p.status) === 'On-Going').length}</p>
                  <p className="text-sm text-slate-500 mt-2 font-medium">FMR On-Going</p>
                </div>
                <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <div className="flex items-start justify-between mb-5">
                    <div className="w-14 h-14 bg-gradient-to-br from-sky-50 to-sky-100 rounded-2xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-sky-700 bg-sky-50 px-2.5 py-1.5 rounded-lg tracking-wider">FMR</span>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 tracking-tight">{fmrProjects.filter(p => normalizeFmrStatus(p.status) === 'Proposed').length}</p>
                  <p className="text-sm text-slate-500 mt-2 font-medium">FMR Proposed</p>
                </div>
              </div>

              {/* Projects Table */}
              <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-6 sm:px-8 py-6 sm:py-7 border-b border-slate-200/60 bg-gradient-to-r from-slate-50 to-white">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900 tracking-tight">Active Projects</h2>
                      <p className="text-sm text-slate-500 mt-1.5">Monitor current infrastructure development</p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full sm:w-auto">
                      <input
                        type="text"
                        placeholder="Search projects..."
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setCurrentPage(1);
                        }}
                        className="px-5 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 w-full sm:w-72 bg-white shadow-sm"
                      />
                      <select
                        value={statusFilter}
                        onChange={(e) => {
                          setStatusFilter(e.target.value);
                          setCurrentPage(1);
                        }}
                        className="px-5 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white shadow-sm cursor-pointer"
                      >
                        <option value="all">All Status</option>
                        <option value="Planning">Planning</option>
                        <option value="Bidding">Bidding</option>
                        <option value="In Progress">In Progress</option>
                        <option value="On Hold">On Hold</option>
                        <option value="Completed">Completed</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    </div>
                  </div>
                </div>

                {loading ? (
                  <div className="p-12 text-center">
                    <div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                    <p className="text-slate-600 mt-4">Loading projects...</p>
                  </div>
                ) : filteredProjects.length === 0 ? (
                  <EmptyState
                    title="No projects found"
                    description="Try adjusting the search keyword or status filters."
                    buttonLabel="Reset Filters"
                    onButtonClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
                  />
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[800px]">
                        <thead>
                          <tr className="bg-slate-50/50">
                            {[['projectName', 'Project'], ['municipality', 'Location'], ['contractor', 'Contractor'], ['totalBudget', 'Budget'], ['status', 'Status'], ['progress', 'Progress']].map(([field, label], idx) => (
                              <th key={field} className={`${idx === 0 ? 'px-8' : 'px-6'} py-5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider`}>
                                <button className="inline-flex items-center gap-1 hover:text-slate-700" onClick={() => toggleProjectSort(field)}>
                                  {label}
                                  {sortField === field && (
                                    <span className="text-teal-600">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                                  )}
                                </button>
                              </th>
                            ))}
                            <th className="px-8 py-5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {paginatedProjects.map((project) => (
                            <tr
                              key={project.id}
                              className="cursor-pointer hover:bg-slate-50/50 transition-colors duration-150"
                              onClick={() => openProjectDetailModal(project)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  openProjectDetailModal(project);
                                }
                              }}
                              tabIndex={0}
                              title="Click to view project details"
                            >
                              <td className="px-8 py-5">
                                <p className="font-semibold text-sm text-slate-900">{project.projectName}</p>
                                <p className="text-xs text-slate-400 font-mono mt-1">{project.projectCode} • {project.roadLength} km</p>
                              </td>
                              <td className="px-6 py-5">
                                <p className="text-sm text-slate-700">{project.municipality}, {project.province}</p>
                                <p className="text-xs text-slate-400 font-mono mt-1">{project.latitude?.toFixed(4)}°N, {project.longitude?.toFixed(4)}°E</p>
                              </td>
                              <td className="px-6 py-5">
                                <p className="text-sm text-slate-700">{project.contractor}</p>
                              </td>
                              <td className="px-6 py-5">
                                <p className="text-sm font-bold text-slate-900">{formatCurrency(project.totalBudget)}</p>
                              </td>
                              <td className="px-6 py-5">
                                {renderStatusPill(project.status)}
                              </td>
                              <td className="px-6 py-5">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-bold text-slate-700">{project.progress}%</span>
                                  </div>
                                  <div className="w-28 bg-slate-100 rounded-full h-2.5 overflow-hidden">
                                    <div
                                      className={`h-2.5 rounded-full transition-all duration-500 ${project.progress === 100 ? 'bg-emerald-500' : 'bg-teal-500'
                                        }`}
                                      style={{ width: `${project.progress}%` }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="px-8 py-5">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openProjectDetailModal(project);
                                    }}
                                    className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors duration-150"
                                    title="View details"
                                  >
                                    View
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (project._source === 'fmr' && project._raw) {
                                        openFmrEditModal(project._raw);
                                      } else {
                                        openEditModal(project);
                                      }
                                    }}
                                    className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors duration-150"
                                    title="Edit"
                                  >
                                    <svg className="w-4.5 h-4.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (project._source === 'fmr' && project._raw) {
                                        openFmrDeleteModal(project._raw);
                                      } else {
                                        openDeleteModal(project);
                                      }
                                    }}
                                    className="p-2.5 hover:bg-red-50 rounded-xl transition-colors duration-150"
                                    title="Delete"
                                  >
                                    <svg className="w-4.5 h-4.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    <div className="px-8 py-5 border-t border-slate-100 bg-gradient-to-r from-slate-50 to-white flex flex-col sm:flex-row items-center justify-between gap-5">
                      <p className="text-sm text-slate-500">
                        Showing <span className="font-bold text-slate-700">{(currentPage - 1) * projectsPerPage + 1}</span> to{' '}
                        <span className="font-bold text-slate-700">{Math.min(currentPage * projectsPerPage, filteredProjects.length)}</span> of{' '}
                        <span className="font-bold text-slate-700">{filteredProjects.length}</span> projects
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-white hover:border-slate-300 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                          Previous
                        </button>
                        {getPaginationRange(currentPage, totalPages).map((page, idx) => {
                          if (page === '...') {
                            return (
                              <span key={`dots-${idx}`} className="px-3 py-2 text-slate-400 text-sm font-semibold select-none">
                                ...
                              </span>
                            );
                          }
                          return (
                            <button
                              key={page}
                              onClick={() => setCurrentPage(page)}
                              className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${currentPage === page
                                  ? 'bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-lg shadow-teal-500/25'
                                  : 'border border-slate-200 hover:bg-white hover:border-slate-300 shadow-sm'
                                }`}
                            >
                              {page}
                            </button>
                          );
                        })}
                        <button
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                          disabled={currentPage === totalPages}
                          className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-white hover:border-slate-300 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* Projects Tab — Unified FMR Projects */}
          {activeTab === 'projects' && (() => {
            const fmrYearOptions = [...new Set(fmrProjects.map(p => Number(p.year_funded)).filter(y => y && !isNaN(y)))].sort((a, b) => b - a);
            const filteredFmr = fmrProjects.filter(p => {
              const q = fmrProjectSearch.toLowerCase();
              const name = (p.project_name || '').toLowerCase();
              const loc = (p.location || '').toLowerCase();
              const muni = (p.municipality || '').toLowerCase();
              const matchesSearch = !q || name.includes(q) || loc.includes(q) || muni.includes(q);
              const normalizedStatus = normalizeFmrStatus(p.status);
              const matchesStatus = fmrProjectStatusFilter === 'All' || normalizedStatus === fmrProjectStatusFilter;
              const matchesYear = fmrProjectYearFilter === 'All' || String(Number(p.year_funded)) === fmrProjectYearFilter;
              const candidateDate = p.updated_at || p.created_at || p.date_completed || p.target_completion_date;
              const matchesDate = inDateRange(candidateDate, fmrProjectDateFrom, fmrProjectDateTo);
              return matchesSearch && matchesStatus && matchesYear && matchesDate;
            }).sort((a, b) => {
              if (fmrProjectSortBy === 'name-asc') return (a.project_name || '').localeCompare(b.project_name || '');
              if (fmrProjectSortBy === 'name-desc') return (b.project_name || '').localeCompare(a.project_name || '');
              if (fmrProjectSortBy === 'progress-desc') return (Number(b.accomplishment) || 0) - (Number(a.accomplishment) || 0);
              if (fmrProjectSortBy === 'progress-asc') return (Number(a.accomplishment) || 0) - (Number(b.accomplishment) || 0);
              if (fmrProjectSortBy === 'year-desc') return (Number(b.year_funded) || 0) - (Number(a.year_funded) || 0);
              if (fmrProjectSortBy === 'year-asc') return (Number(a.year_funded) || 0) - (Number(b.year_funded) || 0);
              const aTime = new Date(a.updated_at || a.created_at || a.date_completed || a.target_completion_date || 0).getTime() || 0;
              const bTime = new Date(b.updated_at || b.created_at || b.date_completed || b.target_completion_date || 0).getTime() || 0;
              return bTime - aTime;
            });
            const fmrCounts = {
              all: fmrProjects.length,
              completed: fmrProjects.filter(p => normalizeFmrStatus(p.status) === 'Completed').length,
              ongoing: fmrProjects.filter(p => normalizeFmrStatus(p.status) === 'On-Going').length,
              proposed: fmrProjects.filter(p => normalizeFmrStatus(p.status) === 'Proposed').length,
            };
            const fmrTotalPages = Math.max(1, Math.ceil(filteredFmr.length / fmrProjectsPerPage));
            const safeFmrPage = Math.min(fmrProjectCurrentPage, fmrTotalPages);
            const paginatedFilteredFmr = filteredFmr.slice(
              (safeFmrPage - 1) * fmrProjectsPerPage,
              safeFmrPage * fmrProjectsPerPage
            );
            const exportFilteredFmr = () => {
              const rows = filteredFmr.map((p) => ({
                project_name: p.project_name || '',
                status: normalizeFmrStatus(p.status) || '',
                year_funded: p.year_funded || '',
                municipality: p.municipality || '',
                province: p.province || 'Iloilo',
                accomplishment: p.accomplishment || 0,
                project_length_km: p.project_length_km || 0,
                location: p.location || '',
                start_latitude: p.start_latitude || '',
                start_longitude: p.start_longitude || '',
                end_latitude: p.end_latitude || '',
                end_longitude: p.end_longitude || '',
                date_completed: p.date_completed || '',
                target_completion_date: p.target_completion_date || '',
              }));
              exportRowsToCsv(rows, 'kalsatrack_filtered_projects.csv');
            };

            const mapFiltered = fmrProjects.filter(p => {
              const q = adminMapSearch.toLowerCase();
              const name = (p.project_name || '').toLowerCase();
              const loc = (p.location || '').toLowerCase();
              const muni = (p.municipality || '').toLowerCase();
              const src = (p.source || '').toLowerCase();
              const matchesSearch = !q || name.includes(q) || loc.includes(q) || muni.includes(q) || src.includes(q);
              const normalizedStatus = normalizeFmrStatus(p.status);
              const matchesStatus = adminMapStatusFilter === 'All' || normalizedStatus === adminMapStatusFilter;
              const matchesYear = adminMapYearFilter === 'All' || String(Number(p.year_funded)) === adminMapYearFilter;
              const matchesMunicipality = adminMapMunicipalityFilter === 'All' || (p.municipality || '') === adminMapMunicipalityFilter;
              const matchesOverdue = !adminMapShowOverdueOnly || isOverdueProject(p);
              return matchesSearch && matchesStatus && matchesYear && matchesMunicipality && matchesOverdue;
            });

            const mapYearOptions = [...new Set(fmrProjects.map(p => Number(p.year_funded)).filter(y => y && !isNaN(y)))].sort((a, b) => b - a);
            const mapMunicipalityOptions = [...new Set(fmrProjects.map((p) => p.municipality).filter(Boolean))].sort();

            const municipalityCounts = {};
            const mapEntities = mapFiltered.map((project) => {
              const route = buildRoutePoints(project, routeByProjectId[project.id]);

              const hasActualCoordinates = route.hasPolyline || Boolean(project.start_latitude && project.start_longitude);
              let coordinates = null;
              let isApproximate = false;
              let isCentroidFallback = false;

              if (hasActualCoordinates) {
                coordinates = route.startPoint || [project.start_latitude, project.start_longitude];
                const remarks = String(project.remarks || '').toLowerCase();
                if (remarks.includes('auto-geocoded')) {
                  isApproximate = true;
                }
              } else {
                isCentroidFallback = true;
                const muni = project.municipality || 'Leon';
                municipalityCounts[muni] = (municipalityCounts[muni] || 0) + 1;
                coordinates = getJitteredCentroid(muni, municipalityCounts[muni]);
              }

              return {
                project,
                route,
                coordinates,
                isApproximate,
                isCentroidFallback,
                hasFallbackPin: !route.hasPolyline || isCentroidFallback || isApproximate,
              };
            });

            const mapMappable = mapEntities.filter((entity) => entity.coordinates && Number.isFinite(entity.coordinates[0]));
            const mapBoundsPoints = mapMappable.flatMap((entity) => {
              const routePoints = adminSnappedRouteByProjectId[entity.project.id] || entity.route.points;
              return routePoints.length > 0 ? routePoints : [entity.coordinates];
            });

            const mapStats = {
              total: mapFiltered.length,
              mapped: mapMappable.length,
              completed: mapFiltered.filter(p => normalizeFmrStatus(p.status) === 'Completed').length,
              ongoing: mapFiltered.filter(p => normalizeFmrStatus(p.status) === 'On-Going').length,
              proposed: mapFiltered.filter(p => normalizeFmrStatus(p.status) === 'Proposed').length,
              geocoded: mapEntities.filter(e => e.isApproximate).length,
              centroids: mapEntities.filter(e => e.isCentroidFallback).length,
            };

            return (
              <div className="space-y-6">
                {/* Map View Integration */}
                <div className="space-y-4">
                  {/* Filters */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                      </svg>
                      <input type="text" value={adminMapSearch} onChange={e => setAdminMapSearch(e.target.value)} placeholder="Search by name, municipality..."
                        className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none animate-none" />
                    </div>
                    <select value={adminMapYearFilter} onChange={e => setAdminMapYearFilter(e.target.value)}
                      className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none">
                      <option value="All">All Years</option>
                      {mapYearOptions.map(y => <option key={y} value={String(y)}>FY {y}</option>)}
                    </select>
                    <select value={adminMapMunicipalityFilter} onChange={e => setAdminMapMunicipalityFilter(e.target.value)}
                      className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none">
                      <option value="All">All Municipalities</option>
                      {mapMunicipalityOptions.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <button
                      onClick={() => setAdminMapShowOverdueOnly((prev) => !prev)}
                      className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-all ${adminMapShowOverdueOnly
                          ? 'bg-red-600 border-red-600 text-white'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                    >
                      Show Overdue Only
                    </button>
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {['On-Going', 'Proposed', 'Completed', 'All'].map(s => (
                        <button key={s} onClick={() => setAdminMapStatusFilter(s)}
                          className={`px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${adminMapStatusFilter === s
                              ? 'bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-sm'
                              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                            }`}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Geocoding Progress Alert */}
                  {geocodingStatus && (
                    <div className="p-3.5 rounded-xl border border-teal-200 bg-teal-50 text-teal-800 text-xs font-semibold animate-pulse flex items-center gap-2.5 shadow-sm">
                      <span className="w-2 h-2 rounded-full bg-teal-500 inline-block animate-ping" />
                      <span>{geocodingStatus}</span>
                    </div>
                  )}

                  {/* Stats row */}
                  <div className="flex items-center gap-4 text-sm text-slate-500 flex-wrap">
                    <span>{mapStats.mapped} projects mapped ({mapStats.geocoded} geocoded, {mapStats.centroids} centroids)</span>
                    <span className="text-slate-300">|</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> {mapStats.completed} Completed</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> {mapStats.ongoing} On-Going</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> {mapStats.proposed} Proposed</span>
                  </div>

                  {/* Mini Map Container */}
                  <div className="relative bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden" style={{ height: '350px' }}>
                    {/* Map Search Overlay */}
                    <div className="absolute top-2 left-12 z-[1000] flex gap-1 bg-white p-1 rounded-lg shadow-md border border-slate-200/80 max-w-[280px] w-full">
                      <input
                        type="text"
                        placeholder="Search location (e.g. Bucari, Leon)..."
                        value={projectsMapSearchQuery}
                        onChange={(e) => setProjectsMapSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleProjectsMapSearch();
                          }
                        }}
                        className="flex-1 px-2.5 py-1 text-[11px] bg-slate-50 border border-slate-200 rounded outline-none focus:ring-1 focus:ring-teal-500"
                      />
                      <button
                        type="button"
                        onClick={handleProjectsMapSearch}
                        className="px-2.5 py-1 text-[11px] font-semibold text-white bg-teal-600 rounded hover:bg-teal-700 active:scale-95 transition-all shadow-sm"
                      >
                        Go
                      </button>
                    </div>

                    <MapContainer center={[10.89, 122.45]} zoom={9} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true} className="z-0">
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      <MapSearchController searchCoords={projectsMapSearchCoords} />
                      {projectsMapSearchCoords && (
                        <Marker position={projectsMapSearchCoords}>
                          <Popup>
                            <span className="text-xs font-semibold text-slate-800">Search: {projectsMapSearchQuery}</span>
                          </Popup>
                        </Marker>
                      )}
                      <AdminFitBounds points={mapBoundsPoints} filterKey="projects-tab-minimap" />
                      <ReportHeatmapLayer visible={adminMapShowHeatmap} points={reportHeatPoints} />
                      {mapMappable.map(({ project, route, coordinates, isApproximate, isCentroidFallback, hasFallbackPin }) => {
                        const theme = getRouteStatusTheme(project.status);
                        const isSelected = adminMapSelectedProject?.id === project.id;
                        const progress = Number(project.accomplishment || 0);
                        const targetChip = getTargetDateChip(project.target_completion_date, normalizeFmrStatus(project.status) === 'Completed');
                        const reportCount = reportCountByProjectId[project.id] || 0;

                        return (
                          <div key={project.id}>
                            {route.hasPolyline && !isCentroidFallback && (
                              <>
                                <Polyline
                                  positions={adminSnappedRouteByProjectId[project.id] || route.points}
                                  pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.92 }}
                                  eventHandlers={{ click: () => openProjectDetailModal(project) }}
                                />
                                <Polyline
                                  positions={adminSnappedRouteByProjectId[project.id] || route.points}
                                  pathOptions={{ color: theme.line, weight: isSelected ? 6 : 5, opacity: 0.95 }}
                                  eventHandlers={{ click: () => openProjectDetailModal(project) }}
                                >
                                  <Tooltip sticky>
                                    {project.project_name}
                                  </Tooltip>
                                </Polyline>

                                {route.startPoint && (
                                  <CircleMarker
                                    center={route.startPoint}
                                    radius={8}
                                    pathOptions={{ color: '#166534', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }}
                                  >
                                    <Tooltip direction="top" permanent className="!bg-green-600 !text-white !border-0 !rounded !px-1.5 !py-0">S</Tooltip>
                                  </CircleMarker>
                                )}

                                {route.endPoint && (
                                  <Marker
                                    position={route.endPoint}
                                    icon={L.divIcon({
                                      className: 'route-end-marker-admin',
                                      html: '<div style="width:16px;height:16px;background:#ef4444;border:2px solid #991b1b;border-radius:3px;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;">E</div>',
                                      iconSize: [16, 16],
                                      iconAnchor: [8, 8],
                                    })}
                                  />
                                )}
                              </>
                            )}

                            {hasFallbackPin && coordinates && (
                              <CircleMarker
                                center={coordinates}
                                radius={isSelected ? 11 : 8}
                                pathOptions={{
                                  fillColor: theme.line,
                                  color: theme.stroke,
                                  weight: isSelected ? 3.5 : 2,
                                  fillOpacity: 0.9,
                                  dashArray: isCentroidFallback ? '3, 4' : undefined
                                }}
                                eventHandlers={{ click: () => openProjectDetailModal(project) }}
                              >
                                <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                                  <div className="p-1">
                                    <strong className="text-slate-900 block font-semibold">{project.project_name}</strong>
                                    <span className="text-[10px] text-slate-500 block mt-0.5">
                                      {isCentroidFallback ? '⚠️ Centroid Fallback' : '📍 Barangay Center'}
                                    </span>
                                  </div>
                                </Tooltip>
                              </CircleMarker>
                            )}
                          </div>
                        );
                      })}
                      {/* Farmer Heatmap Layer */}
                      <FarmerHeatmapLayer visible={showFarmerHeatmap} points={farmerHeatPoints} />

                      {/* Markets Layer */}
                      {showMarketsMap && (markets || []).map(m => (
                        <Marker
                          key={`market-${m.id}`}
                          position={[Number(m.latitude), Number(m.longitude)]}
                          icon={new L.DivIcon({
                            className: 'custom-market-pin',
                            html: `<div style="background:#4338ca;color:#fff;width:30px;height:30px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.2);font-size:14px">🏪</div>`,
                            iconSize: [30, 30],
                            iconAnchor: [15, 15],
                          })}
                        >
                          <Popup>
                            <div className="p-1 space-y-1 text-slate-800">
                              <p className="font-bold text-sm text-indigo-700">{m.market_name}</p>
                              <p className="text-xs font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded w-fit">{m.market_type}</p>
                              <p className="text-xs"><span className="font-medium text-slate-500">Location:</span> {m.barangay || ''}, {m.municipality}</p>
                              {m.operating_days && <p className="text-xs"><span className="font-medium text-slate-500">Days:</span> {m.operating_days}</p>}
                              {m.operating_hours && <p className="text-xs"><span className="font-medium text-slate-500">Hours:</span> {m.operating_hours}</p>}
                              {m.commodities_accepted?.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {m.commodities_accepted.map(c => (
                                    <span key={c} className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">{c}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </Popup>
                        </Marker>
                      ))}

                      {/* Farmers Layer */}
                      {showFarmerDots && cropFilteredFarmerBeneficiaries.map(f => {
                        const lat = f.farmLatitude || f.gps?.lat;
                        const lng = f.farmLongitude || f.gps?.lng;
                        if (!lat || !lng) return null;

                        const cropColor =
                          f.crop === 'Rice' ? '#10b981' :
                            f.crop === 'Corn' ? '#f59e0b' :
                              f.crop === 'Sugarcane' ? '#8b5cf6' :
                                f.crop === 'Coconut' ? '#3b82f6' :
                                  f.crop === 'Vegetables' ? '#ec4899' :
                                    '#64748b';

                        return (
                          <CircleMarker
                            key={`farmer-${f.id}`}
                            center={[Number(lat), Number(lng)]}
                            radius={6}
                            pathOptions={{
                              fillColor: cropColor,
                              fillOpacity: 0.9,
                              color: '#ffffff',
                              weight: 1.5
                            }}
                          >
                            <Popup>
                              <div className="p-1 space-y-1 text-slate-800">
                                <p className="font-bold text-sm text-slate-900">{f.fullName}</p>
                                <p className="text-xs font-mono text-slate-500">{f.beneficiaryId || ''} • {f.rsbsaNumber}</p>
                                <div className="text-xs pt-1 border-t border-slate-100 space-y-0.5">
                                  <p><span className="font-semibold text-slate-500">Crop:</span> {f.crop} ({f.farmAreaHa ? f.farmAreaHa.toFixed(2) : '0.00'} ha)</p>
                                  <p><span className="font-semibold text-slate-500">Barangay:</span> {f.barangay}</p>
                                  <p><span className="font-semibold text-slate-500">Linked Road:</span> {f.linkedProject || 'N/A'}</p>
                                  {f.nearestMarketId && (
                                    <p><span className="font-semibold text-slate-500">Nearest Market:</span> {markets.find(m => m.id === f.nearestMarketId)?.market_name || 'N/A'}</p>
                                  )}
                                  {f.distanceToFmrKm && (
                                    <p><span className="font-semibold text-slate-500">Road Distance:</span> {f.distanceToFmrKm} km</p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setSelectedFarmerForPath(f)}
                                  className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-800 underline block mt-1.5"
                                >
                                  Show Supply Chain Links
                                </button>
                              </div>
                            </Popup>
                          </CircleMarker>
                        );
                      })}

                      {/* Supply Chain Connection Lines */}
                      {(() => {
                        if (!selectedFarmerForPath) return null;
                        const farmLat = selectedFarmerForPath.farmLatitude || selectedFarmerForPath.gps?.lat;
                        const farmLng = selectedFarmerForPath.farmLongitude || selectedFarmerForPath.gps?.lng;
                        if (!farmLat || !farmLng) return null;

                        const connectionPoints = [];
                        connectionPoints.push([Number(farmLat), Number(farmLng)]);

                        const linkedProj = fmrProjects.find(p => p.id === selectedFarmerForPath.linkedProjectId);
                        if (linkedProj && linkedProj.start_latitude && linkedProj.start_longitude) {
                          connectionPoints.push([Number(linkedProj.start_latitude), Number(linkedProj.start_longitude)]);
                          if (linkedProj.end_latitude && linkedProj.end_longitude) {
                            connectionPoints.push([Number(linkedProj.end_latitude), Number(linkedProj.end_longitude)]);
                          }
                        }

                        const linkedMarket = markets.find(m => m.id === selectedFarmerForPath.nearestMarketId);
                        if (linkedMarket && linkedMarket.latitude && linkedMarket.longitude) {
                          connectionPoints.push([Number(linkedMarket.latitude), Number(linkedMarket.longitude)]);
                        }

                        if (connectionPoints.length < 2) return null;

                        return (
                          <Polyline
                            positions={connectionPoints}
                            pathOptions={{
                              color: '#fb7185',
                              weight: 3.5,
                              dashArray: '5, 8',
                              opacity: 0.95
                            }}
                          />
                        );
                      })()}
                    </MapContainer>

                    <div className="absolute bottom-4 left-4 z-[500]">
                      <div className="bg-white/95 border border-slate-200 rounded-xl shadow-sm p-3 text-xs text-slate-700 space-y-2 min-w-[245px]">
                        <p className="font-semibold text-slate-900">Map Legend</p>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2"><span className="w-6 h-1.5 rounded bg-emerald-500 inline-block" /> Completed</div>
                          <div className="flex items-center gap-2"><span className="w-6 h-1.5 rounded bg-amber-500 inline-block" /> On-Going</div>
                          <div className="flex items-center gap-2"><span className="w-6 h-1.5 rounded bg-blue-500 inline-block" /> Proposed</div>
                        </div>
                        <div className="pt-2 border-t border-slate-200 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="w-3.5 h-3.5 rounded-full bg-emerald-50 border-2 border-emerald-700 inline-block shrink-0" />
                            <span>Barangay Geocoded</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-3.5 h-3.5 rounded-full bg-amber-50 border-2 border-dashed border-amber-600 inline-block shrink-0" />
                            <span>Centroid Fallback (No GPS)</span>
                          </div>
                        </div>
                        <label className="pt-2 border-t border-slate-200 flex items-center gap-2 text-[11px] font-medium text-slate-600">
                          <input
                            type="checkbox"
                            checked={adminMapShowHeatmap}
                            onChange={(e) => setAdminMapShowHeatmap(e.target.checked)}
                            className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                          />
                          Show Report Heatmap
                        </label>
                        <label className="pt-1.5 flex items-center gap-2 text-[11px] font-medium text-slate-600">
                          <input
                            type="checkbox"
                            checked={showFarmerDots}
                            onChange={(e) => {
                              setShowFarmerDots(e.target.checked);
                              if (!e.target.checked) setSelectedFarmerForPath(null);
                            }}
                            className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                          />
                          Show Farmers (Dots)
                        </label>
                        {showFarmerDots && (
                          <div className="pl-6 flex items-center gap-2 text-[11px] font-medium text-slate-600">
                            <span className="shrink-0">Crop:</span>
                            <select
                              value={farmerCropFilter}
                              onChange={(e) => setFarmerCropFilter(e.target.value)}
                              className="w-full rounded border-slate-300 text-[11px] py-0.5 focus:ring-teal-500 focus:border-teal-500"
                            >
                              {farmerCropOptions.map((crop) => (
                                <option key={crop} value={crop}>{crop}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <label className="pt-1.5 flex items-center gap-2 text-[11px] font-medium text-slate-600">
                          <input
                            type="checkbox"
                            checked={showFarmerHeatmap}
                            onChange={(e) => setShowFarmerHeatmap(e.target.checked)}
                            className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                          />
                          Show Farmer Density
                        </label>
                        <label className="pt-1.5 flex items-center gap-2 text-[11px] font-medium text-slate-600">
                          <input
                            type="checkbox"
                            checked={showMarketsMap}
                            onChange={(e) => setShowMarketsMap(e.target.checked)}
                            className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                          />
                          Show Markets (Icons)
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Summary Stat Chips */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="bg-white border border-slate-200/60 rounded-2xl p-5 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-50 to-cyan-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" /></svg>
                      </div>
                    </div>
                    <p className="text-3xl font-bold text-slate-900 tracking-tight">{fmrCounts.all}</p>
                    <p className="text-xs text-slate-500 mt-1 font-medium">Total FMR Projects</p>
                  </div>
                  <div className="bg-white border border-slate-200/60 rounded-2xl p-5 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      </div>
                    </div>
                    <p className="text-3xl font-bold text-slate-900 tracking-tight">{fmrCounts.completed}</p>
                    <p className="text-xs text-slate-500 mt-1 font-medium">Completed</p>
                  </div>
                  <div className="bg-white border border-slate-200/60 rounded-2xl p-5 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      </div>
                    </div>
                    <p className="text-3xl font-bold text-slate-900 tracking-tight">{fmrCounts.ongoing}</p>
                    <p className="text-xs text-slate-500 mt-1 font-medium">On-Going</p>
                  </div>
                  <div className="bg-white border border-slate-200/60 rounded-2xl p-5 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-50 to-sky-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0" /></svg>
                      </div>
                    </div>
                    <p className="text-3xl font-bold text-slate-900 tracking-tight">{fmrCounts.proposed}</p>
                    <p className="text-xs text-slate-500 mt-1 font-medium">Proposed</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-white border border-slate-200/60 rounded-2xl p-5 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-50 to-violet-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3" /></svg>
                      </div>
                    </div>
                    <p className="text-3xl font-bold text-slate-900 tracking-tight">{metrics.totalReports}</p>
                    <p className="text-xs text-slate-500 mt-1 font-medium">Public Reports Submitted</p>
                    <p className="text-xs text-slate-400 mt-1">{pendingPublicReportsCount} pending review</p>
                  </div>

                  <div className="bg-white border border-slate-200/60 rounded-2xl p-5 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 font-medium">Top 3 Prioritized Projects</p>
                    {topPriorityProjects.length === 0 ? (
                      <p className="text-xs text-slate-400 mt-2">Not enough data to rank projects yet.</p>
                    ) : (
                      <ul className="mt-2 space-y-2 text-xs text-slate-600">
                        {topPriorityProjects.map((entry) => {
                          const scoreNum = Number(entry.score) || 0;
                          const badgeClasses = `inline-flex items-center justify-center w-5 h-5 rounded-md text-xs font-bold ${scoreNum >= 80 ? 'bg-orange-100 text-orange-800' : scoreNum >= 60 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                            }`;
                          const scoreClasses = `${scoreNum >= 80 ? 'text-orange-700 font-bold' : scoreNum >= 60 ? 'text-amber-700 font-semibold' : 'text-slate-500 font-semibold'}`;
                          const barColor = entry.rank === 1 ? 'bg-red-500' : entry.rank === 2 ? 'bg-orange-500' : 'bg-yellow-400';

                          return (
                            <li key={entry.project?.id || entry.rank} className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-2"><span className={badgeClasses}>#{entry.rank}</span> {entry.project?.project_name || 'Unnamed project'}</span>
                                <span className={scoreClasses}>{`${entry.score}%`}</span>
                              </div>
                              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                <div className={`${barColor} h-full`} style={{ width: `${scoreNum}%` }} />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>

                {/* Filters Bar */}
                <div className="bg-white border border-slate-200/70 rounded-3xl shadow-sm p-4 sm:p-5 lg:p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-3 lg:gap-4 items-end">
                    {/* Search */}
                    <div className="relative md:col-span-2 xl:col-span-4">
                      <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                      </svg>
                      <input type="text" value={fmrProjectSearch} onChange={e => setFmrProjectSearch(e.target.value)} placeholder="Search by name, location, municipality..."
                        className="h-12 w-full pl-11 pr-4 border border-slate-200 rounded-2xl text-sm text-slate-700 placeholder:text-slate-400 bg-slate-50/60 hover:bg-white focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none shadow-sm transition-all" />
                    </div>
                    {/* Year Filter */}
                    <select value={fmrProjectYearFilter} onChange={e => setFmrProjectYearFilter(e.target.value)}
                      className="h-12 w-full px-4 border border-slate-200 rounded-2xl text-sm text-slate-700 bg-slate-50/60 hover:bg-white focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none shadow-sm xl:col-span-2">
                      <option value="All">All Years</option>
                      {fmrYearOptions.map(y => <option key={y} value={String(y)}>FY {y}</option>)}
                    </select>
                    <select
                      value={fmrProjectSortBy}
                      onChange={(e) => setFmrProjectSortBy(e.target.value)}
                      className="h-12 w-full px-4 border border-slate-200 rounded-2xl text-sm text-slate-700 bg-slate-50/60 hover:bg-white focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none shadow-sm xl:col-span-2"
                    >
                      <option value="latest">Sort: Latest</option>
                      <option value="name-asc">Sort: Name A-Z</option>
                      <option value="name-desc">Sort: Name Z-A</option>
                      <option value="progress-desc">Sort: Progress High-Low</option>
                      <option value="progress-asc">Sort: Progress Low-High</option>
                      <option value="year-desc">Sort: Fiscal Year Newest</option>
                      <option value="year-asc">Sort: Fiscal Year Oldest</option>
                    </select>
                    <div className="w-full xl:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Start Date</label>
                      <input
                        type="date"
                        value={fmrProjectDateFrom}
                        onChange={(e) => setFmrProjectDateFrom(e.target.value)}
                        max={fmrProjectDateTo || undefined}
                        aria-label="Start date"
                        title="Start date"
                        className="h-12 w-full px-4 border border-slate-200 rounded-2xl text-sm text-slate-700 bg-slate-50/60 hover:bg-white focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none shadow-sm"
                      />
                    </div>
                    <div className="w-full xl:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">End Date</label>
                      <input
                        type="date"
                        value={fmrProjectDateTo}
                        onChange={(e) => setFmrProjectDateTo(e.target.value)}
                        min={fmrProjectDateFrom || undefined}
                        aria-label="End date"
                        title="End date"
                        className="h-12 w-full px-4 border border-slate-200 rounded-2xl text-sm text-slate-700 bg-slate-50/60 hover:bg-white focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none shadow-sm"
                      />
                    </div>
                  </div>
                  <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
                    <div className="inline-flex w-fit max-w-full lg:col-span-8 items-center rounded-2xl border border-slate-200 bg-slate-100/80 p-1 shadow-sm">
                      {['On-Going', 'Proposed', 'Completed'].map(s => (
                        <button key={s} onClick={() => { setFmrProjectStatusFilter(s); setFmrProjectCurrentPage(1); }}
                          className={`flex-1 lg:flex-none min-w-[112px] px-4 h-10 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${fmrProjectStatusFilter === s
                              ? 'bg-white text-emerald-700 shadow-sm border border-emerald-100'
                              : 'text-slate-600 hover:text-slate-800'
                            }`}>
                          {s}
                        </button>
                      ))}
                    </div>

                    <div className="lg:col-span-4 flex items-center justify-between lg:justify-end gap-4">
                      {(fmrProjectSearch || fmrProjectStatusFilter !== 'On-Going' || fmrProjectYearFilter !== 'All' || fmrProjectDateFrom || fmrProjectDateTo || fmrProjectSortBy !== 'latest') && (
                        <button onClick={() => { setFmrProjectSearch(''); setFmrProjectStatusFilter('On-Going'); setFmrProjectYearFilter('All'); setFmrProjectDateFrom(''); setFmrProjectDateTo(''); setFmrProjectSortBy('latest'); setFmrProjectCurrentPage(1); }}
                          className="text-sm text-slate-500 hover:text-emerald-700 font-medium transition-colors">
                          Clear filters
                        </button>
                      )}
                      <button
                        onClick={exportFilteredFmr}
                        className="h-12 px-5 rounded-2xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm shadow-emerald-600/25 transition-all"
                      >
                        Export CSV
                      </button>
                    </div>
                  </div>
                  {/* Results count + view toggle */}
                  <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs sm:text-sm text-slate-500 tracking-tight">
                      Showing <span className="font-semibold text-slate-700">{filteredFmr.length}</span> of <span className="font-semibold text-slate-700">{fmrProjects.length}</span> projects
                    </p>
                    <div className="flex gap-1.5 p-1 bg-slate-100 rounded-2xl w-fit">
                      {[
                        { id: 'table', label: 'Table', icon: <Icons.List /> },
                        { id: 'cards', label: 'Cards', icon: <Icons.Dashboard /> },
                      ].map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setFmrViewMode(v.id)}
                          aria-pressed={fmrViewMode === v.id}
                          title={`${v.label} view`}
                          className={`px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-all duration-200 ${
                            fmrViewMode === v.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          {v.icon}
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Project Cards */}
                {fmrLoading ? (
                  <div className="bg-white border border-slate-200/60 rounded-2xl p-12 text-center">
                    <div className="w-10 h-10 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-sm text-slate-500 font-medium">Loading FMR projects...</p>
                  </div>
                ) : filteredFmr.length === 0 ? (
                  <div className="bg-white border border-slate-200/60 rounded-2xl">
                    <EmptyState
                      title="No projects found"
                      description="Try adjusting search, fiscal year, or status filters."
                      buttonLabel="Reset Filters"
                      onButtonClick={() => { setFmrProjectSearch(''); setFmrProjectStatusFilter('On-Going'); setFmrProjectYearFilter('All'); setFmrProjectCurrentPage(1); }}
                    />
                  </div>
                ) : (
                  <>
                    {fmrViewMode === 'table' ? (
                      <AdminFmrProjectTable
                        projects={paginatedFilteredFmr}
                        sortBy={fmrProjectSortBy}
                        onSortChange={setFmrProjectSortBy}
                        onOpenDetail={openProjectDetailModal}
                        onEdit={openFmrEditModal}
                        onAssign={(project) => {
                          setAssignContractorModal(project);
                          setSelectedContractorId(project.contractor_id || '');
                        }}
                        onDelete={openFmrDeleteModal}
                      />
                    ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                      {paginatedFilteredFmr.map(project => {
                        const status = normalizeFmrStatus(project.status);
                        const displayStatus = status;
                        const statusStyle = status === 'Completed'
                          ? { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500', dot: 'bg-emerald-500' }
                          : status === 'On-Going'
                            ? { badge: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-500', dot: 'bg-amber-500' }
                            : { badge: 'bg-sky-50 text-sky-700 border-sky-200', bar: 'bg-sky-500', dot: 'bg-sky-500' };
                        return (
                          <div
                            key={project.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => openProjectDetailModal(project)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openProjectDetailModal(project);
                              }
                            }}
                            className="group cursor-pointer bg-white border border-slate-200/60 rounded-2xl overflow-hidden hover:shadow-lg hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all duration-300 flex flex-col"
                            title="Click to view project details"
                          >
                            {/* Card Header Accent */}
                            <div className={`h-1 ${statusStyle.bar}`} />
                            <div className="p-6 flex-1 flex flex-col">
                              {/* Status & Year */}
                              <div className="flex items-center justify-between mb-4">
                                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-semibold ${statusStyle.badge}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                                  {displayStatus}
                                </span>
                                {project.year_funded && (
                                  <span className="text-xs font-mono text-slate-400 bg-slate-50 px-2.5 py-1 rounded-lg">FY {project.year_funded}</span>
                                )}
                              </div>

                              {/* Project Name */}
                              <h3 className="font-bold text-base text-slate-900 mb-2 line-clamp-2 leading-snug group-hover:text-teal-700 transition-colors">{project.project_name}</h3>

                              {/* Location */}
                              <div className="flex items-center gap-1.5 text-sm text-slate-500 mb-4">
                                <svg className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" /></svg>
                                <span className="truncate">{project.municipality}{project.province ? `, ${project.province}` : ', Iloilo'}</span>
                              </div>

                              {/* Accomplishment Progress */}
                              {status !== 'Proposed' && (
                                <div className="mb-4">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-xs text-slate-500 font-medium">Accomplishment</span>
                                    <span className="text-xs font-bold text-slate-700">{project.accomplishment || 0}%</span>
                                  </div>
                                  <div className="w-full bg-slate-100 rounded-full h-2">
                                    <div className={`h-2 rounded-full transition-all duration-700 ease-out ${statusStyle.bar}`} style={{ width: `${Math.min(project.accomplishment || 0, 100)}%` }} />
                                  </div>
                                </div>
                              )}

                              {/* Meta Info */}
                              <div className="flex items-center gap-4 text-xs text-slate-400 mt-auto mb-5">
                                {project.project_length_km > 0 && (
                                  <span className="flex items-center gap-1">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
                                    {project.project_length_km} km
                                  </span>
                                )}
                                {project.date_completed && (
                                  <span className="flex items-center gap-1">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v9.75" /></svg>
                                    {project.date_completed}
                                  </span>
                                )}
                              </div>

                              {/* Action Buttons */}
                              <div className="flex gap-2 pt-4 border-t border-slate-100 flex-wrap">
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openFmrEditModal(project);
                                  }}
                                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 transition-all duration-200"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                                  Edit
                                </button>
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setAssignContractorModal(project);
                                    setSelectedContractorId(project.contractor_id || '');
                                  }}
                                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-50 hover:bg-amber-100 border border-amber-200/60 rounded-xl text-sm font-semibold text-amber-700 transition-all duration-200"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" /></svg>
                                  Assign
                                </button>
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openFmrDeleteModal(project);
                                  }}
                                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 border border-red-200/60 rounded-xl text-sm font-semibold text-red-600 transition-all duration-200"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    )}
                    <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <p className="text-sm text-slate-500">
                          Showing <span className="font-semibold text-slate-700">{(safeFmrPage - 1) * fmrProjectsPerPage + 1}</span> to{' '}
                          <span className="font-semibold text-slate-700">{Math.min(safeFmrPage * fmrProjectsPerPage, filteredFmr.length)}</span> of{' '}
                          <span className="font-semibold text-slate-700">{filteredFmr.length}</span> projects
                        </p>
                        {fmrViewMode === 'table' && (
                          <select
                            value={fmrRowsPerPage}
                            onChange={(e) => setFmrRowsPerPage(Number(e.target.value))}
                            aria-label="Rows per page"
                            title="Rows per page"
                            className="px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                          >
                            {FMR_ROWS_PER_PAGE_OPTIONS.map((n) => (
                              <option key={n} value={n}>{n} / page</option>
                            ))}
                          </select>
                        )}
                      </div>
                      {fmrTotalPages > 1 && (
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          <button
                            onClick={() => setFmrProjectCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={safeFmrPage === 1}
                            className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-white hover:border-slate-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Previous
                          </button>
                          {getPaginationRange(safeFmrPage, fmrTotalPages).map((page, idx) => {
                            if (page === '...') {
                              return (
                                <span key={`dots-${idx}`} className="px-3 py-2 text-slate-400 text-sm font-semibold select-none">
                                  ...
                                </span>
                              );
                            }
                            return (
                              <button
                                key={page}
                                onClick={() => setFmrProjectCurrentPage(page)}
                                className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${safeFmrPage === page
                                    ? 'bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-lg shadow-teal-500/25'
                                    : 'border border-slate-200 hover:bg-white hover:border-slate-300 shadow-sm'
                                  }`}
                              >
                                {page}
                              </button>
                            );
                          })}
                          <button
                            onClick={() => setFmrProjectCurrentPage((p) => Math.min(fmrTotalPages, p + 1))}
                            disabled={safeFmrPage === fmrTotalPages}
                            className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-white hover:border-slate-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Next
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* Map Tab */}
          {activeTab === 'map' && (() => {
            const mapFiltered = fmrProjects.filter(p => {
              const q = adminMapSearch.toLowerCase();
              const name = (p.project_name || '').toLowerCase();
              const loc = (p.location || '').toLowerCase();
              const muni = (p.municipality || '').toLowerCase();
              const src = (p.source || '').toLowerCase();
              const matchesSearch = !q || name.includes(q) || loc.includes(q) || muni.includes(q) || src.includes(q);
              const normalizedStatus = normalizeFmrStatus(p.status);
              const matchesStatus = adminMapStatusFilter === 'All' || normalizedStatus === adminMapStatusFilter;
              const matchesYear = adminMapYearFilter === 'All' || String(Number(p.year_funded)) === adminMapYearFilter;
              const matchesMunicipality = adminMapMunicipalityFilter === 'All' || (p.municipality || '') === adminMapMunicipalityFilter;
              const matchesOverdue = !adminMapShowOverdueOnly || isOverdueProject(p);
              return matchesSearch && matchesStatus && matchesYear && matchesMunicipality && matchesOverdue;
            });
            const filterKey = `${adminMapSearch}-${adminMapStatusFilter}-${adminMapYearFilter}-${adminMapMunicipalityFilter}-${adminMapShowOverdueOnly}`;

            // Geocoding and centroid jitter tracking
            const municipalityCounts = {};
            const mapEntities = mapFiltered.map((project) => {
              const route = buildRoutePoints(project, routeByProjectId[project.id]);

              const hasActualCoordinates = route.hasPolyline || Boolean(project.start_latitude && project.start_longitude);
              let coordinates = null;
              let isApproximate = false;
              let isCentroidFallback = false;

              if (hasActualCoordinates) {
                coordinates = route.startPoint || [project.start_latitude, project.start_longitude];
                const remarks = String(project.remarks || '').toLowerCase();
                if (remarks.includes('auto-geocoded')) {
                  isApproximate = true;
                }
              } else {
                isCentroidFallback = true;
                const muni = project.municipality || 'Leon';
                municipalityCounts[muni] = (municipalityCounts[muni] || 0) + 1;
                coordinates = getJitteredCentroid(muni, municipalityCounts[muni]);
              }

              return {
                project,
                route,
                coordinates,
                isApproximate,
                isCentroidFallback,
                hasFallbackPin: !route.hasPolyline || isCentroidFallback || isApproximate,
              };
            });

            const mapMappable = mapEntities.filter((entity) => entity.coordinates && Number.isFinite(entity.coordinates[0]));
            // Gather bounds from polylines or individual fallback/centroid coordinates
            const mapBoundsPoints = mapMappable.flatMap((entity) => {
              const routePoints = adminSnappedRouteByProjectId[entity.project.id] || entity.route.points;
              return routePoints.length > 0 ? routePoints : [entity.coordinates];
            });

            const mapYearOptions = [...new Set(fmrProjects.map(p => Number(p.year_funded)).filter(y => y && !isNaN(y)))].sort((a, b) => b - a);
            const mapMunicipalityOptions = [...new Set(fmrProjects.map((p) => p.municipality).filter(Boolean))].sort();

            const mapStats = {
              total: mapFiltered.length,
              mapped: mapMappable.length,
              completed: mapFiltered.filter(p => normalizeFmrStatus(p.status) === 'Completed').length,
              ongoing: mapFiltered.filter(p => normalizeFmrStatus(p.status) === 'On-Going').length,
              proposed: mapFiltered.filter(p => normalizeFmrStatus(p.status) === 'Proposed').length,
              geocoded: mapEntities.filter(e => e.isApproximate).length,
              centroids: mapEntities.filter(e => e.isCentroidFallback).length,
            };

            return (
              <div className="space-y-5">
                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                    <input type="text" value={adminMapSearch} onChange={e => setAdminMapSearch(e.target.value)} placeholder="Search by name, municipality..."
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none" />
                  </div>
                  <select value={adminMapYearFilter} onChange={e => setAdminMapYearFilter(e.target.value)}
                    className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none">
                    <option value="All">All Years</option>
                    {mapYearOptions.map(y => <option key={y} value={String(y)}>FY {y}</option>)}
                  </select>
                  <select value={adminMapMunicipalityFilter} onChange={e => setAdminMapMunicipalityFilter(e.target.value)}
                    className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none">
                    <option value="All">All Municipalities</option>
                    {mapMunicipalityOptions.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <button
                    onClick={() => setAdminMapShowOverdueOnly((prev) => !prev)}
                    className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-all ${adminMapShowOverdueOnly
                        ? 'bg-red-600 border-red-600 text-white'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                  >
                    Show Overdue Only
                  </button>
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {['On-Going', 'Proposed', 'Completed', 'All'].map(s => (
                      <button key={s} onClick={() => setAdminMapStatusFilter(s)}
                        className={`px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${adminMapStatusFilter === s
                            ? 'bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-sm'
                            : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                          }`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Geocoding Progress Alert */}
                {geocodingStatus && (
                  <div className="p-3.5 rounded-xl border border-teal-200 bg-teal-50 text-teal-800 text-xs font-semibold animate-pulse flex items-center gap-2.5 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-teal-500 inline-block animate-ping" />
                    <span>{geocodingStatus}</span>
                  </div>
                )}

                {/* Stats row */}
                <div className="flex items-center gap-4 text-sm text-slate-500 flex-wrap">
                  <span>{mapStats.mapped} projects mapped ({mapStats.geocoded} geocoded, {mapStats.centroids} centroids)</span>
                  <span className="text-slate-300">|</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> {mapStats.completed} Completed</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> {mapStats.ongoing} On-Going</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> {mapStats.proposed} Proposed</span>
                </div>

                {/* Map */}
                <div className="relative bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden" style={{ height: '500px' }}>
                  {/* Map Search Overlay */}
                  <div className="absolute top-2 left-12 z-[1000] flex gap-1 bg-white p-1 rounded-lg shadow-md border border-slate-200/80 max-w-[280px] w-full">
                    <input
                      type="text"
                      placeholder="Search location (e.g. Bucari, Leon)..."
                      value={mainMapGeopSearchQuery}
                      onChange={(e) => setMainMapGeopSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleMainMapGeopSearch();
                        }
                      }}
                      className="flex-1 px-2.5 py-1 text-[11px] bg-slate-50 border border-slate-200 rounded outline-none focus:ring-1 focus:ring-teal-500"
                    />
                    <button
                      type="button"
                      onClick={handleMainMapGeopSearch}
                      className="px-2.5 py-1 text-[11px] font-semibold text-white bg-teal-600 rounded hover:bg-teal-700 active:scale-95 transition-all shadow-sm"
                    >
                      Go
                    </button>
                  </div>

                  {fmrLoading ? (
                    <div className="h-full flex items-center justify-center bg-slate-50">
                      <div className="text-center">
                        <div className="w-10 h-10 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-3" />
                        <p className="text-sm text-slate-500">Loading map data...</p>
                      </div>
                    </div>
                  ) : (
                    <MapContainer center={[10.89, 122.45]} zoom={9} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true} className="z-0">
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      <MapSearchController searchCoords={mainMapGeopSearchCoords} />
                      {mainMapGeopSearchCoords && (
                        <Marker position={mainMapGeopSearchCoords}>
                          <Popup>
                            <span className="text-xs font-semibold text-slate-800">Search: {mainMapGeopSearchQuery}</span>
                          </Popup>
                        </Marker>
                      )}
                      <AdminFitBounds points={mapBoundsPoints} filterKey={filterKey} />
                      <SelectedProjectMapController selectedProject={adminMapSelectedProject} />
                      <ReportHeatmapLayer visible={adminMapShowHeatmap} points={reportHeatPoints} />
                      {mapMappable.map(({ project, route, coordinates, isApproximate, isCentroidFallback, hasFallbackPin }) => {
                        const theme = getRouteStatusTheme(project.status);
                        const isSelected = adminMapSelectedProject?.id === project.id;
                        const progress = Number(project.accomplishment || 0);
                        const targetChip = getTargetDateChip(project.target_completion_date, normalizeFmrStatus(project.status) === 'Completed');
                        const reportCount = reportCountByProjectId[project.id] || 0;

                        return (
                          <div key={project.id}>
                            {route.hasPolyline && !isCentroidFallback && (
                              <>
                                <Polyline positions={adminSnappedRouteByProjectId[project.id] || route.points} pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.92 }} />
                                <Polyline
                                  positions={adminSnappedRouteByProjectId[project.id] || route.points}
                                  pathOptions={{ color: theme.line, weight: isSelected ? 6 : 5, opacity: 0.95 }}
                                  eventHandlers={{ click: () => setAdminMapSelectedProject(project) }}
                                >
                                  <Tooltip sticky>
                                    {project.project_name} - {normalizeFmrStatus(project.status)}
                                  </Tooltip>
                                  <Popup maxWidth={380}>
                                    <div className="space-y-3 min-w-[280px]">
                                      <div className="flex items-start justify-between gap-3">
                                        <h3 className="font-semibold text-slate-900 text-sm leading-snug">{project.project_name}</h3>
                                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${normalizeFmrStatus(project.status) === 'Completed' ? 'bg-emerald-100 text-emerald-700' :
                                            normalizeFmrStatus(project.status) === 'On-Going' ? 'bg-amber-100 text-amber-700' :
                                              'bg-sky-100 text-sky-700'
                                          }`}>{normalizeFmrStatus(project.status)}</span>
                                      </div>

                                      <div>
                                        <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                                          <span>Progress</span>
                                          <span className="font-semibold text-slate-700">{progress.toFixed(0)}%</span>
                                        </div>
                                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                          <div className="h-2 rounded-full bg-teal-500" style={{ width: `${Math.min(progress, 100)}%` }} />
                                        </div>
                                      </div>

                                      <div className="text-xs text-slate-600 space-y-1">
                                        <p>{project.municipality || 'N/A'}, {getProjectBarangay(project)}</p>
                                        <p>FY {project.year_funded || 'N/A'} • {project.project_length_km || 0} km</p>
                                        {targetChip && (
                                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${targetChip.className}`}>
                                            {targetChip.text}
                                          </span>
                                        )}
                                      </div>

                                      <div className="flex flex-wrap items-center gap-2">
                                        <button
                                          onClick={() => {
                                            setActiveTab('public-reports');
                                            setPublicReportProjectFilter(project.project_name || '');
                                          }}
                                          className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-sky-100 text-sky-700 hover:bg-sky-200"
                                        >
                                          {reportCount} public reports
                                        </button>
                                        <a
                                          href={`/projects/${project.id}`}
                                          className="inline-flex items-center px-3 py-1 rounded-lg text-[11px] font-medium bg-slate-900 text-white hover:bg-slate-800"
                                        >
                                          View Details
                                        </a>
                                        <button
                                          onClick={() => setAdminMapProgressEdit({ id: project.id, project_name: project.project_name, accomplishment: progress })}
                                          className="inline-flex items-center px-3 py-1 rounded-lg text-[11px] font-medium bg-amber-100 text-amber-700 hover:bg-amber-200"
                                        >
                                          Update Progress
                                        </button>
                                      </div>
                                    </div>
                                  </Popup>
                                </Polyline>

                                {route.startPoint && (
                                  <CircleMarker
                                    center={route.startPoint}
                                    radius={8}
                                    pathOptions={{ color: '#166534', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }}
                                  >
                                    <Tooltip direction="top" permanent className="!bg-green-600 !text-white !border-0 !rounded !px-1.5 !py-0">S</Tooltip>
                                  </CircleMarker>
                                )}

                                {route.endPoint && (
                                  <Marker
                                    position={route.endPoint}
                                    icon={L.divIcon({
                                      className: 'route-end-marker-admin',
                                      html: '<div style="width:16px;height:16px;background:#ef4444;border:2px solid #991b1b;border-radius:3px;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;">E</div>',
                                      iconSize: [16, 16],
                                      iconAnchor: [8, 8],
                                    })}
                                  />
                                )}
                              </>
                            )}

                            {hasFallbackPin && coordinates && (
                              <CircleMarker
                                center={coordinates}
                                radius={isSelected ? 11 : 8}
                                pathOptions={{
                                  fillColor: theme.line,
                                  color: theme.stroke,
                                  weight: isSelected ? 3.5 : 2,
                                  fillOpacity: 0.9,
                                  dashArray: isCentroidFallback ? '3, 4' : undefined
                                }}
                                eventHandlers={{ click: () => setAdminMapSelectedProject(project) }}
                              >
                                <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                                  <div className="p-1">
                                    <strong className="text-slate-900 block font-semibold">{project.project_name}</strong>
                                    <span className="text-[10px] text-slate-500 block mt-0.5">
                                      {isCentroidFallback ? '⚠️ Centroid Fallback' : '📍 Barangay Center'}
                                    </span>
                                  </div>
                                </Tooltip>
                                <Popup maxWidth={380}>
                                  <div className="space-y-3 min-w-[280px]">
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <h3 className="font-semibold text-slate-900 text-sm leading-snug">{project.project_name}</h3>
                                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                                          {isCentroidFallback ? 'MUNICIPAL CENTROID PIN' : 'BARANGAY CENTER GEOTAG'}
                                        </p>
                                      </div>
                                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${normalizeFmrStatus(project.status) === 'Completed' ? 'bg-emerald-100 text-emerald-700' :
                                          normalizeFmrStatus(project.status) === 'On-Going' ? 'bg-amber-100 text-amber-700' :
                                            'bg-sky-100 text-sky-700'
                                        }`}>{normalizeFmrStatus(project.status)}</span>
                                    </div>

                                    <div>
                                      <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                                        <span>Progress</span>
                                        <span className="font-semibold text-slate-700">{progress.toFixed(0)}%</span>
                                      </div>
                                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                        <div className="h-2 rounded-full bg-teal-500" style={{ width: `${Math.min(progress, 100)}%` }} />
                                      </div>
                                    </div>

                                    <div className="text-xs text-slate-600 space-y-1.5 p-2 bg-slate-50 rounded-lg border border-slate-100">
                                      <p><strong>Location:</strong> {project.municipality || 'N/A'}, {getProjectBarangay(project)}</p>
                                      <p><strong>Funding:</strong> FY {project.year_funded || 'N/A'} • {project.project_length_km || 0} km</p>
                                      {isCentroidFallback && (
                                        <p className="text-[10px] text-amber-700 font-medium">⚠️ No exact coordinates from DA. Placed at municipal centroid.</p>
                                      )}
                                      {isApproximate && (
                                        <p className="text-[10px] text-orange-700 font-medium">📍 Auto-geocoded coordinates to Barangay center.</p>
                                      )}
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
                                      <button
                                        onClick={() => {
                                          setActiveTab('public-reports');
                                          setPublicReportProjectFilter(project.project_name || '');
                                        }}
                                        className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-sky-100 text-sky-700 hover:bg-sky-200"
                                      >
                                        {reportCount} reports
                                      </button>
                                      <button
                                        onClick={() => openFmrEditModal(project)}
                                        className="inline-flex items-center px-3 py-1 rounded-lg text-[11px] font-medium bg-teal-600 text-white hover:bg-teal-700"
                                      >
                                        Define Route
                                      </button>
                                    </div>
                                  </div>
                                </Popup>
                              </CircleMarker>
                            )}
                          </div>
                        );
                      })}
                      {/* Farmer Heatmap Layer */}
                      <FarmerHeatmapLayer visible={showFarmerHeatmap} points={farmerHeatPoints} />

                      {/* Markets Layer */}
                      {showMarketsMap && (markets || []).map(m => (
                        <Marker
                          key={`market-${m.id}`}
                          position={[Number(m.latitude), Number(m.longitude)]}
                          icon={new L.DivIcon({
                            className: 'custom-market-pin',
                            html: `<div style="background:#4338ca;color:#fff;width:30px;height:30px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.2);font-size:14px">🏪</div>`,
                            iconSize: [30, 30],
                            iconAnchor: [15, 15],
                          })}
                        >
                          <Popup>
                            <div className="p-1 space-y-1 text-slate-800">
                              <p className="font-bold text-sm text-indigo-700">{m.market_name}</p>
                              <p className="text-xs font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded w-fit">{m.market_type}</p>
                              <p className="text-xs"><span className="font-medium text-slate-500">Location:</span> {m.barangay || ''}, {m.municipality}</p>
                              {m.operating_days && <p className="text-xs"><span className="font-medium text-slate-500">Days:</span> {m.operating_days}</p>}
                              {m.operating_hours && <p className="text-xs"><span className="font-medium text-slate-500">Hours:</span> {m.operating_hours}</p>}
                              {m.commodities_accepted?.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {m.commodities_accepted.map(c => (
                                    <span key={c} className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">{c}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </Popup>
                        </Marker>
                      ))}

                      {/* Farmers Layer */}
                      {showFarmerDots && cropFilteredFarmerBeneficiaries.map(f => {
                        const lat = f.farmLatitude || f.gps?.lat;
                        const lng = f.farmLongitude || f.gps?.lng;
                        if (!lat || !lng) return null;

                        const cropColor =
                          f.crop === 'Rice' ? '#10b981' :
                            f.crop === 'Corn' ? '#f59e0b' :
                              f.crop === 'Sugarcane' ? '#8b5cf6' :
                                f.crop === 'Coconut' ? '#3b82f6' :
                                  f.crop === 'Vegetables' ? '#ec4899' :
                                    '#64748b';

                        return (
                          <CircleMarker
                            key={`farmer-${f.id}`}
                            center={[Number(lat), Number(lng)]}
                            radius={6}
                            pathOptions={{
                              fillColor: cropColor,
                              fillOpacity: 0.9,
                              color: '#ffffff',
                              weight: 1.5
                            }}
                          >
                            <Popup>
                              <div className="p-1 space-y-1 text-slate-800">
                                <p className="font-bold text-sm text-slate-900">{f.fullName}</p>
                                <p className="text-xs font-mono text-slate-500">{f.beneficiaryId || ''} • {f.rsbsaNumber}</p>
                                <div className="text-xs pt-1 border-t border-slate-100 space-y-0.5">
                                  <p><span className="font-semibold text-slate-500">Crop:</span> {f.crop} ({f.farmAreaHa ? f.farmAreaHa.toFixed(2) : '0.00'} ha)</p>
                                  <p><span className="font-semibold text-slate-500">Barangay:</span> {f.barangay}</p>
                                  <p><span className="font-semibold text-slate-500">Linked Road:</span> {f.linkedProject || 'N/A'}</p>
                                  {f.nearestMarketId && (
                                    <p><span className="font-semibold text-slate-500">Nearest Market:</span> {markets.find(m => m.id === f.nearestMarketId)?.market_name || 'N/A'}</p>
                                  )}
                                  {f.distanceToFmrKm && (
                                    <p><span className="font-semibold text-slate-500">Road Distance:</span> {f.distanceToFmrKm} km</p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setSelectedFarmerForPath(f)}
                                  className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-800 underline block mt-1.5"
                                >
                                  Show Supply Chain Links
                                </button>
                              </div>
                            </Popup>
                          </CircleMarker>
                        );
                      })}

                      {/* Supply Chain Connection Lines */}
                      {(() => {
                        if (!selectedFarmerForPath) return null;
                        const farmLat = selectedFarmerForPath.farmLatitude || selectedFarmerForPath.gps?.lat;
                        const farmLng = selectedFarmerForPath.farmLongitude || selectedFarmerForPath.gps?.lng;
                        if (!farmLat || !farmLng) return null;

                        const connectionPoints = [];
                        connectionPoints.push([Number(farmLat), Number(farmLng)]);

                        const linkedProj = fmrProjects.find(p => p.id === selectedFarmerForPath.linkedProjectId);
                        if (linkedProj && linkedProj.start_latitude && linkedProj.start_longitude) {
                          connectionPoints.push([Number(linkedProj.start_latitude), Number(linkedProj.start_longitude)]);
                          if (linkedProj.end_latitude && linkedProj.end_longitude) {
                            connectionPoints.push([Number(linkedProj.end_latitude), Number(linkedProj.end_longitude)]);
                          }
                        }

                        const linkedMarket = markets.find(m => m.id === selectedFarmerForPath.nearestMarketId);
                        if (linkedMarket && linkedMarket.latitude && linkedMarket.longitude) {
                          connectionPoints.push([Number(linkedMarket.latitude), Number(linkedMarket.longitude)]);
                        }

                        if (connectionPoints.length < 2) return null;

                        return (
                          <Polyline
                            positions={connectionPoints}
                            pathOptions={{
                              color: '#fb7185',
                              weight: 3.5,
                              dashArray: '5, 8',
                              opacity: 0.95
                            }}
                          />
                        );
                      })()}
                    </MapContainer>
                  )}

                  <div className="absolute bottom-4 left-4 z-[500]">
                    <div className="bg-white/95 border border-slate-200 rounded-xl shadow-sm p-3 text-xs text-slate-700 space-y-2 min-w-[245px]">
                      <p className="font-semibold text-slate-900">Map Legend</p>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2"><span className="w-6 h-1.5 rounded bg-emerald-500 inline-block" /> Completed</div>
                        <div className="flex items-center gap-2"><span className="w-6 h-1.5 rounded bg-amber-500 inline-block" /> On-Going</div>
                        <div className="flex items-center gap-2"><span className="w-6 h-1.5 rounded bg-blue-500 inline-block" /> Proposed</div>
                      </div>
                      <div className="pt-2 border-t border-slate-200 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-3.5 h-3.5 rounded-full bg-emerald-50 border-2 border-emerald-700 inline-block shrink-0" />
                          <span>Barangay Geocoded</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-3.5 h-3.5 rounded-full bg-amber-50 border-2 border-dashed border-amber-600 inline-block shrink-0" />
                          <span>Centroid Fallback (No GPS)</span>
                        </div>
                      </div>
                      <label className="pt-2 border-t border-slate-200 flex items-center gap-2 text-[11px] font-medium text-slate-600">
                        <input
                          type="checkbox"
                          checked={adminMapShowHeatmap}
                          onChange={(e) => setAdminMapShowHeatmap(e.target.checked)}
                          className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                        />
                        Show Report Heatmap
                      </label>
                      <label className="pt-1.5 flex items-center gap-2 text-[11px] font-medium text-slate-600">
                        <input
                          type="checkbox"
                          checked={showFarmerDots}
                          onChange={(e) => {
                            setShowFarmerDots(e.target.checked);
                            if (!e.target.checked) setSelectedFarmerForPath(null);
                          }}
                          className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                        />
                        Show Farmers (Dots)
                      </label>
                      {showFarmerDots && (
                        <div className="pl-6 flex items-center gap-2 text-[11px] font-medium text-slate-600">
                          <span className="shrink-0">Crop:</span>
                          <select
                            value={farmerCropFilter}
                            onChange={(e) => setFarmerCropFilter(e.target.value)}
                            className="w-full rounded border-slate-300 text-[11px] py-0.5 focus:ring-teal-500 focus:border-teal-500"
                          >
                            {farmerCropOptions.map((crop) => (
                              <option key={crop} value={crop}>{crop}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <label className="pt-1.5 flex items-center gap-2 text-[11px] font-medium text-slate-600">
                        <input
                          type="checkbox"
                          checked={showFarmerHeatmap}
                          onChange={(e) => setShowFarmerHeatmap(e.target.checked)}
                          className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                        />
                        Show Farmer Density
                      </label>
                      <label className="pt-1.5 flex items-center gap-2 text-[11px] font-medium text-slate-600">
                        <input
                          type="checkbox"
                          checked={showMarketsMap}
                          onChange={(e) => setShowMarketsMap(e.target.checked)}
                          className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                        />
                        Show Markets (Icons)
                      </label>
                    </div>
                  </div>
                </div>

                {/* Selected project detail */}
                {adminMapSelectedProject && (() => {
                  const hasCoordinates = adminMapSelectedProject.start_latitude && adminMapSelectedProject.start_longitude;
                  const remarks = String(adminMapSelectedProject.remarks || '').toLowerCase();
                  const isApproximate = hasCoordinates && remarks.includes('auto-geocoded');
                  const isCentroidFallback = !hasCoordinates;

                  return (
                    <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm p-6">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
                        <div>
                          <h3 className="font-bold text-lg text-slate-900">{adminMapSelectedProject.project_name}</h3>
                          <p className="text-sm text-slate-500 mt-1">DA-RAED Region VI &middot; FMR Development Program</p>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className={`px-3 py-1.5 rounded-full text-xs font-semibold ${normalizeFmrStatus(adminMapSelectedProject.status) === 'Completed' ? 'bg-emerald-100 text-emerald-700' :
                              normalizeFmrStatus(adminMapSelectedProject.status) === 'On-Going' ? 'bg-amber-100 text-amber-700' :
                                'bg-blue-100 text-blue-700'
                            }`}>{normalizeFmrStatus(adminMapSelectedProject.status)}</span>
                          <button onClick={() => setAdminMapSelectedProject(null)} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      </div>

                      {/* Accuracy Alert Banner */}
                      {isCentroidFallback && (
                        <div className="mb-4 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-850 text-xs flex items-start gap-2">
                          <span className="text-sm">⚠️</span>
                          <div>
                            <p className="font-semibold text-amber-900">Missing Road Coordinates</p>
                            <p className="text-amber-700 mt-0.5">This project is placed at the municipal center because exact GPS coordinates are missing from the DA. You can define them below.</p>
                          </div>
                        </div>
                      )}
                      {isApproximate && (
                        <div className="mb-4 p-3 rounded-xl border border-orange-200 bg-orange-50 text-orange-850 text-xs flex items-start gap-2">
                          <span className="text-sm">📍</span>
                          <div>
                            <p className="font-semibold text-orange-950">Auto-Geocoded Barangay Center</p>
                            <p className="text-orange-700 mt-0.5">The coordinates are automatically geocoded to the center of Barangay <strong>{getProjectBarangay(adminMapSelectedProject)}</strong>. You can refine this by drawing the official route.</p>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        {adminMapSelectedProject.municipality && (
                          <div className="p-3 bg-slate-50 rounded-xl">
                            <p className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Municipality</p>
                            <p className="text-sm font-medium text-slate-800">{adminMapSelectedProject.municipality}</p>
                          </div>
                        )}
                        {adminMapSelectedProject.year_funded && (
                          <div className="p-3 bg-slate-50 rounded-xl">
                            <p className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Year Funded</p>
                            <p className="text-sm font-medium text-slate-800">FY {adminMapSelectedProject.year_funded}</p>
                          </div>
                        )}
                        {adminMapSelectedProject.project_length_km > 0 && (
                          <div className="p-3 bg-slate-50 rounded-xl">
                            <p className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Road Length</p>
                            <p className="text-sm font-medium text-slate-800">{adminMapSelectedProject.project_length_km} km</p>
                          </div>
                        )}
                        {adminMapSelectedProject.date_completed && (
                          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                            <p className="text-xs text-emerald-600 uppercase tracking-wider mb-0.5">Completed</p>
                            <p className="text-sm font-medium text-emerald-800">{adminMapSelectedProject.date_completed}</p>
                          </div>
                        )}
                        {adminMapSelectedProject.target_completion_date && (
                          <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                            <p className="text-xs text-amber-600 uppercase tracking-wider mb-0.5">Target</p>
                            <p className="text-sm font-medium text-amber-800">{adminMapSelectedProject.target_completion_date}</p>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                        {adminMapSelectedProject.start_latitude && adminMapSelectedProject.end_latitude && (
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-md font-mono">
                              START: {adminMapSelectedProject.start_latitude?.toFixed(6)}, {adminMapSelectedProject.start_longitude?.toFixed(6)}
                            </span>
                            <span>&rarr;</span>
                            <span className="px-2 py-1 bg-rose-50 text-rose-700 rounded-md font-mono">
                              END: {adminMapSelectedProject.end_latitude?.toFixed(6)}, {adminMapSelectedProject.end_longitude?.toFixed(6)}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 ml-auto">
                          <button
                            onClick={() => openFmrEditModal(adminMapSelectedProject)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-lg transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                            {isCentroidFallback ? 'Define Coordinates' : 'Edit Route'}
                          </button>
                          {adminMapSelectedProject.start_latitude && adminMapSelectedProject.end_latitude && (
                            <a href={`https://www.google.com/maps/dir/${adminMapSelectedProject.start_latitude},${adminMapSelectedProject.start_longitude}/${adminMapSelectedProject.end_latitude},${adminMapSelectedProject.end_longitude}`}
                              target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition-colors">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
                              Google Maps
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Source info */}
                {!fmrLoading && fmrProjects.length > 0 && (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-center">
                    <p className="text-xs text-slate-400">
                      Data from Department of Agriculture &mdash; RAED Region VI &middot; Farm-to-Market Road Development Program (FMRDP)
                    </p>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Farmer Beneficiaries Tab */}
          {activeTab === 'farmers' && (
            <FarmerBeneficiariesTab
              beneficiaries={farmerBeneficiaries}
              onExportCsv={exportRowsToCsv}
              loading={farmerBeneficiariesLoading}
            />
          )}

          {/* LGU Project Proposals Tab */}
          {activeTab === 'lgu-proposals' && (
            <LguProposalsTab
              proposals={lguProposals}
              fmrProjects={fmrProjects}
              loading={lguProposalsLoading}
              onValidate={validateLguProposal}
              onReject={rejectLguProposal}
              onRequestRevision={requestLguProposalRevision}
              onCreateProject={openAddProjectFromProposal}
            />
          )}

          {/* Project Management Tab */}
          {activeTab === 'project-mgmt' && (() => {
            // ── helpers ──────────────────────────────────────────────
            const pmStatusMap = {
              'Completed': { col: 'completed', label: 'Completed', color: 'emerald', line: '#10b981', bg: 'bg-emerald-500', border: 'border-l-emerald-500', pill: 'bg-emerald-100 text-emerald-700' },
              'On-Going': { col: 'ongoing', label: 'On-Going', color: 'amber', line: '#f59e0b', bg: 'bg-amber-400', border: 'border-l-amber-400', pill: 'bg-amber-100 text-amber-700' },
              'Proposed': { col: 'proposed', label: 'Proposed', color: 'blue', line: '#3b82f6', bg: 'bg-blue-500', border: 'border-l-blue-500', pill: 'bg-blue-100 text-blue-700' },
            };
            const getPmStatus = (s) => {
              const n = normalizeFmrStatus(s);
              return pmStatusMap[n] || pmStatusMap['Proposed'];
            };
            const priorityColor = { Low: 'bg-slate-100 text-slate-600', Medium: 'bg-sky-100 text-sky-700', High: 'bg-orange-100 text-orange-700', Critical: 'bg-red-100 text-red-700' };
            const fmtDateShort = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
            const relTime = (d) => {
              if (!d) return 'just now';
              const diff = Date.now() - new Date(d).getTime();
              const mins = Math.floor(diff / 60000);
              if (mins < 2) return 'just now';
              if (mins < 60) return `${mins}m ago`;
              const hrs = Math.floor(mins / 60);
              if (hrs < 24) return `${hrs}h ago`;
              return `${Math.floor(hrs / 24)}d ago`;
            };

            // ── DA-BAFE FMRDP Budget Processor ─────────────────────────
            const getDaBudgetDetails = (p) => {
              // Real total_budget if the admin has entered one, else the DA-BAFE
              // 2026 ₱15M/km indicative rate (see src/lib/budgetEstimate.js).
              const { amount: estimatedCost } = estimateProjectBudget(p);

              // Implementing Mode: locked to DA
              const isDpwh = p.id && String(p.id).charCodeAt(0) % 2 === 0;
              const mode = 'DA';

              // Prefer the real, admin-released tranches (project_tranches) once
              // they've been initialized for this project; otherwise fall back
              // to the RA-9184 estimate computed from physical progress.
              const realTranches = tranchesByProjectId[p.id] || [];
              const isReal = realTranches.length > 0;
              const tranches = (isReal ? realTranchesToScheduleShape(realTranches) : buildDisbursementTranches(estimatedCost, p))
                .map((t) => ({
                  ...t,
                  label: `${t.name} (${t.percentage}%)`,
                }));

              const {
                totalReleased,
                totalLiquidated,
                remainingToRelease,
                remainingToLiquidate,
                liquidationRate,
              } = summarizeTranches(tranches, estimatedCost);

              return {
                estimatedCost,
                mode,
                isDpwh,
                isReal,
                tranches,
                totalReleased,
                totalLiquidated,
                remainingToRelease,
                remainingToLiquidate,
                liquidationRate,
              };
            };

            // ── Unified Filtering Logic ────────────────────────────────
            const filteredFmrProjects = fmrProjects.filter(p => {
              const q = pmSearch.toLowerCase();
              const matchesSearch = !q || [
                p.project_name,
                p.municipality,
                p.barangay,
                p.location
              ].some(field => String(field || '').toLowerCase().includes(q));

              const matchesMuni = pmMunicipalityFilter === 'All' || p.municipality === pmMunicipalityFilter;

              const matchesMode = true;

              const matchesStatus = pmStatusFilter === 'All' || normalizeFmrStatus(p.status) === pmStatusFilter;

              return matchesSearch && matchesMuni && matchesMode && matchesStatus;
            });

            // ── Kanban groups from filtered list ───────────────────────
            const kanbanGroups = {
              proposed: filteredFmrProjects.filter(p => normalizeFmrStatus(p.status) === 'Proposed'),
              ongoing: filteredFmrProjects.filter(p => normalizeFmrStatus(p.status) === 'On-Going'),
              completed: filteredFmrProjects.filter(p => normalizeFmrStatus(p.status) === 'Completed'),
            };

            // ── Activity Feed: merge progressUpdates + publicReports ───
            const activityItems = [
              ...(progressUpdates || []).slice(0, 15).map(u => ({
                id: `pu-${u.id}`,
                type: 'progress',
                icon: '📈',
                text: `Progress update submitted for`,
                project: u.project_name || u.fmr_projects?.project_name || 'a project',
                detail: u.status === 'pending' ? 'Pending review' : `Status: ${u.status}`,
                time: u.created_at,
                color: 'teal',
              })),
              ...(publicReports || []).slice(0, 10).map(r => ({
                id: `pr-${r.id}`,
                type: 'report',
                icon: '📋',
                text: `Public report filed for`,
                project: r.project_name || 'a project',
                detail: r.category || r.report_type || 'General report',
                time: r.created_at,
                color: 'blue',
              })),
            ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 20);

            // ── Budget program KPIs ────────────────────────────────────
            const programGaaTotal = filteredFmrProjects.reduce((sum, p) => sum + getDaBudgetDetails(p).estimatedCost, 0);
            const programTotalReleased = filteredFmrProjects.reduce((sum, p) => sum + getDaBudgetDetails(p).totalReleased, 0);
            const programTotalLiquidated = filteredFmrProjects.reduce((sum, p) => sum + getDaBudgetDetails(p).totalLiquidated, 0);
            const programLiquidationCompliance = programTotalReleased > 0 ? (programTotalLiquidated / programTotalReleased) * 100 : 0;

            // ── Sub-tab pills ──────────────────────────────────────────
            const pmSubTabs = [
              { id: 'budget', label: 'Budget Audit', icon: (cls) => <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
              { id: 'board', label: 'Board', icon: (cls) => <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" /></svg> },
              { id: 'timeline', label: 'Timeline', icon: (cls) => <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> },
              { id: 'activity', label: 'Activity', icon: (cls) => <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> },
            ];

            return (
              <div className="space-y-6">
                {/* ── Header ─────────────────────────────────────────── */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Project Management</h2>
                    <p className="text-sm text-slate-500 mt-0.5">{filteredFmrProjects.length} filtered FMR projects · Farm-to-Market Road Program</p>
                  </div>
                  {/* KPI pills row */}
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Proposed', val: kanbanGroups.proposed.length, cls: 'bg-blue-50 text-blue-700 border-blue-200' },
                      { label: 'On-Going', val: kanbanGroups.ongoing.length, cls: 'bg-amber-50 text-amber-700 border-amber-200' },
                      { label: 'Completed', val: kanbanGroups.completed.length, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                    ].map(k => (
                      <span key={k.label} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border ${k.cls}`}>
                        <span className="font-bold text-base leading-none">{k.val}</span> {k.label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* ── Sub-tab bar ─────────────────────────────────────── */}
                <div className="flex gap-1.5 p-1 bg-slate-100 rounded-2xl w-fit">
                  {pmSubTabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => { setPmSubTab(tab.id); setPmBudgetPage(1); }}
                      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${pmSubTab === tab.id
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                      {tab.icon(`w-3.5 h-3.5 ${pmSubTab === tab.id ? 'text-teal-600' : 'text-slate-400'}`)}
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>

                {/* ── Global Filter Header ──────────────────────────── */}
                <div className="bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">Project Operations</h3>
                      <p className="text-xs text-slate-500">Unified filters for Board, Gantt Timeline, and FMRDP Auditing views</p>
                    </div>
                    {/* Mode Selector */}
                    <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
                      <button
                        disabled
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-900 shadow-sm cursor-default"
                      >
                        Implementing Agency: DA
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Search */}
                    <div className="relative">
                      <input
                        type="text"
                        value={pmSearchInput}
                        onChange={(e) => { setPmSearchInput(e.target.value); setPmBudgetPage(1); }}
                        placeholder="Search project, barangay..."
                        className="h-10 w-full pl-9 pr-8 border border-slate-200 rounded-xl text-xs text-slate-700 placeholder:text-slate-400 bg-slate-50/60 focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all shadow-sm"
                      />
                      <span className="absolute left-3 top-3 text-slate-400 text-xs">🔍</span>
                      {pmSearchInput && (
                        <button
                          onClick={() => { setPmSearchInput(''); setPmBudgetPage(1); }}
                          className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 text-xs font-semibold"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Municipality */}
                    <select
                      value={pmMunicipalityFilter}
                      onChange={(e) => { setPmMunicipalityFilter(e.target.value); setPmBudgetPage(1); }}
                      className="h-10 w-full px-3 border border-slate-200 rounded-xl text-xs text-slate-700 bg-slate-50/60 hover:bg-white focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all shadow-sm"
                    >
                      <option value="All">All Municipalities</option>
                      {getMunicipalities().map((muni) => (
                        <option key={muni} value={muni}>{muni}</option>
                      ))}
                    </select>

                    {/* Status */}
                    <select
                      value={pmStatusFilter}
                      onChange={(e) => { setPmStatusFilter(e.target.value); setPmBudgetPage(1); }}
                      className="h-10 w-full px-3 border border-slate-200 rounded-xl text-xs text-slate-700 bg-slate-50/60 hover:bg-white focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all shadow-sm"
                    >
                      <option value="All">All Statuses</option>
                      <option value="Proposed">Proposed</option>
                      <option value="On-Going">On-Going</option>
                      <option value="Completed">Completed</option>
                    </select>
                  </div>
                </div>

                {/* ════════════════════════════════════════════════════ */}
                {/* BOARD VIEW                                           */}
                {/* ════════════════════════════════════════════════════ */}
                {pmSubTab === 'board' && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    {[
                      { key: 'proposed', label: 'Proposed', dot: 'bg-blue-500', header: 'bg-blue-50 border-blue-200', count: kanbanGroups.proposed.length },
                      { key: 'ongoing', label: 'On-Going', dot: 'bg-amber-400', header: 'bg-amber-50 border-amber-200', count: kanbanGroups.ongoing.length },
                      { key: 'completed', label: 'Completed', dot: 'bg-emerald-500', header: 'bg-emerald-50 border-emerald-200', count: kanbanGroups.completed.length },
                    ].map(col => {
                      const projects = kanbanGroups[col.key];
                      return (
                        <div key={col.key} className="flex flex-col bg-slate-50/70 rounded-2xl border border-slate-200/80 overflow-hidden">
                          {/* Column header */}
                          <div className={`flex items-center justify-between px-4 py-3 border-b ${col.header}`}>
                            <div className="flex items-center gap-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${col.dot}`} />
                              <span className="text-sm font-bold text-slate-800">{col.label}</span>
                            </div>
                            <span className="min-w-[22px] h-5.5 px-1.5 flex items-center justify-center rounded-full text-[11px] font-black bg-white border border-slate-200 text-slate-600 shadow-sm" style={{ height: '22px' }}>
                              {col.count}
                            </span>
                          </div>
                          {/* Cards */}
                          <div className="flex-1 overflow-y-auto max-h-[520px] p-3 space-y-2.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                            {projects.length === 0 ? (
                              <div className="py-10 text-center text-xs text-slate-400 font-medium">No projects here</div>
                            ) : projects.map(p => {
                              const st = getPmStatus(p.status);
                              const progress = Number(p.accomplishment || 0);
                              const targetChip = getTargetDateChip(p.target_completion_date, normalizeFmrStatus(p.status) === 'Completed');
                              const budget = getDaBudgetDetails(p);
                              return (
                                <div
                                  key={p.id}
                                  onClick={() => openProjectDetailModal(p)}
                                  className={`bg-white rounded-xl border-l-4 ${st.border} border border-slate-200/70 p-3.5 cursor-pointer hover:shadow-md hover:border-slate-300 transition-[box-shadow,border-color] duration-200 group`}
                                >
                                  <p className="text-[13px] font-semibold text-slate-900 leading-snug line-clamp-2 group-hover:text-teal-700 transition-colors">{p.project_name}</p>
                                  <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                    {p.municipality || 'Iloilo'}{p.barangay ? `, ${p.barangay}` : ''}
                                  </p>
                                  {/* Progress bar */}
                                  <div className="mt-3">
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                      <span>Progress</span>
                                      <span className="font-semibold text-slate-600">{progress.toFixed(0)}%</span>
                                    </div>
                                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                      <div className={`h-1.5 rounded-full ${st.bg} transition-all duration-500`} style={{ width: `${Math.min(progress, 100)}%` }} />
                                    </div>
                                  </div>
                                  {/* Footer badges */}
                                  <div className="flex flex-wrap items-center gap-1.5 mt-3">
                                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold border bg-teal-50 text-teal-700 border-teal-200">
                                      DA
                                    </span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-800 border border-slate-200">
                                      {formatPeso(budget.estimatedCost)}
                                    </span>
                                    {p.project_length_km > 0 && (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">
                                        {p.project_length_km} km
                                      </span>
                                    )}
                                    {targetChip && (
                                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${targetChip.className}`}>
                                        {targetChip.text}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ════════════════════════════════════════════════════ */}
                {/* PROJECT SCHEDULING (Calendar / Gantt / Table)         */}
                {/* ════════════════════════════════════════════════════ */}
                {pmSubTab === 'timeline' && (
                  <ProjectSchedulingTab
                    fmrProjects={filteredFmrProjects}
                    contractors={contractors}
                    progressUpdates={progressUpdates}
                    showNotification={showNotification}
                  />
                )}

                {/* ════════════════════════════════════════════════════ */}
                {/* BUDGET AUDIT VIEW                                    */}
                {/* ════════════════════════════════════════════════════ */}
                {pmSubTab === 'budget' && (() => {
                  const budgetAuditPageSize = 6;
                  const totalAuditPages = Math.ceil(filteredFmrProjects.length / budgetAuditPageSize);
                  const safeAuditPage = Math.max(1, Math.min(pmBudgetPage, totalAuditPages));
                  const paginatedAuditProjects = filteredFmrProjects.slice(
                    (safeAuditPage - 1) * budgetAuditPageSize,
                    safeAuditPage * budgetAuditPageSize
                  );
                  return (
                    <div className="space-y-6">
                      {/* Official Scorecard */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total FMRDP Allocation</p>
                          <p className="text-2xl font-bold text-slate-900 mt-2">{formatPeso(programGaaTotal)}</p>
                          <p className="text-[11px] text-slate-500 mt-1">Based on dynamic standard unit cost</p>
                        </div>
                        <div className="bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Downloaded / Released</p>
                          <p className="text-2xl font-bold text-slate-900 mt-2">{formatPeso(programTotalReleased)}</p>
                          <p className="text-[11px] text-slate-500 mt-1">Funds transferred to executing agency</p>
                        </div>
                        <div className="bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Liquidated (COA Audited)</p>
                          <p className="text-2xl font-bold text-slate-900 mt-2">{formatPeso(programTotalLiquidated)}</p>
                          <p className="text-[11px] text-slate-500 mt-1">Cleared expenditures</p>
                        </div>
                        <div className="bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Liquidation Compliance</p>
                          <div className="flex items-center justify-between mt-2">
                            <p className="text-2xl font-bold text-slate-900">{programLiquidationCompliance.toFixed(1)}%</p>
                            <span className={`text-[9px] px-2 py-0.5 rounded font-black border ${programLiquidationCompliance >= 80
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-250'
                                : programLiquidationCompliance >= 40
                                  ? 'bg-amber-50 text-amber-700 border-amber-250'
                                  : 'bg-red-50 text-red-700 border-red-250'
                              }`}>
                              {programLiquidationCompliance >= 80 ? 'HIGH COMPLIANCE' : programLiquidationCompliance >= 40 ? 'ONGOING AUDIT' : 'CRITICAL PEN'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
                        {/* Projects budget audit table */}
                        <div className="xl:col-span-3 bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden flex flex-col justify-between">
                          <div>
                            <div className="px-6 py-5 border-b border-slate-100">
                              <h3 className="text-base font-bold text-slate-900">FMRDP Allocation Ledger</h3>
                              <p className="text-xs text-slate-500 mt-0.5">Select a road project to view its DA-BAFE milestone release schedule</p>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-xs text-slate-600">
                                <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                                  <tr>
                                    <th className="py-3 px-4 pl-6">Project details</th>
                                    <th className="py-3 px-4">Implementing Agency</th>
                                    <th className="py-3 px-4">Est. Cost</th>
                                    <th className="py-3 px-4">Released</th>
                                    <th className="py-3 px-4">Liquidated</th>
                                    <th className="py-3 px-4 pr-6">Auditing Status</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {paginatedAuditProjects.length === 0 ? (
                                    <tr>
                                      <td colSpan={6} className="py-12 text-center text-slate-400 font-medium">No projects match the selected filters</td>
                                    </tr>
                                  ) : paginatedAuditProjects.map(p => {
                                    const budget = getDaBudgetDetails(p);
                                    const isSelected = selectedFmrPmProject && selectedFmrPmProject.id === p.id;

                                    // Auditing status pill
                                    let auditPill = { text: 'Fully Audited', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
                                    if (budget.liquidationRate < 100) {
                                      auditPill = budget.liquidationRate > 0
                                        ? { text: 'Auditing Out', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
                                        : { text: 'Pending Audit', cls: 'bg-red-50 text-red-700 border-red-200' };
                                    }

                                    return (
                                      <tr
                                        key={p.id}
                                        onClick={() => setSelectedFmrPmProject(p)}
                                        className={`cursor-pointer hover:bg-slate-50/50 transition-colors ${isSelected ? 'bg-teal-50/40 hover:bg-teal-50/60' : ''}`}
                                      >
                                        <td className="py-3 px-4 pl-6">
                                          <p className="font-semibold text-slate-900 line-clamp-1">{p.project_name}</p>
                                          <p className="text-[10px] text-slate-400 font-medium">{p.municipality} · {p.project_length_km || 1.5} km</p>
                                        </td>
                                        <td className="py-3 px-4">
                                          <span className="inline-flex px-2 py-0.5 rounded-full font-semibold text-[10px] bg-teal-50 text-teal-700 border border-teal-150">
                                            DA
                                          </span>
                                        </td>
                                        <td className="py-3 px-4 font-semibold text-slate-800">{formatPeso(budget.estimatedCost)}</td>
                                        <td className="py-3 px-4 text-slate-600">{formatPeso(budget.totalReleased)}</td>
                                        <td className="py-3 px-4 text-slate-600">{formatPeso(budget.totalLiquidated)}</td>
                                        <td className="py-3 px-4 pr-6">
                                          <span className={`inline-flex px-2 py-0.5 rounded-full font-semibold border text-[9px] ${auditPill.cls}`}>
                                            {auditPill.text}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          {/* Pagination Footer */}
                          {totalAuditPages > 1 && (
                            <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px]">
                              <p className="text-slate-500">
                                Showing <span className="font-semibold text-slate-700">{(safeAuditPage - 1) * budgetAuditPageSize + 1}</span> to{' '}
                                <span className="font-semibold text-slate-700">{Math.min(safeAuditPage * budgetAuditPageSize, filteredFmrProjects.length)}</span> of{' '}
                                <span className="font-semibold text-slate-700">{filteredFmrProjects.length}</span> projects
                              </p>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => setPmBudgetPage((p) => Math.max(1, p - 1))}
                                  disabled={safeAuditPage === 1}
                                  className="px-2.5 py-1 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all font-semibold text-slate-650 shadow-sm"
                                >
                                  Prev
                                </button>
                                {Array.from({ length: totalAuditPages }, (_, i) => i + 1).map((page) => (
                                  <button
                                    key={page}
                                    onClick={() => setPmBudgetPage(page)}
                                    className={`min-w-[24px] h-6 rounded-lg text-[10px] font-semibold border transition-all ${safeAuditPage === page
                                        ? 'bg-teal-600 border-teal-600 text-white shadow-sm'
                                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                      }`}
                                  >
                                    {page}
                                  </button>
                                ))}
                                <button
                                  onClick={() => setPmBudgetPage((p) => Math.min(totalAuditPages, p + 1))}
                                  disabled={safeAuditPage === totalAuditPages}
                                  className="px-2.5 py-1 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all font-semibold text-slate-650 shadow-sm"
                                >
                                  Next
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Detailed Side Panel */}
                        <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6 flex flex-col justify-start min-h-[400px]">
                          {!selectedFmrPmProject ? (
                            <div className="h-full flex flex-col items-center justify-center py-20 text-center text-slate-400 my-auto">
                              <svg className="w-12 h-12 text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              <h4 className="text-sm font-bold text-slate-800">No FMR Project Selected</h4>
                              <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">Select any road project from the ledger to audit its DA-BAFE milestone release schedule and COA liquidation records</p>
                            </div>
                          ) : (() => {
                            const p = selectedFmrPmProject;
                            const budget = getDaBudgetDetails(p);
                            const progress = Number(p.accomplishment || 0);

                            return (
                              <div className="space-y-6">
                                <div>
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0 flex-1">
                                      <h3 className="text-sm font-extrabold text-slate-900 leading-snug break-words">{p.project_name}</h3>
                                      <p className="text-[10px] text-slate-400 mt-0.5">{p.municipality} · {p.barangay ? `${p.barangay}, ` : ''}FMR</p>
                                    </div>
                                    <button
                                      onClick={() => setSelectedFmrPmProject(null)}
                                      className="text-slate-400 hover:text-slate-650 font-bold text-xs p-1 hover:bg-slate-100 rounded transition-all flex-shrink-0"
                                    >
                                      ✕
                                    </button>
                                  </div>

                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold border bg-teal-50 text-teal-700 border-teal-200">
                                      DA
                                    </span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600 border border-slate-200">
                                      {p.project_length_km || 1.5} km
                                    </span>
                                  </div>
                                </div>

                                {/* Progress Indicator */}
                                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                  <div className="flex justify-between text-xs text-slate-600 mb-1">
                                    <span className="font-semibold">Physical Accomplishment</span>
                                    <span className="font-bold text-teal-600">{progress.toFixed(0)}%</span>
                                  </div>
                                  <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                    <div className="h-full bg-teal-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
                                  </div>
                                </div>

                                {/* Tranches Flow */}
                                <div className="space-y-4">
                                  <div className="flex items-center justify-between">
                                    <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">DA FMRDP Release Lifecycle</h4>
                                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${budget.isReal ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                                      }`}>
                                      {budget.isReal ? 'OFFICIAL RECORD' : 'ESTIMATE ONLY'}
                                    </span>
                                  </div>
                                  <ProjectTrancheTimeline
                                    project={p}
                                    tranches={tranchesByProjectId[p.id] || []}
                                    canManage
                                    onInitialize={handleInitializeTranches}
                                    onRelease={handleReleaseTranche}
                                  />
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* ════════════════════════════════════════════════════ */}
                {/* ACTIVITY FEED                                        */}
                {/* ════════════════════════════════════════════════════ */}
                {pmSubTab === 'activity' && (
                  <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    {/* Activity log */}
                    <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
                      <div className="px-6 py-5 border-b border-slate-100">
                        <h3 className="text-lg font-bold text-slate-900">Recent Activity</h3>
                        <p className="text-sm text-slate-500 mt-0.5">Live project updates and reports</p>
                      </div>
                      <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                        {activityItems.length === 0 ? (
                          <div className="py-16 text-center text-slate-400 text-sm">No recent activity found</div>
                        ) : activityItems.map((item) => (
                          <div key={item.id} className="flex items-start gap-4 px-6 py-4 hover:bg-slate-50/60 transition-colors">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${item.type === 'progress' ? 'bg-teal-50 text-teal-600' : 'bg-blue-50 text-blue-600'
                              }`}>
                              {item.type === 'progress' ? (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                              ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] text-slate-700">
                                <span>{item.text} </span>
                                <span className="font-semibold text-slate-900">{item.project}</span>
                              </p>
                              <p className="text-[11px] text-slate-400 mt-0.5">{item.detail}</p>
                            </div>
                            <span className="text-[11px] text-slate-400 flex-shrink-0 mt-0.5">{relTime(item.time)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Side stats */}
                    <div className="space-y-5">
                      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5">
                        <h4 className="text-sm font-bold text-slate-900 mb-4">Project Health</h4>
                        <div className="space-y-3">
                          {[
                            { label: 'Completed', val: kanbanGroups.completed.length, total: filteredFmrProjects.length, color: 'bg-emerald-500' },
                            { label: 'On-Going', val: kanbanGroups.ongoing.length, total: filteredFmrProjects.length, color: 'bg-amber-400' },
                            { label: 'Proposed', val: kanbanGroups.proposed.length, total: filteredFmrProjects.length, color: 'bg-blue-500' },
                          ].map(item => {
                            const pct = filteredFmrProjects.length > 0 ? Math.round((item.val / filteredFmrProjects.length) * 100) : 0;
                            return (
                              <div key={item.label}>
                                <div className="flex justify-between text-xs mb-1.5">
                                  <span className="text-slate-600 font-medium">{item.label}</span>
                                  <span className="text-slate-500">{item.val} <span className="text-slate-300">/ {filteredFmrProjects.length}</span></span>
                                </div>
                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                  <div className={`h-2 rounded-full ${item.color} transition-all duration-700`} style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5">
                        <h4 className="text-sm font-bold text-slate-900 mb-4">Activity Summary</h4>
                        <div className="space-y-3">
                          {[
                            { icon: '📈', label: 'Progress Updates', val: (progressUpdates || []).length, color: 'text-teal-600' },
                            { icon: '📋', label: 'Public Reports', val: (publicReports || []).length, color: 'text-blue-600' },
                            { icon: '⚠️', label: 'Pending Reviews', val: (progressUpdates || []).filter(u => u.status === 'pending').length, color: 'text-amber-600' },
                          ].map(s => (
                            <div key={s.label} className="flex items-center justify-between">
                              <div className="flex items-center gap-2.5">
                                <span className="text-base">{s.icon}</span>
                                <span className="text-xs text-slate-600">{s.label}</span>
                              </div>
                              <span className={`text-sm font-bold ${s.color}`}>{s.val}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="bg-gradient-to-br from-teal-600 to-teal-500 rounded-2xl p-5 text-white">
                        <p className="text-xs font-semibold opacity-80 uppercase tracking-wider">Avg Completion</p>
                        <p className="text-3xl font-black mt-1">
                          {filteredFmrProjects.length > 0
                            ? `${Math.round(filteredFmrProjects.reduce((s, p) => s + Number(p.accomplishment || 0), 0) / filteredFmrProjects.length)}%`
                            : '—'}
                        </p>
                        <p className="text-xs opacity-70 mt-1">Across all {filteredFmrProjects.length} filtered projects</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Analytics Tab */}
          {activeTab === 'analytics' && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className={enterpriseCardClass}>
                <h3 className="text-lg font-bold text-slate-900">Projects by Municipality</h3>
                <p className="text-sm text-slate-500 mb-4">Top municipalities by number of projects</p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analyticsProjectsByMunicipality} margin={{ top: 8, right: 8, left: -12, bottom: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="municipality" tick={{ fill: '#64748b', fontSize: 11 }} angle={-20} textAnchor="end" height={50} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                      <RechartsTooltip />
                      <Bar dataKey="count" fill="#0d9488" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className={enterpriseCardClass}>
                <h3 className="text-lg font-bold text-slate-900">Project Status Distribution</h3>
                <p className="text-sm text-slate-500 mb-4">Overall breakdown by current status</p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={analyticsStatusDistribution} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
                        {analyticsStatusDistribution.map((entry, index) => {
                          const palette = ['#0f766e', '#0ea5e9', '#f59e0b', '#22c55e', '#a855f7', '#ef4444'];
                          return <Cell key={`status-cell-${entry.name}`} fill={palette[index % palette.length]} />;
                        })}
                      </Pie>
                      <Legend verticalAlign="bottom" height={36} />
                      <RechartsTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className={enterpriseCardClass}>
                <h3 className="text-lg font-bold text-slate-900">Projects Created Per Month</h3>
                <p className="text-sm text-slate-500 mb-4">Monthly trend of project records</p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={analyticsProjectsPerMonth} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" tickFormatter={formatMonthKey} tick={{ fill: '#64748b', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
                      <RechartsTooltip labelFormatter={formatMonthKey} />
                      <Line dataKey="projects" stroke="#0d9488" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className={enterpriseCardClass}>
                <h3 className="text-lg font-bold text-slate-900">Budget vs Disbursed Over Time</h3>
                <p className="text-sm text-slate-500 mb-4">Monthly totals for allocation and disbursement</p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analyticsBudgetDisbursedOverTime} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
                      <defs>
                        <linearGradient id="budgetGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0f172a" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#0f172a" stopOpacity={0.04} />
                        </linearGradient>
                        <linearGradient id="disbursedGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0d9488" stopOpacity={0.45} />
                          <stop offset="95%" stopColor="#0d9488" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" tickFormatter={formatMonthKey} tick={{ fill: '#64748b', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(v) => `₱${Math.round(v / 1000000)}M`} />
                      <RechartsTooltip labelFormatter={formatMonthKey} formatter={(v) => formatCurrency(Number(v || 0))} />
                      <Area type="monotone" dataKey="budget" stroke="#0f172a" fill="url(#budgetGradient)" strokeWidth={2} />
                      <Area type="monotone" dataKey="disbursed" stroke="#0d9488" fill="url(#disbursedGradient)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Priorities Tab */}
          {activeTab === 'priorities' && (
            <PriorityTab
              projects={fmrProjects}
              reports={publicReports}
              escalations={escalations}
              onViewReports={(project) => {
                openProjectFeedbackModal({
                  projectName: project.project_name,
                  barangay: project.barangay,
                  municipality: project.municipality,
                  id: project.id,
                });
              }}
              onViewProjectDetail={(project) => {
                openProjectDetailModal(project);
              }}
            />
          )}

          {/* Reports Tab */}
          {activeTab === 'reports' && (() => {
            const fmtDateShort = (d) => d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
            const today = new Date(); today.setHours(0, 0, 0, 0);

            const reportsYearOptions = [...new Set((fmrProjects || [])
              .map((p) => Number(p.year_funded))
              .filter((y) => y && !Number.isNaN(y)))]
              .sort((a, b) => b - a);

            const reportsMunicipalityOptions = [...new Set((fmrProjects || [])
              .map((p) => p.municipality)
              .filter(Boolean))].sort((a, b) => a.localeCompare(b));

            const filterReportList = (list) => {
              const q = reportsSearch.trim().toLowerCase();
              const filtered = (list || []).filter((p) => {
                if (q) {
                  const hay = `${p.project_name || ''} ${p.location || ''} ${p.municipality || ''}`.toLowerCase();
                  if (!hay.includes(q)) return false;
                }
                if (reportsYearFilter !== 'All' && String(p.year_funded || '') !== String(reportsYearFilter)) return false;
                if (reportsMunicipalityFilter !== 'All' && String(p.municipality || '') !== String(reportsMunicipalityFilter)) return false;

                const dateValue = p.target_completion_date || p.date_completed || p.created_at || p.updated_at;
                if ((reportsDateFrom || reportsDateTo) && !inDateRange(dateValue, reportsDateFrom, reportsDateTo)) return false;
                return true;
              });

              const getSortDate = (p) => {
                const dt = parseDateOnly(p.target_completion_date || p.date_completed || p.created_at || p.updated_at);
                return dt ? dt.getTime() : 0;
              };

              return filtered.sort((a, b) => {
                if (reportsSortBy === 'latest') return getSortDate(b) - getSortDate(a);
                if (reportsSortBy === 'name-asc') return String(a.project_name || '').localeCompare(String(b.project_name || ''));
                if (reportsSortBy === 'name-desc') return String(b.project_name || '').localeCompare(String(a.project_name || ''));
                if (reportsSortBy === 'progress-desc') return Number(b.accomplishment || 0) - Number(a.accomplishment || 0);
                if (reportsSortBy === 'progress-asc') return Number(a.accomplishment || 0) - Number(b.accomplishment || 0);
                return 0;
              });
            };

            const sectionMeta = {
              completed: {
                key: 'completed',
                title: 'Completed Projects',
                emptyMsg: 'No completed projects yet.',
                colorStyles: { gradient: 'from-emerald-50', iconBg: 'bg-emerald-100', iconText: 'text-emerald-600' },
                list: filterReportList(classifiedFmrProjects.completedProjects),
              },
              delayed: {
                key: 'delayed',
                title: 'Overdue Projects',
                emptyMsg: 'No overdue projects - all on schedule!',
                colorStyles: { gradient: 'from-red-50', iconBg: 'bg-red-100', iconText: 'text-red-600' },
                list: filterReportList(classifiedFmrProjects.delayedProjects),
              },
              ongoing: {
                key: 'ongoing',
                title: 'Ongoing Projects',
                emptyMsg: 'No ongoing projects.',
                colorStyles: { gradient: 'from-blue-50', iconBg: 'bg-blue-100', iconText: 'text-blue-600' },
                list: filterReportList(classifiedFmrProjects.ongoingProjects),
              },
              pending: {
                key: 'pending',
                title: 'Pending Projects',
                emptyMsg: 'No pending projects.',
                colorStyles: { gradient: 'from-slate-50', iconBg: 'bg-slate-100', iconText: 'text-slate-600' },
                list: filterReportList(classifiedFmrProjects.pendingProjects),
              },
            };

            const sectionKeys = ['ongoing', 'pending', 'completed', 'delayed'];

            const renderProjectTable = (section) => {
              const { key, title, list, colorStyles, emptyMsg } = section;
              const totalPages = Math.max(1, Math.ceil(list.length / reportsPerSectionPage));
              const currentPage = Math.min(reportsPageBySection[key] || 1, totalPages);
              const start = (currentPage - 1) * reportsPerSectionPage;
              const pagedList = list.slice(start, start + reportsPerSectionPage);

              return (
                <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
                  <div className={`px-6 sm:px-8 py-5 border-b border-slate-200/60 bg-gradient-to-r ${colorStyles.gradient} to-white flex items-center justify-between`}>
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center justify-center w-9 h-9 rounded-xl ${colorStyles.iconBg} ${colorStyles.iconText}`}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </span>
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
                        <p className="text-sm text-slate-500">{list.length} project{list.length !== 1 ? 's' : ''} total</p>
                      </div>
                    </div>
                  </div>
                  {list.length === 0 ? (
                    <EmptyState title="No records" description={emptyMsg} />
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[700px]">
                          <thead>
                            <tr className="bg-slate-50/50">
                              <th className="px-6 py-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Project</th>
                              <th className="px-6 py-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Location</th>
                              <th className="px-6 py-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Year Funded</th>
                              <th className="px-6 py-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Target Completion</th>
                              <th className="px-6 py-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                              <th className="px-6 py-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Accomplishment</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {pagedList.map((p) => {
                              const status = normalizeFmrStatus(p.status);
                              const accomplishment = Number(p.accomplishment || 0);
                              const isCompleted = status === 'Completed' || accomplishment >= 100 || Boolean(p.date_completed);
                              const isOverdue = !isCompleted && isPastDate(p.target_completion_date, today);
                              return (
                                <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="px-6 py-4">
                                    <p className="font-semibold text-sm text-slate-900">{p.project_name}</p>
                                    <p className="text-xs text-slate-400 font-mono mt-0.5">{p.id ? `ID-${p.id}` : 'FMR'}</p>
                                  </td>
                                  <td className="px-6 py-4 text-sm text-slate-700">{p.location || `${p.municipality || 'N/A'}, ${p.province || 'Iloilo'}`}</td>
                                  <td className="px-6 py-4 text-sm text-slate-600">{p.year_funded || '—'}</td>
                                  <td className="px-6 py-4">
                                    <span className={`text-sm ${isOverdue ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>{fmtDateShort(p.target_completion_date)}</span>
                                    {isOverdue && <p className="text-[11px] text-red-500 mt-0.5">Overdue</p>}
                                  </td>
                                  <td className="px-6 py-4">
                                    {renderStatusPill(status)}
                                  </td>
                                  <td className="px-6 py-4">
                                    <div className="flex items-center gap-2">
                                      <div className="w-20 bg-slate-100 rounded-full h-2 overflow-hidden">
                                        <div className={`h-2 rounded-full ${(p.accomplishment || 0) >= 100 ? 'bg-emerald-500' : 'bg-teal-500'}`} style={{ width: `${Math.min(p.accomplishment || 0, 100)}%` }} />
                                      </div>
                                      <span className="text-xs font-bold text-slate-700">{p.accomplishment || 0}%</span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="px-6 sm:px-8 py-4 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <p className="text-xs sm:text-sm text-slate-500">
                          Showing <span className="font-bold text-slate-700">{start + 1}</span> to{' '}
                          <span className="font-bold text-slate-700">{Math.min(start + reportsPerSectionPage, list.length)}</span> of{' '}
                          <span className="font-bold text-slate-700">{list.length}</span>
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setReportsPageBySection((prev) => ({ ...prev, [key]: Math.max(1, currentPage - 1) }))}
                            disabled={currentPage === 1}
                            className="px-3.5 py-2 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium hover:bg-white hover:border-slate-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Previous
                          </button>
                          <span className="text-xs sm:text-sm font-semibold text-slate-600 min-w-[78px] text-center">Page {currentPage} / {totalPages}</span>
                          <button
                            onClick={() => setReportsPageBySection((prev) => ({ ...prev, [key]: Math.min(totalPages, currentPage + 1) }))}
                            disabled={currentPage === totalPages}
                            className="px-3.5 py-2 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium hover:bg-white hover:border-slate-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            };

            return (
              <div className="space-y-8">
                {/* Summary stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                  <div className="bg-blue-50 border border-blue-200/60 rounded-2xl p-6">
                    <p className="text-3xl font-bold text-blue-700">{classifiedFmrProjects.ongoingProjects.length}</p>
                    <p className="text-sm text-blue-600 mt-1 font-medium">Ongoing Projects</p>
                  </div>
                  <div className="bg-red-50 border border-red-200/60 rounded-2xl p-6">
                    <p className="text-3xl font-bold text-red-700">{classifiedFmrProjects.delayedProjects.length}</p>
                    <p className="text-sm text-red-600 mt-1 font-medium">Delayed Projects</p>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200/60 rounded-2xl p-6">
                    <p className="text-3xl font-bold text-emerald-700">{classifiedFmrProjects.completedProjects.length}</p>
                    <p className="text-sm text-emerald-600 mt-1 font-medium">Completed Projects</p>
                  </div>
                </div>

                <div className="bg-white border border-slate-200/60 rounded-2xl p-4 sm:p-5 shadow-sm">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-3 lg:gap-4 items-end">
                    <div className="relative md:col-span-2 xl:col-span-4">
                      <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                      </svg>
                      <input
                        type="text"
                        value={reportsSearch}
                        onChange={(e) => setReportsSearch(e.target.value)}
                        placeholder="Search by name, municipality, location..."
                        className="h-12 w-full pl-11 pr-4 border border-slate-200 rounded-2xl text-sm text-slate-700 placeholder:text-slate-400 bg-slate-50/60 hover:bg-white focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none shadow-sm transition-all"
                      />
                    </div>
                    <select
                      value={reportsYearFilter}
                      onChange={(e) => setReportsYearFilter(e.target.value)}
                      className="h-12 w-full px-4 border border-slate-200 rounded-2xl text-sm text-slate-700 bg-slate-50/60 hover:bg-white focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none shadow-sm xl:col-span-2"
                    >
                      <option value="All">All Years</option>
                      {reportsYearOptions.map((y) => (
                        <option key={y} value={String(y)}>FY {y}</option>
                      ))}
                    </select>
                    <select
                      value={reportsMunicipalityFilter}
                      onChange={(e) => setReportsMunicipalityFilter(e.target.value)}
                      className="h-12 w-full px-4 border border-slate-200 rounded-2xl text-sm text-slate-700 bg-slate-50/60 hover:bg-white focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none shadow-sm xl:col-span-2"
                    >
                      <option value="All">All Municipalities</option>
                      {reportsMunicipalityOptions.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <select
                      value={reportsSortBy}
                      onChange={(e) => setReportsSortBy(e.target.value)}
                      className="h-12 w-full px-4 border border-slate-200 rounded-2xl text-sm text-slate-700 bg-slate-50/60 hover:bg-white focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none shadow-sm xl:col-span-2"
                    >
                      <option value="latest">Sort: Latest</option>
                      <option value="name-asc">Sort: Name A-Z</option>
                      <option value="name-desc">Sort: Name Z-A</option>
                      <option value="progress-desc">Sort: Progress High-Low</option>
                      <option value="progress-asc">Sort: Progress Low-High</option>
                    </select>
                    <div className="w-full xl:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Start Date</label>
                      <input
                        type="date"
                        value={reportsDateFrom}
                        onChange={(e) => setReportsDateFrom(e.target.value)}
                        max={reportsDateTo || undefined}
                        aria-label="Start date"
                        title="Start date"
                        className="h-12 w-full px-4 border border-slate-200 rounded-2xl text-sm text-slate-700 bg-slate-50/60 hover:bg-white focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none shadow-sm"
                      />
                    </div>
                    <div className="w-full xl:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">End Date</label>
                      <input
                        type="date"
                        value={reportsDateTo}
                        onChange={(e) => setReportsDateTo(e.target.value)}
                        min={reportsDateFrom || undefined}
                        aria-label="End date"
                        title="End date"
                        className="h-12 w-full px-4 border border-slate-200 rounded-2xl text-sm text-slate-700 bg-slate-50/60 hover:bg-white focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
                    <div className="inline-flex w-fit max-w-full lg:col-span-8 items-center rounded-2xl border border-slate-200 bg-slate-100/80 p-1 shadow-sm">
                      {sectionKeys.map((key) => {
                        const section = sectionMeta[key];
                        const isActive = reportsSectionFilter === key;
                        return (
                          <button
                            key={key}
                            onClick={() => {
                              setReportsSectionFilter(key);
                              setReportsPageBySection((prev) => ({ ...prev, [key]: 1 }));
                            }}
                            className={`flex-1 lg:flex-none min-w-[112px] px-4 h-10 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${isActive
                                ? 'bg-white text-emerald-700 shadow-sm border border-emerald-100'
                                : 'text-slate-600 hover:text-slate-800'
                              }`}
                          >
                            {section.title} ({section.list.length})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {renderProjectTable(sectionMeta[reportsSectionFilter])}
              </div>
            );
          })()}

          {/* Public Reports Tab */}
          {activeTab === 'public-reports' && (() => {
            // Derive unique streets from reports for the street filter
            const allMunicipalities = [...new Set(publicReports.map(r => r.municipality).filter(Boolean))].sort();
            const filteredBarangayOptions = publicReportMunicipalityFilter !== 'all'
              ? [...new Set(publicReports.filter(r => r.municipality === publicReportMunicipalityFilter).map(r => r.barangay).filter(Boolean))].sort()
              : [...new Set(publicReports.map(r => r.barangay).filter(Boolean))].sort();
            const filteredStreetOptions = (() => {
              let pool = publicReports;
              if (publicReportMunicipalityFilter !== 'all') pool = pool.filter(r => r.municipality === publicReportMunicipalityFilter);
              if (publicReportBarangayFilter !== 'all') pool = pool.filter(r => r.barangay === publicReportBarangayFilter);
              return [...new Set(pool.map(r => r.street).filter(Boolean))].sort();
            })();

            const filteredPublicReports = publicReports.filter(rpt => {
              const matchesStatus = rpt.status === publicReportFilter;
              const matchesVerification = publicReportCategoryFilter === 'all' || rpt.verification === publicReportCategoryFilter;
              const matchesAssigned = publicReportAssignedFilter === 'all' ||
                (publicReportAssignedFilter === 'unassigned' && !rpt.assigned_engineer_id) ||
                (publicReportAssignedFilter === 'assigned' && rpt.assigned_engineer_id);
              const matchesDate = inDateRange(rpt.created_at, publicReportDateFrom, publicReportDateTo);
              const matchesMunicipality = publicReportMunicipalityFilter === 'all' || rpt.municipality === publicReportMunicipalityFilter;
              const matchesBarangay = publicReportBarangayFilter === 'all' || rpt.barangay === publicReportBarangayFilter;
              const matchesStreet = publicReportStreetFilter === 'all' || (rpt.street || '') === publicReportStreetFilter;
              const normalizedProject = (rpt.project_name || 'Unlinked Project').trim();
              const matchesProject = !publicReportProjectFilter || normalizedProject === publicReportProjectFilter;
              const q = publicReportSearch.toLowerCase();
              const matchesSearch = !q ||
                (rpt.full_name || '').toLowerCase().includes(q) ||
                (rpt.municipality || '').toLowerCase().includes(q) ||
                (rpt.barangay || '').toLowerCase().includes(q) ||
                (rpt.street || '').toLowerCase().includes(q) ||
                (rpt.project_name || '').toLowerCase().includes(q) ||
                (rpt.description || '').toLowerCase().includes(q);
              return matchesStatus && matchesVerification && matchesAssigned && matchesDate && matchesMunicipality && matchesBarangay && matchesStreet && matchesProject && matchesSearch;
            });
            const sortedFilteredPublicReports = [...filteredPublicReports].sort((a, b) => {
              const aTime = new Date(a.updated_at || a.created_at || 0).getTime() || 0;
              const bTime = new Date(b.updated_at || b.created_at || 0).getTime() || 0;
              return bTime - aTime;
            });
            const pendingCount = publicReports.filter(r => r.status === 'pending').length;
            const reviewedCount = publicReports.filter(r => r.status === 'reviewed').length;
            const resolvedCount = publicReports.filter(r => r.status === 'resolved').length;
            const verifiedCount = publicReports.filter(r => r.verification === 'Verified On-Site').length;

            const startOfDay = (value) => {
              const d = new Date(value);
              if (Number.isNaN(d.getTime())) return null;
              d.setHours(0, 0, 0, 0);
              return d;
            };

            const formatDateInput = (dateObj) => {
              const y = dateObj.getFullYear();
              const m = String(dateObj.getMonth() + 1).padStart(2, '0');
              const d = String(dateObj.getDate()).padStart(2, '0');
              return `${y}-${m}-${d}`;
            };

            const getResolutionDays = (report) => {
              if (report.status !== 'resolved') return null;
              const created = new Date(report.created_at || 0);
              const resolved = new Date(report.reviewed_at || report.updated_at || 0);
              if (Number.isNaN(created.getTime()) || Number.isNaN(resolved.getTime())) return null;
              const diff = (resolved.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
              return diff >= 0 ? diff : null;
            };

            const topProjectMap = publicReports.reduce((acc, report) => {
              const key = (report.project_name || 'Unlinked Project').trim();
              if (!acc[key]) {
                acc[key] = { project_name: key, count: 0, pending: 0, reviewed: 0, resolved: 0 };
              }
              acc[key].count += 1;
              if (report.status === 'pending') acc[key].pending += 1;
              if (report.status === 'reviewed') acc[key].reviewed += 1;
              if (report.status === 'resolved') acc[key].resolved += 1;
              return acc;
            }, {});

            const truncateProjectName = (name) => (name.length > 28 ? `${name.slice(0, 28)}...` : name);
            const topProjectsData = Object.values(topProjectMap)
              .sort((a, b) => b.count - a.count)
              .slice(0, 10)
              .map((item) => {
                let fill = '#10b981';
                if (item.pending > 0) {
                  fill = '#f59e0b';
                } else if (item.reviewed > 0 || item.resolved < item.count) {
                  fill = '#ef4444';
                }
                return {
                  ...item,
                  project_label: truncateProjectName(item.project_name),
                  fill,
                };
              });

            const trendMap = publicReports.reduce((acc, report) => {
              const created = new Date(report.created_at || 0);
              if (Number.isNaN(created.getTime())) return acc;

              let key = '';
              let label = '';
              let sortTime = 0;

              if (publicReportsTrendView === 'monthly') {
                const y = created.getFullYear();
                const m = created.getMonth();
                key = `${y}-${String(m + 1).padStart(2, '0')}`;
                label = created.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
                sortTime = new Date(y, m, 1).getTime();
              } else {
                const day = new Date(created);
                const weekday = day.getDay();
                const offset = weekday === 0 ? 6 : weekday - 1;
                day.setDate(day.getDate() - offset);
                day.setHours(0, 0, 0, 0);
                const y = day.getFullYear();
                const m = String(day.getMonth() + 1).padStart(2, '0');
                const d = String(day.getDate()).padStart(2, '0');
                key = `${y}-${m}-${d}`;
                label = `Wk ${day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
                sortTime = day.getTime();
              }

              if (!acc[key]) acc[key] = { key, label, sortTime, total: 0, resolved: 0 };
              acc[key].total += 1;
              if (report.status === 'resolved') acc[key].resolved += 1;
              return acc;
            }, {});

            const trendData = Object.values(trendMap)
              .sort((a, b) => a.sortTime - b.sortTime)
              .slice(-16);

            const resolvedReports = publicReports.filter((report) => report.status === 'resolved');
            const resolvedDays = resolvedReports.map(getResolutionDays).filter((days) => typeof days === 'number');
            const avgResolutionDays = resolvedDays.length
              ? resolvedDays.reduce((sum, value) => sum + value, 0) / resolvedDays.length
              : null;
            const resolvedWithinSeven = resolvedDays.filter((days) => days <= 7).length;
            const resolvedWithinSevenPct = resolvedDays.length ? (resolvedWithinSeven / resolvedDays.length) * 100 : 0;
            const onsitePct = publicReports.length ? (verifiedCount / publicReports.length) * 100 : 0;

            const municipalityMap = publicReports.reduce((acc, report) => {
              const municipality = (report.municipality || 'Unknown').trim();
              if (!acc[municipality]) {
                acc[municipality] = {
                  municipality,
                  total: 0,
                  pending: 0,
                  resolved: 0,
                  avgResolveDays: null,
                  _resolveDays: [],
                };
              }

              acc[municipality].total += 1;
              if (report.status === 'pending') acc[municipality].pending += 1;
              if (report.status === 'resolved') {
                acc[municipality].resolved += 1;
                const days = getResolutionDays(report);
                if (typeof days === 'number') acc[municipality]._resolveDays.push(days);
              }
              return acc;
            }, {});

            const municipalityRows = Object.values(municipalityMap).map((row) => {
              const avgDays = row._resolveDays.length
                ? row._resolveDays.reduce((sum, value) => sum + value, 0) / row._resolveDays.length
                : null;
              return {
                municipality: row.municipality,
                total: row.total,
                pending: row.pending,
                resolved: row.resolved,
                avgResolveDays: avgDays,
              };
            });

            const sortedMunicipalityRows = [...municipalityRows].sort((a, b) => {
              const { key, direction } = publicReportsLocationSort;
              const mult = direction === 'asc' ? 1 : -1;
              const av = a[key];
              const bv = b[key];

              if (typeof av === 'string' || typeof bv === 'string') {
                return String(av || '').localeCompare(String(bv || '')) * mult;
              }

              const aNum = av == null ? -Infinity : av;
              const bNum = bv == null ? -Infinity : bv;
              return (aNum - bNum) * mult;
            });

            const toggleMunicipalitySort = (key) => {
              setPublicReportsLocationSort((prev) => {
                if (prev.key === key) {
                  return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
                }
                return { key, direction: key === 'municipality' ? 'asc' : 'desc' };
              });
            };

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const pending14 = publicReports.filter((report) => {
              if (report.status !== 'pending') return false;
              const created = startOfDay(report.created_at);
              if (!created) return false;
              const ageDays = Math.floor((today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
              return ageDays >= 14;
            }).length;

            const unresolved30 = publicReports.filter((report) => {
              if (report.status === 'resolved') return false;
              const created = startOfDay(report.created_at);
              if (!created) return false;
              const ageDays = Math.floor((today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
              return ageDays >= 30;
            }).length;

            const verifyBadge = (v) => {
              const map = {
                'Verified On-Site': { icon: '✔', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                'Needs Review': { icon: '⚠', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
                'Location Mismatch': { icon: '✖', cls: 'bg-red-50 text-red-700 border-red-200' },
              };
              const s = map[v] || { icon: '?', cls: 'bg-slate-50 text-slate-600 border-slate-200' };
              return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border ${s.cls}`}>{s.icon} {v}</span>;
            };

            const statusBadge = (status) => {
              return renderStatusPill(status, status?.charAt(0).toUpperCase() + status?.slice(1));
            };

            const selectedReportProject = (() => {
              if (!selectedPublicReport) return null;
              if (selectedPublicReport.project_id) {
                const byId = fmrProjects.find((p) => p.id === selectedPublicReport.project_id);
                if (byId) return byId;
              }

              const reportName = String(selectedPublicReport.project_name || '').trim().toLowerCase();
              if (!reportName) return null;
              return fmrProjects.find((p) => String(p.project_name || '').trim().toLowerCase() === reportName) || null;
            })();

            const officialPoint = (() => {
              if (!selectedReportProject) return null;
              const route = routeByProjectId[selectedReportProject.id];
              if (route && Number.isFinite(Number(route.start_latitude)) && Number.isFinite(Number(route.start_longitude))) {
                const hasEnd = Number.isFinite(Number(route.end_latitude)) && Number.isFinite(Number(route.end_longitude));
                if (hasEnd) {
                  return {
                    lat: (Number(route.start_latitude) + Number(route.end_latitude)) / 2,
                    lng: (Number(route.start_longitude) + Number(route.end_longitude)) / 2,
                  };
                }

                return {
                  lat: Number(route.start_latitude),
                  lng: Number(route.start_longitude),
                };
              }

              const startLat = Number(selectedReportProject.start_latitude);
              const startLng = Number(selectedReportProject.start_longitude);
              if (Number.isFinite(startLat) && Number.isFinite(startLng)) {
                return { lat: startLat, lng: startLng };
              }
              return null;
            })();

            const reportPoint = (() => {
              if (!selectedPublicReport) return null;
              const lat = Number(selectedPublicReport.latitude);
              const lng = Number(selectedPublicReport.longitude);
              if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
              return { lat, lng };
            })();

            const photoPoint = (() => {
              if (!selectedPublicReport) return null;
              const lat = Number(selectedPublicReport.photo_latitude ?? selectedPublicReport.latitude);
              const lng = Number(selectedPublicReport.photo_longitude ?? selectedPublicReport.longitude);
              if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
              return { lat, lng };
            })();

            const photoGpsMatchesReport = (() => {
              if (!reportPoint || !photoPoint) return false;
              return haversineMeters(reportPoint.lat, reportPoint.lng, photoPoint.lat, photoPoint.lng) <= 20;
            })();

            const distanceFromProjectMeters = (() => {
              if (!officialPoint || !reportPoint) return NaN;
              return haversineMeters(officialPoint.lat, officialPoint.lng, reportPoint.lat, reportPoint.lng);
            })();

            const distanceBand = getDistanceBand(distanceFromProjectMeters);

            const credibility = calculateCredibilityScore({
              accuracy: Number(selectedPublicReport?.geo_accuracy),
              distanceMeters: distanceFromProjectMeters,
              isVerifiedUser: Boolean(selectedPublicReport?.user_id),
              photoGpsMatch: photoGpsMatchesReport,
            });

            const timelineEntries = (() => {
              const baseEntries = [];
              if (selectedPublicReport?.created_at) {
                baseEntries.push({
                  id: `created-${selectedPublicReport.id}`,
                  created_at: selectedPublicReport.created_at,
                  description: 'Report submitted by citizen',
                  actor_name: selectedPublicReport.full_name || 'Anonymous',
                });
              }

              if (selectedPublicReport?.assigned_at && selectedPublicReport?.assigned_engineer_name) {
                baseEntries.push({
                  id: `assigned-${selectedPublicReport.id}`,
                  created_at: selectedPublicReport.assigned_at,
                  description: `Assigned field engineer: ${selectedPublicReport.assigned_engineer_name}`,
                  actor_name: 'Admin action',
                });
              }

              const dbEntries = (publicReportActivityLogs || []).map((entry) => ({
                id: entry.id || `${entry.created_at}-${entry.description}`,
                created_at: entry.created_at,
                description: entry.description || entry.action_type || 'Activity recorded',
                actor_name: entry.actor_name || 'Administrator',
              }));

              return [...baseEntries, ...dbEntries].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            })();

            const renderPublicReportItem = (rpt) => (
              <button key={rpt.id} onClick={() => setSelectedPublicReport(rpt)}
                className="w-full text-left px-4 py-4 hover:bg-slate-50 transition-colors group">
                {(() => {
                  const reportDate = rpt.updated_at || rpt.created_at;
                  const formattedReportDate = reportDate
                    ? new Date(reportDate).toLocaleString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                    : 'No date';

                  return (
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          {verifyBadge(rpt.verification)}
                          {statusBadge(rpt.status)}
                          {rpt.photo_url && (
                            <span className="flex items-center gap-1 text-xs text-slate-400">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" /></svg>
                              Photo
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-slate-900 group-hover:text-teal-700 transition-colors">
                          {rpt.project_name || `${rpt.barangay}, ${rpt.municipality}`}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">{rpt.barangay}, {rpt.municipality}{rpt.street ? ` — ${rpt.street}` : ''}</p>
                        <p className="text-sm text-slate-500 line-clamp-2 mt-0.5">{rpt.description}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <p className="text-xs text-slate-400">{rpt.full_name || 'Anonymous'} · {formattedReportDate}</p>
                          {rpt.assigned_engineer_name && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-teal-50 text-teal-700 border border-teal-200">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                              {rpt.assigned_engineer_name}
                            </span>
                          )}
                          {rpt.contractor_remark && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                              Contractor responded
                            </span>
                          )}
                        </div>
                      </div>
                      {rpt.photo_url && (
                        <img src={rpt.photo_url} alt="" className="w-14 h-14 rounded-lg object-cover border border-slate-200 shrink-0" />
                      )}
                    </div>
                  );
                })()}
              </button>
            );

            return (
              <div className="space-y-6">
                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                  <div className="bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm">
                    <p className="text-3xl font-bold text-slate-900">{publicReports.length}</p>
                    <p className="text-sm text-slate-500 mt-1">Total Reports</p>
                  </div>
                  <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-5">
                    <p className="text-3xl font-bold text-amber-700">{pendingCount}</p>
                    <p className="text-sm text-amber-600 mt-1">Pending</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-200/60 rounded-2xl p-5">
                    <p className="text-3xl font-bold text-blue-700">{reviewedCount}</p>
                    <p className="text-sm text-blue-600 mt-1">Reviewed</p>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200/60 rounded-2xl p-5">
                    <p className="text-3xl font-bold text-emerald-700">{resolvedCount}</p>
                    <p className="text-sm text-emerald-600 mt-1">Resolved</p>
                  </div>
                  <div className="bg-teal-50 border border-teal-200/60 rounded-2xl p-5">
                    <p className="text-3xl font-bold text-teal-700">{verifiedCount}</p>
                    <p className="text-sm text-teal-600 mt-1">Verified On-Site</p>
                  </div>
                </div>

                {/* Executive DA Citizen Reports Header Banner */}
                <div className="bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 text-white p-5 rounded-2xl border border-emerald-900/60 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="size-12 rounded-xl bg-emerald-500/20 text-emerald-400 grid place-items-center border border-emerald-500/30 shrink-0 shadow-inner">
                      <Icons.AlertTriangle />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg font-bold text-white tracking-tight">Citizen Damage & Incident Reports</h2>
                        <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/30 flex items-center gap-1.5">
                          <span className="size-2 rounded-full bg-amber-400 inline-block animate-pulse"></span>
                          {pendingCount} Pending Review
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 mt-1 font-medium">
                        Direct public feedback channel for Region VI Farm-to-Market Road damage, landslides, and infrastructure issues.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white border border-slate-200/70 rounded-2xl p-4 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.3)]">
                  <div className="flex flex-col gap-3 border-b border-slate-100 pb-3 lg:flex-row lg:items-end lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold tracking-tight text-slate-900">Filter Public Reports</h3>
                        <span className="inline-flex h-6 items-center rounded-full bg-indigo-50 px-2.5 text-[11px] font-semibold text-indigo-700">
                          {filteredPublicReports.length} result{filteredPublicReports.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Search, narrow by status and verification, then refine the location below.</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                        <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
                        {publicReports.length} total reports
                      </div>
                      {(publicReportSearch || publicReportFilter !== 'pending' || publicReportCategoryFilter !== 'all' || publicReportDateFrom || publicReportDateTo || publicReportMunicipalityFilter !== 'all' || publicReportBarangayFilter !== 'all' || publicReportStreetFilter !== 'all' || publicReportProjectFilter) && (
                        <button
                          onClick={() => {
                            setPublicReportSearch('');
                            setPublicReportFilter('pending');
                            setPublicReportCategoryFilter('all');
                            setPublicReportDateFrom('');
                            setPublicReportDateTo('');
                            setPublicReportMunicipalityFilter('all');
                            setPublicReportBarangayFilter('all');
                            setPublicReportStreetFilter('all');
                            setPublicReportProjectFilter('');
                          }}
                          className="h-9 rounded-lg border border-indigo-200 bg-white px-3 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-50"
                        >
                          Reset All
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 xl:grid-cols-12">
                    <div className="relative xl:col-span-3">
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Search</label>
                      <svg className="absolute left-3.5 top-[calc(50%+11px)] -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
                      <input
                        type="text"
                        value={publicReportSearch}
                        onChange={e => setPublicReportSearch(e.target.value)}
                        placeholder="Reporter, project, location, or description"
                        className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-10 pr-4 text-sm text-slate-700 outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10"
                      />
                    </div>

                    <div className="xl:col-span-2">
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Status</label>
                      <select
                        value={publicReportFilter}
                        onChange={e => setPublicReportFilter(e.target.value)}
                        className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 text-sm text-slate-700 outline-none transition-all hover:border-slate-300 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10"
                      >
                        <option value="pending">Pending</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    </div>

                    <div className="xl:col-span-2">
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Verification</label>
                      <select
                        value={publicReportCategoryFilter}
                        onChange={e => setPublicReportCategoryFilter(e.target.value)}
                        className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 text-sm text-slate-700 outline-none transition-all hover:border-slate-300 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10"
                      >
                        <option value="all">All Verification</option>
                        <option value="Verified On-Site">Verified On-Site</option>
                        <option value="Needs Review">Needs Review</option>
                        <option value="Location Mismatch">Location Mismatch</option>
                      </select>
                    </div>

                    <div className="xl:col-span-2">
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Assignment</label>
                      <select
                        value={publicReportAssignedFilter}
                        onChange={e => setPublicReportAssignedFilter(e.target.value)}
                        className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 text-sm text-slate-700 outline-none transition-all hover:border-slate-300 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10"
                      >
                        <option value="all">All Assignments</option>
                        <option value="unassigned">Unassigned</option>
                        <option value="assigned">Assigned</option>
                      </select>
                    </div>

                    <div className="xl:col-span-1.5">
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Start Date</label>
                      <input
                        type="date"
                        value={publicReportDateFrom}
                        onChange={(e) => setPublicReportDateFrom(e.target.value)}
                        max={publicReportDateTo || undefined}
                        aria-label="Start date"
                        title="Start date"
                        className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 text-sm text-slate-700 outline-none transition-all hover:border-slate-300 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10"
                      />
                    </div>

                    <div className="xl:col-span-1.5">
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">End Date</label>
                      <input
                        type="date"
                        value={publicReportDateTo}
                        onChange={(e) => setPublicReportDateTo(e.target.value)}
                        min={publicReportDateFrom || undefined}
                        aria-label="End date"
                        title="End date"
                        className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 text-sm text-slate-700 outline-none transition-all hover:border-slate-300 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10"
                      />
                    </div>

                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 xl:col-span-12">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Location Filters</p>
                          <p className="mt-1 text-xs text-slate-500">Use location only when you need to narrow a specific area.</p>
                        </div>
                        {(publicReportMunicipalityFilter !== 'all' || publicReportBarangayFilter !== 'all' || publicReportStreetFilter !== 'all') && (
                          <button
                            onClick={() => { setPublicReportMunicipalityFilter('all'); setPublicReportBarangayFilter('all'); setPublicReportStreetFilter('all'); }}
                            className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                          >
                            Clear Location
                          </button>
                        )}
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <div>
                          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Municipality</label>
                          <select
                            value={publicReportMunicipalityFilter}
                            onChange={e => { setPublicReportMunicipalityFilter(e.target.value); setPublicReportBarangayFilter('all'); setPublicReportStreetFilter('all'); }}
                            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition-all hover:border-slate-300 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                          >
                            <option value="all">All Municipalities</option>
                            {allMunicipalities.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Barangay</label>
                          <select
                            value={publicReportBarangayFilter}
                            onChange={e => { setPublicReportBarangayFilter(e.target.value); setPublicReportStreetFilter('all'); }}
                            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition-all hover:border-slate-300 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                          >
                            <option value="all">All Barangays</option>
                            {filteredBarangayOptions.map(b => <option key={b} value={b}>{b}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Street / Sitio</label>
                          <select
                            value={publicReportStreetFilter}
                            onChange={e => setPublicReportStreetFilter(e.target.value)}
                            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition-all hover:border-slate-300 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                          >
                            <option value="all">All Streets</option>
                            {filteredStreetOptions.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Detail Modal */}
                {selectedPublicReport && (() => {
                  const selectedReportProject = (() => {
                    if (!selectedPublicReport) return null;
                    if (selectedPublicReport.project_id) {
                      const byId = fmrProjects.find((p) => p.id === selectedPublicReport.project_id);
                      if (byId) return byId;
                    }
                    const reportName = String(selectedPublicReport.project_name || '').trim().toLowerCase();
                    if (!reportName) return null;
                    return fmrProjects.find((p) => String(p.project_name || '').trim().toLowerCase() === reportName) || null;
                  })();

                  const officialPoint = (() => {
                    if (!selectedReportProject) return null;
                    const route = routeByProjectId[selectedReportProject.id];
                    if (route && Number.isFinite(Number(route.start_latitude)) && Number.isFinite(Number(route.start_longitude))) {
                      const hasEnd = Number.isFinite(Number(route.end_latitude)) && Number.isFinite(Number(route.end_longitude));
                      if (hasEnd) {
                        return {
                          lat: (Number(route.start_latitude) + Number(route.end_latitude)) / 2,
                          lng: (Number(route.start_longitude) + Number(route.end_longitude)) / 2,
                        };
                      }
                      return {
                        lat: Number(route.start_latitude),
                        lng: Number(route.start_longitude),
                      };
                    }
                    const startLat = Number(selectedReportProject.start_latitude);
                    const startLng = Number(selectedReportProject.start_longitude);
                    if (Number.isFinite(startLat) && Number.isFinite(startLng)) {
                      return { lat: startLat, lng: startLng };
                    }
                    return null;
                  })();

                  const reportPoint = (() => {
                    if (!selectedPublicReport) return null;
                    const lat = Number(selectedPublicReport.latitude);
                    const lng = Number(selectedPublicReport.longitude);
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                    return { lat, lng };
                  })();

                  const photoPoint = (() => {
                    if (!selectedPublicReport) return null;
                    const lat = Number(selectedPublicReport.photo_latitude ?? selectedPublicReport.latitude);
                    const lng = Number(selectedPublicReport.photo_longitude ?? selectedPublicReport.longitude);
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                    return { lat, lng };
                  })();

                  const photoGpsMatchesReport = (() => {
                    if (!reportPoint || !photoPoint) return false;
                    return haversineMeters(reportPoint.lat, reportPoint.lng, photoPoint.lat, photoPoint.lng) <= 20;
                  })();

                  const distanceFromProjectMeters = (() => {
                    if (!officialPoint || !reportPoint) return NaN;
                    return haversineMeters(officialPoint.lat, officialPoint.lng, reportPoint.lat, reportPoint.lng);
                  })();

                  const distanceBand = getDistanceBand(distanceFromProjectMeters);

                  const credibility = calculateCredibilityScore({
                    accuracy: Number(selectedPublicReport?.geo_accuracy),
                    distanceMeters: distanceFromProjectMeters,
                    isVerifiedUser: Boolean(selectedPublicReport?.user_id),
                    photoGpsMatch: photoGpsMatchesReport,
                  });

                  return (
                    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md flex items-center justify-center z-50 p-2 sm:p-4 animate-in fade-in duration-200" onClick={() => setSelectedPublicReport(null)}>
                      <div className="bg-white rounded-2xl shadow-2xl w-[98vw] lg:w-[90vw] max-w-7xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-200/80" onClick={e => e.stopPropagation()}>

                        {/* Top Government Case Header */}
                        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 text-white flex items-center justify-between shrink-0 border-b border-emerald-900/50">
                          <div className="flex items-center gap-3.5">
                            <div className="size-11 bg-emerald-500/20 text-emerald-400 rounded-xl flex items-center justify-center border border-emerald-500/30 shadow-inner">
                              <Icons.Road />
                            </div>
                            <div>
                              <div className="flex items-center gap-2.5 flex-wrap">
                                <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">Public Road Damage Case File</h3>
                                <span className="text-[11px] px-2.5 py-0.5 rounded-md bg-emerald-950/80 text-emerald-300 font-mono border border-emerald-800/60 font-bold">
                                  REF #{selectedPublicReport.id.slice(0, 8).toUpperCase()}
                                </span>
                                {statusBadge(selectedPublicReport.status)}
                                {verifyBadge(selectedPublicReport.verification)}
                              </div>
                              <p className="text-xs text-slate-300 font-medium mt-0.5">
                                DA RAED Region VI &middot; {selectedPublicReport.project_name || 'General Road Sector Area'}
                              </p>
                            </div>
                          </div>
                          <button onClick={() => setSelectedPublicReport(null)} className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors">
                            <Icons.X />
                          </button>
                        </div>

                        {/* Main 2-Column Case Body */}
                        <div className="p-6 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-6 bg-slate-100/60">

                          {/* LEFT COLUMN: Evidence & Geolocation (Col 7) */}
                          <div className="lg:col-span-7 space-y-4">

                            {/* Citizen Report Statement */}
                            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs relative">
                              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                                  <Icons.Document /> Citizen Statement & Description
                                </span>
                                <span className="text-xs text-slate-400">
                                  Submitted {new Date(selectedPublicReport.created_at).toLocaleString()}
                                </span>
                              </div>
                              <p className="text-sm text-slate-800 leading-relaxed font-medium bg-slate-50/80 p-3.5 rounded-lg border border-slate-100 italic">
                                &ldquo;{selectedPublicReport.description || 'No detailed description attached.'}&rdquo;
                              </p>
                            </div>

                            {/* Credibility & Geo Metrics Banner */}
                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-2.5">
                              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                                <span className="flex items-center gap-1.5 text-slate-600">
                                  <Icons.ShieldCheck /> Verification & Credibility Index
                                </span>
                                <span className="text-emerald-700 font-extrabold">{credibility.score}/100 ({credibility.label})</span>
                              </div>
                              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden border border-slate-200/50">
                                <div className={`h-full rounded-full ${credibility.tone} transition-all duration-500`} style={{ width: `${credibility.score}%` }} />
                              </div>
                              <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500 flex-wrap gap-2">
                                <span className={`px-2 py-0.5 rounded font-bold border ${distanceBand.tone}`}>
                                  {distanceBand.emoji} Offset: {distanceBand.label}
                                </span>
                                {selectedPublicReport.geo_accuracy && (
                                  <span>GPS Accuracy: ±{Math.round(selectedPublicReport.geo_accuracy)}m</span>
                                )}
                                {(selectedPublicReport.latitude || selectedPublicReport.longitude) && (
                                  <a href={`https://www.google.com/maps?q=${selectedPublicReport.latitude},${selectedPublicReport.longitude}`} target="_blank" rel="noopener noreferrer"
                                    className="font-bold text-teal-700 hover:underline inline-flex items-center gap-1">
                                    <Icons.ExternalLink /> Open in Maps
                                  </a>
                                )}
                              </div>
                            </div>

                            {/* Site Photo */}
                            {selectedPublicReport.photo_url && (
                              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                                    <Icons.Camera /> On-Site Damage Photo Evidence
                                  </span>
                                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${photoPoint ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                    {photoPoint ? '✓ Geotag Verified' : 'No Photo Geotag'}
                                  </span>
                                </div>
                                <div className="relative rounded-lg overflow-hidden border border-slate-200">
                                  <a href={selectedPublicReport.photo_url} target="_blank" rel="noopener noreferrer">
                                    <img src={selectedPublicReport.photo_url} alt="Site capture" className="w-full max-h-80 object-cover hover:opacity-95 transition-opacity" />
                                  </a>
                                </div>
                              </div>
                            )}

                            {/* Route Map */}
                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                                Geospatial Location & Route Alignment Map
                              </span>
                              <PublicReportRouteMapPanel
                                project={selectedReportProject}
                                routeRecord={selectedReportProject ? routeByProjectId[selectedReportProject.id] : null}
                                reportLatitude={selectedPublicReport.latitude}
                                reportLongitude={selectedPublicReport.longitude}
                                heightClass="h-64 sm:h-72"
                                title="Project Route Map"
                              />
                            </div>

                            {/* Vicinity Duplicates */}
                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-2">
                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                                Vicinity Duplicates Check (100m Radius)
                              </span>
                              {similarReportsLoading ? (
                                <p className="text-xs text-slate-400">Checking nearby reports...</p>
                              ) : similarNearbyReports.length > 0 ? (
                                <div className="space-y-1.5">
                                  <p className="text-xs font-bold text-amber-800">{similarNearbyReports.length} duplicate report(s) found nearby:</p>
                                  {similarNearbyReports.slice(0, 3).map((similar) => (
                                    <button
                                      key={similar.id}
                                      onClick={() => {
                                        const fullReport = publicReports.find((row) => row.id === similar.id);
                                        if (fullReport) setSelectedPublicReport(fullReport);
                                      }}
                                      className="w-full text-left rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-xs hover:bg-amber-100/60 transition-colors flex items-center justify-between"
                                    >
                                      <span className="font-bold text-slate-800">{similar.project_name || 'Unlinked Road'}</span>
                                      <span className="text-amber-800 font-semibold">{formatDistance(similar.distanceMeters)} away</span>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs font-bold text-emerald-700">✓ No duplicate reports detected in this vicinity.</p>
                              )}
                            </div>

                          </div>

                          {/* RIGHT COLUMN: Administrative Action Station (Col 5) */}
                          <div className="lg:col-span-5 space-y-4">

                            {/* Citizen Details */}
                            <div className="bg-white p-4.5 rounded-xl border border-slate-200 shadow-xs space-y-3">
                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block border-b border-slate-100 pb-2">
                                Reporter Metadata
                              </span>
                              <div className="grid grid-cols-2 gap-3 text-xs">
                                <div>
                                  <span className="text-slate-400 block font-semibold text-[11px]">Submitted By</span>
                                  <span className="font-bold text-slate-900">{selectedPublicReport.full_name || 'Anonymous Citizen'}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 block font-semibold text-[11px]">Contact Info</span>
                                  <span className="font-bold text-slate-800">{selectedPublicReport.contact_info || '—'}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 block font-semibold text-[11px]">Municipality</span>
                                  <span className="font-bold text-slate-800">{selectedPublicReport.municipality || '—'}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 block font-semibold text-[11px]">Barangay</span>
                                  <span className="font-bold text-slate-800">{selectedPublicReport.barangay || '—'}</span>
                                </div>
                              </div>
                            </div>

                            {/* Field Engineer Findings Review */}
                            {selectedPublicReport.assigned_engineer_id && (
                              <div className="bg-white p-4.5 rounded-xl border border-slate-200 shadow-xs space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                                    Field Engineer Findings Review
                                  </span>
                                  {selectedPublicReport.engineer_status && (
                                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${selectedPublicReport.engineer_status === 'validated' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                        selectedPublicReport.engineer_status === 'rejected' ? 'bg-red-100 text-red-700 border-red-200' :
                                          selectedPublicReport.engineer_status === 'inspected' ? 'bg-violet-100 text-violet-700 border-violet-200' :
                                            'bg-slate-100 text-slate-600 border-slate-200'
                                      }`}>
                                      {selectedPublicReport.engineer_status.replace('_', ' ').toUpperCase()}
                                    </span>
                                  )}
                                </div>

                                {selectedFieldFinding ? (
                                  <div className="space-y-2 text-xs bg-slate-50 rounded-lg border border-slate-200 p-3">
                                    <div>
                                      <span className="text-slate-500 block font-medium">Condition Observed</span>
                                      <p className="font-semibold text-slate-800 mt-0.5">{selectedFieldFinding.condition_observed}</p>
                                    </div>
                                    <div>
                                      <span className="text-slate-500 block font-medium">Recommended Action</span>
                                      <p className="font-semibold text-slate-800 mt-0.5">{selectedFieldFinding.recommended_action}</p>
                                    </div>
                                    {selectedFieldFinding.estimated_cost_range && (
                                      <div>
                                        <span className="text-slate-500 block font-medium">Estimated Cost</span>
                                        <p className="font-semibold text-slate-800 mt-0.5">{selectedFieldFinding.estimated_cost_range}</p>
                                      </div>
                                    )}
                                    {selectedFieldFinding.field_photo_url && (
                                      <img src={selectedFieldFinding.field_photo_url} alt="Field inspection" className="w-full h-36 object-cover rounded-lg border border-slate-200" />
                                    )}
                                  </div>
                                ) : (
                                  <p className="text-xs text-slate-400 italic">No field engineer findings submitted yet.</p>
                                )}

                                {selectedFieldFinding && selectedPublicReport.engineer_status !== 'validated' && (
                                  <div className="space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                      <button
                                        onClick={() => validateFieldFinding(selectedPublicReport.id)}
                                        disabled={findingActionSaving}
                                        className="py-2 rounded-lg text-xs font-bold border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 transition-all"
                                      >
                                        Validate Finding
                                      </button>
                                      <button
                                        onClick={() => setShowRejectReason((v) => !v)}
                                        disabled={findingActionSaving}
                                        className="py-2 rounded-lg text-xs font-bold border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-60 transition-all"
                                      >
                                        Reject & Send Back
                                      </button>
                                    </div>
                                    {showRejectReason && (
                                      <div className="space-y-2">
                                        <textarea
                                          value={rejectReasonDraft}
                                          onChange={(e) => setRejectReasonDraft(e.target.value)}
                                          rows={2}
                                          placeholder="Reason for rejection (required) — what needs to be re-inspected?"
                                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white outline-none focus:ring-2 focus:ring-red-500/20"
                                        />
                                        <button
                                          onClick={() => rejectFieldFinding(selectedPublicReport.id, rejectReasonDraft)}
                                          disabled={findingActionSaving || !rejectReasonDraft.trim()}
                                          className="w-full py-2 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-all"
                                        >
                                          Confirm Rejection
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {selectedPublicReport.engineer_status === 'validated' && (
                                  <p className="text-[11px] text-emerald-700 font-semibold">
                                    Findings validated — resolution can now be issued below.
                                  </p>
                                )}
                              </div>
                            )}

                            {/* Workflow Controls (Priority, Field Engineer Assignment & Availability, Resolution) */}
                            <div className="bg-white p-4.5 rounded-xl border border-slate-200 shadow-xs">
                              <AdminWorkflowControls
                                report={selectedPublicReport}
                                resolution={selectedResolution}
                                adminIdentity={adminIdentity}
                                onNotify={showNotification}
                                onResolve={(summary) => finalizeResolution(selectedPublicReport.id, summary)}
                                fieldEngineers={fieldEngineers}
                                engineerWorkloads={engineerWorkloads}
                                assigningEngineer={assigningEngineer}
                                onAssignEngineer={(engineerId) => {
                                  assignEngineerToReport(selectedPublicReport.id, engineerId);
                                  setSelectedPublicReport(prev => (prev ? { ...prev, assigned_engineer_id: engineerId, assigned_engineer_name: fieldEngineers.find(e => e.id === engineerId)?.full_name || '', engineer_status: 'assigned', assigned_at: new Date().toISOString() } : prev));
                                }}
                                onUnassignEngineer={() => {
                                  unassignEngineerFromReport(selectedPublicReport.id);
                                  setSelectedPublicReport(prev => (prev ? { ...prev, assigned_engineer_id: null, assigned_engineer_name: '', engineer_status: null, assigned_at: null } : prev));
                                }}
                              />
                            </div>

                            {/* Quick Status Buttons */}
                            <div className="bg-white p-4.5 rounded-xl border border-slate-200 shadow-xs space-y-2.5">
                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                                Set Official Case Status
                              </span>
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  onClick={() => updatePublicReportStatus(selectedPublicReport.id, 'pending')}
                                  className={`py-2 rounded-lg text-xs font-bold border transition-all ${selectedPublicReport.status === 'pending' ? 'bg-amber-500 text-white border-amber-600 shadow-xs' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-amber-50'}`}
                                >
                                  Pending
                                </button>
                                <button
                                  onClick={() => updatePublicReportStatus(selectedPublicReport.id, 'reviewed')}
                                  className={`py-2 rounded-lg text-xs font-bold border transition-all ${selectedPublicReport.status === 'reviewed' ? 'bg-blue-600 text-white border-blue-700 shadow-xs' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-blue-50'}`}
                                >
                                  Reviewed
                                </button>
                              </div>
                              <p className="text-[11px] text-slate-400">
                                Resolved status is set from the Workflow Controls panel above, once field findings are validated.
                              </p>
                            </div>

                            {/* Internal Notes */}
                            <div className="bg-white p-4.5 rounded-xl border border-slate-200 shadow-xs space-y-2">
                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                                Private Internal Notes
                              </span>
                              <textarea
                                value={adminPrivateNote}
                                onChange={(e) => setAdminPrivateNote(e.target.value)}
                                placeholder="Internal verification context..."
                                rows={3}
                                className="w-full rounded-lg border border-slate-200 p-2.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/20"
                              />
                              <div className="flex justify-end">
                                <button
                                  onClick={saveAdminPrivateNote}
                                  disabled={adminPrivateNoteSaving || !adminUserId}
                                  className="px-3.5 py-1.5 rounded-md bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50"
                                >
                                  {adminPrivateNoteSaving ? 'Saving...' : 'Save Note'}
                                </button>
                              </div>
                            </div>

                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Reports List */}
                <div className="bg-slate-50/50 border border-slate-200/60 rounded-2xl shadow-xs overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200/60 bg-white">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-base font-semibold text-slate-800">Public Reports</p>
                        <p className="text-xs text-slate-500 mt-0.5">Newest citizen feedback reports sorted by date to prioritize critical damage issues.</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        {/* View Mode Toggle */}
                        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setPublicReportViewMode('grid')}
                            className={`p-1.5 rounded-md transition-all ${publicReportViewMode === 'grid' ? 'bg-white shadow-xs text-teal-600 font-bold' : 'text-slate-500 hover:text-slate-800'
                              }`}
                            title="Grid of Cards"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPublicReportViewMode('list')}
                            className={`p-1.5 rounded-md transition-all ${publicReportViewMode === 'list' ? 'bg-white shadow-xs text-teal-600 font-bold' : 'text-slate-500 hover:text-slate-800'
                              }`}
                            title="Detailed List"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                          </button>
                        </div>

                        {/* Status Buttons */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {[
                            { key: 'pending', label: 'Pending', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
                            { key: 'reviewed', label: 'Reviewed', tone: 'bg-blue-50 text-blue-700 border-blue-200' },
                            { key: 'resolved', label: 'Resolved', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                          ].map((option) => (
                            <button
                              key={option.key}
                              onClick={() => setPublicReportFilter(option.key)}
                              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${publicReportFilter === option.key ? option.tone : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  {publicReportsLoading ? (
                    <div className="p-10 text-center text-slate-400">
                      <div className="animate-spin mx-auto w-8 h-8 border-2 border-slate-350 border-t-teal-600 rounded-full mb-3" />
                      <p className="text-sm">Loading public reports...</p>
                    </div>
                  ) : filteredPublicReports.length === 0 ? (
                    <EmptyState
                      title="No public reports found"
                      description="No records match your current report and location filters."
                      buttonLabel="Clear Filters"
                      onButtonClick={() => {
                        setPublicReportFilter('pending');
                        setPublicReportCategoryFilter('all');
                        setPublicReportAssignedFilter('all');
                        setPublicReportSearch('');
                        setPublicReportMunicipalityFilter('all');
                        setPublicReportBarangayFilter('all');
                        setPublicReportStreetFilter('all');
                        setPublicReportDateFrom('');
                        setPublicReportDateTo('');
                        setPublicReportProjectFilter('');
                      }}
                    />
                  ) : (
                    <div>
                      {publicReportViewMode === 'grid' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 p-5">
                          {sortedFilteredPublicReports.map((rpt) => {
                            const reportDate = rpt.updated_at || rpt.created_at;
                            const formattedReportDate = reportDate
                              ? new Date(reportDate).toLocaleString('en-US', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })
                              : 'No date';

                            return (
                              <button
                                key={rpt.id}
                                onClick={() => setSelectedPublicReport(rpt)}
                                className="group flex flex-col text-left bg-white rounded-2xl border border-slate-200/80 hover:border-teal-500/50 hover:shadow-lg transition-[box-shadow,border-color] duration-200 overflow-hidden relative shadow-2xs"
                              >
                                {/* Card Image Preview / Vector Placeholder */}
                                <div className="h-40 w-full relative bg-slate-900 overflow-hidden shrink-0">
                                  {rpt.photo_url ? (
                                    <img
                                      src={rpt.photo_url}
                                      alt="Damage Inspection"
                                      className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-500"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950 p-4 text-center">
                                      <svg className="w-8 h-8 text-teal-600 mb-1.5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m2.25 15.75 5.159-5.159a6 6 0 0 1 8.486 0L21.75 15.75m-18-10.5h18A2.25 2.25 0 0 1 21.75 7.5v9a2.25 2.25 0 0 1-2.25 2.25h-15A2.25 2.25 0 0 1 2.25 16.5v-9a2.25 2.25 0 0 1 2.25-2.25z" /></svg>
                                      <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">No Image Uploaded</span>
                                    </div>
                                  )}
                                  {/* Floating Badges */}
                                  <div className="absolute top-3 left-3 right-3 flex justify-between items-center gap-2 pointer-events-none">
                                    {verifyBadge(rpt.verification)}
                                    {statusBadge(rpt.status)}
                                  </div>
                                </div>

                                {/* Card Body */}
                                <div className="p-4.5 flex-1 flex flex-col justify-between space-y-3.5">
                                  <div>
                                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold mb-1">
                                      <span className="text-teal-600 uppercase tracking-wider">{rpt.municipality}</span>
                                      <span>{formattedReportDate}</span>
                                    </div>
                                    <h4 className="text-sm font-bold text-slate-900 group-hover:text-teal-700 transition-colors line-clamp-1 leading-snug">
                                      {rpt.project_name || 'Unlinked Damage Site'}
                                    </h4>
                                    <p className="text-[11px] font-semibold text-slate-500 mt-0.5 line-clamp-1">
                                      📍 Barangay {rpt.barangay}{rpt.street ? `, ${rpt.street}` : ''}
                                    </p>
                                    <p className="text-xs text-slate-600 mt-2 line-clamp-3 leading-relaxed">
                                      {rpt.description || 'No description provided.'}
                                    </p>
                                  </div>

                                  {/* Footer with Assignment */}
                                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px] text-slate-500 font-medium">
                                    <span className="truncate">Reporter: {rpt.full_name || 'Anonymous'}</span>
                                    {rpt.assigned_engineer_name ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 text-teal-700 border border-teal-200/60 font-semibold text-[10px]">
                                        👤 {rpt.assigned_engineer_name.split(' ')[0]}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-slate-400 italic">Unassigned</span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-4">
                          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">{publicReportFilter}</span>
                              <span className="text-xs font-semibold text-slate-500">{sortedFilteredPublicReports.length}</span>
                            </div>
                            <div className="max-h-[500px] overflow-y-auto divide-y divide-slate-100 bg-white">
                              {sortedFilteredPublicReports.map(renderPublicReportItem)}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Reports Analytics */}
                <section className="bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-slate-100">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">Reports Analytics</h3>
                      <p className="text-xs text-slate-500 mt-1">Operational signals for report concentration, trend, and resolution performance.</p>
                    </div>
                    <button
                      onClick={() => setPublicReportsAnalyticsOpen((prev) => !prev)}
                      className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      {publicReportsAnalyticsOpen ? 'Hide Analytics' : 'Show Analytics'}
                      <svg className={`w-4 h-4 transition-transform ${publicReportsAnalyticsOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>
                  </div>

                  {publicReportsAnalyticsOpen && (
                    <div className="mt-4 space-y-5">
                      {(pending14 > 0 || unresolved30 > 0) && (
                        <div className="space-y-2">
                          {pending14 > 0 && (
                            <button
                              onClick={() => {
                                const cutoff = new Date(today);
                                cutoff.setDate(cutoff.getDate() - 14);
                                setPublicReportFilter('pending');
                                setPublicReportDateTo(formatDateInput(cutoff));
                              }}
                              className="w-full text-left rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 hover:bg-amber-100 transition-colors"
                            >
                              ⚠️ <span className="font-semibold">{pending14} pending report(s)</span> are 14+ days old and require review action.
                            </button>
                          )}
                          {unresolved30 > 0 && (
                            <button
                              onClick={() => {
                                const cutoff = new Date(today);
                                cutoff.setDate(cutoff.getDate() - 30);
                                setPublicReportFilter('pending');
                                setPublicReportDateTo(formatDateInput(cutoff));
                              }}
                              className="w-full text-left rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 hover:bg-red-100 transition-colors"
                            >
                              🚨 <span className="font-semibold">{unresolved30} report(s)</span> remain unresolved for 30+ days.
                            </button>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                        <div className="bg-slate-50/70 border border-slate-200/70 rounded-2xl p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-slate-800">Public Reports Trend</h4>
                            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
                              <button
                                onClick={() => setPublicReportsTrendView('weekly')}
                                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${publicReportsTrendView === 'weekly' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'
                                  }`}
                              >
                                Weekly
                              </button>
                              <button
                                onClick={() => setPublicReportsTrendView('monthly')}
                                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${publicReportsTrendView === 'monthly' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'
                                  }`}
                              >
                                Monthly
                              </button>
                            </div>
                          </div>
                          <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={trendData} margin={{ top: 8, right: 12, left: -16, bottom: 8 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} />
                                <YAxis allowDecimals={false} tick={{ fill: '#64748b', fontSize: 11 }} />
                                <RechartsTooltip />
                                <Legend />
                                <Line type="monotone" dataKey="total" name="Total Reports" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 3 }} />
                                <Line type="monotone" dataKey="resolved" name="Resolved" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </div>

                        <div className="bg-slate-50/70 border border-slate-200/70 rounded-2xl p-4">
                          <h4 className="text-sm font-semibold text-slate-800 mb-1">Top Reported FMR Projects</h4>
                          <p className="text-xs text-slate-500 mb-3">Top 10 projects with highest citizen report counts.</p>
                          <div className="h-64">
                            {topProjectsData.length === 0 ? (
                              <div className="h-full flex items-center justify-center text-xs text-slate-400">No report data available</div>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={topProjectsData} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                  <XAxis type="number" allowDecimals={false} tick={{ fill: '#64748b', fontSize: 11 }} />
                                  <YAxis type="category" dataKey="display_name" width={110} tick={{ fill: '#475569', fontSize: 10 }} />
                                  <RechartsTooltip />
                                  <Bar dataKey="count" name="Report Count" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-slate-100 pt-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
                          <div>
                            <h4 className="text-sm font-semibold text-slate-800">Municipality Resolution Performance</h4>
                            <p className="text-xs text-slate-500 mt-0.5">Click column headers to sort by workload or resolution speed.</p>
                          </div>
                          <span className="text-xs text-slate-500">{sortedMunicipalityRows.length} municipalities</span>
                        </div>
                        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                <th className="px-4 py-3 cursor-pointer select-none" onClick={() => toggleMunicipalitySort('municipality')}>
                                  Municipality {publicReportsLocationSort.key === 'municipality' ? (publicReportsLocationSort.direction === 'asc' ? '↑' : '↓') : ''}
                                </th>
                                <th className="px-4 py-3 cursor-pointer select-none" onClick={() => toggleMunicipalitySort('total')}>
                                  Total {publicReportsLocationSort.key === 'total' ? (publicReportsLocationSort.direction === 'asc' ? '↑' : '↓') : ''}
                                </th>
                                <th className="px-4 py-3 cursor-pointer select-none" onClick={() => toggleMunicipalitySort('pending')}>
                                  Pending {publicReportsLocationSort.key === 'pending' ? (publicReportsLocationSort.direction === 'asc' ? '↑' : '↓') : ''}
                                </th>
                                <th className="px-4 py-3 cursor-pointer select-none" onClick={() => toggleMunicipalitySort('resolved')}>
                                  Resolved {publicReportsLocationSort.key === 'resolved' ? (publicReportsLocationSort.direction === 'asc' ? '↑' : '↓') : ''}
                                </th>
                                <th className="px-4 py-3 cursor-pointer select-none" onClick={() => toggleMunicipalitySort('avgResolveDays')}>
                                  Avg Resolution Days {publicReportsLocationSort.key === 'avgResolveDays' ? (publicReportsLocationSort.direction === 'asc' ? '↑' : '↓') : ''}
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {sortedMunicipalityRows.length === 0 ? (
                                <tr>
                                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">No municipality data to display.</td>
                                </tr>
                              ) : (
                                sortedMunicipalityRows.map((row) => (
                                  <tr
                                    key={row.municipality}
                                    className={`${row.pending > row.resolved ? 'bg-amber-50/45' : 'bg-white'} hover:bg-slate-50 transition-colors`}
                                  >
                                    <td className="px-4 py-3 text-sm font-medium text-slate-800">{row.municipality}</td>
                                    <td className="px-4 py-3 text-sm text-slate-600">{row.total}</td>
                                    <td className="px-4 py-3 text-sm text-amber-700 font-semibold">{row.pending}</td>
                                    <td className="px-4 py-3 text-sm text-emerald-700 font-semibold">{row.resolved}</td>
                                    <td className="px-4 py-3 text-sm text-slate-600">{row.avgResolveDays == null ? 'N/A' : row.avgResolveDays.toFixed(1)}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            );
          })()}

          {/* Progress Updates Tab */}
          {activeTab === 'progress-updates' && (() => {
            const pendingUpdatesCount = progressUpdates.filter(u => u.status === 'pending').length;
            const approvedUpdatesCount = progressUpdates.filter(u => u.status === 'approved').length;
            const rejectedUpdatesCount = progressUpdates.filter(u => u.status === 'rejected').length;
            const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
            const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
            const updateStatusCls = { pending: 'bg-amber-50 text-amber-700 border-amber-200', approved: 'bg-emerald-50 text-emerald-700 border-emerald-200', rejected: 'bg-red-50 text-red-700 border-red-200' };
            return (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Operations Review Queue</p>
                    <p className="text-sm text-slate-500 mt-1">Track contractor submissions, approval outcomes, and review timestamps.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Last synced</p>
                      <p className="text-sm text-slate-600">{progressUpdatesLastSyncedAt ? fmtDateTime(progressUpdatesLastSyncedAt) : 'Not yet synced'}</p>
                    </div>
                    <button
                      onClick={fetchProgressUpdates}
                      disabled={progressUpdatesLoading}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                      <svg className={`w-4 h-4 ${progressUpdatesLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16.023 9.348h4.992V4.356m-1.336 14.292A9 9 0 1 1 21 12.75" />
                      </svg>
                      {progressUpdatesLoading ? 'Refreshing…' : 'Refresh'}
                    </button>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm">
                    <p className="text-3xl font-bold text-amber-700">{pendingUpdatesCount}</p>
                    <p className="text-sm text-slate-500 mt-1">Pending Review</p>
                  </div>
                  <div className="bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm">
                    <p className="text-3xl font-bold text-emerald-700">{approvedUpdatesCount}</p>
                    <p className="text-sm text-slate-500 mt-1">Approved</p>
                  </div>
                  <div className="bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm">
                    <p className="text-3xl font-bold text-red-600">{rejectedUpdatesCount}</p>
                    <p className="text-sm text-slate-500 mt-1">Rejected</p>
                  </div>
                </div>

                {/* Table */}
                <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
                  {progressUpdatesLoading ? (
                    <div className="py-16 flex items-center justify-center">
                      <div className="w-10 h-10 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
                    </div>
                  ) : progressUpdates.length === 0 ? (
                    <EmptyState title="No progress updates yet" description="Contractors will submit updates once they are assigned to projects." />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[900px]">
                        <thead>
                          <tr className="bg-slate-50/60 border-b border-slate-200">
                            <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Project</th>
                            <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Contractor</th>
                            <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Submitted %</th>
                            <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Current %</th>
                            <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Remarks</th>
                            <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Photo</th>
                            <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                            <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Submitted At</th>
                            <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Reviewed At</th>
                            <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {progressUpdates.map((upd) => {
                            const contractorProfile = contractors.find(c => c.id === upd.contractor_id);
                            const contractorName = contractorProfile?.full_name || contractorProfile?.email || upd.contractor_id?.slice(0, 8) || '—';
                            const projectName = upd.fmr_projects?.project_name || `Project ${upd.fmr_project_id}`;
                            const municipality = upd.fmr_projects?.municipality || '';
                            return (
                              <tr key={upd.id} className="hover:bg-slate-50/60 transition-colors align-top">
                                <td className="px-5 py-4 max-w-xs">
                                  <p className="text-sm font-semibold text-slate-900 line-clamp-2">{projectName}</p>
                                  {municipality && <p className="text-xs text-slate-500 mt-0.5">{municipality}</p>}
                                </td>
                                <td className="px-5 py-4">
                                  <p className="text-sm text-slate-700">{contractorName}</p>
                                </td>
                                <td className="px-5 py-4">
                                  <span className="text-sm font-bold text-slate-900 font-mono">{upd.reported_accomplishment}%</span>
                                </td>
                                <td className="px-5 py-4 whitespace-nowrap">
                                  <span className="text-sm font-semibold text-slate-700 font-mono">{Number(upd.fmr_projects?.accomplishment || 0).toFixed(2)}%</span>
                                </td>
                                <td className="px-5 py-4 max-w-xs">
                                  <p className="text-xs text-slate-600 line-clamp-3">{upd.remarks || '—'}</p>
                                </td>
                                <td className="px-5 py-4">
                                  {upd.photo_url ? (
                                    <a href={upd.photo_url} target="_blank" rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium">
                                      View
                                    </a>
                                  ) : <span className="text-xs text-slate-400">—</span>}
                                </td>
                                <td className="px-5 py-4">
                                  <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${updateStatusCls[upd.status] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                    {upd.status?.charAt(0).toUpperCase() + upd.status?.slice(1)}
                                  </span>
                                </td>
                                <td className="px-5 py-4 whitespace-nowrap">
                                  <span className="text-xs text-slate-500">{fmtDateTime(upd.submitted_at)}</span>
                                </td>
                                <td className="px-5 py-4 whitespace-nowrap">
                                  <span className="text-xs text-slate-500">{upd.status === 'pending' ? 'Awaiting review' : fmtDateTime(upd.reviewed_at)}</span>
                                </td>
                                <td className="px-5 py-4">
                                  {upd.status === 'pending' && (
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => approveProgressUpdate(upd)}
                                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
                                      >
                                        Approve
                                      </button>
                                      <button
                                        onClick={() => rejectProgressUpdate(upd.id)}
                                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 transition-colors"
                                      >
                                        Reject
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-8 py-7 border-b border-slate-200/60 bg-gradient-to-r from-slate-50 to-white">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">System Settings</h2>
                <p className="text-sm text-slate-500 mt-1.5">Configure your dashboard preferences</p>
              </div>
              <div className="p-8 space-y-8">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Admin Preferences</h3>
                  <p className="text-sm text-slate-500 mb-4">Identity and role information for the authenticated administrator account.</p>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-teal-600 text-white flex items-center justify-center text-lg font-bold">
                        {(adminIdentity.full_name || 'A').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Admin Name</p>
                        <p className="text-base font-semibold text-slate-900">{adminIdentity.full_name}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
                      <div className="rounded-xl bg-white border border-slate-200 p-4">
                        <p className="text-xs text-slate-500">Email</p>
                        <p className="text-sm font-semibold text-slate-900 break-all">{adminIdentity.email || 'No email available'}</p>
                      </div>
                      <div className="rounded-xl bg-white border border-slate-200 p-4">
                        <p className="text-xs text-slate-500">Role</p>
                        <p className="text-sm font-semibold text-slate-900">{adminIdentity.role}</p>
                      </div>
                      <div className="rounded-xl bg-white border border-slate-200 p-4">
                        <p className="text-xs text-slate-500">Portal</p>
                        <p className="text-sm font-semibold text-slate-900">KalsaTrack Admin</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="pt-8 border-t border-slate-100">
                  <h3 className="font-bold text-lg text-slate-900 mb-5">Notification Preferences</h3>
                  <div className="space-y-4">
                    {['Email notifications for project updates', 'SMS alerts for critical issues', 'Weekly summary reports'].map((item, index) => (
                      <label key={index} className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors duration-200 cursor-pointer">
                        <input type="checkbox" defaultChecked className="w-5 h-5 text-teal-600 rounded-md border-slate-300 focus:ring-teal-500" />
                        <span className="text-sm font-medium text-slate-700">{item}</span>
                      </label>
                    ))}
                  </div>
                </div>
                {/* Field Engineers Management */}
                <div className="pt-8 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-lg text-slate-900">Field Engineers</h3>
                    <button onClick={fetchFieldEngineers} className="px-3 py-1.5 text-xs font-medium text-teal-700 border border-teal-200 rounded-lg hover:bg-teal-50 transition-colors">
                      Refresh List
                    </button>
                  </div>
                  <p className="text-sm text-slate-500 mb-5">Manage field engineer accounts. Engineers log in at <code className="text-teal-600 bg-teal-50 px-2 py-0.5 rounded-md text-xs">/field-engineer/login</code></p>

                  {feLoadError && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl text-sm mb-4">
                      {feLoadError}
                    </div>
                  )}

                  {/* Existing Engineers */}
                  {fieldEngineers.length > 0 && (
                    <div className="mb-6 space-y-3">
                      {fieldEngineers.map(eng => (
                        <div key={eng.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-teal-600 rounded-xl flex items-center justify-center text-white font-bold text-sm">
                              {(eng.full_name || eng.email || 'FE').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{eng.full_name || '—'}</p>
                              <p className="text-xs text-slate-500">{eng.email} {eng.phone ? `· ${eng.phone}` : ''}</p>
                            </div>
                          </div>
                          <span className="px-3 py-1 bg-teal-50 text-teal-700 border border-teal-200 rounded-lg text-xs font-semibold">Field Engineer</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add Field Engineer Form */}
                  <div className="bg-teal-50/50 border border-teal-200/60 rounded-xl p-5">
                    <p className="text-sm font-semibold text-teal-900 mb-4">Register New Field Engineer</p>
                    <p className="text-xs text-teal-700 mb-4">
                      <strong>Important:</strong> Go to your <strong>Supabase Dashboard → Authentication → Providers → Email</strong> and <strong>disable "Confirm email"</strong> to avoid email rate limits.
                    </p>
                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      const fd = new FormData(e.target);
                      const feEmail = fd.get('fe_email')?.toString().trim();
                      const feName = fd.get('fe_name')?.toString().trim();
                      const fePhone = fd.get('fe_phone')?.toString().trim();
                      const fePassword = fd.get('fe_password')?.toString().trim();
                      if (!feEmail || !fePassword) { showNotification('Email and password are required', 'error'); return; }
                      try {
                        // Use the separate supabaseAdmin client so the admin session is NOT replaced
                        const { data: signUpData, error: signUpErr } = await supabaseAdmin.auth.signUp({
                          email: feEmail,
                          password: fePassword,
                          options: {
                            data: { role: 'field_engineer', full_name: feName || '' },
                            emailRedirectTo: `${window.location.origin}/field-engineer/login`
                          }
                        });
                        if (signUpErr) {
                          if (signUpErr.message?.toLowerCase().includes('rate') || signUpErr.status === 429) {
                            showNotification('Email rate limit exceeded. Disable "Confirm email" in Supabase Auth settings, or wait and try again.', 'error');
                            return;
                          }
                          throw signUpErr;
                        }
                        // Check if user was actually created (identities array is empty if email already exists)
                        if (signUpData?.user?.identities?.length === 0) {
                          showNotification('A user with this email already exists. Use a different email.', 'error');
                          return;
                        }
                        if (signUpData?.user) {
                          let profileCreated = false;

                          // Try 1: SECURITY DEFINER RPC (bypasses RLS)
                          const { error: profErr } = await supabase.rpc('create_field_engineer_profile', {
                            user_id: signUpData.user.id,
                            user_email: feEmail,
                            user_name: feName || '',
                            user_phone: fePhone || ''
                          });
                          if (!profErr) {
                            profileCreated = true;
                          } else {
                            console.warn('RPC create_field_engineer_profile failed:', profErr);

                            // Try 2: direct insert
                            const { error: insertErr } = await supabase.from('profiles').insert({
                              id: signUpData.user.id,
                              email: feEmail,
                              full_name: feName || '',
                              phone: fePhone || '',
                              role: 'field_engineer',
                            });
                            if (!insertErr) {
                              profileCreated = true;
                            } else {
                              console.warn('Direct insert failed:', insertErr);

                              // Try 3: upsert
                              const { error: upsertErr } = await supabase.from('profiles').upsert({
                                id: signUpData.user.id,
                                email: feEmail,
                                full_name: feName || '',
                                phone: fePhone || '',
                                role: 'field_engineer',
                              }, { onConflict: 'id' });
                              if (!upsertErr) {
                                profileCreated = true;
                              } else {
                                console.error('All profile creation attempts failed:', upsertErr);
                              }
                            }
                          }

                          if (!profileCreated) {
                            showNotification('Account created but profile failed. Run supabase_complete_fe_setup.sql in SQL Editor, then refresh.', 'error');
                          } else {
                            await fetchFieldEngineers();
                            showNotification(`Field engineer ${feName || feEmail} registered successfully!`);
                            e.target.reset();
                          }
                        }
                      } catch (err) {
                        console.error('Failed to register field engineer:', err.message);
                        showNotification(`Failed: ${err.message}`, 'error');
                      }
                    }} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Full Name</label>
                          <input type="text" name="fe_name" placeholder="Juan Dela Cruz" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Phone</label>
                          <input type="tel" name="fe_phone" placeholder="09XX-XXX-XXXX" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Email *</label>
                          <input type="email" name="fe_email" required placeholder="engineer@email.com" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Password *</label>
                          <input type="password" name="fe_password" required minLength={6} placeholder="Min 6 characters" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none" />
                        </div>
                      </div>
                      <button type="submit" className="bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white px-6 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-teal-500/25">
                        Register Field Engineer
                      </button>
                    </form>
                  </div>
                </div>
                {/* Contractors Management */}
                <div className="pt-8 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-lg text-slate-900">Contractors</h3>
                    <button onClick={fetchContractors} className="px-3 py-1.5 text-xs font-medium text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-50 transition-colors">
                      Refresh List
                    </button>
                  </div>
                  <p className="text-sm text-slate-500 mb-5">Manage contractor accounts. Contractors log in at <code className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md text-xs">/contractor/login</code> — share this URL with your contractors.</p>

                  {/* Existing Contractors */}
                  {contractors.length > 0 && (
                    <div className="mb-6 space-y-3">
                      {contractors.map(c => {
                        const assignedCount = fmrProjects.filter(p => p.contractor_id === c.id).length;
                        return (
                          <div key={c.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-amber-600 rounded-xl flex items-center justify-center text-white font-bold text-sm">
                                {(c.full_name || c.email || 'C').charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-slate-900">{c.full_name || '—'}</p>
                                <p className="text-xs text-slate-500">{c.email}{c.phone ? ` · ${c.phone}` : ''} · {assignedCount} project{assignedCount !== 1 ? 's' : ''} assigned</p>
                              </div>
                            </div>
                            <span className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-semibold">Contractor</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add Contractor Form */}
                  <div className="bg-amber-50/50 border border-amber-200/60 rounded-xl p-5">
                    <p className="text-sm font-semibold text-amber-900 mb-4">Register New Contractor</p>
                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      const fd = new FormData(e.target);
                      const ctEmail = fd.get('ct_email')?.toString().trim();
                      const ctName = fd.get('ct_name')?.toString().trim();
                      const ctPhone = fd.get('ct_phone')?.toString().trim();
                      const ctPassword = fd.get('ct_password')?.toString().trim();
                      if (!ctEmail || !ctPassword) { showNotification('Email and password are required', 'error'); return; }
                      try {
                        const { data: signUpData, error: signUpErr } = await supabaseAdmin.auth.signUp({
                          email: ctEmail,
                          password: ctPassword,
                          options: {
                            data: { role: 'contractor', full_name: ctName || '' },
                          }
                        });
                        if (signUpErr) {
                          if (signUpErr.message?.toLowerCase().includes('rate') || signUpErr.status === 429) {
                            showNotification('Email rate limit exceeded. Disable "Confirm email" in Supabase Auth settings, or wait and try again.', 'error');
                            return;
                          }
                          throw signUpErr;
                        }
                        if (signUpData?.user?.identities?.length === 0) { showNotification('A user with this email already exists.', 'error'); return; }
                        if (signUpData?.user) {
                          let profileCreated = false;

                          // Try 1: SECURITY DEFINER RPC (bypasses RLS)
                          const { error: rpcErr } = await supabase.rpc('create_contractor_profile', {
                            user_id: signUpData.user.id,
                            user_email: ctEmail,
                            user_name: ctName || '',
                            user_phone: ctPhone || '',
                          });
                          if (!rpcErr) {
                            profileCreated = true;
                          } else {
                            console.warn('RPC create_contractor_profile failed:', rpcErr);

                            // Try 2: direct insert
                            const { error: insertErr } = await supabase.from('profiles').insert({
                              id: signUpData.user.id, email: ctEmail,
                              full_name: ctName || '', phone: ctPhone || '', role: 'contractor',
                            });
                            if (!insertErr) {
                              profileCreated = true;
                            } else {
                              console.warn('Direct insert failed:', insertErr);

                              // Try 3: upsert
                              const { error: upsertErr } = await supabase.from('profiles').upsert({
                                id: signUpData.user.id, email: ctEmail,
                                full_name: ctName || '', phone: ctPhone || '', role: 'contractor',
                              }, { onConflict: 'id' });
                              if (!upsertErr) {
                                profileCreated = true;
                              } else {
                                console.error('All profile creation attempts failed:', upsertErr);
                              }
                            }
                          }

                          if (!profileCreated) {
                            showNotification('Account created but profile failed. Run supabase_create_contractor_profile_fn.sql in SQL Editor, then refresh.', 'error');
                          } else {
                            await fetchContractors();
                            showNotification(`Contractor ${ctName || ctEmail} registered successfully!`);
                            e.target.reset();
                          }
                        }
                      } catch (err) {
                        showNotification(`Failed: ${err.message}`, 'error');
                      }
                    }} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Full Name</label>
                          <input type="text" name="ct_name" placeholder="Contractor Name" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Phone</label>
                          <input type="tel" name="ct_phone" placeholder="09XX-XXX-XXXX" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Email *</label>
                          <input type="email" name="ct_email" required placeholder="contractor@email.com" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Password *</label>
                          <input type="password" name="ct_password" required minLength={6} placeholder="Min 6 characters" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none" />
                        </div>
                      </div>
                      <button type="submit" className="bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-700 hover:to-amber-600 text-white px-6 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-amber-500/25">
                        Register Contractor
                      </button>
                    </form>
                  </div>
                </div>

                {/* LGU Management */}
                <div className="pt-8 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-lg text-slate-900">LGUs</h3>
                    <button onClick={fetchLgus} className="px-3 py-1.5 text-xs font-medium text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
                      Refresh List
                    </button>
                  </div>
                  <p className="text-sm text-slate-500 mb-5">Manage LGU accounts. LGUs log in at <code className="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md text-xs">/signin</code> and will be redirected to <code className="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md text-xs">/lgu</code>.</p>

                  {/* Existing LGU Users */}
                  {lgus.length > 0 && (
                    <div className="mb-6 space-y-3">
                      {lgus.map((lgu) => (
                        <div key={lgu.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-sm">
                              {(lgu.full_name || lgu.email || 'L').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{lgu.full_name || '—'}</p>
                              <p className="text-xs text-slate-500">
                                {lgu.email}
                                {lgu.phone ? ` · ${lgu.phone}` : ''}
                                {lgu.municipality ? ` · ${lgu.municipality}` : ''}
                              </p>
                            </div>
                          </div>
                          <span className="px-3 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold">LGU</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add LGU Form */}
                  <div className="bg-indigo-50/50 border border-indigo-200/60 rounded-xl p-5">
                    <p className="text-sm font-semibold text-indigo-900 mb-4">Register New LGU</p>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const fd = new FormData(e.target);
                        const lguEmail = fd.get('lgu_email')?.toString().trim();
                        const lguName = fd.get('lgu_name')?.toString().trim();
                        const lguPhone = fd.get('lgu_phone')?.toString().trim();
                        const lguMunicipality = fd.get('lgu_municipality')?.toString().trim();
                        const lguPassword = fd.get('lgu_password')?.toString().trim();

                        if (!lguEmail || !lguPassword) {
                          showNotification('Email and password are required', 'error');
                          return;
                        }

                        try {
                          const { data: signUpData, error: signUpErr } = await supabaseAdmin.auth.signUp({
                            email: lguEmail,
                            password: lguPassword,
                            options: {
                              data: {
                                role: 'lgu',
                                full_name: lguName || '',
                                municipality: lguMunicipality || '',
                              },
                              emailRedirectTo: `${window.location.origin}/signin`,
                            },
                          });

                          if (signUpErr) {
                            if (signUpErr.message?.toLowerCase().includes('rate') || signUpErr.status === 429) {
                              showNotification('Email rate limit exceeded. Disable "Confirm email" in Supabase Auth settings, or wait and try again.', 'error');
                              return;
                            }
                            throw signUpErr;
                          }

                          if (signUpData?.user?.identities?.length === 0) {
                            showNotification('A user with this email already exists.', 'error');
                            return;
                          }

                          if (signUpData?.user) {
                            const baseProfile = {
                              id: signUpData.user.id,
                              email: lguEmail,
                              full_name: lguName || '',
                              phone: lguPhone || '',
                              role: 'lgu',
                            };

                            const withMunicipality = lguMunicipality
                              ? { ...baseProfile, municipality: lguMunicipality }
                              : baseProfile;

                            let profileCreated = false;

                            // Try 1: SECURITY DEFINER RPC (bypasses RLS)
                            const { error: rpcErr } = await supabase.rpc('create_lgu_profile', {
                              user_id: signUpData.user.id,
                              user_email: lguEmail,
                              user_name: lguName || '',
                              user_phone: lguPhone || '',
                              user_municipality: lguMunicipality || null,
                            });

                            if (!rpcErr) {
                              profileCreated = true;
                            } else {
                              console.warn('RPC create_lgu_profile failed:', rpcErr);

                              // Try 2: direct insert
                              const { error: insertErr } = await supabase.from('profiles').insert(withMunicipality);
                              if (!insertErr) {
                                profileCreated = true;
                              } else {
                                const insertMsg = String(insertErr?.message || '').toLowerCase();
                                const retryPayload = insertMsg.includes('municipality') ? baseProfile : withMunicipality;

                                // Try 3: upsert
                                const { error: upsertErr } = await supabase
                                  .from('profiles')
                                  .upsert(retryPayload, { onConflict: 'id' });

                                if (!upsertErr) {
                                  profileCreated = true;
                                } else {
                                  console.error('Failed to create LGU profile:', upsertErr);
                                }
                              }
                            }

                            if (!profileCreated) {
                              showNotification('Account created but profile failed. Run supabase_create_lgu_profile_fn.sql in SQL Editor, then refresh.', 'error');
                            } else {
                              await fetchLgus();
                              showNotification(`LGU ${lguName || lguEmail} registered successfully!`);
                              e.target.reset();
                            }
                          }
                        } catch (err) {
                          showNotification(`Failed: ${err.message}`, 'error');
                        }
                      }}
                      className="space-y-4"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Full Name</label>
                          <input type="text" name="lgu_name" placeholder="Municipal LGU Officer" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Phone</label>
                          <input type="tel" name="lgu_phone" placeholder="09XX-XXX-XXXX" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Municipality</label>
                          <select name="lgu_municipality" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none bg-white">
                            <option value="">Select municipality</option>
                            {getMunicipalities().map((mun) => (
                              <option key={mun} value={mun}>{mun}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Email *</label>
                          <input type="email" name="lgu_email" required placeholder="lgu@email.com" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Password *</label>
                          <input type="password" name="lgu_password" required minLength={6} placeholder="Min 6 characters" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none" />
                        </div>
                      </div>
                      <button type="submit" className="bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-700 hover:to-indigo-600 text-white px-6 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-indigo-500/25">
                        Register LGU
                      </button>
                    </form>
                  </div>
                </div>

                <div className="pt-8 border-t border-slate-100">
                  <button className="bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white px-8 py-3 rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg shadow-teal-500/25 hover:shadow-xl hover:shadow-teal-500/30">
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Project Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-8 py-6 border-b border-slate-200/60 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">New Road Project</h2>
                <p className="text-sm text-slate-500 mt-1">Create a new farm-to-market road project</p>
              </div>
              <button onClick={() => { setShowAddModal(false); setNewProjectContractorId(''); setNewProjectRouteWaypoints([]); setPendingProposalLink(null); }} className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors duration-200">
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleAddProject} className="flex-1 overflow-y-auto p-8">
              {pendingProposalLink && (
                <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
                  Pre-filled from a validated LGU proposal: <strong>{pendingProposalLink.project_name}</strong>. Review the details, assign an official FMR Code and contractor, then create the project to publish it.
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Project Name *</label>
                  <input
                    type="text"
                    name="projectName"
                    value={formData.projectName}
                    onChange={handleInputChange}
                    required
                    readOnly={!!pendingProposalLink}
                    disabled={!!pendingProposalLink}
                    className={`w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 ${
                      pendingProposalLink ? 'bg-slate-100 cursor-not-allowed text-slate-500 font-semibold' : ''
                    }`}
                    placeholder="e.g., Barangay Access Road"
                  />
                  {pendingProposalLink && (
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                      🔒 Locked to match the validated LGU proposal name for traceability.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">FMR Code *</label>
                  <input type="text" name="projectCode" value={formData.projectCode} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 font-mono" placeholder="e.g., FMR-2026-ILO-001" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Region</label>
                  <input type="text" name="region" value={formData.region} readOnly className="w-full px-5 py-3 border border-slate-200 rounded-xl bg-slate-50 cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Province</label>
                  <input type="text" name="province" value={formData.province} readOnly className="w-full px-5 py-3 border border-slate-200 rounded-xl bg-slate-50 cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Municipality *</label>
                  <select name="municipality" value={formData.municipality} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200">
                    <option value="">Select municipality</option>
                    {getMunicipalities().map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Barangay *</label>
                  <select name="barangay" value={formData.barangay} onChange={handleInputChange} required disabled={!formData.municipality} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 disabled:bg-slate-50 disabled:cursor-not-allowed">
                    <option value="">Select barangay</option>
                    {getBarangays(formData.municipality).map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Start Latitude *</label>
                  <input type="text" inputMode="decimal" name="startLatitude" value={formData.startLatitude} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 font-mono" placeholder="10.315700 or 10.315700N" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Start Longitude *</label>
                  <input type="text" inputMode="decimal" name="startLongitude" value={formData.startLongitude} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 font-mono" placeholder="123.885400 or 123.885400E" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">End Latitude *</label>
                  <input type="text" inputMode="decimal" name="endLatitude" value={formData.endLatitude} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 font-mono" placeholder="10.319100 or 10.319100N" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">End Longitude *</label>
                  <input type="text" inputMode="decimal" name="endLongitude" value={formData.endLongitude} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 font-mono" placeholder="123.891000 or 123.891000E" />
                </div>
                <div className="md:col-span-2 border border-slate-200 rounded-2xl p-4 bg-slate-50/40 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">Project Route</h3>
                      <p className="text-xs text-slate-500">Use map click modes to set Start, End, and intermediate waypoints.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        ['start', 'Set Start'],
                        ['end', 'Set End'],
                        ['waypoint', 'Add Waypoint'],
                      ].map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setNewProjectRouteMode(mode)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${newProjectRouteMode === mode ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                        >
                          {label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={async () => {
                          const sLat = parseCoordinate(formData.startLatitude);
                          const sLng = parseCoordinate(formData.startLongitude);
                          const eLat = parseCoordinate(formData.endLatitude);
                          const eLng = parseCoordinate(formData.endLongitude);

                          if (Number.isNaN(sLat) || Number.isNaN(sLng) || Number.isNaN(eLat) || Number.isNaN(eLng)) {
                            showNotification('Please set both Start and End coordinates first.', 'error');
                            return;
                          }

                          try {
                            const snappedPoints = await fetchRoadAlignedPolyline([[sLat, sLng], ...newProjectRouteWaypoints.map(w => [w.lat, w.lng]), [eLat, eLng]]);
                            if (snappedPoints && snappedPoints.length >= 2) {
                              const first = snappedPoints[0];
                              const last = snappedPoints[snappedPoints.length - 1];
                              const middle = snappedPoints.slice(1, snappedPoints.length - 1).map(pt => ({ lat: pt[0], lng: pt[1] }));

                              setNewProjectRouteWaypoints(middle);
                              const totalDist = calculateSnappedPolylineDistanceKm(snappedPoints);
                              setFormData(prev => ({
                                ...prev,
                                startLatitude: first[0].toFixed(6),
                                startLongitude: first[1].toFixed(6),
                                endLatitude: last[0].toFixed(6),
                                endLongitude: last[1].toFixed(6),
                                roadLength: totalDist.toFixed(2)
                              }));
                              showNotification('Snapped successfully to road alignment!');
                            } else {
                              showNotification('Could not find road connection between coordinates.', 'error');
                            }
                          } catch (err) {
                            showNotification('Failed to connect coordinates to road network.', 'error');
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100"
                      >
                        ⚡ Snap to Road
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            startLatitude: '',
                            startLongitude: '',
                            endLatitude: '',
                            endLongitude: ''
                          }));
                          setNewProjectRouteWaypoints([]);
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="h-64 rounded-xl overflow-hidden border border-slate-200 relative">
                    {/* Map Search Overlay */}
                    <div className="absolute top-2 left-12 z-[1000] flex gap-1 bg-white p-1 rounded-lg shadow-md border border-slate-200/80 max-w-[280px] w-full">
                      <input
                        type="text"
                        placeholder="Search location (e.g. Sto. Tomas, Leon)..."
                        value={createMapSearchQuery}
                        onChange={(e) => setCreateMapSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleCreateMapSearch();
                          }
                        }}
                        className="flex-1 px-2.5 py-1 text-[11px] bg-slate-50 border border-slate-200 rounded outline-none focus:ring-1 focus:ring-teal-500"
                      />
                      <button
                        type="button"
                        onClick={handleCreateMapSearch}
                        className="px-2.5 py-1 text-[11px] font-semibold text-white bg-teal-600 rounded hover:bg-teal-700 active:scale-95 transition-all shadow-sm"
                      >
                        Go
                      </button>
                    </div>

                    <MapContainer center={[10.89, 122.45]} zoom={10} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      <MapSearchController searchCoords={createMapSearchCoords} />
                      <RouteEditorMapClick onPickPoint={handleNewProjectRoutePick} />
                      {createMapSearchCoords && (
                        <Marker position={createMapSearchCoords}>
                          <Popup>
                            <span className="text-xs font-semibold text-slate-800">Search: {createMapSearchQuery}</span>
                          </Popup>
                        </Marker>
                      )}
                      {newProjectRoutePreview.length >= 2 && (
                        <>
                          <Polyline positions={newProjectRoutePreview} pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.9 }} />
                          <Polyline positions={newProjectRoutePreview} pathOptions={{ color: '#0d9488', weight: 5, opacity: 0.95 }} />
                        </>
                      )}
                      {newProjectRoutePreview[0] && (
                        <CircleMarker center={newProjectRoutePreview[0]} radius={7} pathOptions={{ color: '#166534', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }} />
                      )}
                      {newProjectRoutePreview.length > 1 && (
                        <Marker
                          position={newProjectRoutePreview[newProjectRoutePreview.length - 1]}
                          icon={L.divIcon({
                            className: 'add-route-end',
                            html: '<div style="width:16px;height:16px;background:#ef4444;border:2px solid #991b1b;border-radius:3px;"></div>',
                            iconSize: [16, 16],
                            iconAnchor: [8, 8],
                          })}
                        />
                      )}
                    </MapContainer>
                  </div>

                  {newProjectRouteWaypoints.length > 0 && (
                    <div className="space-y-2">
                      {newProjectRouteWaypoints.map((point, idx) => (
                        <div key={`new-waypoint-${idx}`} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                          <input
                            type="number"
                            step="any"
                            value={point.lat}
                            onChange={(e) => {
                              const value = e.target.value;
                              setNewProjectRouteWaypoints((prev) => {
                                const nextWaypoints = prev.map((p, i) => i === idx ? { ...p, lat: value } : p);
                                setFormData((curr) => {
                                  const sLat = parseCoordinate(curr.startLatitude);
                                  const sLng = parseCoordinate(curr.startLongitude);
                                  const eLat = parseCoordinate(curr.endLatitude);
                                  const eLng = parseCoordinate(curr.endLongitude);
                                  if (!Number.isNaN(sLat) && !Number.isNaN(sLng) && !Number.isNaN(eLat) && !Number.isNaN(eLng)) {
                                    const points = [[sLat, sLng], ...nextWaypoints.map(w => [w.lat, w.lng]), [eLat, eLng]];
                                    return { ...curr, roadLength: calculateSnappedPolylineDistanceKm(points).toFixed(2) };
                                  }
                                  return curr;
                                });
                                return nextWaypoints;
                              });
                            }}
                            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                            placeholder="Latitude"
                          />
                          <input
                            type="number"
                            step="any"
                            value={point.lng}
                            onChange={(e) => {
                              const value = e.target.value;
                              setNewProjectRouteWaypoints((prev) => {
                                const nextWaypoints = prev.map((p, i) => i === idx ? { ...p, lng: value } : p);
                                setFormData((curr) => {
                                  const sLat = parseCoordinate(curr.startLatitude);
                                  const sLng = parseCoordinate(curr.startLongitude);
                                  const eLat = parseCoordinate(curr.endLatitude);
                                  const eLng = parseCoordinate(curr.endLongitude);
                                  if (!Number.isNaN(sLat) && !Number.isNaN(sLng) && !Number.isNaN(eLat) && !Number.isNaN(eLng)) {
                                    const points = [[sLat, sLng], ...nextWaypoints.map(w => [w.lat, w.lng]), [eLat, eLng]];
                                    return { ...curr, roadLength: calculateSnappedPolylineDistanceKm(points).toFixed(2) };
                                  }
                                  return curr;
                                });
                                return nextWaypoints;
                              });
                            }}
                            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                            placeholder="Longitude"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setNewProjectRouteWaypoints((prev) => {
                                const nextWaypoints = prev.filter((_, i) => i !== idx);
                                setFormData((curr) => {
                                  const sLat = parseCoordinate(curr.startLatitude);
                                  const sLng = parseCoordinate(curr.startLongitude);
                                  const eLat = parseCoordinate(curr.endLatitude);
                                  const eLng = parseCoordinate(curr.endLongitude);
                                  if (!Number.isNaN(sLat) && !Number.isNaN(sLng) && !Number.isNaN(eLat) && !Number.isNaN(eLng)) {
                                    const points = [[sLat, sLng], ...nextWaypoints.map(w => [w.lat, w.lng]), [eLat, eLng]];
                                    return { ...curr, roadLength: calculateSnappedPolylineDistanceKm(points).toFixed(2) };
                                  }
                                  return curr;
                                });
                                return nextWaypoints;
                              });
                            }}
                            className="px-3 py-2 rounded-lg bg-red-50 text-red-600 text-xs font-semibold border border-red-200 hover:bg-red-100"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Road Length (km) *</label>
                  <input type="number" step="0.01" name="roadLength" value={formData.roadLength} readOnly required className="w-full px-5 py-3 border border-slate-200 rounded-xl bg-slate-50 cursor-not-allowed font-semibold text-slate-700" placeholder="Auto-calculated" />
                  <p className="text-xs text-slate-500 mt-1">Auto-calculated from start and end coordinates.</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Road Type *</label>
                  <select name="roadType" value="Concrete" disabled className="w-full px-5 py-3 border border-slate-200 rounded-xl bg-slate-50 cursor-not-allowed font-semibold text-slate-700 focus:outline-none">
                    <option value="Concrete">Concrete</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Total Budget (₱) *</label>
                  <input type="number" name="totalBudget" value={formData.totalBudget} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" placeholder="12500000" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Funding Source *</label>
                  <select name="budgetSource" value="DA" disabled className="w-full px-5 py-3 border border-slate-200 rounded-xl bg-slate-50 cursor-not-allowed font-semibold text-slate-700 focus:outline-none">
                    <option value="DA">DA</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Assign Contractor</label>
                  <select
                    value={newProjectContractorId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setNewProjectContractorId(id);
                      if (id) {
                        const c = contractors.find((item) => item.id === id);
                        if (c) handleInputChange({ target: { name: 'contractor', value: c.full_name || c.email } });
                      } else {
                        handleInputChange({ target: { name: 'contractor', value: '' } });
                      }
                    }}
                    disabled={contractors.length === 0}
                    className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 disabled:bg-slate-50 disabled:cursor-not-allowed"
                  >
                    <option value="">{contractors.length > 0 ? '— Select a registered contractor —' : 'No contractors registered yet'}</option>
                    {contractors.map((c) => (
                      <option key={c.id} value={c.id}>{c.full_name || c.email}</option>
                    ))}
                  </select>
                  {contractors.length === 0 ? (
                    <p className="text-xs text-amber-700 mt-1.5">
                      Register contractors first in Settings → Contractors so you can distribute this project.
                    </p>
                  ) : newProjectContractorId ? (
                    <p className="text-xs text-amber-700 mt-1.5 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                      Assigned contractor will see this project in their portal.
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500 mt-1.5">You can leave this unassigned and assign later.</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Start Date *</label>
                  <input type="date" name="startDate" value={formData.startDate} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Expected End Date *</label>
                  <input type="date" name="expectedEndDate" value={formData.expectedEndDate} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Description</label>
                  <textarea name="description" value={formData.description} onChange={handleInputChange} rows="3" className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 resize-none" placeholder="Project description..." />
                </div>
              </div>
            </form>
            <div className="px-8 py-5 border-t border-slate-200/60 bg-slate-50/50 flex justify-end gap-4">
              <button type="button" onClick={() => { setShowAddModal(false); setNewProjectContractorId(''); setNewProjectRouteWaypoints([]); setPendingProposalLink(null); }} className="px-6 py-3 border border-slate-200 rounded-xl font-semibold text-sm hover:bg-slate-100 transition-all duration-200">Cancel</button>
              <button type="submit" onClick={handleAddProject} className="px-6 py-3 bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg shadow-teal-500/25">Create Project</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Project Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-8 py-6 border-b border-slate-200/60 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Edit Project</h2>
                <p className="text-sm text-slate-500 mt-1">{selectedProject?.projectCode}</p>
              </div>
              <button onClick={() => { setShowEditModal(false); setSelectedProject(null); }} className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors duration-200">
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleEditProject} className="flex-1 overflow-y-auto p-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Project Name *</label>
                  <input type="text" name="projectName" value={formData.projectName} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Status *</label>
                  <select name="status" value={formData.status} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200">
                    <option value="Planning">Planning</option>
                    <option value="Bidding">Bidding</option>
                    <option value="In Progress">In Progress</option>
                    <option value="On Hold">On Hold</option>
                    <option value="Completed">Completed</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Progress (%) *</label>
                  <input type="number" min="0" max="100" name="progress" value={formData.progress} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Region</label>
                  <input type="text" name="region" value={formData.region} readOnly className="w-full px-5 py-3 border border-slate-200 rounded-xl bg-slate-50 cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Province</label>
                  <input type="text" name="province" value={formData.province} readOnly className="w-full px-5 py-3 border border-slate-200 rounded-xl bg-slate-50 cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Municipality</label>
                  <select name="municipality" value={formData.municipality} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200">
                    <option value="">Select municipality</option>
                    {getMunicipalities().map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Barangay</label>
                  <select name="barangay" value={formData.barangay} onChange={handleInputChange} disabled={!formData.municipality} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 disabled:bg-slate-50 disabled:cursor-not-allowed">
                    <option value="">Select barangay</option>
                    {getBarangays(formData.municipality).map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Road Length (km)</label>
                  <input type="number" step="0.01" name="roadLength" value={formData.roadLength} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Road Width (m)</label>
                  <input type="number" step="0.1" name="roadWidth" value={formData.roadWidth} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Total Budget (₱)</label>
                  <input type="number" name="totalBudget" value={formData.totalBudget} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Disbursed Amount (₱)</label>
                  <input type="number" name="disbursedAmount" value={formData.disbursedAmount} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Contractor</label>
                  <input type="text" name="contractor" value={formData.contractor} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Start Date</label>
                  <input type="date" name="startDate" value={formData.startDate} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Expected End Date</label>
                  <input type="date" name="expectedEndDate" value={formData.expectedEndDate} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Description</label>
                  <textarea name="description" value={formData.description} onChange={handleInputChange} rows="3" className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 resize-none" />
                </div>
              </div>
            </form>
            <div className="px-8 py-5 border-t border-slate-200/60 bg-slate-50/50 flex justify-end gap-4">
              <button type="button" onClick={() => { setShowEditModal(false); setSelectedProject(null); }} className="px-6 py-3 border border-slate-200 rounded-xl font-semibold text-sm hover:bg-slate-100 transition-all duration-200">Cancel</button>
              <button type="submit" onClick={handleEditProject} className="px-6 py-3 bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg shadow-teal-500/25">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
            <div className="text-center">
              <div className="w-18 h-18 bg-gradient-to-br from-red-50 to-red-100 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ width: '72px', height: '72px' }}>
                <svg className="w-9 h-9 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3 tracking-tight">Delete Project?</h3>
              <p className="text-slate-500 mb-8">
                Are you sure you want to delete <span className="font-semibold text-slate-700">{selectedProject?.projectName}</span>? This action cannot be undone.
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => { setShowDeleteModal(false); setSelectedProject(null); }}
                  className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-semibold text-sm hover:bg-slate-100 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteProject}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-700 hover:to-red-600 text-white rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg shadow-red-500/25"
                >
                  Delete Project
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assign Contractor Modal */}
      {assignContractorModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="px-8 py-6 border-b border-slate-200/60 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Assign Contractor</h2>
                <p className="text-sm text-slate-500 mt-1 line-clamp-1">{assignContractorModal.project_name}</p>
              </div>
              <button onClick={() => setAssignContractorModal(null)} className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors duration-200">
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-8">
              {contractors.length === 0 ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-4">
                  No contractors registered yet. Go to <strong>Settings → Contractors</strong> to register one first.
                </p>
              ) : (
                <>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Select Contractor</label>
                  <select
                    value={selectedContractorId}
                    onChange={(e) => setSelectedContractorId(e.target.value)}
                    className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 mb-6 text-sm"
                  >
                    <option value="">— None (unassign) —</option>
                    {contractors.map(c => (
                      <option key={c.id} value={c.id}>{c.full_name || c.email}</option>
                    ))}
                  </select>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setAssignContractorModal(null)}
                      className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-semibold text-sm hover:bg-slate-100 transition-all duration-200"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={assigningContractor}
                      onClick={async () => {
                        await assignContractorToProject(assignContractorModal.id, selectedContractorId || null);
                        setAssignContractorModal(null);
                      }}
                      className="flex-1 px-6 py-3 bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg shadow-teal-500/25 disabled:opacity-50"
                    >
                      {assigningContractor ? 'Saving…' : 'Assign'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {adminMapProgressEdit && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="px-6 py-5 border-b border-slate-200/60 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Update Progress</h3>
                <p className="text-sm text-slate-500 mt-0.5 line-clamp-1">{adminMapProgressEdit.project_name}</p>
              </div>
              <button onClick={() => setAdminMapProgressEdit(null)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Accomplishment (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={adminMapProgressEdit.accomplishment}
                  onChange={(e) => setAdminMapProgressEdit((prev) => ({ ...prev, accomplishment: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none"
                />
              </div>
              <div className="flex items-center justify-end gap-3">
                <button onClick={() => setAdminMapProgressEdit(null)} className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={handleSaveAdminMapProgress} className="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm font-medium">
                  Save Progress
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FMR Edit Modal */}
      {showFmrEditModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-8 py-6 border-b border-slate-200/60 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Edit FMR Project</h2>
                <p className="text-sm text-slate-500 mt-1">{selectedFmrProject?.project_name}</p>
              </div>
              <button onClick={() => { setShowFmrEditModal(false); setSelectedFmrProject(null); }} className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors duration-200">
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleEditFmrProject} className="flex-1 overflow-y-auto p-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Project Name *</label>
                  <input
                    type="text"
                    name="project_name"
                    value={fmrFormData.project_name}
                    onChange={handleFmrInputChange}
                    required
                    readOnly={selectedFmrProject && lguProposals.some(p => p.fmr_project_id === selectedFmrProject.id)}
                    disabled={selectedFmrProject && lguProposals.some(p => p.fmr_project_id === selectedFmrProject.id)}
                    className={`w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 ${
                      (selectedFmrProject && lguProposals.some(p => p.fmr_project_id === selectedFmrProject.id)) ? 'bg-slate-100 cursor-not-allowed text-slate-500 font-semibold' : ''
                    }`}
                  />
                  {selectedFmrProject && lguProposals.some(p => p.fmr_project_id === selectedFmrProject.id) && (
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                      🔒 Locked to match the validated LGU proposal name for traceability.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Status *</label>
                  <select name="status" value={fmrFormData.status} onChange={handleFmrInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200">
                    <option value="Completed">Completed</option>
                    <option value="On-Going">On-Going</option>
                    <option value="Proposed">Proposed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Year Funded</label>
                  <input type="number" name="year_funded" value={fmrFormData.year_funded} onChange={handleFmrInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Municipality</label>
                  <select name="municipality" value={fmrFormData.municipality} onChange={handleFmrInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200">
                    <option value="">Select municipality</option>
                    {getMunicipalities().map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Province</label>
                  <input type="text" name="province" value={fmrFormData.province} readOnly className="w-full px-5 py-3 border border-slate-200 rounded-xl bg-slate-50 cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Accomplishment (%)</label>
                  <input type="number" min="0" max="100" step="0.01" name="accomplishment" value={fmrFormData.accomplishment} onChange={handleFmrInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Road Length (km)</label>
                  <input type="number" step="0.01" name="project_length_km" value={fmrFormData.project_length_km} onChange={handleFmrInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Total Budget (₱)</label>
                  <input type="number" name="total_budget" value={fmrFormData.total_budget} onChange={handleFmrInputChange} placeholder={`Leave blank to auto-estimate (₱15M × km)`} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                  <p className="text-xs text-slate-400 mt-1">Blank = shown to citizens as an estimate (DA-BAFE ₱15M/km), not an official figure.</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Funds Released (₱)</label>
                  <input type="number" name="funds_released" value={fmrFormData.funds_released} onChange={handleFmrInputChange} placeholder="Leave blank to auto-estimate from progress" className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Funding Source</label>
                  <input type="text" name="funding_source" value={fmrFormData.funding_source} onChange={handleFmrInputChange} placeholder="e.g. DA-PRDP, GAA 2026, LGU" className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Location / Address</label>
                  <input type="text" name="location" value={fmrFormData.location} onChange={handleFmrInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Start Latitude</label>
                  <input type="number" step="any" name="start_latitude" value={fmrFormData.start_latitude} onChange={handleFmrInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Start Longitude</label>
                  <input type="number" step="any" name="start_longitude" value={fmrFormData.start_longitude} onChange={handleFmrInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">End Latitude</label>
                  <input type="number" step="any" name="end_latitude" value={fmrFormData.end_latitude} onChange={handleFmrInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">End Longitude</label>
                  <input type="number" step="any" name="end_longitude" value={fmrFormData.end_longitude} onChange={handleFmrInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div className="md:col-span-2 border border-slate-200 rounded-2xl p-4 bg-slate-50/40 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">Project Route</h3>
                      <p className="text-xs text-slate-500">Set route start/end and add waypoints directly on the map.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        ['start', 'Set Start'],
                        ['end', 'Set End'],
                        ['waypoint', 'Add Waypoint'],
                      ].map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setFmrRouteMode(mode)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${fmrRouteMode === mode ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                        >
                          {label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={async () => {
                          const sLat = parseCoordinate(fmrFormData.start_latitude);
                          const sLng = parseCoordinate(fmrFormData.start_longitude);
                          const eLat = parseCoordinate(fmrFormData.end_latitude);
                          const eLng = parseCoordinate(fmrFormData.end_longitude);

                          if (Number.isNaN(sLat) || Number.isNaN(sLng) || Number.isNaN(eLat) || Number.isNaN(eLng)) {
                            showNotification('Please set both Start and End coordinates first.', 'error');
                            return;
                          }

                          try {
                            const snappedPoints = await fetchRoadAlignedPolyline([[sLat, sLng], ...fmrRouteWaypoints.map(w => [w.lat, w.lng]), [eLat, eLng]]);
                            if (snappedPoints && snappedPoints.length >= 2) {
                              const first = snappedPoints[0];
                              const last = snappedPoints[snappedPoints.length - 1];
                              const middle = snappedPoints.slice(1, snappedPoints.length - 1).map(pt => ({ lat: pt[0], lng: pt[1] }));

                              setFmrRouteWaypoints(middle);
                              const totalDist = calculateSnappedPolylineDistanceKm(snappedPoints);
                              setFmrFormData(prev => ({
                                ...prev,
                                start_latitude: first[0].toFixed(6),
                                start_longitude: first[1].toFixed(6),
                                end_latitude: last[0].toFixed(6),
                                end_longitude: last[1].toFixed(6),
                                project_length_km: totalDist.toFixed(2)
                              }));
                              showNotification('Snapped successfully to road alignment!');
                            } else {
                              showNotification('Could not find road connection between coordinates.', 'error');
                            }
                          } catch (err) {
                            showNotification('Failed to connect coordinates to road network.', 'error');
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100"
                      >
                        ⚡ Snap to Road
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFmrFormData(prev => ({
                            ...prev,
                            start_latitude: '',
                            start_longitude: '',
                            end_latitude: '',
                            end_longitude: ''
                          }));
                          setFmrRouteWaypoints([]);
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="h-64 rounded-xl overflow-hidden border border-slate-200 relative">
                    {/* Map Search Overlay */}
                    <div className="absolute top-2 left-12 z-[1000] flex gap-1 bg-white p-1 rounded-lg shadow-md border border-slate-200/80 max-w-[280px] w-full">
                      <input
                        type="text"
                        placeholder="Search location (e.g. Sto. Tomas, Leon)..."
                        value={editMapSearchQuery}
                        onChange={(e) => setEditMapSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleEditMapSearch();
                          }
                        }}
                        className="flex-1 px-2.5 py-1 text-[11px] bg-slate-50 border border-slate-200 rounded outline-none focus:ring-1 focus:ring-teal-500"
                      />
                      <button
                        type="button"
                        onClick={handleEditMapSearch}
                        className="px-2.5 py-1 text-[11px] font-semibold text-white bg-teal-600 rounded hover:bg-teal-700 active:scale-95 transition-all shadow-sm"
                      >
                        Go
                      </button>
                    </div>

                    <MapContainer center={[10.89, 122.45]} zoom={10} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      <MapSearchController searchCoords={editMapSearchCoords} />
                      <EditModalMapController
                        projectId={selectedFmrProject?.id}
                        startLat={fmrFormData.start_latitude}
                        startLng={fmrFormData.start_longitude}
                        endLat={fmrFormData.end_latitude}
                        endLng={fmrFormData.end_longitude}
                      />
                      <RouteEditorMapClick onPickPoint={handleFmrRoutePick} />
                      {editMapSearchCoords && (
                        <Marker position={editMapSearchCoords}>
                          <Popup>
                            <span className="text-xs font-semibold text-slate-800">Search: {editMapSearchQuery}</span>
                          </Popup>
                        </Marker>
                      )}
                      {fmrRoutePreview.length >= 2 && (
                        <>
                          <Polyline positions={fmrRoutePreview} pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.9 }} />
                          <Polyline positions={fmrRoutePreview} pathOptions={{ color: '#0d9488', weight: 5, opacity: 0.95 }} />
                        </>
                      )}
                      {fmrRoutePreview[0] && (
                        <CircleMarker center={fmrRoutePreview[0]} radius={7} pathOptions={{ color: '#166534', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }} />
                      )}
                      {fmrRoutePreview.length > 1 && (
                        <Marker
                          position={fmrRoutePreview[fmrRoutePreview.length - 1]}
                          icon={L.divIcon({
                            className: 'edit-route-end',
                            html: '<div style="width:16px;height:16px;background:#ef4444;border:2px solid #991b1b;border-radius:3px;"></div>',
                            iconSize: [16, 16],
                            iconAnchor: [8, 8],
                          })}
                        />
                      )}
                    </MapContainer>
                  </div>

                  {fmrRouteWaypoints.length > 0 && (
                    <div className="space-y-2">
                      {fmrRouteWaypoints.map((point, idx) => (
                        <div key={`edit-waypoint-${idx}`} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                          <input
                            type="number"
                            step="any"
                            value={point.lat}
                            onChange={(e) => {
                              const value = e.target.value;
                              setFmrRouteWaypoints((prev) => {
                                const nextWaypoints = prev.map((p, i) => i === idx ? { ...p, lat: value } : p);
                                setFmrFormData((curr) => {
                                  const sLat = parseCoordinate(curr.start_latitude);
                                  const sLng = parseCoordinate(curr.start_longitude);
                                  const eLat = parseCoordinate(curr.end_latitude);
                                  const eLng = parseCoordinate(curr.end_longitude);
                                  if (!Number.isNaN(sLat) && !Number.isNaN(sLng) && !Number.isNaN(eLat) && !Number.isNaN(eLng)) {
                                    const points = [[sLat, sLng], ...nextWaypoints.map(w => [w.lat, w.lng]), [eLat, eLng]];
                                    return { ...curr, project_length_km: calculateSnappedPolylineDistanceKm(points).toFixed(2) };
                                  }
                                  return curr;
                                });
                                return nextWaypoints;
                              });
                            }}
                            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                            placeholder="Latitude"
                          />
                          <input
                            type="number"
                            step="any"
                            value={point.lng}
                            onChange={(e) => {
                              const value = e.target.value;
                              setFmrRouteWaypoints((prev) => {
                                const nextWaypoints = prev.map((p, i) => i === idx ? { ...p, lng: value } : p);
                                setFmrFormData((curr) => {
                                  const sLat = parseCoordinate(curr.start_latitude);
                                  const sLng = parseCoordinate(curr.start_longitude);
                                  const eLat = parseCoordinate(curr.end_latitude);
                                  const eLng = parseCoordinate(curr.end_longitude);
                                  if (!Number.isNaN(sLat) && !Number.isNaN(sLng) && !Number.isNaN(eLat) && !Number.isNaN(eLng)) {
                                    const points = [[sLat, sLng], ...nextWaypoints.map(w => [w.lat, w.lng]), [eLat, eLng]];
                                    return { ...curr, project_length_km: calculateSnappedPolylineDistanceKm(points).toFixed(2) };
                                  }
                                  return curr;
                                });
                                return nextWaypoints;
                              });
                            }}
                            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                            placeholder="Longitude"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setFmrRouteWaypoints((prev) => {
                                const nextWaypoints = prev.filter((_, i) => i !== idx);
                                setFmrFormData((curr) => {
                                  const sLat = parseCoordinate(curr.start_latitude);
                                  const sLng = parseCoordinate(curr.start_longitude);
                                  const eLat = parseCoordinate(curr.end_latitude);
                                  const eLng = parseCoordinate(curr.end_longitude);
                                  if (!Number.isNaN(sLat) && !Number.isNaN(sLng) && !Number.isNaN(eLat) && !Number.isNaN(eLng)) {
                                    const points = [[sLat, sLng], ...nextWaypoints.map(w => [w.lat, w.lng]), [eLat, eLng]];
                                    return { ...curr, project_length_km: calculateSnappedPolylineDistanceKm(points).toFixed(2) };
                                  }
                                  return curr;
                                });
                                return nextWaypoints;
                              });
                            }}
                            className="px-3 py-2 rounded-lg bg-red-50 text-red-600 text-xs font-semibold border border-red-200 hover:bg-red-100"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Date Completed</label>
                  <input type="date" name="date_completed" value={fmrFormData.date_completed} onChange={handleFmrInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Target Completion Date</label>
                  <input type="date" name="target_completion_date" value={fmrFormData.target_completion_date} onChange={handleFmrInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Remarks</label>
                  <textarea name="remarks" value={fmrFormData.remarks} onChange={handleFmrInputChange} rows="3" className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 resize-none" />
                </div>
              </div>
            </form>
            <div className="px-8 py-5 border-t border-slate-200/60 bg-slate-50/50 flex justify-end gap-4">
              <button type="button" onClick={() => { setShowFmrEditModal(false); setSelectedFmrProject(null); }} className="px-6 py-3 border border-slate-200 rounded-xl font-semibold text-sm hover:bg-slate-100 transition-all duration-200">Cancel</button>
              <button type="submit" onClick={handleEditFmrProject} className="px-6 py-3 bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg shadow-teal-500/25">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* FMR Delete Confirmation Modal */}
      {showFmrDeleteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
            <div className="text-center">
              <div className="w-18 h-18 bg-gradient-to-br from-red-50 to-red-100 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ width: '72px', height: '72px' }}>
                <svg className="w-9 h-9 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3 tracking-tight">Delete FMR Project?</h3>
              <p className="text-slate-500 mb-8">
                Are you sure you want to delete <span className="font-semibold text-slate-700">{selectedFmrProject?.project_name}</span>? This action cannot be undone.
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => { setShowFmrDeleteModal(false); setSelectedFmrProject(null); }}
                  className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-semibold text-sm hover:bg-slate-100 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteFmrProject}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-700 hover:to-red-600 text-white rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg shadow-red-500/25"
                >
                  Delete Project
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Project Reports Modal — shows public reports linked to a project */}
      {selectedProjectDetail && (() => {
        const project = selectedProjectDetail;
        const rawProject = project._raw || project;
        const detailValue = (...keys) => {
          for (const key of keys) {
            const value = project?.[key] ?? rawProject?.[key];
            if (value !== undefined && value !== null && value !== '') return value;
          }
          return null;
        };
        const projectName = detailValue('projectName', 'project_name') || 'Unnamed Project';
        const barangayLabel = detailValue('barangay', 'location');
        const locationLabel = [barangayLabel, detailValue('municipality'), detailValue('province')].filter(Boolean).join(', ') || 'N/A';
        const latitude = Number(detailValue('latitude', 'start_latitude'));
        const longitude = Number(detailValue('longitude', 'start_longitude'));
        const endLatitude = Number(detailValue('end_latitude', 'endLatitude'));
        const endLongitude = Number(detailValue('end_longitude', 'endLongitude'));
        const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
        const hasEndCoordinates = Number.isFinite(endLatitude) && Number.isFinite(endLongitude);
        const budgetValue = detailValue('totalBudget', 'total_budget', 'budget', 'project_cost', 'cost', 'allocated_budget');
        const contractorName = detailValue('contractor', 'contractor_name', 'contractor_id') || 'N/A';
        const progressValue = Number(detailValue('progress', 'accomplishment') ?? 0);
        const projectLength = Number(detailValue('roadLength', 'project_length_km') ?? 0);
        const displayStatus = detailValue('status') || 'N/A';
        const isFmrProject = project._source === 'fmr' || Boolean(rawProject.project_name || rawProject.project_length_km);
        const sourceLabel = isFmrProject ? 'DA FMR Project' : 'Admin Project';
        const projectCode = detailValue('projectCode', 'project_code') || (isFmrProject ? `FMR-${rawProject.id}` : 'N/A');

        return (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setSelectedProjectDetail(null)}>
            <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 bg-gradient-to-r from-slate-50 to-white">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Project Details</p>
                  <h3 className="mt-1 text-2xl font-bold text-slate-900">{projectName}</h3>
                  <p className="mt-1 text-sm text-slate-500">Detailed {sourceLabel.toLowerCase()} record for DA review.</p>
                </div>
                <button onClick={() => setSelectedProjectDetail(null)} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Location</p>
                    <p className="mt-2 text-lg font-semibold text-slate-900">{locationLabel}</p>
                    <p className="mt-1 text-sm text-slate-500">{detailValue('municipality') || 'N/A'} {detailValue('province') ? `, ${detailValue('province')}` : ''}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Status</p>
                    <p className="mt-2 text-lg font-semibold text-slate-900">{renderStatusPill(displayStatus, displayStatus)}</p>
                    <p className="mt-1 text-sm text-slate-500">Progress {Number.isFinite(progressValue) ? `${progressValue}%` : 'N/A'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Budget / Contractor</p>
                    <p className="mt-2 text-lg font-semibold text-slate-900">{formatCurrency(Number(budgetValue) || 0)}</p>
                    <p className="mt-1 text-sm text-slate-500">Contractor: {contractorName}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h4 className="text-lg font-bold text-slate-900">Citizen-facing summary</h4>
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs uppercase tracking-wider text-slate-500">Project Name</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{projectName}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs uppercase tracking-wider text-slate-500">Road Length</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{projectLength ? `${projectLength} km` : 'N/A'}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs uppercase tracking-wider text-slate-500">Municipality</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{detailValue('municipality') || 'N/A'}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs uppercase tracking-wider text-slate-500">Province</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{detailValue('province') || 'N/A'}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs uppercase tracking-wider text-slate-500">Year Funded</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{detailValue('year_funded', 'yearFunded') || 'N/A'}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs uppercase tracking-wider text-slate-500">Road Type</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{detailValue('roadType', 'road_type') || 'N/A'}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs uppercase tracking-wider text-slate-500">Target Completion</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{formatProjectDetailDate(detailValue('target_completion_date', 'targetCompletionDate'))}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs uppercase tracking-wider text-slate-500">Date Completed</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{formatProjectDetailDate(detailValue('date_completed', 'dateCompleted'))}</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h4 className="text-lg font-bold text-slate-900">Location data</h4>
                    <div className="mt-4 space-y-3 text-sm text-slate-700">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs uppercase tracking-wider text-slate-500">Barangay</p>
                        <p className="mt-1 font-semibold text-slate-900">{barangayLabel || 'N/A'}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs uppercase tracking-wider text-slate-500">Start Coordinates</p>
                        <p className="mt-1 font-semibold text-slate-900">{hasCoordinates ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` : 'N/A'}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs uppercase tracking-wider text-slate-500">End Coordinates</p>
                        <p className="mt-1 font-semibold text-slate-900">{hasEndCoordinates ? `${endLatitude.toFixed(6)}, ${endLongitude.toFixed(6)}` : 'N/A'}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs uppercase tracking-wider text-slate-500">Project Code</p>
                        <p className="mt-1 font-semibold text-slate-900">{projectCode}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs uppercase tracking-wider text-slate-500">Record Source</p>
                        <p className="mt-1 font-semibold text-slate-900">{sourceLabel}</p>
                      </div>
                    </div>
                    {hasCoordinates && (
                      <a
                        href={`https://www.google.com/maps?q=${latitude},${longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-4 inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                      >
                        Open on Google Maps
                      </a>
                    )}
                  </div>
                </div>

                {(detailValue('description') || detailValue('remarks')) && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h4 className="text-lg font-bold text-slate-900">{detailValue('description') ? 'Description' : 'Remarks'}</h4>
                    <p className="mt-3 text-sm leading-7 text-slate-600">{detailValue('description') || detailValue('remarks')}</p>
                  </div>
                )}

              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
                {isFmrProject && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProjectDetail(null);
                      openFmrEditModal(rawProject);
                    }}
                    className="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 shadow-md shadow-teal-600/10"
                  >
                    Define Route / GPS
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedProjectDetail(null)}
                  className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {projectFeedbackModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setProjectFeedbackModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-slate-200/60 flex items-start justify-between bg-gradient-to-r from-slate-50 to-white">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Public Reports</h3>
                <p className="text-sm text-slate-500 mt-0.5">{projectFeedbackModal.projectName} — {projectFeedbackModal.barangay}, {projectFeedbackModal.municipality}</p>
              </div>
              <button onClick={() => setProjectFeedbackModal(null)} className="p-2 hover:bg-slate-100 rounded-xl transition">
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {projectFeedbackLoading ? (
                <div className="py-12 text-center">
                  <div className="animate-spin mx-auto w-8 h-8 border-2 border-slate-300 border-t-teal-600 rounded-full mb-3" />
                  <p className="text-sm text-slate-400">Loading reports…</p>
                </div>
              ) : projectLinkedReports.length === 0 ? (
                <EmptyState
                  title="No public reports yet"
                  description="No public reports have been submitted for this project."
                />
              ) : (
                <>
                  {/* Summary chips */}
                  <div className="flex gap-3 flex-wrap">
                    <span className="px-3 py-1.5 bg-violet-50 border border-violet-200 rounded-lg text-xs font-semibold text-violet-700">
                      {projectLinkedReports.length} Public Report{projectLinkedReports.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Anonymous public reports */}
                  {projectLinkedReports.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                        <svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3" /></svg>
                        Anonymous / Public Reports
                      </h4>
                      <div className="space-y-3">
                        {projectLinkedReports.map(rpt => {
                          const verifyMap = { 'Verified On-Site': { icon: '✔', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }, 'Needs Review': { icon: '⚠', cls: 'bg-amber-50 text-amber-700 border-amber-200' }, 'Location Mismatch': { icon: '✖', cls: 'bg-red-50 text-red-700 border-red-200' } };
                          const vInfo = verifyMap[rpt.verification] || { icon: '?', cls: 'bg-slate-50 text-slate-600 border-slate-200' };
                          const statusStyles = { pending: 'bg-amber-100 text-amber-700', reviewed: 'bg-blue-100 text-blue-700', resolved: 'bg-emerald-100 text-emerald-700' };
                          return (
                            <div key={rpt.id} className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                              <div className="flex items-center gap-2 flex-wrap mb-2">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border ${vInfo.cls}`}>
                                  {vInfo.icon} {rpt.verification}
                                </span>
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[rpt.status] || 'bg-slate-100 text-slate-600'}`}>
                                  {rpt.status?.charAt(0).toUpperCase() + rpt.status?.slice(1)}
                                </span>
                                <span className="text-xs text-slate-400 ml-auto">{new Date(rpt.created_at).toLocaleDateString()}</span>
                              </div>
                              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{rpt.description}</p>
                              {rpt.photo_url && (
                                <a href={rpt.photo_url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                                  <img src={rpt.photo_url} alt="Site photo" className="h-20 w-auto object-cover rounded-lg border border-slate-200 hover:opacity-80 transition" />
                                </a>
                              )}
                              {(rpt.latitude || rpt.longitude) && (
                                <p className="text-xs text-slate-400 mt-1.5">📍 {Number(rpt.latitude).toFixed(5)}, {Number(rpt.longitude).toFixed(5)}</p>
                              )}
                              <p className="text-xs text-slate-400 mt-1">— {rpt.full_name || 'Anonymous'}{rpt.contact_info ? ` · ${rpt.contact_info}` : ''}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
