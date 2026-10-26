import { CircleHelpIcon, PlusIcon, CircleCheckIcon, HourglassIcon, LandPlotIcon, LockIcon, TriangleAlertIcon, MapPinIcon, UsersIcon, WheatIcon, RouteIcon, StoreIcon, SearchIcon, XIcon, DownloadIcon, ChevronDownIcon, ArrowUpDownIcon } from 'lucide-react';
import StaffProfile from '../components/profile/StaffProfile';
import { BeneficiaryKeyCards } from '../components/admin/BeneficiaryAnalytics';
import { SidebarAccount, SidebarBrand, SidebarFooter, SidebarGroupLabel, SidebarNav, SidebarNavItem, SidebarSignOut } from '../components/ui/SidebarParts';
import ProfileAvatar from '../components/ui/ProfileAvatar';
import PortalHeader from '../components/ui/PortalHeader';
import { useProfileNameUpdates, useRememberedName } from '../lib/profileName';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents, Popup, Polyline, Polygon, CircleMarker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { supabaseLgu as supabase, supabaseAdmin } from '../lib/supabase';
import { notify } from '../lib/toast';
import { confirm, confirmSignOut } from '../lib/confirm';
import { barangayGeometry, checkPinInBarangay, lineCrossesBarangay, useBarangayBoundaries } from '../lib/barangayLocator';
import { findRoadAccess, rankRoadsByAccess, snapRoadLine } from '../lib/farmRoadAccess';
import { chooseAttachPoint, loadAccessData } from '../lib/farmAttach';
import { findDuplicateFarmer, projectsAlongRoute, registrationSuggestions } from '../lib/farmerRegistrationChecks';
import { typicalYieldTPerHa } from '../lib/harvestPlausibility';
import RequiredReminder from '../components/publicReports/reportForm/RequiredReminder';
import { MODAL_OVERLAY, MODAL_PANEL, ModalEffects } from '../components/ui/Modal';
import NotificationBell from '../components/NotificationBell';
import LguRouteMap from '../components/lgu/LguRouteMap';
import LguAnalyticsTab from '../components/lgu/LguAnalyticsTab';
import RoadInventoryTab from '../components/lgu/RoadInventoryTab';
import MarketManagement from '../components/lgu/MarketManagement';
import LguProjectProposalsTab from '../components/lgu/LguProjectProposalsTab';
import HandlerReportsPanel from '../components/publicReports/HandlerReportsPanel';
import PageTour from '../components/ui/PageTour';
import { usePageTour } from '../lib/usePageTour';
import { LGU_PAGE_TOURS } from '../components/lgu/lguPageTours';
import { buildHandlerQueue, countHandlerStages, useHandlerFollowUps } from '../lib/handlerFollowUps';
import { handlerFor } from '../lib/publicReportStatus';
import { lguHandlesWholeRegion } from '../lib/lguTestingScope';
import { getBarangays, getMunicipalities } from '../data/iloiloLocations';
import { BENEFICIARY_CROPS } from '../utils/farmerBeneficiaryData';
import { getMunicipalityCentroid, buildRoutePoints, geocodeFmrLocation, fetchRoadAlignedPolyline, calculatePolylineDistanceKm, nearestPointOnPolyline } from '../lib/mapRouteUtils';
import { ConnectionStatus } from '../components/ui/SidebarStatusCards';
import MapSearchBox from '../components/map/MapSearchBox';
import { usernameToSyntheticEmail, normalizeUsername } from '../lib/farmerAuth';
import roadInventory from '../data/leonRoadInventory.json';
import Logo from '../components/Logo';
import { getPaginationRange } from '../lib/paginationUtils';
import { storeGlyph, routeGlyph } from '../lib/mapMarkerIcons';
import { normalizeUserProjectStatus } from '../lib/projectStatus';
import { isHaltedStatus } from '../lib/delayCases';
import { FmrProjectKpis } from '../components/fmrProjects/FmrProjectListParts';
import HierarchyKpis from '../components/ui/HierarchyKpis';
import SearchableSelect from '../components/ui/SearchableSelect';

// Notifications about a follow-up job assigned to the LGU.
const LGU_JOB_NOTIFICATIONS = ['public_report_repair_assigned', 'public_report_repair_reopened', 'repair_overdue'];

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function resolveEffectiveRole(profileRole, metadataRole) {
  const normalizedProfileRole = normalizeRole(profileRole);
  const normalizedMetadataRole = normalizeRole(metadataRole);

  if (normalizedProfileRole && normalizedProfileRole !== 'user') return normalizedProfileRole;
  if (normalizedMetadataRole && normalizedMetadataRole !== 'user') return normalizedMetadataRole;
  return normalizedProfileRole || normalizedMetadataRole || 'user';
}

function cardTone(kind) {
  if (kind === 'pending') return 'bg-amber-50 border-amber-200 text-amber-700';
  if (kind === 'resolved') return 'bg-emerald-50 border-emerald-200 text-emerald-700';
  if (kind === 'escalated') return 'bg-indigo-50 border-indigo-200 text-indigo-700';
  return 'bg-slate-50 border-slate-200 text-slate-700';
}

function statusTone(status) {
  if (status === 'resolved') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'reviewed') return 'bg-sky-50 text-sky-700 ring-sky-200';
  return 'bg-amber-50 text-amber-700 ring-amber-200';
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 0;
  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Best-known point for an FMR project marker: its own stored coordinates if
// present, otherwise a geocoded fallback looked up by id from coordMap.
function resolveProjectPoint(project, coordMap) {
  const startLat = Number(project.start_latitude);
  const startLng = Number(project.start_longitude);
  if (startLat && startLng) return [startLat, startLng];
  return coordMap[project.id] || null;
}

function suggestedRoadIcon(isExactMatch) {
  return new L.DivIcon({
    className: 'suggested-fmr-pin',
    html: `<div style="background:#f59e0b;opacity:${isExactMatch ? 1 : 0.7};color:#fff;width:26px;height:26px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.25);font-size:12px">${routeGlyph(13)}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function beneficiaryMarketIcon(isNearest) {
  return new L.DivIcon({
    className: 'beneficiary-market-pin',
    html: `<div style="background:${isNearest ? '#4338ca' : '#64748b'};color:#fff;width:24px;height:24px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.2);font-size:11px">${storeGlyph(14)}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function ModalMapController({ farmCoords, marketCoords, roadPoints }) {
  const map = useMap();
  useEffect(() => {
    const pts = [];
    if (farmCoords && farmCoords[0] && farmCoords[1]) pts.push(farmCoords);
    if (marketCoords && marketCoords[0] && marketCoords[1]) pts.push(marketCoords);
    if (Array.isArray(roadPoints)) {
      roadPoints.forEach(p => {
        if (p && p[0] && p[1]) pts.push(p);
      });
    }
    if (pts.length > 0) {
      const lats = pts.map(p => p[0]);
      const lngs = pts.map(p => p[1]);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      map.fitBounds([
        [minLat - 0.002, minLng - 0.002],
        [maxLat + 0.002, maxLng + 0.002]
      ], { padding: [24, 24], animate: true, duration: 1.2 });
    }
  }, [map, farmCoords, marketCoords, roadPoints]);
  return null;
}

function MapClickPicker({ onPick }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    }
  });
  return null;
}

// Moves the registration map only when something that matters (the farm pin,
// where it meets the road) is off-screen. A click to place the pin is always
// on-screen already, so pinning never makes the map jump; a searched place or
// a road suggestion outside the view gets one smooth fly instead.
function FormMapCamera({ points }) {
  const map = useMap();
  const valid = (points || []).filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]));
  const key = valid.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join('|');
  const pointsRef = useRef(valid);
  useEffect(() => {
    pointsRef.current = valid;
  });
  useEffect(() => {
    const pts = pointsRef.current;
    if (pts.length === 0) return;
    const bounds = L.latLngBounds(pts);
    if (map.getBounds().pad(-0.05).contains(bounds)) return;
    if (pts.length === 1) map.flyTo(pts[0], Math.max(map.getZoom(), 15), { duration: 0.8 });
    else map.flyToBounds(bounds, { padding: [48, 48], maxZoom: 16, duration: 0.8 });
  }, [map, key]);
  return null;
}

function normalizeBeneficiaryRow(row) {
  const farmLatitude = row.farm_latitude !== undefined && row.farm_latitude !== null
    ? Number(row.farm_latitude)
    : (row.gps && row.gps.lat !== undefined ? Number(row.gps.lat) : null);
  const farmLongitude = row.farm_longitude !== undefined && row.farm_longitude !== null
    ? Number(row.farm_longitude)
    : (row.gps && row.gps.lng !== undefined ? Number(row.gps.lng) : null);

  return {
    id: row.id,
    userId: row.user_id || null,
    beneficiaryId: row.beneficiary_id || row.id,
    fullName: row.full_name || 'Unnamed Farmer',
    rsbsaNumber: row.rsbsa_number || '',
    controlNo: row.control_no || '',
    firstName: row.first_name || '',
    middleName: row.middle_name || '',
    lastName: row.last_name || '',
    extName: row.ext_name || '',
    birthday: row.birthday || '',
    gender: row.gender || '',
    agency: row.agency || 'DA',
    farmLatitude,
    farmLongitude,
    nearestMarketId: row.nearest_market_id || null,
    contactNumber: row.contact_number || '',
    municipality: row.municipality || '',
    barangay: row.barangay || '',
    crop: row.crop || '',
    farmAreaHa: Number(row.farm_area_ha || 0),
    estimatedYield: Number(row.estimated_yield || 0),
    linkedProjectId: row.linked_project_id || '',
    linkedProject: row.linked_project_name || '',
    linkedProjectStatus: row.linked_project_status || '',
    distanceToFmrKm: Number(row.distance_to_fmr_km || 0),
    serviceArea: row.service_area || '',
    benefitReason: row.benefit_reason || '',
    beneficiaryStatus: row.beneficiary_status || 'Under Review',
    validationStatus: row.validation_status || 'For Verification',
    submittedByLgu: row.submitted_by_lgu || row.created_by_name || '',
    createdByUserId: row.created_by_user_id || '',
    createdByName: row.created_by_name || '',
    adminRemarks: row.admin_remarks || '',
    supportingDocuments: Array.isArray(row.supporting_documents) ? row.supporting_documents : [],
    validationHistory: Array.isArray(row.validation_history) ? row.validation_history : [],
    // The real registration date (or creation date) -- never "now" for a missing one.
    submittedDate: (row.submitted_date || row.created_at) ? new Date(row.submitted_date || row.created_at) : null,
    lastUpdated: row.last_updated ? new Date(row.last_updated) : new Date(),
    gps: row.gps || { lat: farmLatitude, lng: farmLongitude }
  };
}

export default function LguDashboard() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const headerName = useRememberedName(supabase, 'lgu', profile ? (profile.full_name || 'LGU Administrator') : null);
  const [activeTab, setActiveTab] = useState('overview');
  useProfileNameUpdates(useCallback((name) => setProfile((p) => (p ? { ...p, full_name: name } : p)), []));
  const [loading, setLoading] = useState(true);
  // Set by a notification click so the proposals tab can open the exact proposal.
  const [focusProposalId, setFocusProposalId] = useState(null);
  const clearFocusProposal = useCallback(() => setFocusProposalId(null), []);

  const [reports, setReports] = useState([]);
  const [projects, setProjects] = useState([]);
  const [routesByProjectId, setRoutesByProjectId] = useState({});
  const [roadGaps, setRoadGaps] = useState([]);
  const [projectTranches, setProjectTranches] = useState([]);
  const [escalations, setEscalations] = useState([]);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [harvestLogs, setHarvestLogs] = useState([]);
  // Per-source load errors for Analytics, so a failed query reads as
  // "unavailable" there instead of an empty array posing as a real zero.
  const [analyticsErrors, setAnalyticsErrors] = useState({ projects: null, harvest: null, beneficiaries: null });
  const [beneficiariesLoading, setBeneficiariesLoading] = useState(false);
  const [beneficiarySearch, setBeneficiarySearch] = useState('');
  const [beneficiaryCropFilter, setBeneficiaryCropFilter] = useState('all');
  const [beneficiaryBarangayFilter, setBeneficiaryBarangayFilter] = useState('all');
  const [beneficiarySortBy, setBeneficiarySortBy] = useState('area-desc');
  const [beneficiaryPage, setBeneficiaryPage] = useState(1);
  const [markets, setMarkets] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [beneficiaryForm, setBeneficiaryForm] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    extName: '',
    rsbsaNumber: '',
    controlNo: '',
    contactNumber: '',
    birthday: '',
    gender: '',
    agency: 'DA Region VI',
    municipality: '',
    barangay: '',
    crop: '',
    farmAreaHa: '',
    linkedProjectId: '',
    nearestMarketId: '',
    farmLatitude: '',
    farmLongitude: '',
    benefitReason: '',
    createAccount: false,
    accountUsername: '',
    accountPassword: '',
  });

  const [barangayFilter, setBarangayFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [lguMapSearch, setLguMapSearch] = useState('');
  const [lguMapYearFilter, setLguMapYearFilter] = useState('All');
  const [lguMapStatusFilter, setLguMapStatusFilter] = useState('On-Going');
  const [lguMapBarangayFilter, setLguMapBarangayFilter] = useState('All');
  const [lguMapDateFrom, setLguMapDateFrom] = useState('');
  const [lguMapDateTo, setLguMapDateTo] = useState('');
  const [lguMapShowOverdueOnly, setLguMapShowOverdueOnly] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [lguMapCenter, setLguMapCenter] = useState(null);
  const [lguMapZoom, setLguMapZoom] = useState(11);
  const [lguMapSearchMarker, setLguMapSearchMarker] = useState(null);
  const [beneficiarySubTab, setBeneficiarySubTab] = useState('list');
  const [selectedFarmerForModal, setSelectedFarmerForModal] = useState(null);

  useEffect(() => {
    if (beneficiarySubTab === 'register' && !editingId) {
      setBeneficiaryForm((current) => {
        const updates = {};
        if (!current.rsbsaNumber) {
          const num = 100000 + (beneficiaries?.length || 0) * 37 + Math.floor(Math.random() * 1000);
          updates.rsbsaNumber = `RSBSA-06-${num}`;
        }
        if (!current.controlNo) {
          const randomNum = 10000 + Math.floor(Math.random() * 90000);
          updates.controlNo = `CTRL-${new Date().getFullYear()}-${randomNum}`;
        }
        if (Object.keys(updates).length > 0) {
          return { ...current, ...updates };
        }
        return current;
      });
    }
  }, [beneficiarySubTab, editingId, beneficiaries?.length, beneficiaryForm.rsbsaNumber, beneficiaryForm.controlNo]);

  const municipalityScope = profile?.municipality || user?.user_metadata?.municipality || '';
  // A municipal LGU account can only register farmers in its own municipality,
  // so the form's municipality is locked to it rather than left for the officer.
  const formMunicipality = municipalityScope || beneficiaryForm.municipality;
  // Steps 1-2 come first: the farm can only be pinned once the farmer and the
  // barangay are known, so roads are suggested for the right barangay.
  const pinPrerequisites = [
    !beneficiaryForm.firstName.trim() && { key: 'first', label: 'First name', targetId: 'ben-first-name' },
    !beneficiaryForm.lastName.trim() && { key: 'last', label: 'Last name', targetId: 'ben-last-name' },
    !beneficiaryForm.gender && { key: 'sex', label: 'Sex', targetId: 'ben-sex' },
    !formMunicipality && { key: 'town', label: 'Municipality', targetId: 'ben-municipality' },
    !beneficiaryForm.barangay && { key: 'brgy', label: 'Barangay', targetId: 'ben-barangay' },
    !beneficiaryForm.crop && { key: 'crop', label: 'Main crop', targetId: 'ben-crop' },
    !(Number(beneficiaryForm.farmAreaHa) > 0) && { key: 'area', label: 'Farm area', targetId: 'ben-farm-area' },
  ].filter(Boolean);
  const canPin = pinPrerequisites.length === 0;

  // The farmer is already in the registry (same name + birthday/barangay, or
  // same contact number): registering again is not allowed.
  const duplicateFarmer = useMemo(
    () => findDuplicateFarmer({ ...beneficiaryForm, municipality: formMunicipality }, beneficiaries, editingId),
    [beneficiaryForm, formMunicipality, beneficiaries, editingId],
  );

  // Changing where the farm is (municipality, barangay) or which road it uses
  // makes the old pin wrong, so it is removed and must be placed again. Only the
  // officer's own changes do this -- the road picked automatically after pinning
  // does not (that would remove the pin it was picked from).
  const changeFarmLocation = (patch) => {
    const hadPin = Boolean(beneficiaryForm.farmLatitude || beneficiaryForm.farmLongitude);
    const changed = Object.entries(patch).some(([k, v]) => String(beneficiaryForm[k] ?? '') !== String(v ?? ''));
    setBeneficiaryForm((current) => ({
      ...current,
      ...patch,
      ...(hadPin && changed ? { farmLatitude: '', farmLongitude: '' } : {}),
    }));
    if (hadPin && changed) {
      notify('The farm pin was removed because the location or road changed. Please pin the farm again.', 'warning');
    }
  };
  const farmPinnedRaw = Boolean(Number(beneficiaryForm.farmLatitude) && Number(beneficiaryForm.farmLongitude));
  // A pin outside the chosen barangay is flagged and NOT used to suggest roads,
  // so roads from another barangay are never suggested (lib/barangayLocator.js).
  // Official PSA/NAMRIA boundaries for the municipality, loaded on demand;
  // until they arrive (or where a barangay has none) the approximate check is used.
  const boundariesReady = useBarangayBoundaries(formMunicipality);
  const pinCheck = useMemo(() => checkPinInBarangay({
    lat: beneficiaryForm.farmLatitude,
    lng: beneficiaryForm.farmLongitude,
    municipality: formMunicipality,
    barangay: beneficiaryForm.barangay,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boundariesReady re-runs the check once the file loads
  }), [beneficiaryForm.farmLatitude, beneficiaryForm.farmLongitude, formMunicipality, beneficiaryForm.barangay, boundariesReady]);
  // "in Brgy. X", or "outside Leon" when the pin is beyond the municipality.
  const pinActualPlace = pinCheck.nearest?.name
    ? (pinCheck.nearest.name.startsWith('outside ') ? pinCheck.nearest.name : `in Brgy. ${pinCheck.nearest.name}`)
    : 'in another barangay';
  // Outline of the chosen barangay, drawn on the map (Leaflet wants [lat, lng]).
  const barangayOutline = useMemo(() => {
    const geom = boundariesReady ? barangayGeometry(formMunicipality, beneficiaryForm.barangay) : null;
    if (!geom) return null;
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
    return polys.map((rings) => rings.map((ring) => ring.map(([lng, lat]) => [lat, lng])));
  }, [boundariesReady, formMunicipality, beneficiaryForm.barangay]);
  const pinOutsideBarangay = farmPinnedRaw && pinCheck.status === 'outside';
  const farmPinned = farmPinnedRaw && !pinOutsideBarangay;
  const eligibleMunicipalities = useMemo(() => {
    if (municipalityScope) return [municipalityScope];
    return getMunicipalities();
  }, [municipalityScope]);

  const beneficiaryProjectOptions = useMemo(() => {
    return [...projects].sort((a, b) => String(a.project_name || '').localeCompare(String(b.project_name || '')));
  }, [projects]);

  // --- Map-assisted road/market suggestions for the beneficiary registration form ---
  // Suggest FMR projects that plausibly serve the selected barangay: exact
  // text matches against the project's location/name first; if there are
  // none, fall back to other same-municipality projects that already have
  // stored coordinates (so the fallback never needs extra geocode calls).
  const suggestedProjects = useMemo(() => {
    const municipality = (beneficiaryForm.municipality || municipalityScope || '').trim();
    const barangay = (beneficiaryForm.barangay || '').trim();
    if (!municipality || !barangay) return { items: [], isFallback: false, truncatedCount: 0 };

    const normMuni = municipality.toLowerCase();
    const muniProjects = projects.filter((p) => String(p.municipality || '').trim().toLowerCase() === normMuni);

    // A road belongs to the barangay when its barangay, location or name says
    // so, or its saved route runs through the barangay.
    const normBarangay = barangay.toLowerCase();
    const inBarangay = muniProjects.filter((p) => {
      if (String(p.barangay || '').trim().toLowerCase() === normBarangay) return true;
      const haystack = `${p.location || ''} ${p.project_name || ''}`.toLowerCase();
      if (haystack.includes(normBarangay)) return true;
      return lineCrossesBarangay(buildRoutePoints(p, routesByProjectId[p.id]).points, municipality, barangay);
    });
    // Once the farm is pinned, the barangay's boundary is not a wall: a road just
    // outside it can be the farm's real way out (e.g. across the river from the
    // barangay's own road). Add the nearest roads within NEARBY_ROAD_KM; all are
    // then ranked by real road distance below.
    const farmLat = Number(beneficiaryForm.farmLatitude);
    const farmLng = Number(beneficiaryForm.farmLongitude);
    if (farmPinnedRaw && farmLat && farmLng) {
      const inIds = new Set(inBarangay.map((p) => p.id));
      const NEARBY_ROAD_KM = 5;
      const nearby = muniProjects
        .filter((p) => !inIds.has(p.id))
        .map((p) => {
          const line = buildRoutePoints(p, routesByProjectId[p.id]).points;
          const hit = line.length ? nearestPointOnPolyline([farmLat, farmLng], line) : null;
          return hit ? { p, km: hit.distanceMeters / 1000 } : null;
        })
        .filter((x) => x && x.km <= NEARBY_ROAD_KM)
        .sort((a, b) => a.km - b.km)
        .slice(0, 8)
        .map((x) => ({ ...x.p, isExactMatch: false, outsideBarangay: true }));
      return {
        items: [...inBarangay.map((p) => ({ ...p, isExactMatch: true })), ...nearby],
        isFallback: inBarangay.length === 0,
        truncatedCount: 0,
      };
    }

    if (inBarangay.length > 0) {
      return { items: inBarangay.map((p) => ({ ...p, isExactMatch: true })), isFallback: false, truncatedCount: 0 };
    }

    // No road in this barangay yet: offer only the few nearest mapped roads
    // in the municipality (ranked by distance below), clearly labelled.
    const withCoords = muniProjects.filter((p) => Number(p.start_latitude) && Number(p.start_longitude));
    return {
      items: withCoords.map((p) => ({ ...p, isExactMatch: false })),
      isFallback: true,
      truncatedCount: 0,
    };
    // boundariesReady re-runs the barangay match once the official boundaries load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, beneficiaryForm.municipality, beneficiaryForm.barangay, municipalityScope, routesByProjectId, boundariesReady, farmPinnedRaw, beneficiaryForm.farmLatitude, beneficiaryForm.farmLongitude]);

  // Coordinates for exact-match suggestions that don't already have stored
  // start/end points, resolved on demand via geocodeFmrLocation (cached).
  const [suggestedProjectCoords, setSuggestedProjectCoords] = useState({});

  useEffect(() => {
    const toGeocode = suggestedProjects.items.filter((p) =>
      p.isExactMatch &&
      !(Number(p.start_latitude) && Number(p.start_longitude)) &&
      !(p.id in suggestedProjectCoords)
    );
    if (toGeocode.length === 0) return undefined;

    let cancelled = false;
    Promise.all(
      toGeocode.map(async (p) => [p.id, await geocodeFmrLocation(p.municipality, p.location || p.project_name)])
    ).then((entries) => {
      if (cancelled) return;
      setSuggestedProjectCoords((prev) => {
        const next = { ...prev };
        entries.forEach(([id, coord]) => { next[id] = coord; });
        return next;
      });
    });

    return () => { cancelled = true; };
  }, [suggestedProjects, suggestedProjectCoords]);

  // Reference point used to rank suggestions and find the nearest market:
  // the farm pin once placed, else the closest resolvable suggested
  // project, else the municipality centroid (always available, no network call).
  const suggestionReferencePoint = useMemo(() => {
    if (farmPinned) return [Number(beneficiaryForm.farmLatitude), Number(beneficiaryForm.farmLongitude)];

    for (const p of suggestedProjects.items) {
      const point = resolveProjectPoint(p, suggestedProjectCoords);
      if (point) return point;
    }

    const municipality = beneficiaryForm.municipality || municipalityScope;
    return municipality ? getMunicipalityCentroid(municipality) : null;
  }, [farmPinned, beneficiaryForm.farmLatitude, beneficiaryForm.farmLongitude, beneficiaryForm.municipality, municipalityScope, suggestedProjects, suggestedProjectCoords]);

  // Suggested projects with resolved points + distance from the reference
  // point, closest first, for both display order and connector-line choice.
  // With the farm pinned, distance is to the nearest point ALONG each road
  // (its saved route line), and `access` is where the farm meets that road.
  // Roads saved with only their two ends are drawn along the real road network
  // (a straight line can cut across a river); see snapRoadLine.
  const [snappedRoadLines, setSnappedRoadLines] = useState({});
  useEffect(() => {
    const todo = suggestedProjects.items.filter((p) => !(p.id in snappedRoadLines));
    if (todo.length === 0) return undefined;
    let cancelled = false;
    Promise.all(todo.map(async (p) => {
      const line = buildRoutePoints(p, routesByProjectId[p.id]).points;
      return [p.id, line.length >= 2 && line.length <= 3 ? await snapRoadLine(line) : null];
    })).then((entries) => {
      if (cancelled) return;
      setSnappedRoadLines((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => { cancelled = true; };
  }, [suggestedProjects, routesByProjectId, snappedRoadLines]);

  // Suggested roads with their line and straight-line distance (first guess).
  const baseRankedProjects = useMemo(() => {
    const ref = suggestionReferencePoint;
    return suggestedProjects.items.map((p) => {
      const point = resolveProjectPoint(p, suggestedProjectCoords);
      const routeLine = snappedRoadLines[p.id] || buildRoutePoints(p, routesByProjectId[p.id]).points;
      const line = routeLine.length > 0 ? routeLine : (point ? [point] : []);
      const access = farmPinned && ref ? nearestPointOnPolyline(ref, line) : null;
      const distanceMeters = access
        ? access.distanceMeters
        : (point && ref ? haversineMeters(ref[0], ref[1], point[0], point[1]) : Infinity);
      return { ...p, point, line, access, distanceMeters, byRoad: false };
    });
  }, [suggestedProjects, suggestedProjectCoords, suggestionReferencePoint, routesByProjectId, farmPinned, snappedRoadLines]);

  // Where the farm joins the road network without crossing a river (lib/farmAttach.js).
  const [accessData, setAccessData] = useState({ town: '', data: null });
  useEffect(() => {
    let alive = true;
    loadAccessData(formMunicipality).then((data) => { if (alive) setAccessData({ town: formMunicipality, data }); });
    return () => { alive = false; };
  }, [formMunicipality]);
  const farmAttach = useMemo(() => {
    if (!farmPinned || accessData.town !== formMunicipality || !accessData.data) return null;
    return chooseAttachPoint([Number(beneficiaryForm.farmLatitude), Number(beneficiaryForm.farmLongitude)], accessData.data);
  }, [farmPinned, accessData, formMunicipality, beneficiaryForm.farmLatitude, beneficiaryForm.farmLongitude]);
  const attachKey = farmAttach ? farmAttach.point.map((v) => v.toFixed(5)).join(',') : 'none';

  // Once the farm is pinned, rank the roads by the real distance BY ROAD (one
  // request): the closest road as the crow flies can be across a river.
  const roadRankKey = farmPinned
    ? `${beneficiaryForm.farmLatitude},${beneficiaryForm.farmLongitude}@${attachKey}|${baseRankedProjects.map((p) => `${p.id}:${p.line.length}`).join(',')}`
    : '';
  const [roadRank, setRoadRank] = useState({ key: '', byId: null });
  useEffect(() => {
    if (!roadRankKey || baseRankedProjects.length === 0) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const farm = [Number(beneficiaryForm.farmLatitude), Number(beneficiaryForm.farmLongitude)];
      const byId = await rankRoadsByAccess(farm, baseRankedProjects.map((p) => ({ id: p.id, line: p.line })), farmAttach);
      if (!cancelled) setRoadRank({ key: roadRankKey, byId });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
    // roadRankKey captures the pin and every road line used.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roadRankKey]);
  const roadRankReady = roadRank.key === roadRankKey && roadRankKey !== '' && roadRank.byId?.size > 0;

  // Closest first, by road when known, for display order and the linked road.
  const rankedSuggestedProjects = useMemo(() => {
    const ranked = baseRankedProjects
      .map((p) => {
        const net = roadRankReady ? roadRank.byId.get(p.id) : null;
        return net ? { ...p, distanceMeters: net.meters, byRoad: true } : (roadRankReady ? { ...p, distanceMeters: Infinity, unreachable: true } : p);
      })
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
    // A barangay without its own road falls back to the 3 nearest in the town.
    return suggestedProjects.isFallback && !farmPinned ? ranked.slice(0, 3) : ranked;
  }, [farmPinned, baseRankedProjects, roadRankReady, roadRank, suggestedProjects.isFallback]);

  const nearestSuggestedMarket = useMemo(() => {
    if (!suggestionReferencePoint || markets.length === 0) return null;
    const [refLat, refLng] = suggestionReferencePoint;
    let nearest = null;
    let bestDist = Infinity;
    markets.forEach((m) => {
      const mLat = Number(m.latitude);
      const mLng = Number(m.longitude);
      if (!mLat || !mLng) return;
      const d = haversineMeters(refLat, refLng, mLat, mLng);
      if (d < bestDist) {
        bestDist = d;
        nearest = m;
      }
    });
    return nearest ? { market: nearest, distanceMeters: bestDist } : null;
  }, [suggestionReferencePoint, markets]);

  // The market the route is drawn to: the one chosen in the form, else the nearest.
  const routeMarket = useMemo(() => {
    const chosen = markets.find((m) => String(m.id) === String(beneficiaryForm.nearestMarketId));
    if (chosen && Number(chosen.latitude) && Number(chosen.longitude)) return chosen;
    return nearestSuggestedMarket?.market || null;
  }, [markets, beneficiaryForm.nearestMarketId, nearestSuggestedMarket]);

  // Markets in the dropdown, closest to the farm (or barangay) first.
  const marketOptions = useMemo(() => {
    const ref = suggestionReferencePoint;
    return markets
      .map((m) => {
        const lat = Number(m.latitude);
        const lng = Number(m.longitude);
        const km = ref && lat && lng ? haversineMeters(ref[0], ref[1], lat, lng) / 1000 : null;
        return { ...m, km };
      })
      .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
  }, [markets, suggestionReferencePoint]);

  // The project a road-to-market connector line is drawn for: whichever is
  // currently linked in the form, else the closest suggestion.
  const connectorProject = useMemo(() => {
    if (beneficiaryForm.linkedProjectId) {
      const selected = rankedSuggestedProjects.find((p) => String(p.id) === String(beneficiaryForm.linkedProjectId));
      if (selected?.point) return selected;
    }
    return rankedSuggestedProjects.find((p) => p.point) || null;
  }, [rankedSuggestedProjects, beneficiaryForm.linkedProjectId]);

  // Farm -> road link: how the farm actually reaches the linked (or closest)
  // road BY ROAD. The closest point as the crow flies can be across a river,
  // so spots along the road are tested on the road network and the shortest
  // real route wins (lib/farmRoadAccess.js). Waits for the pin to settle so
  // clicking around the map doesn't send a request per click.
  const farmPoint = farmPinned ? [Number(beneficiaryForm.farmLatitude), Number(beneficiaryForm.farmLongitude)] : null;
  const connectorLine = connectorProject?.line || null;
  const farmLinkKey = farmPoint && connectorLine?.length ? `${farmPoint.join(',')}@${attachKey}>${connectorProject.id}` : '';
  const [farmLink, setFarmLink] = useState({ key: '', access: null });

  useEffect(() => {
    if (!farmLinkKey || !farmPoint || !connectorLine?.length) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const access = await findRoadAccess(farmPoint, connectorLine, farmAttach);
      if (!cancelled) setFarmLink({ key: farmLinkKey, access });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
    // farmLinkKey captures the pin and the road; farmPoint/connectorLine are
    // rebuilt each render and would restart the wait on unrelated updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmLinkKey]);

  const farmLinkReady = farmLink.key === farmLinkKey && farmLinkKey !== '' && Boolean(farmLink.access);
  const farmAccess = farmLinkReady ? farmLink.access : null;
  const farmLinkFinding = farmLinkKey !== '' && farmLink.key !== farmLinkKey;
  const carryLeg = farmAccess?.byRoad && farmAccess.carryMeters > 30 ? farmAccess.path.slice(0, 2) : null;
  const farmLinkPoints = farmAccess ? (carryLeg ? farmAccess.path.slice(1) : farmAccess.path) : null;

  const [connectorRoute, setConnectorRoute] = useState(null);

  useEffect(() => {
    // From where the farm actually meets its road (farm access), else the road's own point.
    const point = farmAccess?.point || connectorProject?.point || null;
    const marketPoint = routeMarket
      ? [Number(routeMarket.latitude), Number(routeMarket.longitude)]
      : null;

    let cancelled = false;
    const routePromise = (point && marketPoint)
      ? fetchRoadAlignedPolyline([point, marketPoint])
      : Promise.resolve(null);

    routePromise.then((snapped) => {
      if (cancelled) return;
      setConnectorRoute(snapped ? {
        points: snapped,
        distanceKm: calculatePolylineDistanceKm(snapped),
        projectId: connectorProject.id,
      } : null);
    });

    return () => { cancelled = true; };
  }, [connectorProject, routeMarket, farmAccess]);

  // Every FMR road the farm-to-market route actually runs along (not just the
  // nearest one): farm -> linked road -> ... -> market.
  const routeProjects = useMemo(() => {
    const route = [...(farmAccess?.path || []), ...(connectorRoute?.points || [])];
    if (route.length < 2) return [];
    const normMuni = String(formMunicipality || '').trim().toLowerCase();
    const candidates = projects
      .filter((p) => String(p.municipality || '').trim().toLowerCase() === normMuni)
      .map((p) => ({ id: p.id, name: p.project_name, line: snappedRoadLines[p.id] || buildRoutePoints(p, routesByProjectId[p.id]).points }));
    const found = projectsAlongRoute(route, candidates);
    // The linked road always counts (the farm joins the route there).
    if (connectorProject && !found.some((f) => String(f.id) === String(connectorProject.id))) {
      found.unshift({ id: connectorProject.id, name: connectorProject.project_name, overlapMeters: 0, order: -1 });
    }
    return found;
  }, [farmAccess, connectorRoute, projects, formMunicipality, snappedRoadLines, routesByProjectId, connectorProject]);
  const routeProjectIds = useMemo(() => new Set(routeProjects.map((p) => String(p.id))), [routeProjects]);

  // Auto-fill "Linked FMR project" with the closest suggestion once one is
  // known, but never overwrite a value the officer chose themselves (via
  // this dropdown, a map click, or one already present when editing an
  // existing beneficiary) -- only a value this effect itself last set.
  const autoLinkedProjectIdRef = useRef(null);

  useEffect(() => {
    if (!beneficiaryForm.barangay || !formMunicipality) return;

    const top = rankedSuggestedProjects.find((p) => p.point) || null;
    const nextId = top ? String(top.id) : '';

    setBeneficiaryForm((curr) => {
      const isUntouchedSinceAutoFill = !curr.linkedProjectId || curr.linkedProjectId === autoLinkedProjectIdRef.current;
      if (!isUntouchedSinceAutoFill || curr.linkedProjectId === nextId) return curr;
      return { ...curr, linkedProjectId: nextId };
    });
    autoLinkedProjectIdRef.current = nextId || null;
  }, [rankedSuggestedProjects, beneficiaryForm.barangay, formMunicipality]);

  // Toast telling the officer how many roads were found for the selected
  // barangay, so they don't have to notice the map/legend themselves. Once per
  // barangay choice: the ranking also changes on every pin click, and a toast
  // per click would be noise (the bar above the map says which road is nearest).
  const announcedBarangayRef = useRef('');
  useEffect(() => {
    if (!beneficiaryForm.barangay || !formMunicipality) return undefined;
    const announceKey = `${formMunicipality}|${beneficiaryForm.barangay}`;
    if (announcedBarangayRef.current === announceKey) return undefined;

    // Don't announce a count until any exact-match geocoding has settled.
    const stillResolving = suggestedProjects.items.some((p) =>
      p.isExactMatch &&
      !(Number(p.start_latitude) && Number(p.start_longitude)) &&
      !(p.id in suggestedProjectCoords)
    );
    if (stillResolving) return undefined;

    const count = rankedSuggestedProjects.filter((p) => p.point).length;
    let text;
    if (count > 0 && !suggestedProjects.isFallback) {
      text = `${count} suggested road${count === 1 ? '' : 's'} found in ${beneficiaryForm.barangay}.`;
    } else if (count > 0 && suggestedProjects.isFallback) {
      text = `No road project directly in ${beneficiaryForm.barangay} — showing ${count} nearby road${count === 1 ? '' : 's'} in ${formMunicipality}.`;
    } else {
      text = `No FMR road project found near ${beneficiaryForm.barangay}, ${formMunicipality} — link one manually if needed.`;
    }

    announcedBarangayRef.current = announceKey;
    notify(text, count > 0 ? 'success' : 'warning');
    return undefined;
  }, [beneficiaryForm.barangay, formMunicipality, suggestedProjects, suggestedProjectCoords, rankedSuggestedProjects]);


  const tranchesByProjectId = useMemo(() => {
    const map = {};
    (projectTranches || []).forEach((t) => {
      if (!map[t.project_id]) map[t.project_id] = [];
      map[t.project_id].push(t);
    });
    return map;
  }, [projectTranches]);

  const lguMapYearOptions = useMemo(() => {
    return [...new Set(projects.map(p => Number(p.year_funded)).filter(y => y && !isNaN(y)))].sort((a, b) => b - a);
  }, [projects]);

  const lguMapBarangayOptions = useMemo(() => {
    const list = (projects || []).map(p => p.barangay).filter(Boolean);
    return ['All', ...Array.from(new Set(list))].sort();
  }, [projects]);

  const filteredMapProjects = useMemo(() => {
    return projects.filter(p => {
      const q = lguMapSearch.toLowerCase();
      const name = (p.project_name || '').toLowerCase();
      const loc = (p.location || '').toLowerCase();
      const src = (p.source || '').toLowerCase();
      const matchesSearch = !q || name.includes(q) || loc.includes(q) || src.includes(q);

      const status = p.status || p.project_status || 'Proposed';
      const normalizedStatus = status === 'In Progress' ? 'On-Going' : status === 'Planning' ? 'Proposed' : status;
      const matchesStatus = lguMapStatusFilter === 'All' || normalizedStatus === lguMapStatusFilter;

      const matchesYear = lguMapYearFilter === 'All' || String(Number(p.year_funded)) === lguMapYearFilter;

      const matchesBarangay = lguMapBarangayFilter === 'All' || p.barangay === lguMapBarangayFilter;

      const created = p.created_at ? new Date(p.created_at) : null;
      let matchesDate = true;
      if (lguMapDateFrom && created && created < new Date(`${lguMapDateFrom}T00:00:00`)) matchesDate = false;
      if (lguMapDateTo && created && created > new Date(`${lguMapDateTo}T23:59:59`)) matchesDate = false;

      let matchesOverdue = true;
      if (lguMapShowOverdueOnly) {
        const isCompleted = normalizedStatus === 'Completed' || status.toLowerCase() === 'completed' || isHaltedStatus(status);
        const target = p.target_completion_date ? new Date(p.target_completion_date) : null;
        const isOverdue = !isCompleted && target && target < new Date();
        if (!isOverdue) matchesOverdue = false;
      }

      return matchesSearch && matchesStatus && matchesYear && matchesBarangay && matchesDate && matchesOverdue;
    });
  }, [projects, lguMapSearch, lguMapStatusFilter, lguMapYearFilter, lguMapBarangayFilter, lguMapDateFrom, lguMapDateTo, lguMapShowOverdueOnly]);

  const filteredBeneficiaries = useMemo(() => {
    const query = beneficiarySearch.trim().toLowerCase();

    // 1. Filter
    const filtered = beneficiaries.filter((row) => {
      if (beneficiaryCropFilter !== 'all' && row.crop !== beneficiaryCropFilter) return false;
      if (beneficiaryBarangayFilter !== 'all' && row.barangay !== beneficiaryBarangayFilter) return false;
      if (!query) return true;
      return [row.fullName, row.beneficiaryId, row.rsbsaNumber, row.controlNo, row.municipality, row.barangay, row.crop, row.linkedProject]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });

    // 2. Sort
    return [...filtered].sort((a, b) => {
      if (beneficiarySortBy === 'name-asc') {
        return (a.fullName || '').localeCompare(b.fullName || '');
      }
      if (beneficiarySortBy === 'name-desc') {
        return (b.fullName || '').localeCompare(a.fullName || '');
      }
      if (beneficiarySortBy === 'newest') {
        return new Date(b.submittedDate) - new Date(a.submittedDate);
      }
      if (beneficiarySortBy === 'oldest') {
        return new Date(a.submittedDate) - new Date(b.submittedDate);
      }
      if (beneficiarySortBy === 'area-desc') {
        return Number(b.farmAreaHa || 0) - Number(a.farmAreaHa || 0);
      }
      if (beneficiarySortBy === 'area-asc') {
        return Number(a.farmAreaHa || 0) - Number(b.farmAreaHa || 0);
      }
      return 0;
    });
  }, [beneficiaries, beneficiarySearch, beneficiaryCropFilter, beneficiaryBarangayFilter, beneficiarySortBy]);

  // Computed from the records, replacing a card that always read "100% Validated".
  const beneficiaryStats = useMemo(() => {
    const total = beneficiaries.length;
    const areaHa = beneficiaries.reduce((sum, b) => sum + (Number(b.farmAreaHa) || 0), 0);
    const cropCounts = {};
    beneficiaries.forEach((b) => { if (b.crop) cropCounts[b.crop] = (cropCounts[b.crop] || 0) + 1; });
    const topCrops = Object.entries(cropCounts).sort((a, b) => b[1] - a[1]);
    const linkedToRoad = beneficiaries.filter((b) => b.linkedProjectId).length;
    return {
      total,
      topCrops,
      barangays: new Set(beneficiaries.map((b) => b.barangay).filter(Boolean)).size,
      linkedToRoad,
      linkedPct: total > 0 ? (linkedToRoad / total) * 100 : null,
      areaHa,
      avgAreaHa: total > 0 ? areaHa / total : null,
    };
  }, [beneficiaries]);

  // Filter options come from the records themselves, not a hardcoded list.
  const beneficiaryFilterOptions = useMemo(() => {
    const STATUS_ORDER = ['For Verification', 'Needs Correction', 'Validated', 'Duplicate Record', 'Rejected', 'Archived'];
    const present = new Set(beneficiaries.map((b) => b.validationStatus).filter(Boolean));
    const unique = (key) => [...new Set(beneficiaries.map((b) => b[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const countBy = (key) => beneficiaries.reduce((acc, b) => {
      if (b[key]) acc[b[key]] = (acc[b[key]] || 0) + 1;
      return acc;
    }, {});
    return {
      statuses: STATUS_ORDER.filter((s) => present.has(s)),
      crops: unique('crop'),
      barangays: unique('barangay'),
      counts: { status: countBy('validationStatus'), crop: countBy('crop'), barangay: countBy('barangay') },
    };
  }, [beneficiaries]);

  // Export exactly what the list shows (current filters and sort).
  const exportBeneficiariesCsv = () => {
    const cols = [
      ['RSBSA No.', 'rsbsaNumber'], ['Control No.', 'controlNo'], ['Full name', 'fullName'],
      ['Barangay', 'barangay'], ['Municipality', 'municipality'], ['Crop', 'crop'],
      ['Farm area (ha)', 'farmAreaHa'], ['Linked FMR project', 'linkedProject'],
      ['Distance to FMR (km)', 'distanceToFmrKm'], ['Validation status', 'validationStatus'],
    ];
    // Prefix cells that a spreadsheet would run as a formula.
    const cell = (v) => {
      const text = String(v ?? '');
      const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const csv = [cols.map(([h]) => cell(h)).join(','), ...filteredBeneficiaries.map((row) => cols.map(([, k]) => cell(row[k])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `farmers_${(municipalityScope || 'all').toLowerCase().replace(/\s+/g, '-')}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const beneficiaryFiltersActive = Boolean(beneficiarySearch.trim())
    || beneficiaryCropFilter !== 'all'
    || beneficiaryBarangayFilter !== 'all';
  const clearBeneficiaryFilters = () => {
    setBeneficiarySearch('');
    setBeneficiaryCropFilter('all');
    setBeneficiaryBarangayFilter('all');
  };

  useEffect(() => {
    setBeneficiaryPage(1);
  }, [beneficiarySearch, beneficiaryCropFilter, beneficiaryBarangayFilter, beneficiarySortBy]);

  const beneficiaryRowsPerPage = 8;
  const totalBeneficiaryPages = Math.ceil(filteredBeneficiaries.length / beneficiaryRowsPerPage);

  useEffect(() => {
    if (beneficiaryPage > totalBeneficiaryPages && totalBeneficiaryPages > 0) {
      setBeneficiaryPage(totalBeneficiaryPages);
    }
  }, [filteredBeneficiaries.length, totalBeneficiaryPages, beneficiaryPage]);

  const displayedBeneficiaries = useMemo(() => {
    const start = (beneficiaryPage - 1) * beneficiaryRowsPerPage;
    return filteredBeneficiaries.slice(start, start + beneficiaryRowsPerPage);
  }, [filteredBeneficiaries, beneficiaryPage]);

  // Shared toast (see lib/toast.js); previously a blocking window.alert.
  const showNotification = notify;

  // The search box suggests barangays, roads and places; picking one flies the map there.
  const handleLguMapPlaceSelect = (place) => {
    setLguMapCenter([place.lat, place.lng]);
    setLguMapZoom(place.zoom);
    // Projects already draw their own start marker; other places get a pin.
    setLguMapSearchMarker(place.type === 'project' ? null : [place.lat, place.lng]);
    showNotification(`Map focused on ${place.label}${place.approx ? ' (approximate position)' : ''}`, 'info');
  };

  const handleSignOut = async () => {
    if (!(await confirmSignOut())) return;
    await supabase.auth.signOut({ scope: 'local' });
    navigate('/lgu/login');
  };

  const fetchBeneficiaries = useCallback(async () => {
    if (!user) return;
    setBeneficiariesLoading(true);
    try {
      let query = supabase.from('farmer_beneficiaries').select('*').order('submitted_date', { ascending: false });
      if (municipalityScope) {
        query = query.eq('municipality', municipalityScope);
      }

      const { data, error } = await query;
      if (error) throw error;

      setBeneficiaries((data || []).map(normalizeBeneficiaryRow));
      setAnalyticsErrors((prev) => ({ ...prev, beneficiaries: null }));
    } catch (err) {
      console.error('Failed to fetch beneficiary records:', err.message);
      setBeneficiaries([]);
      setAnalyticsErrors((prev) => ({ ...prev, beneficiaries: err.message || 'Failed to load' }));
    } finally {
      setBeneficiariesLoading(false);
    }
  }, [user, municipalityScope]);

  const submitBeneficiary = async (event) => {
    event.preventDefault();
    if (!user) return;
    if (!canPin || !farmPinnedRaw) {
      notify(canPin
        ? 'Pin the farm on the map before saving.'
        : `Finish steps 1 and 2 first: ${pinPrerequisites.map((m) => m.label).join(', ')}.`, 'warning');
      return;
    }
    // Rules: no duplicate farmers, and the farm must be inside the chosen barangay.
    if (duplicateFarmer) {
      notify(`${duplicateFarmer.row.fullName} is already registered (Brgy. ${duplicateFarmer.row.barangay}). A farmer can only be registered once.`, 'error');
      return;
    }
    if (pinOutsideBarangay) {
      notify(`The farm pin is ${pinActualPlace}, not in Brgy. ${beneficiaryForm.barangay}. Move the pin onto the farm, or choose the correct barangay.`, 'error');
      return;
    }

    // Confirmation, with anything worth fixing first.
    const tips = registrationSuggestions({
      form: beneficiaryForm,
      farmAccess,
      pinCheck,
      linkedProjectId: beneficiaryForm.linkedProjectId,
      marketChosen: Boolean(beneficiaryForm.nearestMarketId),
      routeProjectCount: routeProjects.length,
    });
    const farmerName = [beneficiaryForm.firstName, beneficiaryForm.middleName, beneficiaryForm.lastName, beneficiaryForm.extName].filter(Boolean).join(' ');
    const summary = [
      `${farmerName} · Brgy. ${beneficiaryForm.barangay}, ${formMunicipality}`,
      `${beneficiaryForm.crop} · ${beneficiaryForm.farmAreaHa} ha`,
      routeProjects.length ? `FMR roads to market: ${routeProjects.map((p) => p.name).join(', ')}` : null,
    ].filter(Boolean);
    const ok = await confirm({
      title: editingId ? 'Save changes to this farmer?' : 'Register this farmer?',
      message: [
        ...summary,
        ...(tips.length ? ['', 'Suggestions before saving:', ...tips.map((t) => `• ${t}`)] : []),
      ].join('\n'),
      confirmLabel: tips.length ? (editingId ? 'Save anyway' : 'Register anyway') : (editingId ? 'Save changes' : 'Register farmer'),
      cancelLabel: tips.length ? 'Go back and fix' : 'Cancel',
      tone: tips.length ? 'warning' : 'primary',
    });
    if (!ok) return;

    const farmAreaHa = Number(beneficiaryForm.farmAreaHa || 0);
    const selectedProject = projects.find((project) => String(project.id) === String(beneficiaryForm.linkedProjectId));
    const estimatedYield = Number((farmAreaHa * typicalYieldTPerHa(beneficiaryForm.crop)).toFixed(1));

    // Compute distance to FMR using Haversine
    let distanceToFmrKm = 0.5;
    const farmLat = Number(beneficiaryForm.farmLatitude);
    const farmLng = Number(beneficiaryForm.farmLongitude);

    if (farmLat && farmLng && selectedProject) {
      const startLat = Number(selectedProject.start_latitude);
      const startLng = Number(selectedProject.start_longitude);
      const endLat = Number(selectedProject.end_latitude);
      const endLng = Number(selectedProject.end_longitude);

      let dMeters = Infinity;
      if (startLat && startLng) {
        dMeters = Math.min(dMeters, haversineMeters(farmLat, farmLng, startLat, startLng));
      }
      if (endLat && endLng) {
        dMeters = Math.min(dMeters, haversineMeters(farmLat, farmLng, endLat, endLng));
      }
      if (dMeters !== Infinity) {
        distanceToFmrKm = Number((dMeters / 1000).toFixed(2));
      }
    }
    // Prefer the distance by road shown on the map: it goes around rivers
    // instead of across them (lib/farmRoadAccess.js).
    if (farmAccess?.mode === 'vehicle' && selectedProject && String(connectorProject?.id) === String(selectedProject.id)) {
      distanceToFmrKm = Number(farmAccess.km.toFixed(2));
    }

    const serviceArea = distanceToFmrKm <= 1 ? 'Within primary service area' : distanceToFmrKm <= 2 ? 'Within secondary service area' : 'For proximity verification';
    const submittedAt = new Date().toISOString();
    const beneficiaryId = `BEN-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

    const payload = {
      beneficiary_id: beneficiaryId,
      full_name: `${beneficiaryForm.firstName.trim()} ${beneficiaryForm.middleName ? beneficiaryForm.middleName.trim() + ' ' : ''}${beneficiaryForm.lastName.trim()}${beneficiaryForm.extName ? ' ' + beneficiaryForm.extName.trim() : ''}`,
      first_name: beneficiaryForm.firstName.trim(),
      middle_name: beneficiaryForm.middleName.trim(),
      last_name: beneficiaryForm.lastName.trim(),
      ext_name: beneficiaryForm.extName.trim(),
      rsbsa_number: beneficiaryForm.rsbsaNumber.trim(),
      control_no: beneficiaryForm.controlNo.trim(),
      contact_number: beneficiaryForm.contactNumber.trim(),
      birthday: beneficiaryForm.birthday || null,
      gender: beneficiaryForm.gender,
      agency: 'DA Region VI', // every registration is under DA Region VI
      municipality: municipalityScope || beneficiaryForm.municipality.trim(),
      barangay: beneficiaryForm.barangay.trim(),
      crop: beneficiaryForm.crop,
      farm_area_ha: farmAreaHa,
      estimated_yield: estimatedYield,
      linked_project_id: selectedProject?.id ? String(selectedProject.id) : '',
      linked_project_name: selectedProject?.project_name || '',
      linked_project_status: selectedProject?.status || 'On-Going',
      route_project_ids: routeProjects.map((p) => ({ id: String(p.id), name: p.name })),
      nearest_market_id: beneficiaryForm.nearestMarketId || routeMarket?.id || null, // the market the map routes to
      farm_latitude: farmLat || null,
      farm_longitude: farmLng || null,
      distance_to_fmr_km: distanceToFmrKm,
      service_area: serviceArea,
      benefit_reason: beneficiaryForm.benefitReason.trim() || `${serviceArea}; farm access depends on linked FMR route.`,
      beneficiary_status: 'Active Beneficiary',
      validation_status: 'Validated',
      submitted_by_lgu: profile?.full_name || profile?.email || user.email,
      created_by_user_id: user.id,
      created_by_name: profile?.full_name || profile?.email || user.email,
      created_by_role: 'lgu',
      submitted_date: submittedAt,
      last_updated: submittedAt,
      admin_remarks: 'Auto-approved upon LGU submission.',
      supporting_documents: ['LGU endorsement', 'Farm location sketch', 'Barangay certification'],
      validation_history: [
        {
          date: submittedAt,
          actor: profile?.full_name || profile?.email || user.email,
          action: 'Submitted farmer profile',
          remarks: 'LGU submitted farmer beneficiary profile.',
        },
      ],
      gps: { lat: farmLat || null, lng: farmLng || null },
    };

    if (editingId) {
      const updatePayload = {
        full_name: payload.full_name,
        first_name: payload.first_name,
        middle_name: payload.middle_name,
        last_name: payload.last_name,
        ext_name: payload.ext_name,
        rsbsa_number: payload.rsbsa_number,
        control_no: payload.control_no,
        contact_number: payload.contact_number,
        birthday: payload.birthday,
        gender: payload.gender,
        agency: payload.agency,
        municipality: payload.municipality,
        barangay: payload.barangay,
        crop: payload.crop,
        farm_area_ha: payload.farm_area_ha,
        estimated_yield: payload.estimated_yield,
        linked_project_id: payload.linked_project_id,
        linked_project_name: payload.linked_project_name,
        linked_project_status: payload.linked_project_status,
        route_project_ids: payload.route_project_ids,
        nearest_market_id: payload.nearest_market_id,
        farm_latitude: payload.farm_latitude,
        farm_longitude: payload.farm_longitude,
        distance_to_fmr_km: payload.distance_to_fmr_km,
        service_area: payload.service_area,
        benefit_reason: payload.benefit_reason,
        last_updated: submittedAt,
        gps: payload.gps
      };

      let { error } = await supabase
        .from('farmer_beneficiaries')
        .update(updatePayload)
        .eq('id', editingId);
      if (error && /route_project_ids/.test(error.message || '')) {
        // supabase_farmer_route_projects.sql not run yet: save without the list.
        const { route_project_ids: _omit, ...rest } = updatePayload;
        void _omit;
        ({ error } = await supabase.from('farmer_beneficiaries').update(rest).eq('id', editingId));
      }

      if (error) {
        showNotification(`Failed to update beneficiary: ${error.message}`);
        return;
      }
      setEditingId(null);
      showNotification('Farmer beneficiary profile updated successfully.');
    } else {
      let userUuid = null;

      if (beneficiaryForm.createAccount) {
        if (!beneficiaryForm.accountUsername || !beneficiaryForm.accountPassword) {
          showNotification('Username and password are required for provisioning portal access', 'error');
          return;
        }

        // Reject rather than silently strip characters: the farmer types the
        // username exactly as given to them, so what's stored must match it.
        const normalizedUsername = normalizeUsername(beneficiaryForm.accountUsername);
        if (normalizedUsername !== beneficiaryForm.accountUsername.trim().toLowerCase()) {
          showNotification('Username can only contain letters, numbers, and underscores (no spaces, "@", or ".").', 'error');
          return;
        }
        if (normalizedUsername.length < 3 || normalizedUsername.length > 30) {
          showNotification('Username must be 3-30 characters (letters, numbers, underscore only).', 'error');
          return;
        }

        // Pre-flight uniqueness check against our own data, BEFORE calling
        // signUp, so a duplicate gets a clean message instead of whatever
        // raw shape Supabase's auth error happens to take.
        const { data: existingProfile, error: usernameCheckErr } = await supabase
          .from('profiles')
          .select('id')
          .eq('username', normalizedUsername)
          .maybeSingle();

        if (usernameCheckErr) {
          showNotification(`Could not verify username availability: ${usernameCheckErr.message}`, 'error');
          return;
        }
        if (existingProfile) {
          showNotification('Username already exists. Please choose another.', 'error');
          return;
        }

        const syntheticEmail = usernameToSyntheticEmail(normalizedUsername);

        try {
          const { data: signUpData, error: signUpErr } = await supabaseAdmin.auth.signUp({
            email: syntheticEmail,
            password: beneficiaryForm.accountPassword,
            options: {
              // handle_new_user copies these into public.profiles; the LGU
              // session can't write another user's profile row under RLS.
              data: {
                role: 'farmer',
                username: normalizedUsername,
                full_name: `${beneficiaryForm.firstName.trim()} ${beneficiaryForm.lastName.trim()}`,
                phone: beneficiaryForm.contactNumber
              }
            }
          });

          if (signUpErr) {
            if (signUpErr.message?.toLowerCase().includes('rate') || signUpErr.status === 429) {
              showNotification('Auth service limit hit. Wait a minute or check email settings.', 'error');
              return;
            }
            throw signUpErr;
          }

          // Defense-in-depth: the pre-flight check above should catch nearly
          // all cases; this guards a race between the check and signUp.
          if (signUpData?.user?.identities?.length === 0) {
            showNotification('Username already exists. Please choose another.', 'error');
            return;
          }

          if (signUpData?.user) {
            userUuid = signUpData.user.id;
          }
        } catch (signUpErr) {
          showNotification(`Auth creation failed: ${signUpErr.message}`, 'error');
          return;
        }
      }

      const finalPayload = {
        ...payload,
        user_id: userUuid
      };

      let { error } = await supabase.from('farmer_beneficiaries').insert(finalPayload);
      if (error && /route_project_ids/.test(error.message || '')) {
        // supabase_farmer_route_projects.sql not run yet: save without the list.
        const { route_project_ids: _omit, ...rest } = finalPayload;
        void _omit;
        ({ error } = await supabase.from('farmer_beneficiaries').insert(rest));
      }
      if (error) {
        showNotification(`Failed to submit beneficiary: ${error.message}`);
        return;
      }
      showNotification('Farmer beneficiary profile and portal login created successfully.');
    }

    setBeneficiarySubTab('list');
    setBeneficiaryForm({
      firstName: '',
      middleName: '',
      lastName: '',
      extName: '',
      rsbsaNumber: '',
      controlNo: '',
      contactNumber: '',
      birthday: '',
      gender: '',
      agency: 'DA Region VI',
      municipality: '',
      barangay: '',
      crop: '',
      farmAreaHa: '',
      linkedProjectId: '',
      nearestMarketId: '',
      farmLatitude: '',
      farmLongitude: '',
      benefitReason: '',
      createAccount: false,
      accountUsername: '',
      accountPassword: '',
    });
    await fetchBeneficiaries();
  };

  const fetchAll = useCallback(async (showSpinner = true) => {
    if (!user) return;
    if (showSpinner) setLoading(true);
    try {
      let reportsQuery = supabase.from('public_reports').select('*').order('created_at', { ascending: false });
      let projectsQuery = supabase.from('fmr_projects').select('*').order('project_name', { ascending: true });
      let escalationsQuery = supabase.from('public_report_lgu_escalations').select('*').order('created_at', { ascending: false });

      if (municipalityScope) {
        reportsQuery = reportsQuery.eq('municipality', municipalityScope);
        projectsQuery = projectsQuery.eq('municipality', municipalityScope);
        escalationsQuery = escalationsQuery.eq('municipality', municipalityScope);
      }

      // farmer_harvest_logs has no municipality column of its own -- scoping
      // to this LGU happens at the RLS layer (see
      // supabase_lgu_analytics_rls_scoping.sql) plus the client-side join to
      // the already municipality-scoped `beneficiaries` state in
      // lguAnalytics.js. Until that migration is applied, this select
      // returns every farmer's rows (pre-existing gap, not introduced here).
      const [reportsRes, projectsRes, escalationsRes, routesRes, marketsRes, tranchesRes, gapsRes, harvestLogsRes] = await Promise.all([
        reportsQuery,
        projectsQuery,
        escalationsQuery,
        supabase.from('project_routes').select('*'),
        supabase.from('market_locations').select('*').order('market_name', { ascending: true }),
        supabase.from('project_tranches').select('*').order('tranche_order', { ascending: true }),
        supabase.from('road_network_gaps').select('*').order('gap_km', { ascending: false }),
        // '*' so review_status/area_ha are included once supabase_harvest_review.sql has run, without failing before.
        supabase.from('farmer_harvest_logs').select('*'),
      ]);

      if (projectsRes.error) console.error('Failed to fetch projects:', projectsRes.error.message);
      if (harvestLogsRes.error) console.error('Failed to fetch harvest logs:', harvestLogsRes.error.message);
      setAnalyticsErrors((prev) => ({
        ...prev,
        projects: projectsRes.error?.message || null,
        harvest: harvestLogsRes.error?.message || null,
      }));

      setReports(reportsRes.data || []);
      setProjects(projectsRes.data || []);
      setEscalations(escalationsRes.data || []);
      setMarkets(marketsRes.data || []);
      setProjectTranches(tranchesRes.data || []);
      setRoadGaps(gapsRes.data || []);
      setHarvestLogs(harvestLogsRes.data || []);

      const nextRoutes = {};
      (routesRes.data || []).forEach((row) => {
        if (!row.project_id) return;
        nextRoutes[row.project_id] = row;
      });
      setRoutesByProjectId(nextRoutes);
    } finally {
      setLoading(false);
    }
  }, [user, municipalityScope]);

  useEffect(() => {
    (async () => {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        navigate('/lgu/login');
        return;
      }

      const { data: prof } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .maybeSingle();

      const role = resolveEffectiveRole(prof?.role, currentUser.user_metadata?.role);
      if (role !== 'lgu') {
        navigate('/lgu/login');
        return;
      }

      setUser(currentUser);
      setProfile(prof || { id: currentUser.id, role: 'lgu', full_name: currentUser.email });
    })();
  }, [navigate]);

  useEffect(() => {
    if (!user) return;
    fetchAll(true);
    fetchBeneficiaries();

    const channels = [
      supabase.channel('lgu-reports').on('postgres_changes', { event: '*', schema: 'public', table: 'public_reports' }, () => fetchAll(false)).subscribe(),
      supabase.channel('lgu-escalations').on('postgres_changes', { event: '*', schema: 'public', table: 'public_report_lgu_escalations' }, () => fetchAll(false)).subscribe(),
      supabase.channel('lgu-decisions').on('postgres_changes', { event: '*', schema: 'public', table: 'public_report_lgu_decisions' }, () => fetchAll(false)).subscribe(),
      supabase.channel('lgu-beneficiaries').on('postgres_changes', { event: '*', schema: 'public', table: 'farmer_beneficiaries' }, fetchBeneficiaries).subscribe(),
      supabase.channel('lgu-markets').on('postgres_changes', { event: '*', schema: 'public', table: 'market_locations' }, () => fetchAll(false)).subscribe(),
      supabase.channel('lgu-project-tranches').on('postgres_changes', { event: '*', schema: 'public', table: 'project_tranches' }, () => fetchAll(false)).subscribe(),
    ];

    return () => {
      channels.forEach((channel) => supabase.removeChannel(channel));
    };
  }, [user, fetchAll, fetchBeneficiaries]);

  const filteredReports = useMemo(() => {
    return (reports || []).filter((row) => {
      if (barangayFilter !== 'all' && row.barangay !== barangayFilter) return false;
      if (projectFilter !== 'all' && row.project_name !== projectFilter) return false;
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;

      const created = row.created_at ? new Date(row.created_at) : null;
      if (dateFrom && created && created < new Date(`${dateFrom}T00:00:00`)) return false;
      if (dateTo && created && created > new Date(`${dateTo}T23:59:59`)) return false;

      return true;
    });
  }, [reports, barangayFilter, projectFilter, statusFilter, dateFrom, dateTo]);

  const summary = useMemo(() => {
    const totalProjects = projects.length;
    const activeProjects = projects.filter((p) => normalizeUserProjectStatus(p.status) === 'On-Going').length;
    return {
      total: filteredReports.length,
      pending: filteredReports.filter((r) => r.status === 'pending').length,
      resolved: filteredReports.filter((r) => r.status === 'resolved').length,
      escalated: escalations.filter((r) => ['for_action', 'endorsed', 'rejected', 'more_info_requested'].includes(r.escalation_status)).length,
      beneficiaries: beneficiaries.length,
      totalProjects,
      activeProjects,
    };
  }, [filteredReports, escalations, beneficiaries, projects]);

  // Same shape FmrProjectKpis takes on the admin and farmer portals, so the
  // hierarchy card looks identical here instead of being a separate design.
  const fmrKpiStats = useMemo(() => {
    const total = projects.length;
    const completed = projects.filter((p) => normalizeUserProjectStatus(p.status) === 'Completed').length;
    const ongoing = projects.filter((p) => normalizeUserProjectStatus(p.status) === 'On-Going').length;
    const proposed = projects.filter((p) => normalizeUserProjectStatus(p.status) === 'Proposed').length;
    const totalKm = projects.reduce((sum, p) => sum + (Number(p.project_length_km) || 0), 0);
    return { total, completed, ongoing, proposed, totalKm };
  }, [projects]);

  const activeFilterCount = useMemo(() => {
    return [
      barangayFilter !== 'all',
      statusFilter !== 'all',
      projectFilter !== 'all',
      Boolean(dateFrom),
      Boolean(dateTo),
    ].filter(Boolean).length;
  }, [barangayFilter, statusFilter, projectFilter, dateFrom, dateTo]);

  const roadInventoryStats = useMemo(() => {
    const rows = Array.isArray(roadInventory) ? roadInventory : [];
    const totalKm = rows.reduce((sum, row) => sum + (Number(row.lengthKm) || 0), 0);

    return {
      totalRoads: rows.length,
      totalKm,
      concreteRoads: rows.filter((row) => row.surfaceType === 'Concrete').length,
      highPriority: rows.filter((row) => String(row.condition || '').toLowerCase() === 'poor' || String(row.condition || '').toLowerCase() === 'critical').length,
      preview: rows.slice(0, 5),
    };
  }, []);

  const uniqueBarangays = useMemo(() => ['all', ...Array.from(new Set((reports || []).map((r) => r.barangay).filter(Boolean)))], [reports]);
  const uniqueProjects = useMemo(() => ['all', ...Array.from(new Set((reports || []).map((r) => r.project_name).filter(Boolean)))], [reports]);




  // Citizen reports the LGU fixes (road obstructions, signs) once the DA has checked them.
  // TEMPORARY (testing): a region-wide LGU (lib/lguTestingScope.js) handles every
  // town's reports here; the overview and analytics stay on its own town.
  const wholeRegion = lguHandlesWholeRegion(municipalityScope);
  const [regionReports, setRegionReports] = useState([]);
  useEffect(() => {
    if (!wholeRegion) return undefined;
    let alive = true;
    supabase
      .from('public_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => { if (alive && !error) setRegionReports(data || []); });
    return () => { alive = false; };
  }, [wholeRegion, reports]);
  const handlerReports = wholeRegion ? regionReports : reports;
  const lguReportIds = useMemo(() => handlerReports.filter((r) => handlerFor(r) === 'lgu').map((r) => r.id), [handlerReports]);
  const lguFollowUps = useHandlerFollowUps(supabase, lguReportIds);
  const lguQueue = useMemo(() => buildHandlerQueue(handlerReports, 'lgu', lguFollowUps.actions), [handlerReports, lguFollowUps.actions]);
  const lguQueueCounts = useMemo(() => countHandlerStages(lguQueue), [lguQueue]);

  const navItems = [
    {
      id: 'overview',
      label: 'Overview',
      description: 'Summary and route map',
      icon: (
        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
        </svg>
      )
    },
    {
      id: 'proposals',
      label: 'Project Proposals',
      description: 'Submit and track FMR road proposals',
      icon: (
        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      )
    },
    {
      id: 'citizen-reports',
      label: 'Citizen Reports',
      description: 'Road jobs assigned to your LGU',
      headerDescription: 'Citizen reports assigned to your LGU',
      badge: lguQueueCounts.todo,
      icon: (
        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
        </svg>
      )
    },
    {
      id: 'beneficiaries',
      label: 'Beneficiaries',
      description: 'Register farmer beneficiaries',
      icon: (
        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.109A2.25 2.25 0 0112.75 21.5h-1.5a2.25 2.25 0 01-2.25-2.263V19.13m-4.717-2.28A4.125 4.125 0 002.25 19.34c0 .546.223 1.042.583 1.403a2.25 2.25 0 001.566.66H7.5m9.03-7.432a3 3 0 11-5.714 0M9 9a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    },
    {
      id: 'markets',
      label: 'Markets',
      description: 'Register agricultural markets',
      icon: (
        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h2.25a2.25 2.25 0 002.25-2.25v-7.5a2.25 2.25 0 00-.75-1.685L17.9 6.207A2.25 2.25 0 0016.326 5.5H7.674a2.25 2.25 0 00-1.574.707L2.5 11.065a2.25 2.25 0 00-.75 1.685v7.5A2.25 2.25 0 004 21h2m9-11.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm-6 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
        </svg>
      )
    },
    {
      id: 'analytics',
      label: 'Analytics',
      description: 'Trends and reporting',
      headerDescription: 'Monitor FMR project implementation, farmer beneficiaries, and reported agricultural output.',
      icon: (
        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v5.25c0 .621-.504 1.125-1.125 1.125h-2.25A1.125 1.125 0 013 18.375v-5.25zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125v-9.75zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v14.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
      )
    },
    {
      id: 'profile',
      label: 'My Profile',
      description: 'Your account details',
      headerDescription: 'Your LGU account details and profile photo.',
      icon: (
        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </svg>
      )
    },
  ];

  const activeSection = navItems.find((item) => item.id === activeTab) || navItems[0];

  // Per-page guide behind the ? button (same as the citizen and farmer portals).
  const tourSteps = LGU_PAGE_TOURS[activeTab];
  const tour = usePageTour(tourSteps ? 'lgu' : null, user?.id);

  const NAV_GROUPS = [
    { label: 'Operations', ids: ['overview', 'citizen-reports', 'proposals'] },
    { label: 'Community', ids: ['beneficiaries', 'markets'] },
    { label: 'Insights', ids: ['analytics'] },
    { label: 'Account', ids: ['profile'] },
  ];
  const navGroups = NAV_GROUPS
    .map((g) => ({ label: g.label, items: g.ids.map((id) => navItems.find((n) => n.id === id)).filter(Boolean) }))
    .filter((g) => g.items.length > 0);

  /* ── Notification bell: what a click shows and where it goes ── */
  const resolveNotificationTarget = (n) => {
    if (n.proposal_id) return { actionLabel: 'Open proposal' };
    if (n.type === 'lgu_escalation') return { actionLabel: 'Open escalations' };
    if (n.type === 'lgu_threshold_alert') return { actionLabel: 'View pending reports' };
    if (LGU_JOB_NOTIFICATIONS.includes(n.type)) return { actionLabel: 'Open citizen reports' };
    if (n.report_id) {
      const match = reports.find((r) => r.id === n.report_id);
      return {
        actionLabel: 'View on overview',
        details: match ? [
          { label: 'Location', value: [match.barangay, match.municipality].filter(Boolean).join(', ') || '—' },
          { label: 'Status', value: String(match.status || '—').replace(/_/g, ' ') },
        ] : undefined,
      };
    }
    return null;
  };

  const openNotification = (n) => {
    setSidebarOpen(false);
    if (n.proposal_id) { setFocusProposalId(n.proposal_id); setActiveTab('proposals'); return; }
    if (n.type === 'lgu_escalation') { setActiveTab('analytics'); return; }
    if (n.type === 'lgu_threshold_alert') { setStatusFilter('pending'); setActiveTab('overview'); return; }
    if (LGU_JOB_NOTIFICATIONS.includes(n.type)) { setActiveTab('citizen-reports'); return; }
    setActiveTab('overview');
  };

  return (
    <div className="min-h-dvh bg-slate-50 lg:flex">
      <aside className={`fixed inset-y-0 left-0 z-40 border-r border-slate-800 bg-slate-900 text-white shadow-2xl transition-all duration-300 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0 w-80 max-w-[85vw] ${sidebarCollapsed ? 'lg:w-20' : 'lg:w-80'}`}>
        <div className="flex h-full flex-col relative overflow-hidden">
          {/* Shared sidebar look (components/ui/SidebarParts.jsx) */}
          <SidebarBrand collapsed={sidebarCollapsed} portalLabel="LGU Oversight Portal">
            <div className="mt-3 rounded-xl border border-slate-700 bg-slate-800/70 px-3 py-2 whitespace-nowrap">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Scope</p>
              <p className="mt-0.5 text-xs font-semibold text-white truncate">{municipalityScope || 'All municipalities'}</p>
            </div>
          </SidebarBrand>

          <SidebarNav data-tour="lgu-nav">
            {navGroups.map((group, gi) => (
              <div key={group.label} className="space-y-1.5">
                <SidebarGroupLabel label={group.label} first={gi === 0} collapsed={sidebarCollapsed} />
                {group.items.map((item) => (
                  <SidebarNavItem
                    key={item.id}
                    onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }}
                    icon={item.icon}
                    label={item.label}
                    description={item.description}
                    badge={item.badge || 0}
                    active={activeTab === item.id}
                    collapsed={sidebarCollapsed}
                  />
                ))}
              </div>
            ))}
          </SidebarNav>

          <SidebarFooter>
            <ConnectionStatus collapsed={sidebarCollapsed} />
            <div className="mt-3">
              <SidebarAccount
                collapsed={sidebarCollapsed}
                onClick={() => { setActiveTab('profile'); setSidebarOpen(false); }}
                avatar={<ProfileAvatar client={supabase} name={profile?.full_name} fallback="L" className="size-10 rounded-xl text-sm shadow-sm" />}
                name={profile?.full_name || 'LGU Administrator'}
                subtitle="LGU Account"
              />
            </div>
            <SidebarSignOut collapsed={sidebarCollapsed} onClick={handleSignOut} />
          </SidebarFooter>
        </div>

        {/* Dynamic Edge Arrow Trigger Button (Vertically Centered on Sidebar Border) */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="hidden lg:flex absolute top-1/2 -translate-y-1/2 -right-3 h-6 w-6 z-50 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-400 hover:text-white shadow-lg cursor-pointer transition-colors"
          title={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {sidebarCollapsed ? (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          )}
        </button>
      </aside>

      <div className={`flex min-h-dvh min-w-0 flex-1 flex-col transition-all duration-300 ${
        sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-80'
      }`}>
        <PortalHeader
          className="z-30"
          leading={(
            <button onClick={() => setSidebarOpen((open) => !open)} className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 lg:hidden" aria-label="Toggle navigation">
              <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
          )}
          title={activeSection.label}
          description={activeSection.headerDescription || activeSection.description}
          actions={(
            <>
              {activeTab !== 'proposals' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('proposals')}
                  data-tour="lgu-propose"
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700"
                >
                  <PlusIcon className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Propose Project</span>
                </button>
              )}
              {tourSteps && (
                <button
                  type="button"
                  onClick={tour.start}
                  data-tour="help"
                  aria-label="Show a guide to this page"
                  title="Show a guide to this page"
                  className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                >
                  <CircleHelpIcon className="size-5" aria-hidden="true" />
                </button>
              )}
            </>
          )}
          bell={(
            <span data-tour="notifications" className="inline-flex">
              <NotificationBell client={supabase} resolveTarget={resolveNotificationTarget} onSelect={openNotification} />
            </span>
          )}
          account={{
            onClick: () => setActiveTab('profile'),
            avatar: <ProfileAvatar client={supabase} name={profile?.full_name} fallback="L" className="size-9 rounded-xl text-sm shadow-sm sm:size-10" />,
            name: headerName,
            detail: municipalityScope ? `LGU of ${municipalityScope}` : (profile?.email || 'LGU Account'),
          }}
        />

        <main className="w-full flex-1 px-4 py-5 lg:px-6">
          {activeTab === 'overview' && (
            <section className="mb-5 space-y-4" data-tour="lgu-kpis">
              {/* Identical shared component to the admin/farmer FMR Projects KPI block. */}
              <FmrProjectKpis stats={fmrKpiStats} scopeLabel="in this municipality" />

              <article className="flex items-center gap-4 rounded-2xl border border-slate-200/60 bg-white p-4 shadow-xs">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-100 text-blue-700">
                  <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </span>
                <div>
                  <p className="text-xs font-medium text-slate-500">Farmer Profiles</p>
                  <p className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{summary.beneficiaries}</p>
                </div>
              </article>
            </section>
          )}

          <section className="mt-5">
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Route Map Panel (Full Width at Top) */}
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" data-tour="lgu-map">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4 bg-gradient-to-r from-slate-50 to-white">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">Route Map</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Projects and citizen reports in view.</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{filteredReports.length} reports</span>
                  </div>

                  {/* LGU Map Projects Filter Toolbar */}
                  <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col xl:flex-row gap-3.5">
                    <div className="relative flex-1">
                      <MapSearchBox
                        projects={projects}
                        value={lguMapSearch}
                        onChange={setLguMapSearch}
                        onSelect={handleLguMapPlaceSelect}
                        placeholder="Search a barangay, road or project (e.g. Bucari)..."
                        inputClassName="h-11 py-0 text-sm"
                      />
                    </div>

                    <div className="flex flex-wrap gap-3 items-center">
                      <select
                        value={lguMapYearFilter}
                        onChange={(e) => setLguMapYearFilter(e.target.value)}
                        className="h-11 px-4 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none cursor-pointer"
                      >
                        <option value="All">All Years</option>
                        {lguMapYearOptions.map(y => <option key={y} value={String(y)}>FY {y}</option>)}
                      </select>

                      <select
                        value={lguMapStatusFilter}
                        onChange={(e) => setLguMapStatusFilter(e.target.value)}
                        className="h-11 px-4 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none cursor-pointer"
                      >
                        <option value="All">All Statuses</option>
                        <option value="Proposed">Proposed</option>
                        <option value="On-Going">On-Going</option>
                        <option value="Completed">Completed</option>
                      </select>

                      <select
                        value={lguMapBarangayFilter}
                        onChange={(e) => setLguMapBarangayFilter(e.target.value)}
                        className="h-11 px-4 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none cursor-pointer"
                      >
                        <option value="All">All Barangays</option>
                        {lguMapBarangayOptions.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>

                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <span>From:</span>
                        <input
                          type="date"
                          value={lguMapDateFrom}
                          onChange={(e) => setLguMapDateFrom(e.target.value)}
                          className="h-11 px-3.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none cursor-pointer"
                        />
                      </div>

                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <span>To:</span>
                        <input
                          type="date"
                          value={lguMapDateTo}
                          onChange={(e) => setLguMapDateTo(e.target.value)}
                          className="h-11 px-3.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none cursor-pointer"
                        />
                      </div>

                      <button
                        onClick={() => setLguMapShowOverdueOnly(prev => !prev)}
                        className={`h-11 px-4 rounded-xl text-sm font-semibold border transition-all ${
                          lguMapShowOverdueOnly
                            ? 'bg-rose-600 border-rose-600 text-white shadow-sm'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        Show Overdue Only
                      </button>
                    </div>
                  </div>

                  <LguRouteMap
                    projects={filteredMapProjects}
                    routesByProjectId={routesByProjectId}
                    tranchesByProjectId={tranchesByProjectId}
                    reports={filteredReports}
                    farmerBeneficiaries={beneficiaries}
                    markets={markets}
                    mapCenter={lguMapCenter}
                    mapZoom={lguMapZoom}
                    searchMarker={lguMapSearchMarker}
                    roadGaps={roadGaps}
                    escalations={escalations}
                  />
                </div>

                {/* Road Inventory Cards list (Full Width) */}
                <div className="space-y-4" data-tour="lgu-inventory">
                  <RoadInventoryTab projects={projects} tranchesByProjectId={tranchesByProjectId} />
                </div>
              </div>
            )}

            {activeTab === 'beneficiaries' && (
              <section className="space-y-5">
                {/* Summary: same hierarchy as the FMR Projects KPI block */}
                <HierarchyKpis
                  ariaLabel="Registered farmer summary"
                  lead={{
                    label: 'Registered Farmers',
                    value: beneficiaryStats.total.toLocaleString(),
                    note: beneficiaryStats.total === 0
                      ? 'No farmers registered yet'
                      : <>Across <span className="font-semibold text-slate-700">{beneficiaryStats.barangays} barangay{beneficiaryStats.barangays === 1 ? '' : 's'}</span>{beneficiaryStats.avgAreaHa !== null ? ` · avg. ${beneficiaryStats.avgAreaHa.toFixed(2)} ha per farmer` : ''}</>,
                    icon: <UsersIcon className="size-6" aria-hidden="true" />,
                    // Split by main crop (top 3, then the rest).
                    segments: [
                      ...beneficiaryStats.topCrops.slice(0, 3).map(([crop, n], i) => ({ label: crop, value: n, bar: ['bg-emerald-500', 'bg-amber-500', 'bg-sky-500'][i] })),
                      ...(beneficiaryStats.topCrops.length > 3
                        ? [{ label: 'Other crops', value: beneficiaryStats.topCrops.slice(3).reduce((sum, [, n]) => sum + n, 0), bar: 'bg-slate-400' }]
                        : []),
                    ],
                  }}
                  items={[
                    {
                      icon: <MapPinIcon className="size-4" aria-hidden="true" />,
                      label: 'Barangays Covered',
                      value: beneficiaryStats.barangays.toLocaleString(),
                      hint: 'With at least one registered farmer',
                      chip: 'bg-sky-50 text-sky-600',
                    },
                    {
                      icon: <RouteIcon className="size-4" aria-hidden="true" />,
                      label: 'Linked to an FMR Road',
                      value: beneficiaryStats.linkedToRoad.toLocaleString(),
                      hint: beneficiaryStats.linkedPct === null ? 'No farmers yet' : `${beneficiaryStats.linkedPct.toFixed(0)}% of farmers`,
                      chip: 'bg-amber-50 text-amber-600',
                    },
                    {
                      icon: <LandPlotIcon className="size-4" aria-hidden="true" />,
                      label: 'Cultivated Area',
                      value: `${beneficiaryStats.areaHa.toLocaleString('en-US', { maximumFractionDigits: 2 })} ha`,
                      hint: beneficiaryStats.avgAreaHa === null ? 'No farm area recorded' : `Avg. ${beneficiaryStats.avgAreaHa.toFixed(2)} ha per farmer`,
                      chip: 'bg-teal-50 text-teal-600',
                    },
                    {
                      icon: <WheatIcon className="size-4" aria-hidden="true" />,
                      label: 'Top Crop',
                      value: beneficiaryStats.topCrops[0]?.[0] || '—',
                      hint: beneficiaryStats.topCrops.length === 0
                        ? 'No crops recorded'
                        : `${beneficiaryStats.topCrops[0][1]} farmers${beneficiaryStats.topCrops[1] ? `, then ${beneficiaryStats.topCrops[1][0]}` : ''}`,
                      chip: 'bg-emerald-50 text-emerald-600',
                    },
                  ]}
                />

                {/* Clickable Sub-Nav Bar */}
                <div className="flex border-b border-slate-200" data-tour="lgu-ben-tabs">
                  <button
                    type="button"
                    onClick={() => setBeneficiarySubTab('list')}
                    className={`border-b-2 px-6 py-3 text-sm font-bold transition-all ${
                      beneficiarySubTab === 'list'
                        ? 'border-teal-600 text-teal-600'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Submitted Farmers
                  </button>
                  <button
                    type="button"
                    onClick={() => setBeneficiarySubTab('register')}
                    className={`border-b-2 px-6 py-3 text-sm font-bold transition-all ${
                      beneficiarySubTab === 'register'
                        ? 'border-teal-600 text-teal-600'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {editingId ? 'Edit Profile' : 'Register New Farmer'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBeneficiarySubTab('analytics')}
                    className={`border-b-2 px-6 py-3 text-sm font-bold transition-all ${
                      beneficiarySubTab === 'analytics'
                        ? 'border-teal-600 text-teal-600'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Analytics
                  </button>
                </div>

                {beneficiarySubTab === 'analytics' ? (
                  // Same four cards as the admin page, over all of this LGU's farmers.
                  <BeneficiaryKeyCards beneficiaries={beneficiaries} loading={beneficiariesLoading} />
                ) : beneficiarySubTab === 'register' ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border-b border-slate-100 pb-3 mb-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{editingId ? 'Edit Farmer Profile' : 'Register Farmer Beneficiary'}</p>
                        <p className="text-xs text-slate-500">Register a farmer beneficiary profile. Profiles are submitted directly to the DA dashboard.</p>
                      </div>
                    </div>

                  {/* Wide screens: fields on the left, the map on the right and kept in view
                      while scrolling, so the officer doesn't scroll back and forth. */}
                  <form onSubmit={submitBeneficiary} className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 xl:grid-cols-2">
                    <div className="grid grid-cols-1 content-start gap-3 md:grid-cols-2">
                    <div className="md:col-span-2 flex items-baseline gap-2 border-b border-slate-100 pb-1.5 pt-3 first:pt-0">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-teal-600 text-[11px] font-bold text-white">1</span>
                      <p className="text-sm font-semibold text-slate-900">Farmer details</p>
                      <p className="hidden sm:block text-xs text-slate-500">Name, contact and RSBSA record</p>
                    </div>
                    <input id="ben-first-name" required value={beneficiaryForm.firstName} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, firstName: e.target.value }))} placeholder="First Name *" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <input value={beneficiaryForm.middleName} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, middleName: e.target.value }))} placeholder="Middle Name" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <input id="ben-last-name" required value={beneficiaryForm.lastName} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, lastName: e.target.value }))} placeholder="Last Name *" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <input value={beneficiaryForm.extName} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, extName: e.target.value }))} placeholder="Extension (Jr, Sr, III)" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    {duplicateFarmer && (
                      <div role="alert" className="md:col-span-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                        <TriangleAlertIcon className="mt-px size-4 shrink-0 text-red-600" aria-hidden="true" />
                        <span>
                          <strong className="font-semibold">Already registered:</strong> {duplicateFarmer.row.fullName}, Brgy. {duplicateFarmer.row.barangay}
                          {duplicateFarmer.row.rsbsaNumber ? ` (RSBSA ${duplicateFarmer.row.rsbsaNumber})` : ''}
                          {duplicateFarmer.reason === 'contact' ? ' uses the same contact number.' : ' has the same name and ' + (duplicateFarmer.reason === 'name_birthday' ? 'birthday.' : 'barangay.')}
                          {' '}A farmer can only be registered once. Edit the existing record instead.
                        </span>
                      </div>
                    )}
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase pl-1">RSBSA Number (Auto-generated)</span>
                      <input
                        required
                        readOnly
                        value={beneficiaryForm.rsbsaNumber}
                        placeholder="RSBSA number *"
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-slate-50 text-slate-500 cursor-not-allowed font-mono shadow-inner"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase pl-1">Control Number (Auto-generated)</span>
                      <input
                        readOnly
                        value={beneficiaryForm.controlNo}
                        placeholder="Control number"
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-slate-50 text-slate-500 cursor-not-allowed font-mono shadow-inner"
                      />
                    </div>
                    <input value={beneficiaryForm.contactNumber} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, contactNumber: e.target.value }))} placeholder="Contact number" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    {/* A date field shows "mm/dd/yyyy" and ignores placeholder text, so
                        it gets a visible label like the auto-generated fields above. */}
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase pl-1">Birthday</span>
                      <input
                        type="date"
                        value={beneficiaryForm.birthday}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setBeneficiaryForm((current) => ({ ...current, birthday: e.target.value }))}
                        className={`rounded-lg border border-slate-200 px-3 py-2 text-sm ${beneficiaryForm.birthday ? 'text-slate-800' : 'text-slate-400'}`}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase pl-1">Sex *</span>
                      <select
                        required
                        id="ben-sex"
                        value={beneficiaryForm.gender}
                        onChange={(e) => setBeneficiaryForm((current) => ({ ...current, gender: e.target.value }))}
                        className={`rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm ${beneficiaryForm.gender ? 'text-slate-800' : 'text-slate-500'}`}
                      >
                        <option value="" disabled className="text-slate-400">Select sex</option>
                        <option value="Male" className="text-slate-800">Male</option>
                        <option value="Female" className="text-slate-800">Female</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase pl-1">Agency</span>
                      <span className="relative">
                        <input
                          readOnly
                          value="DA Region VI"
                          aria-label="Agency"
                          title="All farmer beneficiaries are registered under DA Region VI"
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3 pr-9 text-sm text-slate-600 cursor-not-allowed"
                        />
                        <LockIcon className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                      </span>
                    </label>

                    <div className="md:col-span-2 flex items-baseline gap-2 border-b border-slate-100 pb-1.5 pt-3 first:pt-0">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-teal-600 text-[11px] font-bold text-white">2</span>
                      <p className="text-sm font-semibold text-slate-900">Farm & location</p>
                      <p className="hidden sm:block text-xs text-slate-500">Where the farm is and what it grows</p>
                    </div>
                    {municipalityScope ? (
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase pl-1">Municipality (your LGU)</span>
                        <span className="relative">
                          <input
                            readOnly
                            value={municipalityScope}
                            aria-label="Municipality"
                            title="Farmers are registered under your LGU's municipality"
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3 pr-9 text-sm text-slate-600 cursor-not-allowed"
                          />
                          <LockIcon className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                        </span>
                      </label>
                    ) : (
                      <select id="ben-municipality" required value={beneficiaryForm.municipality} onChange={(e) => changeFarmLocation({ municipality: e.target.value, barangay: '', linkedProjectId: '' })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        <option value="">Select municipality *</option>
                        {eligibleMunicipalities.map((municipality) => <option key={municipality} value={municipality}>{municipality}</option>)}
                      </select>
                    )}
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase pl-1">Barangay *</span>
                      <select id="ben-barangay" required value={beneficiaryForm.barangay} onChange={(e) => changeFarmLocation({ barangay: e.target.value, linkedProjectId: '' })} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                        <option value="">Select barangay</option>
                        {getBarangays(formMunicipality).map((barangay) => <option key={barangay} value={barangay}>{barangay}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase pl-1">Main crop *</span>
                      <SearchableSelect
                      required
                      ariaLabel="Main crop"
                      id="ben-crop"
                      value={beneficiaryForm.crop}
                      onChange={(crop) => setBeneficiaryForm((current) => ({ ...current, crop }))}
                      options={BENEFICIARY_CROPS}
                      placeholder="Search or select main crop"
                    />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase pl-1">Farm area (hectares) *</span>
                      <span className="relative">
                        <input id="ben-farm-area" required type="number" step="0.01" min="0" value={beneficiaryForm.farmAreaHa} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, farmAreaHa: e.target.value }))} placeholder="e.g. 1.5" className="w-full rounded-lg border border-slate-200 py-2 pl-3 pr-10 text-sm" />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">ha</span>
                      </span>
                    </label>


                    {!editingId && (
                      <div className="md:col-span-2 border border-emerald-100 bg-emerald-50/20 rounded-xl p-4 space-y-3">
                        <label className="flex items-center gap-2 cursor-pointer font-semibold text-xs text-emerald-800">
                          <input
                            type="checkbox"
                            checked={beneficiaryForm.createAccount}
                            onChange={(e) => setBeneficiaryForm((current) => ({ ...current, createAccount: e.target.checked }))}
                            className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          Provision Farmer Portal Access Credentials
                        </label>
                        {beneficiaryForm.createAccount && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[11px] font-semibold text-slate-500">Farmer Portal Username</label>
                              <input
                                type="text"
                                required
                                value={beneficiaryForm.accountUsername}
                                onChange={(e) => setBeneficiaryForm((current) => ({ ...current, accountUsername: e.target.value }))}
                                placeholder="e.g. juan_delacruz"
                                pattern="[A-Za-z0-9_]{3,30}"
                                title="3-30 characters: letters, numbers, and underscores only"
                                className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
                              />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[11px] font-semibold text-slate-500">Login Password</label>
                              <input
                                type="password"
                                required
                                value={beneficiaryForm.accountPassword}
                                onChange={(e) => setBeneficiaryForm((current) => ({ ...current, accountPassword: e.target.value }))}
                                placeholder="e.g. KalsaFarmer2026!"
                                className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <textarea value={beneficiaryForm.benefitReason} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, benefitReason: e.target.value }))} placeholder="Benefit reason / notes" rows={3} className="rounded-lg border border-slate-200 px-3 py-2 text-sm md:col-span-2" />
                    </div>

                    <div className="flex flex-col gap-3 xl:sticky xl:top-28 xl:self-start">
                    <div className="flex items-baseline gap-2 border-b border-slate-100 pb-1.5 pt-3 first:pt-0">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-teal-600 text-[11px] font-bold text-white">3</span>
                      <p className="text-sm font-semibold text-slate-900">Road & market</p>
                      <p className="hidden sm:block text-xs text-slate-500">The FMR road that takes this farmer to market</p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

                    {/* Only roads of the chosen barangay (or, if it has none, the 3 nearest). */}
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase pl-1">
                        {farmPinned ? 'Linked FMR road (closest by road first)' : suggestedProjects.isFallback ? 'Linked FMR road (no road in this barangay, nearest shown)' : 'Linked FMR road (in this barangay)'}
                      </span>
                      <select
                        value={beneficiaryForm.linkedProjectId}
                        onChange={(e) => changeFarmLocation({ linkedProjectId: e.target.value })}
                        disabled={!beneficiaryForm.barangay}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                      >
                        <option value="">
                          {!beneficiaryForm.barangay
                            ? 'Select a barangay first'
                            : rankedSuggestedProjects.length === 0 ? 'No FMR road found for this barangay' : 'Select linked FMR road'}
                        </option>
                        {rankedSuggestedProjects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.project_name}
                            {Number.isFinite(project.distanceMeters) ? ` · ${(project.distanceMeters / 1000).toFixed(2)} km${project.byRoad ? ' by road' : ''}` : ''}
                            {project.unreachable ? ' · no road connection found' : ''}
                            {project.outsideBarangay ? ' · outside the barangay' : ''}
                          </option>
                        ))}
                        {beneficiaryForm.linkedProjectId && !rankedSuggestedProjects.some((p) => String(p.id) === String(beneficiaryForm.linkedProjectId)) && (() => {
                          const current = beneficiaryProjectOptions.find((p) => String(p.id) === String(beneficiaryForm.linkedProjectId));
                          return current ? <option value={current.id}>{current.project_name} (currently linked)</option> : null;
                        })()}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase pl-1">Market</span>
                      <select value={beneficiaryForm.nearestMarketId} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, nearestMarketId: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        <option value="">{nearestSuggestedMarket ? `Nearest: ${nearestSuggestedMarket.market.market_name}` : 'Select market'}</option>
                        {marketOptions.map((market) => (
                          <option key={market.id} value={market.id}>
                            {market.market_name} ({market.municipality}){market.km != null ? ` · ${market.km.toFixed(1)} km` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    </div>
                    {routeProjects.length > 0 && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 text-xs text-slate-700">
                        <p className="font-semibold text-slate-900">
                          FMR roads on the way to {routeMarket?.market_name || 'the market'} ({routeProjects.length})
                        </p>
                        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                          {routeProjects.map((rp) => (
                            <li key={rp.id}>
                              {rp.name}
                              {String(rp.id) === String(connectorProject?.id) && <span className="ml-1 font-medium text-emerald-700">· linked road</span>}
                            </li>
                          ))}
                        </ol>
                        <p className="mt-1 text-[11px] text-slate-500">Saved with the farmer, so each of these roads counts this farmer as a beneficiary.</p>
                      </div>
                    )}

                    <div className="flex items-baseline gap-2 border-b border-slate-100 pb-1.5 pt-3 first:pt-0">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-teal-600 text-[11px] font-bold text-white">4</span>
                      <p className="text-sm font-semibold text-slate-900">Pin the farm on the map</p>
                      <p className="hidden sm:block text-xs text-slate-500">Click the farm inside the chosen barangay</p>
                    </div>

                    {/* Numeric GPS Coordinate inputs */}
                    <div className="grid grid-cols-2 gap-3">
                    <input type="number" step="any" required disabled={!canPin} value={beneficiaryForm.farmLatitude} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, farmLatitude: e.target.value }))} placeholder="Farm Latitude *" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <input type="number" step="any" required disabled={!canPin} value={beneficiaryForm.farmLongitude} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, farmLongitude: e.target.value }))} placeholder="Farm Longitude *" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />

                    </div>

                    {/* GIS Coordinates Picker Map */}
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-700">Pin Farm GPS Location *</span>
                        <span className="text-xs font-mono text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100">
                          {beneficiaryForm.farmLatitude && beneficiaryForm.farmLongitude
                            ? `${Number(beneficiaryForm.farmLatitude).toFixed(5)}, ${Number(beneficiaryForm.farmLongitude).toFixed(5)}`
                            : 'Click on the map or search to place marker'}
                        </span>
                      </div>

                      {pinOutsideBarangay && (
                        <div role="alert" className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
                          <TriangleAlertIcon className="mt-px size-4 shrink-0 text-red-600" aria-hidden="true" />
                          <span>
                            <strong className="font-semibold">The pin is outside Brgy. {beneficiaryForm.barangay}.</strong>{' '}
                            It looks like it is {pinActualPlace}{pinCheck.exact ? ' (official PSA boundary)' : ''}. Move the pin onto the farm inside Brgy. {beneficiaryForm.barangay}.
                            Roads are suggested for Brgy. {beneficiaryForm.barangay} only until then.
                          </span>
                        </div>
                      )}

                      {/* Suggested FMR road / nearest market legend */}
                      {formMunicipality && beneficiaryForm.barangay && (
                        <div className="px-4 py-2 bg-amber-50/60 border-b border-amber-100 text-[11px] font-medium text-slate-600">
                          {suggestedProjects.items.length === 0 ? (
                            <span>No FMR road projects found for this barangay or municipality yet — link one manually using the dropdown above.</span>
                          ) : (
                            <div className="space-y-1.5">
                            {farmAccess && connectorProject ? (
                              <p className="text-xs text-slate-700">
                                <span className="font-semibold text-slate-900">
                                  {String(beneficiaryForm.linkedProjectId) === String(connectorProject.id) ? 'Linked road: ' : 'Nearest road: '}
                                  {connectorProject.project_name}
                                </span>
                                {farmAccess.mode === 'vehicle' && ` — ${farmAccess.km.toFixed(2)} km by vehicle road (passable with a load)`}
                                {farmAccess.mode === 'walking' && ` — ${farmAccess.km.toFixed(2)} km on foot only`}
                                {farmAccess.mode === 'straight' && ` — ${farmAccess.km.toFixed(2)} km in a straight line (road map unavailable, so this ignores rivers)`}
                                {farmAccess.mode === 'vehicle' && farmAccess.carryMeters > 150 && !farmAccess.farCarry && (
                                  <span className="text-slate-500">, after carrying the harvest about {Math.round(farmAccess.carryMeters)} m to the nearest vehicle road</span>
                                )}
                                {rankedSuggestedProjects.length > 1 && <span className="text-slate-500">. Click another road line on the map to link it instead.</span>}
                              </p>
                            ) : farmLinkFinding ? (
                              <p className="text-xs text-slate-600">Finding how the farm reaches {connectorProject?.project_name || 'the road'} by road…</p>
                            ) : !farmPinned && (
                              <p className="text-xs text-slate-600">Pin the farm on the map to find the road closest to it.</p>
                            )}
                            {farmAccess && (farmAccess.farCarry || farmAccess.mode === 'walking') && (
                              <p className="text-xs font-medium text-amber-800">
                                {farmAccess.mode === 'walking'
                                  ? 'No vehicle road reaches this FMR road on the map: the harvest must be carried on foot or by carabao the whole way.'
                                  : `Far from any vehicle road: the harvest must be carried about ${(farmAccess.carryMeters / 1000).toFixed(1)} km before a vehicle can take it.`}
                              </p>
                            )}
                            {farmAccess?.crossesWater && (
                              <p className="text-xs font-medium text-red-700">
                                Every mapped road near this farm is across a river or stream. Check on the ground how the harvest actually crosses (bridge, ford or boat).
                              </p>
                            )}
                            {farmAccess?.shortcut && (
                              <p className="text-xs text-slate-600">
                                Footpath shortcut: {farmAccess.shortcut.km.toFixed(2)} km, on foot or carabao only (may include footbridges or steps).
                              </p>
                            )}
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                              <span className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded-full bg-amber-500 inline-block border border-white shadow-sm" />
                                {suggestedProjects.isFallback ? `No road in Brgy. ${beneficiaryForm.barangay}: nearest roads` : `Roads in Brgy. ${beneficiaryForm.barangay}`}
                              </span>
                              {farmLinkPoints && (
                                <span className="flex items-center gap-1.5">
                                  <span className="w-4 h-0.5 border-t-2 border-emerald-600 inline-block" />
                                  {farmAccess?.mode === 'walking' ? 'Farm → road on foot' : 'Farm → road by vehicle'}
                                </span>
                              )}
                              {carryLeg && (
                                <span className="flex items-center gap-1.5">
                                  <span className="w-4 h-0.5 border-t-2 border-dotted border-amber-700 inline-block" />
                                  Carried across the field
                                </span>
                              )}
                              {farmAccess?.shortcut && (
                                <span className="flex items-center gap-1.5">
                                  <span className="w-4 h-0.5 border-t-2 border-dashed border-sky-600 inline-block" />
                                  Footpath shortcut
                                </span>
                              )}
                              {nearestSuggestedMarket && (
                                <span className="flex items-center gap-1.5">
                                  <span className="w-3 h-3 rounded-full bg-indigo-700 inline-block border border-white shadow-sm" />
                                  {beneficiaryForm.nearestMarketId ? 'Chosen market' : 'Nearest market'}
                                </span>
                              )}
                              {connectorRoute && (
                                <span className="flex items-center gap-1.5">
                                  <span className="w-4 h-0.5 border-t-2 border-dashed border-pink-500 inline-block" />
                                  Road → {routeMarket?.market_name || 'market'} ({connectorRoute.distanceKm.toFixed(1)} km)
                                </span>
                              )}
                            </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Search Bar inside Map */}
                      <div className="p-3 bg-white border-b border-slate-100 flex gap-2">
                        <input
                          type="text"
                          placeholder="Search barangay/location..."
                          id="mapSearchInput"
                          disabled={!canPin}
                          className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
                        />
                        <button
                          type="button"
                          disabled={!canPin}
                          onClick={async () => {
                            const queryVal = document.getElementById('mapSearchInput')?.value?.trim();
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
                                const { lat, lon } = data[0];
                                setBeneficiaryForm(curr => ({
                                  ...curr,
                                  farmLatitude: lat,
                                  farmLongitude: lon
                                }));
                              } else {
                                notify('Location not found. Try adding the municipality name.');
                              }
                            } catch (err) {
                              console.error(err);
                              notify('Error searching location.');
                            }
                          }}
                          className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Search
                        </button>
                      </div>

                      <div style={{ height: '360px', width: '100%', position: 'relative' }}>
                        {!canPin && (
                          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/75 p-4 backdrop-blur-[2px]">
                            <div className="w-full max-w-md">
                              <RequiredReminder missing={pinPrerequisites} action="pin the farm" />
                            </div>
                          </div>
                        )}
                        <MapContainer
                          center={
                            beneficiaryForm.farmLatitude && beneficiaryForm.farmLongitude
                              ? [Number(beneficiaryForm.farmLatitude), Number(beneficiaryForm.farmLongitude)]
                              : getMunicipalityCentroid(municipalityScope || beneficiaryForm.municipality)
                          }
                          zoom={13}
                          style={{ height: '100%', width: '100%' }}
                          scrollWheelZoom={true}
                        >
                          <TileLayer
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            attribution='&copy; OpenStreetMap contributors'
                          />
                          {barangayOutline && (
                            <Polygon
                              positions={barangayOutline}
                              pathOptions={{ color: '#0d9488', weight: 2, dashArray: '5, 5', fillColor: '#14b8a6', fillOpacity: 0.06, interactive: false }}
                            />
                          )}
                          <MapClickPicker
                            onPick={(lat, lng) => {
                              if (!canPin) return;
                              setBeneficiaryForm(curr => ({
                                ...curr,
                                farmLatitude: lat,
                                farmLongitude: lng
                              }));
                            }}
                          />
                          {beneficiaryForm.farmLatitude && beneficiaryForm.farmLongitude && (
                            <Marker
                              position={[Number(beneficiaryForm.farmLatitude), Number(beneficiaryForm.farmLongitude)]}
                              icon={new L.Icon({
                                iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
                                shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
                                iconSize: [25, 41],
                                iconAnchor: [12, 41],
                              })}
                            />
                          )}

                          <FormMapCamera
                            points={farmPoint
                              ? [farmPoint, farmAccess?.point]
                              : rankedSuggestedProjects.filter((p) => p.point).map((p) => p.point)}
                          />

                          {/* FMR roads on the route to market that aren't among the suggestions. */}
                          {routeProjects
                            .filter((rp) => !rankedSuggestedProjects.some((p) => String(p.id) === String(rp.id)))
                            .map((rp) => {
                              const proj = projects.find((p) => String(p.id) === String(rp.id));
                              const line = proj ? (snappedRoadLines[proj.id] || buildRoutePoints(proj, routesByProjectId[proj.id]).points) : [];
                              return line.length >= 2 ? (
                                <Polyline key={`route-project-${rp.id}`} positions={line} pathOptions={{ color: '#f59e0b', weight: 6, opacity: 0.95, bubblingMouseEvents: false }}>
                                  <Tooltip sticky><span className="text-xs font-semibold">{rp.name}</span></Tooltip>
                                </Polyline>
                              ) : null;
                            })}

                          {/* Suggested road lines, closest/linked one emphasized. Clicking
                              a line links that road; it doesn't move the farm pin. */}
                          {rankedSuggestedProjects.filter((project) => project.line.length >= 2).map((project) => {
                            const isConnector = connectorProject?.id === project.id;
                            const onRoute = isConnector || routeProjectIds.has(String(project.id));
                            return (
                              <Polyline
                                key={`suggested-line-${project.id}-${onRoute ? 'on' : 'off'}`}
                                positions={project.line}
                                pathOptions={{
                                  color: '#f59e0b',
                                  weight: onRoute ? 6 : 4,
                                  opacity: onRoute ? 0.95 : 0.45,
                                  bubblingMouseEvents: false,
                                }}
                                eventHandlers={{
                                  click: () => setBeneficiaryForm((current) => ({ ...current, linkedProjectId: String(project.id) })),
                                }}
                              >
                                <Tooltip sticky>
                                  <span className="text-xs font-semibold">{project.project_name}</span>
                                </Tooltip>
                              </Polyline>
                            );
                          })}

                          {/* Farm -> road link: dashed preview, solid once it follows the road */}
                          {farmLinkPoints && (
                            <Polyline
                              key={farmAccess?.byRoad ? 'farm-link-road' : 'farm-link-straight'}
                              positions={farmLinkPoints}
                              pathOptions={{
                                color: '#059669',
                                weight: 4,
                                bubblingMouseEvents: false,
                                ...(farmAccess?.byRoad ? {} : { dashArray: '6, 8' }),
                              }}
                            />
                          )}
                          {carryLeg && (
                            <Polyline positions={carryLeg} pathOptions={{ color: '#b45309', weight: 3, dashArray: '2, 6', bubblingMouseEvents: false }}>
                              <Tooltip sticky>Harvest carried about {Math.round(farmAccess.carryMeters)} m to the nearest vehicle road</Tooltip>
                            </Polyline>
                          )}
                          {farmAccess?.shortcut && (
                            <Polyline positions={farmAccess.shortcut.path} pathOptions={{ color: '#0284c7', weight: 3, dashArray: '8, 6', opacity: 0.85, bubblingMouseEvents: false }}>
                              <Tooltip sticky>Footpath shortcut, {farmAccess.shortcut.km.toFixed(2)} km: on foot or carabao only (may include footbridges or steps)</Tooltip>
                            </Polyline>
                          )}
                          {farmAccess && (
                            <CircleMarker
                              center={farmAccess.point}
                              radius={6}
                              pathOptions={{ color: '#059669', weight: 3, fillColor: '#ffffff', fillOpacity: 1, bubblingMouseEvents: false }}
                            >
                              <Tooltip direction="top">Farm reaches {connectorProject?.project_name || 'the road'} here</Tooltip>
                            </CircleMarker>
                          )}

                          {/* Suggested FMR road markers -- click to link to this farmer */}
                          {rankedSuggestedProjects.filter((project) => project.point).map((project) => (
                            <Marker
                              key={`suggested-project-${project.id}`}
                              position={project.point}
                              icon={suggestedRoadIcon(project.isExactMatch)}
                            >
                              <Popup>
                                <div className="text-xs font-sans space-y-1">
                                  <p className="font-bold text-amber-700">{project.project_name}</p>
                                  <p className="text-slate-600">Status: {project.status}</p>
                                  <p className="text-slate-500">
                                    {project.isExactMatch ? 'Matches selected barangay' : 'Other road in this municipality'}
                                    {Number.isFinite(project.distanceMeters) ? ` · ${(project.distanceMeters / 1000).toFixed(2)} km away` : ''}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => setBeneficiaryForm((current) => ({ ...current, linkedProjectId: String(project.id) }))}
                                    className="mt-1 px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[11px] font-semibold"
                                  >
                                    Link this road to farmer
                                  </button>
                                </div>
                              </Popup>
                            </Marker>
                          ))}

                          {/* Market pins -- click to set as this farmer's nearest market */}
                          {markets.map((market) => {
                            const mLat = Number(market.latitude);
                            const mLng = Number(market.longitude);
                            if (!mLat || !mLng) return null;
                            const isNearest = routeMarket?.id === market.id;
                            return (
                              <Marker
                                key={`beneficiary-market-${market.id}`}
                                position={[mLat, mLng]}
                                icon={beneficiaryMarketIcon(isNearest)}
                              >
                                <Popup>
                                  <div className="text-xs font-sans space-y-1">
                                    <p className="font-bold text-indigo-700">{market.market_name}</p>
                                    <p className="text-slate-600">{market.market_type}</p>
                                    <button
                                      type="button"
                                      onClick={() => setBeneficiaryForm((current) => ({ ...current, nearestMarketId: String(market.id) }))}
                                      className="mt-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[11px] font-semibold"
                                    >
                                      Set as nearest market
                                    </button>
                                  </div>
                                </Popup>
                              </Marker>
                            );
                          })}

                          {/* Suggested road -> nearest market connector (road-network-aligned) */}
                          {connectorRoute && connectorRoute.points.length >= 2 && (
                            <Polyline
                              positions={connectorRoute.points}
                              pathOptions={{ color: '#ec4899', weight: 3, dashArray: '4, 6' }}
                            >
                              <Popup>
                                <span className="text-xs font-sans font-semibold text-pink-700">
                                  ~{connectorRoute.distanceKm.toFixed(2)} km by road to {routeMarket?.market_name}
                                </span>
                              </Popup>
                            </Polyline>
                          )}
                        </MapContainer>
                      </div>
                    </div>

                    </div>

                    <div className="xl:col-span-2 flex justify-end gap-3">
                      {editingId && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setBeneficiaryForm({
                              firstName: '',
                              middleName: '',
                              lastName: '',
                              extName: '',
                              rsbsaNumber: '',
                              controlNo: '',
                              contactNumber: '',
                              birthday: '',
                              gender: '',
                              agency: 'DA Region VI',
                              municipality: '',
                              barangay: '',
                              crop: '',
                              farmAreaHa: '',
                              linkedProjectId: '',
                              nearestMarketId: '',
                              farmLatitude: '',
                              farmLongitude: '',
                              benefitReason: '',
                              createAccount: false,
                              accountUsername: '',
                              accountPassword: '',
                            });
                            setBeneficiarySubTab('list');
                          }}
                          className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 transition-colors"
                        >
                          Cancel Edit
                        </button>
                      )}
                      <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 transition-colors">
                        {editingId ? 'Update Farmer Profile' : 'Submit Farmer Profile'}
                      </button>
                    </div>
                  </form>
                </div>
                ) : (
                <div className="space-y-4">

                  {/* Search + filters in one toolbar, then a results bar with what's applied. */}
                  <section aria-label="Find farmers" className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-xs">
                    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] xl:items-end">
                      <label className="flex min-w-0 flex-col gap-1 sm:col-span-3 xl:col-span-1">
                        <span className="pl-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Search</span>
                        <span className="relative">
                          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                          <input
                            type="search"
                            value={beneficiarySearch}
                            onChange={(e) => setBeneficiarySearch(e.target.value)}
                            placeholder="Name, RSBSA, control no., barangay, crop or road"
                            aria-label="Search farmers"
                            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-10 pr-4 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/10"
                          />
                        </span>
                      </label>
                      <label className="flex min-w-0 flex-col gap-1">
                        <span className="pl-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Barangay</span>
                        <span className="relative">
                          <MapPinIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                          <select value={beneficiaryBarangayFilter} onChange={(e) => setBeneficiaryBarangayFilter(e.target.value)} aria-label="Barangay" className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-10 pr-9 text-sm font-medium text-slate-700 outline-none transition hover:border-slate-300 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10">
                            <option value="all">All barangays</option>
                            {beneficiaryFilterOptions.barangays.map((b) => <option key={b} value={b}>{b} ({beneficiaryFilterOptions.counts.barangay[b] || 0})</option>)}
                          </select>
                          <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                        </span>
                      </label>
                      <label className="flex min-w-0 flex-col gap-1">
                        <span className="pl-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Crop</span>
                        <span className="relative">
                          <WheatIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                          <select value={beneficiaryCropFilter} onChange={(e) => setBeneficiaryCropFilter(e.target.value)} aria-label="Crop" className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-10 pr-9 text-sm font-medium text-slate-700 outline-none transition hover:border-slate-300 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10">
                            <option value="all">All crops</option>
                            {beneficiaryFilterOptions.crops.map((c) => <option key={c} value={c}>{c} ({beneficiaryFilterOptions.counts.crop[c] || 0})</option>)}
                          </select>
                          <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                        </span>
                      </label>
                      <label className="flex min-w-0 flex-col gap-1">
                        <span className="pl-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sort by</span>
                        <span className="relative">
                          <ArrowUpDownIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                          <select value={beneficiarySortBy} onChange={(e) => setBeneficiarySortBy(e.target.value)} aria-label="Sort by" className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-10 pr-9 text-sm font-medium text-slate-700 outline-none transition hover:border-slate-300 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10">
                            <option value="newest">Newest first</option>
                            <option value="oldest">Oldest first</option>
                            <option value="name-asc">Name A–Z</option>
                            <option value="name-desc">Name Z–A</option>
                            <option value="area-desc">Largest farm</option>
                            <option value="area-asc">Smallest farm</option>
                          </select>
                          <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                        </span>
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
                      <p className="mr-1 text-sm text-slate-500">
                        Showing <span className="font-semibold text-slate-900">{filteredBeneficiaries.length.toLocaleString()}</span> of {beneficiaries.length.toLocaleString()} farmers
                      </p>
                      {[
                        beneficiarySearch.trim() && { key: 'q', label: `“${beneficiarySearch.trim()}”`, clear: () => setBeneficiarySearch('') },
                        beneficiaryBarangayFilter !== 'all' && { key: 'brgy', label: `Brgy. ${beneficiaryBarangayFilter}`, clear: () => setBeneficiaryBarangayFilter('all') },
                        beneficiaryCropFilter !== 'all' && { key: 'crop', label: beneficiaryCropFilter, clear: () => setBeneficiaryCropFilter('all') },
                      ].filter(Boolean).map((chip) => (
                        <span key={chip.key} className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-xs font-medium text-slate-700">
                          <span className="truncate">{chip.label}</span>
                          <button type="button" onClick={chip.clear} aria-label={`Remove filter ${chip.label}`} className="grid size-5 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                            <XIcon className="size-3" aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                      <div className="ml-auto flex items-center gap-3">
                        {beneficiaryFiltersActive && (
                          <button type="button" onClick={clearBeneficiaryFilters} className="text-sm font-medium text-teal-700 hover:text-teal-800 hover:underline">
                            Clear all
                          </button>
                        )}
                        <button
                          type="button"
                          data-tour="lgu-ben-export"
                          onClick={exportBeneficiariesCsv}
                          disabled={filteredBeneficiaries.length === 0}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <DownloadIcon className="size-4" aria-hidden="true" />
                          Export CSV
                        </button>
                      </div>
                    </div>
                  </section>

                  {/* Tabular Form */}
                  {beneficiariesLoading ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 text-center">Loading beneficiary records...</div>
                  ) : filteredBeneficiaries.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 text-center">No beneficiary records match the filters.</div>
                  ) : (
                    <div className="space-y-4">
                      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[1100px] text-sm text-left">
                            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                              <tr>
                                <th className="px-5 py-3.5">Farmer Details</th>
                                <th className="px-5 py-3.5">Location & Coordinates</th>
                                <th className="px-5 py-3.5">Crop / Farm Size</th>
                                <th className="px-5 py-3.5">Infrastructure & Market</th>
                                <th className="px-5 py-3.5">Last Updated</th>
                                <th className="px-5 py-3.5 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {displayedBeneficiaries.map((row) => {
                                const cropTone =
                                  row.crop === 'Rice' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                  row.crop === 'Corn' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                                  row.crop === 'Sugarcane' ? 'bg-purple-50 text-purple-700 border-purple-100' :
                                  row.crop === 'Coconut' ? 'bg-sky-50 text-sky-700 border-sky-100' :
                                  row.crop === 'Vegetables' ? 'bg-pink-50 text-pink-700 border-pink-100' :
                                  'bg-slate-50 text-slate-700 border-slate-100';

                                return (
                                  <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                                    {/* Farmer Details */}
                                    <td className="px-5 py-4">
                                      <div className="space-y-0.5">
                                        <p
                                          onClick={() => setSelectedFarmerForModal(row)}
                                          className="font-bold text-slate-900 cursor-pointer hover:text-teal-600 hover:underline transition-colors"
                                        >
                                          {row.fullName}
                                        </p>
                                        <div className="text-[10px] font-mono text-slate-400 flex flex-wrap gap-x-2 gap-y-0.5">
                                          <span><strong>RSBSA:</strong> {row.rsbsaNumber}</span>
                                          {row.controlNo && <span><strong>Control:</strong> {row.controlNo}</span>}
                                          {row.gender && <span>• {row.gender}</span>}
                                        </div>
                                      </div>
                                    </td>

                                    {/* Location & Coordinates */}
                                    <td className="px-5 py-4">
                                      <div className="space-y-1">
                                        <p className="font-semibold text-slate-700 text-xs">{row.barangay}, {row.municipality}</p>
                                        {row.farmLatitude && row.farmLongitude ? (
                                          <button
                                            type="button"
                                            onClick={() => setSelectedFarmerForModal(row)}
                                            className="text-[10px] font-mono text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100/50 hover:bg-emerald-100 transition-colors"
                                          >
                                            <MapPinIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />{Number(row.farmLatitude).toFixed(5)}, {Number(row.farmLongitude).toFixed(5)}
                                          </button>
                                        ) : (
                                          <p className="text-[10px] text-slate-400 italic">No coordinates set</p>
                                        )}
                                      </div>
                                    </td>

                                    {/* Crop / Farm Size */}
                                    <td className="px-5 py-4">
                                      <div className="space-y-1">
                                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${cropTone}`}>
                                          {row.crop || 'N/A'}
                                        </span>
                                        <p className="text-xs text-slate-500 font-semibold">{row.farmAreaHa ? `${row.farmAreaHa.toFixed(2)} ha` : '0.00 ha'}</p>
                                      </div>
                                    </td>

                                    {/* Infrastructure & Market */}
                                    <td className="px-5 py-4">
                                      <div className="space-y-0.5 text-xs text-slate-600">
                                        <p className="truncate max-w-[200px]" title={row.linkedProject}>
                                          <span className="font-medium text-slate-400">Road:</span> {row.linkedProject || 'N/A'}
                                        </p>
                                        <div className="flex gap-3 text-[10px]">
                                          <span><span className="font-medium text-slate-450">Dist:</span> {row.distanceToFmrKm ? `${row.distanceToFmrKm} km` : 'N/A'}</span>
                                          <span className="truncate max-w-[120px]" title={markets.find(m => m.id === row.nearestMarketId)?.market_name || 'N/A'}>
                                            <span className="font-medium text-slate-450">Market:</span> {markets.find(m => m.id === row.nearestMarketId)?.market_name || 'N/A'}
                                          </span>
                                        </div>
                                      </div>
                                    </td>

                                    {/* Last Updated */}
                                    <td className="px-5 py-4 text-xs text-slate-500">
                                      {new Date(row.lastUpdated).toLocaleDateString()}
                                    </td>

                                    {/* Actions */}
                                    <td className="px-5 py-4 text-right">
                                      <div className="flex items-center justify-end gap-3">
                                        <button
                                          type="button"
                                          onClick={() => setSelectedFarmerForModal(row)}
                                          className="text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
                                        >
                                          View
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingId(row.id);
                                            setBeneficiaryForm({
                                              firstName: row.firstName || '',
                                              middleName: row.middleName || '',
                                              lastName: row.lastName || '',
                                              extName: row.extName || '',
                                              rsbsaNumber: row.rsbsaNumber || '',
                                              controlNo: row.controlNo || '',
                                              contactNumber: row.contactNumber || '',
                                              birthday: row.birthday || '',
                                              gender: row.gender || '',
                                              agency: row.agency || 'DA',
                                              municipality: row.municipality || '',
                                              barangay: row.barangay || '',
                                              crop: row.crop || '',
                                              farmAreaHa: row.farmAreaHa || '',
                                              linkedProjectId: row.linkedProjectId || '',
                                              nearestMarketId: row.nearestMarketId || '',
                                              farmLatitude: row.farmLatitude || '',
                                              farmLongitude: row.farmLongitude || '',
                                              benefitReason: row.benefitReason || '',
                                            });
                                            setBeneficiarySubTab('register');
                                            document.querySelector('.rounded-xl.border.border-slate-200.bg-white')?.scrollIntoView({ behavior: 'smooth' });
                                          }}
                                          className="text-xs font-semibold text-teal-600 hover:text-teal-800 transition-colors"
                                        >
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            const confirmed = await confirm({
                                              title: 'Delete farmer profile?',
                                              message: `The profile of ${row.fullName} will be permanently removed. This cannot be undone.`,
                                              confirmLabel: 'Delete profile',
                                              tone: 'danger',
                                            });
                                            if (confirmed) {
                                              const { error } = await supabase.from('farmer_beneficiaries').delete().eq('id', row.id);
                                              if (error) {
                                                showNotification(`Error: ${error.message}`);
                                              } else {
                                                showNotification('Farmer profile deleted successfully.');
                                                await fetchBeneficiaries();
                                              }
                                            }
                                          }}
                                          className="text-xs font-semibold text-red-655 hover:text-red-800 transition-colors"
                                        >
                                          Delete
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

                      {/* Pagination Controls */}
                      {filteredBeneficiaries.length > 0 && (
                        <div className="flex flex-col sm:flex-row items-center justify-between border border-slate-200 bg-white rounded-xl px-4 py-3 gap-3 shadow-sm">
                          <span className="text-xs text-slate-500">
                            Showing <span className="font-semibold text-slate-700">{((beneficiaryPage - 1) * beneficiaryRowsPerPage) + 1}</span> to{' '}
                            <span className="font-semibold text-slate-700">
                              {Math.min(beneficiaryPage * beneficiaryRowsPerPage, filteredBeneficiaries.length)}
                            </span>{' '}
                            of <span className="font-semibold text-slate-700">{filteredBeneficiaries.length}</span> entries
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={beneficiaryPage <= 1}
                              onClick={() => setBeneficiaryPage(p => Math.max(1, p - 1))}
                              className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-650 hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-transparent transition-colors cursor-pointer"
                            >
                              Previous
                            </button>
                            {getPaginationRange(beneficiaryPage, totalBeneficiaryPages).map((pNum, index) => {
                              if (pNum === '...') {
                                return (
                                  <span key={`dots-${index}`} className="px-2.5 py-1.5 text-slate-400 text-xs font-bold select-none">
                                    ...
                                  </span>
                                );
                              }
                              return (
                                <button
                                  key={`page-${pNum}`}
                                  type="button"
                                  onClick={() => setBeneficiaryPage(pNum)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                    beneficiaryPage === pNum
                                      ? 'bg-teal-600 text-white shadow-sm'
                                      : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                                  }`}
                                >
                                  {pNum}
                                </button>
                              );
                            })}
                            <button
                              type="button"
                              disabled={beneficiaryPage >= totalBeneficiaryPages || totalBeneficiaryPages <= 1}
                              onClick={() => setBeneficiaryPage(p => Math.min(totalBeneficiaryPages || 1, p + 1))}
                              className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-650 hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-transparent transition-colors cursor-pointer"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )}
              </section>
            )}

            {activeTab === 'citizen-reports' && (
              <HandlerReportsPanel
                queue={lguQueue}
                findings={lguFollowUps.findings}
                loading={lguFollowUps.loading}
                party="lgu"
                client={supabase}
                intro={wholeRegion ? 'Testing mode: all municipalities' : undefined}
                onChanged={(message, tone) => {
                  if (message) notify(message, tone === 'error' ? 'error' : 'success');
                  lguFollowUps.reload();
                }}
              />
            )}

            {activeTab === 'markets' && (
              <MarketManagement
                user={user}
                profile={profile}
                municipalityScope={municipalityScope}
              />
            )}

            {activeTab === 'proposals' && (
              <LguProjectProposalsTab
                user={user}
                profile={profile}
                municipalityScope={municipalityScope}
                beneficiaries={beneficiaries}
                focusProposalId={focusProposalId}
                onFocusHandled={clearFocusProposal}
              />
            )}




            {activeTab === 'profile' && (
              <StaffProfile
                client={supabase}
                roleLabel="LGU Account"
                location={municipalityScope ? `${municipalityScope}, Iloilo` : 'Province-wide'}
                fallbackInitial="L"
                statsLoading={loading || beneficiariesLoading}
                stats={[
                  { label: 'FMR Projects', value: projects.length, icon: RouteIcon, tone: 'bg-teal-50 text-teal-700' },
                  { label: 'Registered Farmers', value: beneficiaries.length, icon: UsersIcon, tone: 'bg-emerald-50 text-emerald-700' },
                  { label: 'Markets', value: markets.length, icon: StoreIcon, tone: 'bg-amber-50 text-amber-700' },
                ]}
                details={[
                  { label: 'Role', value: 'LGU Account' },
                  { label: 'Municipality', value: municipalityScope || 'All municipalities' },
                  { label: 'Region', value: 'DA Region VI (Western Visayas)' },
                  { label: 'Farmers validated', value: beneficiaries.filter((b) => b.validationStatus === 'Validated').length },
                ]}
              />
            )}

            {activeTab === 'analytics' && (
              <LguAnalyticsTab
                projects={projects}
                beneficiaries={beneficiaries}
                harvestLogs={harvestLogs}
                loading={loading || beneficiariesLoading}
                errors={analyticsErrors}
                onRetry={() => { fetchAll(true); fetchBeneficiaries(); }}
              />
            )}

            {/* Farmer Profile Modal */}
            {selectedFarmerForModal && (
              <div className={MODAL_OVERLAY} onClick={() => setSelectedFarmerForModal(null)}>
                <ModalEffects onClose={() => setSelectedFarmerForModal(null)} />
                <div className={`${MODAL_PANEL} relative max-w-4xl`} role="dialog" aria-modal="true" aria-label="Farmer profile details" onClick={(e) => e.stopPropagation()}>
                  {/* Modal Header */}
                  <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50/80">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-teal-50 text-teal-700 rounded-xl">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800 text-base sm:text-lg">Farmer Profile Details</h3>
                        <p className="text-xs text-slate-400 font-mono">ID: {selectedFarmerForModal.beneficiaryId}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${
                        selectedFarmerForModal.validationStatus === 'Validated' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-sky-50 text-sky-700 border-sky-200'
                      }`}>
                        {selectedFarmerForModal.validationStatus}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedFarmerForModal(null)}
                        aria-label="Close dialog"
                        className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-200/80 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Modal Content Scrollable Area */}
                  <div className="p-6 overflow-y-auto space-y-6">
                    {/* Profile Overview */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                      {/* Farmer Details */}
                      <div className="md:col-span-2 space-y-4">
                        <div className="bg-slate-50/60 rounded-2xl p-4 border border-slate-100 space-y-3">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Basic Demographics</h4>
                          <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-xs sm:text-sm">
                            <div>
                              <p className="text-slate-400 text-[10px] font-semibold uppercase">Full Name</p>
                              <p className="font-bold text-slate-800">{selectedFarmerForModal.fullName}</p>
                            </div>
                            <div>
                              <p className="text-slate-400 text-[10px] font-semibold uppercase">RSBSA Number</p>
                              <p className="font-mono font-semibold text-slate-700">{selectedFarmerForModal.rsbsaNumber}</p>
                            </div>
                            <div>
                              <p className="text-slate-400 text-[10px] font-semibold uppercase">Control Number</p>
                              <p className="font-mono text-slate-600">{selectedFarmerForModal.controlNo || 'N/A'}</p>
                            </div>
                            <div>
                              <p className="text-slate-400 text-[10px] font-semibold uppercase">Contact Number</p>
                              <p className="font-semibold text-slate-700">{selectedFarmerForModal.contactNumber || 'N/A'}</p>
                            </div>
                            <div>
                              <p className="text-slate-400 text-[10px] font-semibold uppercase">Gender</p>
                              <p className="font-medium text-slate-700">{selectedFarmerForModal.gender || 'N/A'}</p>
                            </div>
                            <div>
                              <p className="text-slate-400 text-[10px] font-semibold uppercase">Birthday / Age</p>
                              <p className="font-medium text-slate-700">
                                {selectedFarmerForModal.birthday
                                  ? `${new Date(selectedFarmerForModal.birthday).toLocaleDateString()} (${new Date().getFullYear() - new Date(selectedFarmerForModal.birthday).getFullYear()} years old)`
                                  : 'N/A'
                                }
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="bg-slate-50/60 rounded-2xl p-4 border border-slate-100 space-y-3">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Agricultural Details</h4>
                          <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-xs sm:text-sm">
                            <div>
                              <p className="text-slate-400 text-[10px] font-semibold uppercase">Primary Crop Type</p>
                              <p className="font-bold text-slate-800">{selectedFarmerForModal.crop || 'N/A'}</p>
                            </div>
                            <div>
                              <p className="text-slate-400 text-[10px] font-semibold uppercase">Farm Area Size</p>
                              <p className="font-bold text-teal-700">{selectedFarmerForModal.farmAreaHa ? `${selectedFarmerForModal.farmAreaHa.toFixed(2)} Hectares` : '0.00 ha'}</p>
                            </div>
                            <div>
                              <p className="text-slate-400 text-[10px] font-semibold uppercase">Agency / Endorser</p>
                              <p className="font-semibold text-slate-700">{selectedFarmerForModal.agency || 'DA'}</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Map Preview Area */}
                      <div className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-50 h-[280px] md:h-auto flex flex-col">
                        <div className="p-3 bg-slate-100 border-b border-slate-200 text-xs font-semibold text-slate-700 flex justify-between">
                          <span><MapPinIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />Location & Infrastructure Map</span>
                          {selectedFarmerForModal.farmLatitude && selectedFarmerForModal.farmLongitude && (
                            <span className="font-mono text-emerald-600 font-bold">{Number(selectedFarmerForModal.farmLatitude).toFixed(4)}, {Number(selectedFarmerForModal.farmLongitude).toFixed(4)}</span>
                          )}
                        </div>
                        <div className="flex-1 relative" style={{ minHeight: '200px' }}>
                          {selectedFarmerForModal.farmLatitude && selectedFarmerForModal.farmLongitude ? (() => {
                            const farmCoords = [Number(selectedFarmerForModal.farmLatitude), Number(selectedFarmerForModal.farmLongitude)];

                            // 1. Find market details
                            const marketObj = markets.find(m => m.id === selectedFarmerForModal.nearestMarketId);
                            const marketCoords = marketObj ? [Number(marketObj.latitude), Number(marketObj.longitude)] : null;

                            // 2. Find linked project details
                            const projectObj = projects.find(p => String(p.id) === String(selectedFarmerForModal.linkedProjectId));
                            const routeRecord = projectObj ? routesByProjectId[projectObj.id] : null;
                            const routeData = projectObj ? buildRoutePoints(projectObj, routeRecord) : null;
                            const roadPoints = routeData?.points || [];
                            const roadStart = routeData?.startPoint || (projectObj ? [Number(projectObj.start_latitude), Number(projectObj.start_longitude)] : null);
                            const roadEnd = routeData?.endPoint || (projectObj ? [Number(projectObj.end_latitude), Number(projectObj.end_longitude)] : null);

                            const startIcon = new L.DivIcon({
                              className: 'lgu-route-start',
                              html: '<div style="background:#16a34a;width:10px;height:10px;border-radius:9999px;border:2px solid #fff;box-shadow:0 0 0 1px rgba(22,101,52,.55),0 1px 3px rgba(0,0,0,.25)"></div>',
                              iconSize: [10, 10],
                              iconAnchor: [5, 5],
                            });

                            const endIcon = new L.DivIcon({
                              className: 'lgu-route-end',
                              html: '<div style="background:#f97316;width:10px;height:10px;border-radius:9999px;border:2px solid #fff;box-shadow:0 0 0 1px rgba(194,65,12,.6),0 1px 3px rgba(0,0,0,.25)"></div>',
                              iconSize: [10, 10],
                              iconAnchor: [5, 5],
                            });

                            return (
                              <>
                                <MapContainer
                                  center={farmCoords}
                                  zoom={13}
                                  style={{ height: '100%', width: '100%', minHeight: '200px' }}
                                  zoomControl={true}
                                >
                                  <TileLayer
                                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                    attribution='&copy; OpenStreetMap contributors'
                                  />

                                  {/* Fit bounds dynamically */}
                                  <ModalMapController
                                    farmCoords={farmCoords}
                                    marketCoords={marketCoords}
                                    roadPoints={roadPoints}
                                  />

                                  {/* Farm Marker */}
                                  <Marker
                                    position={farmCoords}
                                    icon={new L.Icon({
                                      iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
                                      shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
                                      iconSize: [25, 41],
                                      iconAnchor: [12, 41],
                                    })}
                                  >
                                    <Popup>
                                      <div className="text-xs p-1">
                                        <p className="font-bold text-slate-800">{selectedFarmerForModal.fullName} (Farm)</p>
                                        <p className="text-slate-500 mt-0.5">Crop: {selectedFarmerForModal.crop}</p>
                                        <p className="text-slate-500">Area: {selectedFarmerForModal.farmAreaHa} ha</p>
                                      </div>
                                    </Popup>
                                  </Marker>

                                  {/* Nearest Market Marker */}
                                  {marketCoords && (
                                    <Marker
                                      position={marketCoords}
                                      icon={new L.DivIcon({
                                        className: 'custom-market-pin',
                                        html: `<div style="background:#4338ca;color:#fff;width:28px;height:28px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.25);font-size:12px">${storeGlyph(14)}</div>`,
                                        iconSize: [28, 28],
                                        iconAnchor: [14, 14],
                                      })}
                                    >
                                      <Popup>
                                        <div className="text-xs p-1">
                                          <p className="font-bold text-indigo-700">{marketObj.market_name} (Market)</p>
                                          <p className="text-slate-500 mt-0.5">Type: {marketObj.market_type}</p>
                                        </div>
                                      </Popup>
                                    </Marker>
                                  )}

                                  {/* Linked Road Polyline */}
                                  {roadPoints.length >= 2 && (
                                    <Polyline
                                      positions={roadPoints}
                                      pathOptions={{ color: '#0f766e', weight: 4, opacity: 0.8 }}
                                    />
                                  )}

                                  {/* Linked Road Start Marker */}
                                  {roadStart && (
                                    <Marker position={roadStart} icon={startIcon}>
                                      <Popup>
                                        <div className="text-xs p-1">
                                          <p className="font-bold text-teal-700">{projectObj.project_name}</p>
                                          <p className="text-slate-500 mt-0.5">Start point of linked FMR</p>
                                        </div>
                                      </Popup>
                                    </Marker>
                                  )}

                                  {/* Linked Road End Marker */}
                                  {roadEnd && (
                                    <Marker position={roadEnd} icon={endIcon}>
                                      <Popup>
                                        <div className="text-xs p-1">
                                          <p className="font-bold text-teal-700">{projectObj.project_name}</p>
                                          <p className="text-slate-500 mt-0.5">End point of linked FMR</p>
                                        </div>
                                      </Popup>
                                    </Marker>
                                  )}
                                </MapContainer>
                              </>
                            );
                          })() : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 p-4 text-center">
                              <svg className="w-10 h-10 mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              <p className="text-xs font-semibold">No coordinates provided for this farm</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Proximity / FMR Connection */}
                    <div className="bg-slate-50/60 rounded-2xl p-4 border border-slate-100 space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Farm-to-Market Road Alignment</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs sm:text-sm">
                        <div>
                          <p className="text-slate-400 text-[10px] font-semibold uppercase">Linked Road Infrastructure</p>
                          <p className="font-semibold text-slate-800">{selectedFarmerForModal.linkedProject || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-[10px] font-semibold uppercase">Proximity to FMR</p>
                          <p className="font-semibold text-slate-800">{selectedFarmerForModal.distanceToFmrKm ? `${selectedFarmerForModal.distanceToFmrKm} km` : 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-[10px] font-semibold uppercase">Nearest Market Center</p>
                          <p className="font-semibold text-slate-800">{markets.find(m => m.id === selectedFarmerForModal.nearestMarketId)?.market_name || 'N/A'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Justification & Remarks */}
                    <div className="bg-slate-50/60 rounded-2xl p-4 border border-slate-100 space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Justification / Benefit Reason</h4>
                      <p className="text-xs sm:text-sm text-slate-700 leading-relaxed bg-white p-3 rounded-xl border border-slate-100">
                        {selectedFarmerForModal.benefitReason || 'No justification reason entered.'}
                      </p>
                    </div>


                  </div>

                  {/* Modal Footer */}
                  <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4 bg-slate-50/80">
                    <button
                      type="button"
                      onClick={() => setSelectedFarmerForModal(null)}
                      className="rounded-xl border border-slate-200 px-5 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm"
                    >
                      Close Profile
                    </button>
                  </div>
                </div>
              </div>
            )}

          </section>
        </main>
      </div>
      {tour.open && tourSteps && <PageTour key={activeTab} steps={tourSteps} onClose={tour.close} />}
    </div>
  );
}
