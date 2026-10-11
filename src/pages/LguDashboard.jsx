import { CircleCheckIcon, HourglassIcon, LandPlotIcon, LockIcon, MapPinIcon, UsersIcon, WheatIcon, RouteIcon, StoreIcon, SearchIcon, XIcon, DownloadIcon } from 'lucide-react';
import StaffProfile from '../components/profile/StaffProfile';
import { BeneficiaryKeyCards } from '../components/admin/BeneficiaryAnalytics';
import ProfileAvatar from '../components/ui/ProfileAvatar';
import { useProfileNameUpdates } from '../lib/profileName';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents, Popup, Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { supabaseLgu as supabase, supabaseAdmin } from '../lib/supabase';
import { notify } from '../lib/toast';
import { confirm, confirmSignOut } from '../lib/confirm';
import { MODAL_OVERLAY, MODAL_PANEL, ModalEffects } from '../components/ui/Modal';
import NotificationBell from '../components/NotificationBell';
import LguRouteMap from '../components/lgu/LguRouteMap';
import LguAnalyticsTab from '../components/lgu/LguAnalyticsTab';
import RoadInventoryTab from '../components/lgu/RoadInventoryTab';
import MarketManagement from '../components/lgu/MarketManagement';
import LguProjectProposalsTab from '../components/lgu/LguProjectProposalsTab';
import BeneficiaryCsvImport from '../components/lgu/BeneficiaryCsvImport';
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
import { FmrProjectKpis } from '../components/fmrProjects/FmrProjectListParts';
import HierarchyKpis from '../components/ui/HierarchyKpis';
import SearchableSelect from '../components/ui/SearchableSelect';

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

function cropYieldPerHectare(crop) {
  if (crop === 'Rice') return 4.2;
  if (crop === 'Corn') return 3.6;
  if (crop === 'Sugarcane') return 65;
  if (crop === 'Coconut') return 8;
  if (crop === 'Vegetables') return 12;
  return 9;
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
  const [beneficiaryStatusFilter, setBeneficiaryStatusFilter] = useState('all');
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
    agency: 'DA',
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
  const farmPinned = Boolean(Number(beneficiaryForm.farmLatitude) && Number(beneficiaryForm.farmLongitude));
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

    const normBarangay = barangay.toLowerCase();
    const exact = muniProjects.filter((p) => {
      const haystack = `${p.location || ''} ${p.project_name || ''}`.toLowerCase();
      return haystack.includes(normBarangay);
    });
    const withCoords = muniProjects.filter((p) => Number(p.start_latitude) && Number(p.start_longitude));

    // Once the farm is pinned, distance decides: a road in the next barangay
    // can be the closest one, so every mapped road in the municipality is a
    // candidate alongside the barangay's own (ranked and capped below).
    if (farmPinned) {
      const exactIds = new Set(exact.map((p) => p.id));
      return {
        items: [
          ...exact.map((p) => ({ ...p, isExactMatch: true })),
          ...withCoords.filter((p) => !exactIds.has(p.id)).map((p) => ({ ...p, isExactMatch: false })),
        ],
        isFallback: exact.length === 0,
        truncatedCount: 0,
      };
    }

    if (exact.length > 0) {
      return { items: exact.map((p) => ({ ...p, isExactMatch: true })), isFallback: false, truncatedCount: 0 };
    }

    const FALLBACK_CAP = 8;
    const capped = withCoords.slice(0, FALLBACK_CAP);
    return {
      items: capped.map((p) => ({ ...p, isExactMatch: false })),
      isFallback: true,
      truncatedCount: Math.max(0, withCoords.length - capped.length),
    };
  }, [projects, beneficiaryForm.municipality, beneficiaryForm.barangay, municipalityScope, farmPinned]);

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
    const farmLat = Number(beneficiaryForm.farmLatitude);
    const farmLng = Number(beneficiaryForm.farmLongitude);
    if (farmLat && farmLng) return [farmLat, farmLng];

    for (const p of suggestedProjects.items) {
      const point = resolveProjectPoint(p, suggestedProjectCoords);
      if (point) return point;
    }

    const municipality = beneficiaryForm.municipality || municipalityScope;
    return municipality ? getMunicipalityCentroid(municipality) : null;
  }, [beneficiaryForm.farmLatitude, beneficiaryForm.farmLongitude, beneficiaryForm.municipality, municipalityScope, suggestedProjects, suggestedProjectCoords]);

  // Suggested projects with resolved points + distance from the reference
  // point, closest first, for both display order and connector-line choice.
  // With the farm pinned, distance is to the nearest point ALONG each road
  // (its saved route line), and `access` is where the farm meets that road.
  const rankedSuggestedProjects = useMemo(() => {
    const ref = suggestionReferencePoint;
    const ranked = suggestedProjects.items
      .map((p) => {
        const point = resolveProjectPoint(p, suggestedProjectCoords);
        const routeLine = buildRoutePoints(p, routesByProjectId[p.id]).points;
        const line = routeLine.length > 0 ? routeLine : (point ? [point] : []);
        const access = farmPinned && ref ? nearestPointOnPolyline(ref, line) : null;
        const distanceMeters = access
          ? access.distanceMeters
          : (point && ref ? haversineMeters(ref[0], ref[1], point[0], point[1]) : Infinity);
        return { ...p, point, line, access, distanceMeters };
      })
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
    // Every mapped road in the municipality is a candidate once the farm is
    // pinned; only the closest few are worth showing.
    return farmPinned ? ranked.slice(0, 6) : ranked;
  }, [suggestedProjects, suggestedProjectCoords, suggestionReferencePoint, routesByProjectId, farmPinned]);

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

  // The project a road-to-market connector line is drawn for: whichever is
  // currently linked in the form, else the closest suggestion.
  const connectorProject = useMemo(() => {
    if (beneficiaryForm.linkedProjectId) {
      const selected = rankedSuggestedProjects.find((p) => String(p.id) === String(beneficiaryForm.linkedProjectId));
      if (selected?.point) return selected;
    }
    return rankedSuggestedProjects.find((p) => p.point) || null;
  }, [rankedSuggestedProjects, beneficiaryForm.linkedProjectId]);

  // Farm -> road link: from the farm pin to where it meets the linked (or
  // closest) road. A straight preview shows at once; the road-following route
  // replaces it once the pin has settled for a moment, so clicking around the
  // map doesn't send a route request per click.
  const farmAccess = farmPinned ? connectorProject?.access || null : null;
  const farmPoint = farmPinned ? [Number(beneficiaryForm.farmLatitude), Number(beneficiaryForm.farmLongitude)] : null;
  const farmLinkKey = farmAccess && farmPoint ? `${farmPoint.join(',')}>${farmAccess.point.join(',')}` : '';
  const [farmLink, setFarmLink] = useState({ key: '', points: null, snapped: false, km: 0 });

  useEffect(() => {
    if (!farmLinkKey || !farmAccess || !farmPoint) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const straightKm = farmAccess.distanceMeters / 1000;
      const routed = await fetchRoadAlignedPolyline([farmPoint, farmAccess.point]);
      if (cancelled) return;
      const snapped = Array.isArray(routed) && routed.length > 2;
      const path = snapped ? [farmPoint, ...routed, farmAccess.point] : [farmPoint, farmAccess.point];
      const pathKm = calculatePolylineDistanceKm(path);
      // When no road connects them directly the route loops far around; the
      // straight line to the road says more than that detour does.
      const detour = snapped && pathKm > Math.max(straightKm * 3, straightKm + 1);
      setFarmLink(detour || !snapped
        ? { key: farmLinkKey, points: [farmPoint, farmAccess.point], snapped: false, km: straightKm }
        : { key: farmLinkKey, points: path, snapped: true, km: pathKm });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
    // farmLinkKey captures every coordinate used; farmAccess/farmPoint are
    // rebuilt each render and would restart the wait on unrelated updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmLinkKey]);

  const farmLinkReady = farmLink.key === farmLinkKey && farmLinkKey !== '';
  const farmLinkPoints = farmLinkReady ? farmLink.points : (farmAccess && farmPoint ? [farmPoint, farmAccess.point] : null);

  const [connectorRoute, setConnectorRoute] = useState(null);

  useEffect(() => {
    const point = connectorProject?.point || null;
    const marketPoint = nearestSuggestedMarket
      ? [Number(nearestSuggestedMarket.market.latitude), Number(nearestSuggestedMarket.market.longitude)]
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
  }, [connectorProject, nearestSuggestedMarket]);

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


  const agencyOptions = useMemo(() => {
    return Array.from(new Set(beneficiaries.map((b) => b.agency).filter(Boolean))).sort();
  }, [beneficiaries]);

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
        const isCompleted = normalizedStatus === 'Completed' || status.toLowerCase() === 'completed';
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
      if (beneficiaryStatusFilter !== 'all' && row.validationStatus !== beneficiaryStatusFilter) return false;
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
  }, [beneficiaries, beneficiarySearch, beneficiaryStatusFilter, beneficiaryCropFilter, beneficiaryBarangayFilter, beneficiarySortBy]);

  // Computed from the records, replacing a card that always read "100% Validated".
  const beneficiaryStats = useMemo(() => {
    const total = beneficiaries.length;
    const count = (status) => beneficiaries.filter((b) => b.validationStatus === status).length;
    const validated = count('Validated');
    const forVerification = count('For Verification');
    const needsCorrection = count('Needs Correction');
    const areaHa = beneficiaries.reduce((sum, b) => sum + (Number(b.farmAreaHa) || 0), 0);
    const cropCounts = {};
    beneficiaries.forEach((b) => { if (b.crop) cropCounts[b.crop] = (cropCounts[b.crop] || 0) + 1; });
    const topCrops = Object.entries(cropCounts).sort((a, b) => b[1] - a[1]);
    return {
      total,
      validated,
      validatedPct: total > 0 ? (validated / total) * 100 : null,
      forVerification,
      needsCorrection,
      // Duplicate, rejected and archived records.
      otherStatus: total - validated - forVerification - needsCorrection,
      topCrops,
      barangays: new Set(beneficiaries.map((b) => b.barangay).filter(Boolean)).size,
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
    || beneficiaryStatusFilter !== 'all'
    || beneficiaryCropFilter !== 'all'
    || beneficiaryBarangayFilter !== 'all';
  const clearBeneficiaryFilters = () => {
    setBeneficiarySearch('');
    setBeneficiaryStatusFilter('all');
    setBeneficiaryCropFilter('all');
    setBeneficiaryBarangayFilter('all');
  };

  useEffect(() => {
    setBeneficiaryPage(1);
  }, [beneficiarySearch, beneficiaryStatusFilter, beneficiaryCropFilter, beneficiaryBarangayFilter, beneficiarySortBy]);

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
    await supabase.auth.signOut();
    navigate('/signin');
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

    const farmAreaHa = Number(beneficiaryForm.farmAreaHa || 0);
    const selectedProject = projects.find((project) => String(project.id) === String(beneficiaryForm.linkedProjectId));
    const estimatedYield = Number((farmAreaHa * cropYieldPerHectare(beneficiaryForm.crop)).toFixed(1));
    
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
      agency: beneficiaryForm.agency || 'DA',
      municipality: municipalityScope || beneficiaryForm.municipality.trim(),
      barangay: beneficiaryForm.barangay.trim(),
      crop: beneficiaryForm.crop,
      farm_area_ha: farmAreaHa,
      estimated_yield: estimatedYield,
      linked_project_id: selectedProject?.id ? String(selectedProject.id) : '',
      linked_project_name: selectedProject?.project_name || '',
      linked_project_status: selectedProject?.status || 'On-Going',
      nearest_market_id: beneficiaryForm.nearestMarketId || null,
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
        nearest_market_id: payload.nearest_market_id,
        farm_latitude: payload.farm_latitude,
        farm_longitude: payload.farm_longitude,
        distance_to_fmr_km: payload.distance_to_fmr_km,
        service_area: payload.service_area,
        benefit_reason: payload.benefit_reason,
        last_updated: submittedAt,
        gps: payload.gps
      };

      const { error } = await supabase
        .from('farmer_beneficiaries')
        .update(updatePayload)
        .eq('id', editingId);

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

      const { error } = await supabase.from('farmer_beneficiaries').insert(finalPayload);
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
      agency: 'DA',
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
        supabase.from('farmer_harvest_logs').select('id, farmer_id, crop, quantity_kg, harvest_date'),
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
        navigate('/signin');
        return;
      }

      const { data: prof } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .maybeSingle();

      const role = resolveEffectiveRole(prof?.role, currentUser.user_metadata?.role);
      if (role !== 'lgu') {
        navigate('/signin');
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



  const exportPdf = () => {
    window.print();
  };

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

  const NAV_GROUPS = [
    { label: 'Operations', ids: ['overview', 'proposals'] },
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
    setActiveTab('overview');
  };

  return (
    <div className="min-h-dvh bg-slate-50 lg:flex">
      <aside className={`fixed inset-y-0 left-0 z-40 border-r border-slate-800 bg-slate-900 text-white shadow-2xl transition-all duration-300 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0 ${sidebarCollapsed ? 'lg:w-20' : 'lg:w-80'}`}>
        <div className="flex h-full flex-col relative overflow-hidden">
          {/* Header logo block */}
          <div className="border-b border-slate-700/60 px-4 py-4 overflow-hidden shrink-0">
            <div className="flex items-center gap-3">
              {sidebarCollapsed ? (
                <Logo variant="glyph" tone="light" className="h-10 w-10" alt="KalsaTrack LGU" />
              ) : (
                <div className="flex flex-col gap-1 overflow-hidden">
                  <Logo tone="light" className="h-8" />
                  <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-400 whitespace-nowrap">LGU Oversight Portal</p>
                </div>
              )}
            </div>
            
            <div className={`mt-3 rounded-xl border border-slate-700 bg-slate-800/70 px-3 py-2 transition-all duration-300 ease-in-out whitespace-nowrap ${sidebarCollapsed ? 'opacity-0 h-0 py-0 border-none mt-0 overflow-hidden' : 'opacity-100 h-auto'}`}>
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Scope</p>
              <p className="mt-0.5 text-xs font-semibold text-white truncate">{municipalityScope || 'All municipalities'}</p>
            </div>
          </div>

          {/* Navigation Area */}
          <nav className="flex-1 overflow-y-auto px-2 py-3 overflow-x-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <p className={`px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 transition-all duration-300 overflow-hidden whitespace-nowrap ${sidebarCollapsed ? 'opacity-0 h-0 pb-0 overflow-hidden' : 'opacity-100 h-auto'}`}>
              {navGroups[0]?.label}
            </p>
            <div className="space-y-1.5">
              {navGroups.map((group, gi) => (
              <div key={group.label} className="space-y-1.5">
                {gi > 0 && (
                  sidebarCollapsed ? (
                    <div className="mx-2 my-2 border-t border-slate-700/60" />
                  ) : (
                    <p className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{group.label}</p>
                  )
                )}
              {group.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setSidebarOpen(false);
                  }}
                  className={`flex items-center rounded-xl transition-all duration-300 w-full hover:bg-slate-800/80 ${
                    activeTab === item.id 
                      ? 'bg-teal-500 text-white shadow-lg shadow-teal-500/25 font-semibold' 
                      : 'text-slate-300 hover:text-white'
                  }`}
                  style={{ 
                    paddingLeft: sidebarCollapsed ? '12px' : '14px', 
                    paddingRight: sidebarCollapsed ? '12px' : '14px',
                    paddingTop: '8px',
                    paddingBottom: '8px',
                    gap: sidebarCollapsed ? '0px' : '14px' 
                  }}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                    activeTab === item.id ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {item.icon}
                  </div>
                  <div className={`transition-all duration-300 ease-in-out origin-left whitespace-nowrap overflow-hidden text-left ${
                    sidebarCollapsed ? 'opacity-0 w-0 scale-95 pointer-events-none' : 'opacity-100 w-full scale-100'
                  }`}>
                    <p className="text-xs font-bold leading-tight">{item.label}</p>
                    <p className={`mt-0.5 text-[10px] leading-tight ${activeTab === item.id ? 'text-teal-50' : 'text-slate-400'}`}>{item.description}</p>
                  </div>
                </button>
              ))}
              </div>
              ))}
            </div>

          </nav>

          {/* Bottom Area */}
          <div className="border-t border-slate-700/60 p-4 overflow-hidden shrink-0">
            <ConnectionStatus collapsed={sidebarCollapsed} />

            {/* User Profile display */}
            <button
              type="button"
              onClick={() => setActiveTab('profile')}
              title="My profile"
              aria-label="Open your profile"
              className="flex w-full items-center gap-3 rounded-xl text-left transition-colors hover:bg-white/5"
            >
              <ProfileAvatar client={supabase} name={profile?.full_name} fallback="L" className="size-10 rounded-xl text-sm shadow-sm" />
              <div className={`transition-all duration-300 ease-in-out origin-left whitespace-nowrap overflow-hidden text-left ${sidebarCollapsed ? 'opacity-0 w-0 scale-95 pointer-events-none' : 'opacity-100 w-full scale-100'}`}>
                <p className="text-xs font-bold text-white truncate">{profile?.full_name || 'LGU Administrator'}</p>
                <p className="text-[10px] text-slate-400 leading-none mt-0.5">LGU Account</p>
              </div>
            </button>

            {/* Buttons */}
            <div className="mt-3.5 space-y-2">
              <button
                onClick={exportPdf}
                className={`w-full rounded-xl border border-slate-600 bg-slate-800 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 transition-all duration-300 flex items-center justify-center overflow-hidden h-9.5 ${
                  sidebarCollapsed ? 'px-0 gap-0' : 'px-3.5 gap-2'
                }`}
                title="Export PDF"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v12m0-12L9 6m3-3l3 3M4 17h16" />
                </svg>
                <span className={`transition-all duration-300 ease-in-out origin-left whitespace-nowrap ${sidebarCollapsed ? 'opacity-0 w-0 scale-95 pointer-events-none' : 'opacity-100 w-auto scale-100'}`}>
                  Export PDF
                </span>
              </button>

              <button
                onClick={handleSignOut}
                className={`w-full rounded-xl border border-red-500/20 bg-red-500/10 py-2.5 text-xs font-semibold text-red-200 hover:bg-red-500/20 transition-all duration-300 flex items-center justify-center overflow-hidden h-9.5 ${
                  sidebarCollapsed ? 'px-0 gap-0' : 'px-3.5 gap-2'
                }`}
                title="Sign Out"
              >
                <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                </svg>
                <span className={`transition-all duration-300 ease-in-out origin-left whitespace-nowrap ${sidebarCollapsed ? 'opacity-0 w-0 scale-95 pointer-events-none' : 'opacity-100 w-auto scale-100'}`}>
                  Sign Out
                </span>
              </button>
            </div>
          </div>
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
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex w-full items-center justify-between gap-3 px-4 py-4 lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setSidebarOpen((open) => !open)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 transition lg:hidden"
                aria-label="Toggle navigation"
              >
                <span className="flex flex-col gap-1.5">
                  <span className="h-0.5 w-4 rounded-full bg-current" />
                  <span className="h-0.5 w-4 rounded-full bg-current" />
                  <span className="h-0.5 w-4 rounded-full bg-current" />
                </span>
              </button>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold text-slate-900">{activeSection.label}</h2>
                <p className="truncate text-sm text-slate-500">{activeSection.headerDescription || activeSection.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* LGU carries the largest notification backlog of any role —
                  threshold alerts and proposal decisions, none of it displayed
                  before this. */}
              <NotificationBell client={supabase} resolveTarget={resolveNotificationTarget} onSelect={openNotification} />
            </div>
          </div>
        </header>

        <main className="w-full flex-1 px-4 py-5 lg:px-6">
          {activeTab === 'overview' && (
            <section className="mb-5 space-y-4">
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
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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
                <div className="space-y-4">
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
                    note: beneficiaryStats.validatedPct === null
                      ? 'No farmers registered yet'
                      : <><span className="font-semibold text-emerald-700">{beneficiaryStats.validatedPct.toFixed(0)}% validated</span> across {beneficiaryStats.barangays} barangay{beneficiaryStats.barangays === 1 ? '' : 's'}</>,
                    icon: <UsersIcon className="size-6" aria-hidden="true" />,
                    segments: [
                      { label: 'Validated', value: beneficiaryStats.validated, bar: 'bg-emerald-500' },
                      { label: 'For verification', value: beneficiaryStats.forVerification, bar: 'bg-amber-500' },
                      { label: 'Needs correction', value: beneficiaryStats.needsCorrection, bar: 'bg-slate-400' },
                      ...(beneficiaryStats.otherStatus > 0
                        ? [{ label: 'Duplicate / rejected', value: beneficiaryStats.otherStatus, bar: 'bg-rose-500' }]
                        : []),
                    ],
                  }}
                  items={[
                    {
                      icon: <HourglassIcon className="size-4" aria-hidden="true" />,
                      label: 'Awaiting Verification',
                      value: beneficiaryStats.forVerification.toLocaleString(),
                      hint: beneficiaryStats.forVerification > 0 ? 'Click to show these records' : 'Nothing waiting',
                      chip: 'bg-amber-50 text-amber-600',
                      onClick: beneficiaryStats.forVerification > 0
                        ? () => { setBeneficiaryStatusFilter('For Verification'); setBeneficiarySubTab('list'); }
                        : undefined,
                    },
                    {
                      icon: <CircleCheckIcon className="size-4" aria-hidden="true" />,
                      label: 'Validated',
                      value: beneficiaryStats.validated.toLocaleString(),
                      hint: beneficiaryStats.needsCorrection > 0 ? `${beneficiaryStats.needsCorrection} need correction` : 'None need correction',
                      chip: 'bg-emerald-50 text-emerald-600',
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
                      chip: 'bg-slate-100 text-slate-600',
                    },
                  ]}
                />

                {/* Clickable Sub-Nav Bar */}
                <div className="flex border-b border-slate-200">
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

                {beneficiarySubTab !== 'analytics' && (
                  <BeneficiaryCsvImport
                    user={user}
                    profile={profile}
                    municipalityScope={municipalityScope}
                    onImported={fetchBeneficiaries}
                  />
                )}

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

                  <form onSubmit={submitBeneficiary} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <input required value={beneficiaryForm.firstName} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, firstName: e.target.value }))} placeholder="First Name *" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <input value={beneficiaryForm.middleName} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, middleName: e.target.value }))} placeholder="Middle Name" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <input required value={beneficiaryForm.lastName} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, lastName: e.target.value }))} placeholder="Last Name *" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <input value={beneficiaryForm.extName} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, extName: e.target.value }))} placeholder="Extension (Jr, Sr, III)" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
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
                        value={beneficiaryForm.gender}
                        onChange={(e) => setBeneficiaryForm((current) => ({ ...current, gender: e.target.value }))}
                        className={`rounded-lg border border-slate-200 px-3 py-2 text-sm ${beneficiaryForm.gender ? 'text-slate-800' : 'text-slate-400'}`}
                      >
                        <option value="" disabled>Select sex</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                      </select>
                    </label>
                    <input list="agency-options" value={beneficiaryForm.agency} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, agency: e.target.value }))} placeholder="Agency (e.g. DA)" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <datalist id="agency-options">
                      {agencyOptions.map((agency) => <option key={agency} value={agency} />)}
                    </datalist>
                    
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
                      <select required value={beneficiaryForm.municipality} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, municipality: e.target.value, barangay: '' }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        <option value="">Select municipality *</option>
                        {eligibleMunicipalities.map((municipality) => <option key={municipality} value={municipality}>{municipality}</option>)}
                      </select>
                    )}
                    <select required value={beneficiaryForm.barangay} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, barangay: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <option value="">Select barangay *</option>
                      {getBarangays(formMunicipality).map((barangay) => <option key={barangay} value={barangay}>{barangay}</option>)}
                    </select>
                    <SearchableSelect
                      required
                      ariaLabel="Main crop"
                      value={beneficiaryForm.crop}
                      onChange={(crop) => setBeneficiaryForm((current) => ({ ...current, crop }))}
                      options={BENEFICIARY_CROPS}
                      placeholder="Search or select main crop *"
                    />
                    <input required type="number" step="0.01" min="0" value={beneficiaryForm.farmAreaHa} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, farmAreaHa: e.target.value }))} placeholder="Farm area (ha) *" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    
                    <select value={beneficiaryForm.linkedProjectId} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, linkedProjectId: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <option value="">Select linked FMR project</option>
                      {beneficiaryProjectOptions.map((project) => <option key={project.id} value={project.id}>{project.project_name}</option>)}
                    </select>

                    <select value={beneficiaryForm.nearestMarketId} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, nearestMarketId: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <option value="">Select nearest market</option>
                      {markets.map((market) => <option key={market.id} value={market.id}>{market.market_name} ({market.municipality})</option>)}
                    </select>

                    {/* Numeric GPS Coordinate inputs */}
                    <input type="number" step="any" required value={beneficiaryForm.farmLatitude} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, farmLatitude: e.target.value }))} placeholder="Farm Latitude *" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <input type="number" step="any" required value={beneficiaryForm.farmLongitude} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, farmLongitude: e.target.value }))} placeholder="Farm Longitude *" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />

                    {/* GIS Coordinates Picker Map */}
                    <div className="md:col-span-2 xl:col-span-3 border border-slate-200 rounded-xl overflow-hidden mt-2">
                      <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-700">Pin Farm GPS Location *</span>
                        <span className="text-xs font-mono text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100">
                          {beneficiaryForm.farmLatitude && beneficiaryForm.farmLongitude
                            ? `${Number(beneficiaryForm.farmLatitude).toFixed(5)}, ${Number(beneficiaryForm.farmLongitude).toFixed(5)}`
                            : 'Click on the map or search to place marker'}
                        </span>
                      </div>

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
                                {' '}— {(farmAccess.distanceMeters / 1000).toFixed(2)} km from the farm
                                {farmLinkReady && farmLink.snapped ? ` (about ${farmLink.km.toFixed(2)} km by road)` : ''}
                                {rankedSuggestedProjects.length > 1 && <span className="text-slate-500">. Click another road line on the map to link it instead.</span>}
                              </p>
                            ) : !farmPinned && (
                              <p className="text-xs text-slate-600">Pin the farm on the map to find the road closest to it.</p>
                            )}
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                              <span className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded-full bg-amber-500 inline-block border border-white shadow-sm" />
                                {farmPinned ? 'Nearby roads' : suggestedProjects.isFallback ? 'Suggested road (nearby in municipality)' : 'Suggested road (this barangay)'}
                              </span>
                              {farmLinkPoints && (
                                <span className="flex items-center gap-1.5">
                                  <span className="w-4 h-0.5 border-t-2 border-emerald-600 inline-block" />
                                  Farm → road link
                                </span>
                              )}
                              {nearestSuggestedMarket && (
                                <span className="flex items-center gap-1.5">
                                  <span className="w-3 h-3 rounded-full bg-indigo-700 inline-block border border-white shadow-sm" />
                                  Nearest market
                                </span>
                              )}
                              {connectorRoute && (
                                <span className="flex items-center gap-1.5">
                                  <span className="w-4 h-0.5 border-t-2 border-dashed border-pink-500 inline-block" />
                                  Road → market route
                                </span>
                              )}
                              {suggestedProjects.truncatedCount > 0 && (
                                <span className="text-slate-400">+{suggestedProjects.truncatedCount} more in this municipality — refine using the dropdown above</span>
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
                          className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
                        />
                        <button
                          type="button"
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
                          className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition-colors"
                        >
                          Search
                        </button>
                      </div>

                      <div style={{ height: '360px', width: '100%', position: 'relative' }}>
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
                          <MapClickPicker
                            onPick={(lat, lng) => {
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

                          {/* Suggested road lines, closest/linked one emphasized. Clicking
                              a line links that road; it doesn't move the farm pin. */}
                          {rankedSuggestedProjects.filter((project) => project.line.length >= 2).map((project) => {
                            const isConnector = connectorProject?.id === project.id;
                            return (
                              <Polyline
                                key={`suggested-line-${project.id}-${isConnector ? 'on' : 'off'}`}
                                positions={project.line}
                                pathOptions={{
                                  color: '#f59e0b',
                                  weight: isConnector ? 6 : 4,
                                  opacity: isConnector ? 0.95 : 0.45,
                                  bubblingMouseEvents: false,
                                }}
                                eventHandlers={{
                                  click: () => setBeneficiaryForm((current) => ({ ...current, linkedProjectId: String(project.id) })),
                                }}
                              >
                                <Tooltip sticky>
                                  <span className="text-xs font-semibold">{project.project_name}</span>
                                  {!isConnector && <span className="block text-[11px] text-slate-500">Click to link this road</span>}
                                </Tooltip>
                              </Polyline>
                            );
                          })}

                          {/* Farm -> road link: dashed preview, solid once it follows the road */}
                          {farmLinkPoints && (
                            <Polyline
                              key={farmLinkReady && farmLink.snapped ? 'farm-link-road' : 'farm-link-straight'}
                              positions={farmLinkPoints}
                              pathOptions={{
                                color: '#059669',
                                weight: 4,
                                bubblingMouseEvents: false,
                                ...(farmLinkReady && farmLink.snapped ? {} : { dashArray: '6, 8' }),
                              }}
                            />
                          )}
                          {farmAccess && (
                            <CircleMarker
                              center={farmAccess.point}
                              radius={6}
                              pathOptions={{ color: '#059669', weight: 3, fillColor: '#ffffff', fillOpacity: 1, bubblingMouseEvents: false }}
                            >
                              <Tooltip direction="top">Farm meets {connectorProject?.project_name || 'the road'} here</Tooltip>
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
                            const isNearest = nearestSuggestedMarket?.market.id === market.id;
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
                                  ~{connectorRoute.distanceKm.toFixed(2)} km by road to {nearestSuggestedMarket?.market.market_name}
                                </span>
                              </Popup>
                            </Polyline>
                          )}
                        </MapContainer>
                      </div>
                    </div>

                    {!editingId && (
                      <div className="md:col-span-2 xl:col-span-3 border border-emerald-100 bg-emerald-50/20 rounded-xl p-4 space-y-3 mt-2">
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

                    <textarea value={beneficiaryForm.benefitReason} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, benefitReason: e.target.value }))} placeholder="Benefit reason / notes" rows={3} className="rounded-lg border border-slate-200 px-3 py-2 text-sm md:col-span-2 xl:col-span-3" />
                    <div className="md:col-span-2 xl:col-span-3 flex justify-end gap-3">
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
                              agency: 'DA',
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
                    <div className="flex flex-col gap-2.5 p-4 xl:flex-row xl:items-center">
                      <div className="relative min-w-0 flex-1">
                        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                        <input
                          type="search"
                          value={beneficiarySearch}
                          onChange={(e) => setBeneficiarySearch(e.target.value)}
                          placeholder="Search name, RSBSA, control no., barangay, crop or road"
                          aria-label="Search farmers"
                          className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-10 pr-4 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/10"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:flex xl:flex-nowrap">
                        <select
                          value={beneficiaryStatusFilter}
                          onChange={(e) => setBeneficiaryStatusFilter(e.target.value)}
                          aria-label="Validation status"
                          className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white pl-3.5 pr-8 text-sm text-slate-700 outline-none transition hover:border-slate-300 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 xl:w-44"
                        >
                          <option value="all">All statuses</option>
                          {beneficiaryFilterOptions.statuses.map((s) => <option key={s} value={s}>{s} ({beneficiaryFilterOptions.counts.status[s] || 0})</option>)}
                        </select>
                        <select
                          value={beneficiaryBarangayFilter}
                          onChange={(e) => setBeneficiaryBarangayFilter(e.target.value)}
                          aria-label="Barangay"
                          className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white pl-3.5 pr-8 text-sm text-slate-700 outline-none transition hover:border-slate-300 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 xl:w-44"
                        >
                          <option value="all">All barangays</option>
                          {beneficiaryFilterOptions.barangays.map((b) => <option key={b} value={b}>{b} ({beneficiaryFilterOptions.counts.barangay[b] || 0})</option>)}
                        </select>
                        <select
                          value={beneficiaryCropFilter}
                          onChange={(e) => setBeneficiaryCropFilter(e.target.value)}
                          aria-label="Crop"
                          className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white pl-3.5 pr-8 text-sm text-slate-700 outline-none transition hover:border-slate-300 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 xl:w-44"
                        >
                          <option value="all">All crops</option>
                          {beneficiaryFilterOptions.crops.map((c) => <option key={c} value={c}>{c} ({beneficiaryFilterOptions.counts.crop[c] || 0})</option>)}
                        </select>
                        <select
                          value={beneficiarySortBy}
                          onChange={(e) => setBeneficiarySortBy(e.target.value)}
                          aria-label="Sort by"
                          className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white pl-3.5 pr-8 text-sm text-slate-700 outline-none transition hover:border-slate-300 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 xl:w-44"
                        >
                          <option value="newest">Newest first</option>
                          <option value="oldest">Oldest first</option>
                          <option value="name-asc">Name A–Z</option>
                          <option value="name-desc">Name Z–A</option>
                          <option value="area-desc">Largest farm</option>
                          <option value="area-asc">Smallest farm</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
                      <p className="mr-1 text-sm text-slate-500">
                        Showing <span className="font-semibold text-slate-900">{filteredBeneficiaries.length.toLocaleString()}</span> of {beneficiaries.length.toLocaleString()} farmers
                      </p>
                      {[
                        beneficiarySearch.trim() && { key: 'q', label: `“${beneficiarySearch.trim()}”`, clear: () => setBeneficiarySearch('') },
                        beneficiaryStatusFilter !== 'all' && { key: 'status', label: beneficiaryStatusFilter, clear: () => setBeneficiaryStatusFilter('all') },
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
    </div>
  );
}
