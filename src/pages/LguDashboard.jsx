import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { supabase, supabaseAdmin } from '../lib/supabase';
import LguRouteMap from '../components/lgu/LguRouteMap';
import LguAnalyticsTab from '../components/lgu/LguAnalyticsTab';
import RoadInventoryTab from '../components/lgu/RoadInventoryTab';
import MarketManagement from '../components/lgu/MarketManagement';
import LguProjectProposalsTab from '../components/lgu/LguProjectProposalsTab';
import BeneficiaryCsvImport from '../components/lgu/BeneficiaryCsvImport';
import { getBarangays, getMunicipalities } from '../data/iloiloLocations';
import { BENEFICIARY_CROPS } from '../utils/farmerBeneficiaryData';
import { getMunicipalityCentroid, buildRoutePoints } from '../lib/mapRouteUtils';
import roadInventory from '../data/leonRoadInventory.json';

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

function MapCenterController({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center && center[0] && center[1]) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);
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
    submittedDate: row.submitted_date ? new Date(row.submitted_date) : new Date(),
    lastUpdated: row.last_updated ? new Date(row.last_updated) : new Date(),
    gps: row.gps || { lat: farmLatitude, lng: farmLongitude }
  };
}

export default function LguDashboard() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  const [reports, setReports] = useState([]);
  const [projects, setProjects] = useState([]);
  const [routesByProjectId, setRoutesByProjectId] = useState({});
  const [escalations, setEscalations] = useState([]);
  const [findings, setFindings] = useState([]);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [beneficiariesLoading, setBeneficiariesLoading] = useState(false);
  const [beneficiarySearch, setBeneficiarySearch] = useState('');
  const [beneficiaryStatusFilter, setBeneficiaryStatusFilter] = useState('all');
  const [beneficiaryCropFilter, setBeneficiaryCropFilter] = useState('all');
  const [beneficiarySortBy, setBeneficiarySortBy] = useState('newest');
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
    gender: 'Male',
    agency: 'DA',
    municipality: '',
    barangay: '',
    crop: 'Rice',
    farmAreaHa: '',
    linkedProjectId: '',
    nearestMarketId: '',
    farmLatitude: '',
    farmLongitude: '',
    benefitReason: '',
    createAccount: false,
    accountEmail: '',
    accountPassword: '',
  });

  const [barangayFilter, setBarangayFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showHeat, setShowHeat] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [lguMapSearch, setLguMapSearch] = useState('');
  const [lguMapYearFilter, setLguMapYearFilter] = useState('All');
  const [lguMapStatusFilter, setLguMapStatusFilter] = useState('All');
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

  const municipalityScope = profile?.municipality || user?.user_metadata?.municipality || '';
  const eligibleMunicipalities = useMemo(() => {
    if (municipalityScope) return [municipalityScope];
    return getMunicipalities();
  }, [municipalityScope]);

  const beneficiaryProjectOptions = useMemo(() => {
    return [...projects].sort((a, b) => String(a.project_name || '').localeCompare(String(b.project_name || '')));
  }, [projects]);

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
      if (!query) return true;
      return [row.fullName, row.beneficiaryId, row.rsbsaNumber, row.municipality, row.barangay, row.linkedProject]
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
  }, [beneficiaries, beneficiarySearch, beneficiaryStatusFilter, beneficiaryCropFilter, beneficiarySortBy]);

  useEffect(() => {
    setBeneficiaryPage(1);
  }, [beneficiarySearch, beneficiaryStatusFilter, beneficiaryCropFilter, beneficiarySortBy]);

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

  const getPaginationRange = (currentPage, totalPages) => {
    const delta = 1;
    const range = [];
    const rangeWithDots = [];
    let l;

    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - delta && i <= currentPage + delta)) {
        range.push(i);
      }
    }

    for (let i of range) {
      if (l) {
        if (i - l === 2) {
          rangeWithDots.push(l + 1);
        } else if (i - l > 2) {
          rangeWithDots.push('...');
        }
      }
      rangeWithDots.push(i);
      l = i;
    }

    return rangeWithDots;
  };

  const showNotification = (message) => {
    window.alert(message);
  };

  const handleLguMapSearchSubmit = async () => {
    const query = lguMapSearch.trim();
    if (!query) return;

    // 1. Try to find a local project that matches the query
    const matchedProject = projects.find(p => 
      (p.project_name || '').toLowerCase().includes(query.toLowerCase()) &&
      p.start_latitude && p.start_longitude
    );

    if (matchedProject) {
      setLguMapCenter([Number(matchedProject.start_latitude), Number(matchedProject.start_longitude)]);
      setLguMapZoom(15);
      setLguMapSearchMarker(null); // Clear search marker since project has its own start icon
      showNotification(`Map focused on project: ${matchedProject.project_name}`);
      return;
    }

    // 2. Try Nominatim Geocoding search within municipality
    try {
      const fullQuery = `${query}, Iloilo, Philippines`;
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullQuery)}`);
      const results = await res.json();
      if (results && results.length > 0) {
        const { lat, lon } = results[0];
        const coords = [Number(lat), Number(lon)];
        setLguMapCenter(coords);
        setLguMapZoom(14);
        setLguMapSearchMarker(coords); // Set custom search marker!
        showNotification(`Map focused on location: ${results[0].display_name.split(',')[0]}`);
      } else {
        showNotification('No matching project or location found.');
      }
    } catch (err) {
      console.error(err);
      showNotification('Error performing map search.');
    }
  };

  const handleSignOut = async () => {
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
    } catch (err) {
      console.error('Failed to fetch beneficiary records:', err.message);
      setBeneficiaries([]);
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
        if (!beneficiaryForm.accountEmail || !beneficiaryForm.accountPassword) {
          showNotification('Email and password are required for provisioning portal access', 'error');
          return;
        }

        try {
          const { data: signUpData, error: signUpErr } = await supabaseAdmin.auth.signUp({
            email: beneficiaryForm.accountEmail,
            password: beneficiaryForm.accountPassword,
            options: {
              data: {
                role: 'farmer',
                full_name: `${beneficiaryForm.firstName.trim()} ${beneficiaryForm.lastName.trim()}`
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

          if (signUpData?.user?.identities?.length === 0) {
            showNotification('A user account with this email already exists.', 'error');
            return;
          }

          if (signUpData?.user) {
            userUuid = signUpData.user.id;

            const { error: profErr } = await supabase.from('profiles').insert({
              id: userUuid,
              email: beneficiaryForm.accountEmail,
              full_name: `${beneficiaryForm.firstName.trim()} ${beneficiaryForm.lastName.trim()}`,
              role: 'farmer',
              phone: beneficiaryForm.contactNumber
            });

            if (profErr) {
              console.warn('Profile direct insert error:', profErr);
            }
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
      gender: 'Male',
      agency: 'DA',
      municipality: '',
      barangay: '',
      crop: 'Rice',
      farmAreaHa: '',
      linkedProjectId: '',
      nearestMarketId: '',
      farmLatitude: '',
      farmLongitude: '',
      benefitReason: '',
      createAccount: false,
      accountEmail: '',
      accountPassword: '',
    });
    await fetchBeneficiaries();
  };

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      let reportsQuery = supabase.from('public_reports').select('*').order('created_at', { ascending: false });
      let projectsQuery = supabase.from('fmr_projects').select('*').order('project_name', { ascending: true });
      let escalationsQuery = supabase.from('public_report_lgu_escalations').select('*').order('created_at', { ascending: false });

      if (municipalityScope) {
        reportsQuery = reportsQuery.eq('municipality', municipalityScope);
        projectsQuery = projectsQuery.eq('municipality', municipalityScope);
        escalationsQuery = escalationsQuery.eq('municipality', municipalityScope);
      }

      const [reportsRes, projectsRes, escalationsRes, routesRes, findingsRes, marketsRes] = await Promise.all([
        reportsQuery,
        projectsQuery,
        escalationsQuery,
        supabase.from('project_routes').select('*'),
        supabase.from('public_report_field_findings').select('*').order('submitted_at', { ascending: false }),
        supabase.from('market_locations').select('*').order('market_name', { ascending: true }),
      ]);

      setReports(reportsRes.data || []);
      setProjects(projectsRes.data || []);
      setEscalations(escalationsRes.data || []);
      setFindings(findingsRes.data || []);
      setMarkets(marketsRes.data || []);

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
    fetchAll();
    fetchBeneficiaries();

    const channels = [
      supabase.channel('lgu-reports').on('postgres_changes', { event: '*', schema: 'public', table: 'public_reports' }, fetchAll).subscribe(),
      supabase.channel('lgu-escalations').on('postgres_changes', { event: '*', schema: 'public', table: 'public_report_lgu_escalations' }, fetchAll).subscribe(),
      supabase.channel('lgu-decisions').on('postgres_changes', { event: '*', schema: 'public', table: 'public_report_lgu_decisions' }, fetchAll).subscribe(),
      supabase.channel('lgu-beneficiaries').on('postgres_changes', { event: '*', schema: 'public', table: 'farmer_beneficiaries' }, fetchBeneficiaries).subscribe(),
      supabase.channel('lgu-markets').on('postgres_changes', { event: '*', schema: 'public', table: 'market_locations' }, fetchAll).subscribe(),
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
    const activeProjects = projects.filter(p => p.project_status === 'In Progress' || p.project_status === 'Under Construction').length;
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

  const activeFilterCount = useMemo(() => {
    return [
      barangayFilter !== 'all',
      statusFilter !== 'all',
      projectFilter !== 'all',
      Boolean(dateFrom),
      Boolean(dateTo),
      !showHeat,
    ].filter(Boolean).length;
  }, [barangayFilter, statusFilter, projectFilter, dateFrom, dateTo, showHeat]);

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
      icon: (
        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v5.25c0 .621-.504 1.125-1.125 1.125h-2.25A1.125 1.125 0 013 18.375v-5.25zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125v-9.75zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v14.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
      )
    },
  ];

  const activeSection = navItems.find((item) => item.id === activeTab) || navItems[0];

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside className={`fixed inset-y-0 left-0 z-40 border-r border-slate-800 bg-slate-900 text-white shadow-2xl transition-all duration-300 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0 ${sidebarCollapsed ? 'lg:w-20' : 'lg:w-80'}`}>
        <div className="flex h-full flex-col relative overflow-hidden">
          {/* Header logo block */}
          <div className="border-b border-slate-700/60 px-4 py-4 overflow-hidden shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-500 text-white font-black text-xl shadow-lg shadow-teal-500/25">
                K
              </div>
              <div className={`transition-all duration-300 ease-in-out origin-left whitespace-nowrap overflow-hidden ${sidebarCollapsed ? 'opacity-0 w-0 scale-95 pointer-events-none' : 'opacity-100 w-auto scale-100'}`}>
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-400">LGU Oversight Portal</p>
                <h1 className="text-sm font-bold text-white leading-tight">KalsaTrack LGU</h1>
              </div>
            </div>
            
            <div className={`mt-3 rounded-xl border border-slate-700 bg-slate-800/70 px-3 py-2 transition-all duration-300 ease-in-out whitespace-nowrap ${sidebarCollapsed ? 'opacity-0 h-0 py-0 border-none mt-0 overflow-hidden' : 'opacity-100 h-auto'}`}>
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Scope</p>
              <p className="mt-0.5 text-xs font-semibold text-white truncate">{municipalityScope || 'All municipalities'}</p>
            </div>
          </div>

          {/* Navigation Area */}
          <nav className="flex-1 overflow-y-auto px-2 py-3 overflow-x-hidden">
            <p className={`px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 transition-all duration-300 overflow-hidden whitespace-nowrap ${sidebarCollapsed ? 'opacity-0 h-0 pb-0 overflow-hidden' : 'opacity-100 h-auto'}`}>
              Main Menu
            </p>
            <div className="space-y-1.5">
              {navItems.map((item) => (
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
          </nav>

          {/* Bottom Area */}
          <div className="border-t border-slate-700/60 p-4 overflow-hidden shrink-0">
            {/* User Profile display */}
            <div className="flex items-center gap-3">
              <div 
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-600/30 text-teal-400 border border-teal-500/20 font-bold text-sm shadow-sm"
                title={profile?.full_name || 'LGU User'}
              >
                {String(profile?.full_name || 'L').slice(0, 1).toUpperCase()}
              </div>
              <div className={`transition-all duration-300 ease-in-out origin-left whitespace-nowrap overflow-hidden text-left ${sidebarCollapsed ? 'opacity-0 w-0 scale-95 pointer-events-none' : 'opacity-100 w-full scale-100'}`}>
                <p className="text-xs font-bold text-white truncate">{profile?.full_name || 'LGU Administrator'}</p>
                <p className="text-[10px] text-slate-400 leading-none mt-0.5">LGU Account</p>
              </div>
            </div>

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

      <div className={`flex min-h-screen min-w-0 flex-1 flex-col transition-all duration-300 ${
        sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-80'
      }`}>
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 lg:px-6">
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
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">LGU Oversight Portal</p>
                <h2 className="truncate text-lg font-bold text-slate-900">{activeSection.label}</h2>
                <p className="truncate text-sm text-slate-500">{activeSection.description}</p>
              </div>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{activeTab.replace(/_/g, ' ')}</span>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full flex-1 px-4 py-5 lg:px-6 max-w-[1800px]">
          {activeTab === 'overview' && (
            <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
              {/* Total FMR Projects */}
              <div className="bg-white border border-slate-200/60 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow duration-300">
                <div className="flex items-start justify-between mb-2.5">
                  <div className="w-10 h-10 bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-xl flex items-center justify-center">
                    <svg className="w-4.5 h-4.5 text-indigo-650" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                  </div>
                  <span className="text-[9px] font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-1 rounded-md tracking-wider">PROJECTS</span>
                </div>
                <p className="text-2xl font-bold text-slate-900 tracking-tight">{summary.totalProjects}</p>
                <p className="text-xs text-slate-500 mt-1 font-medium">Total FMR Projects</p>
              </div>

              {/* Active Construction */}
              <div className="bg-white border border-slate-200/60 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow duration-300">
                <div className="flex items-start justify-between mb-2.5">
                  <div className="w-10 h-10 bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl flex items-center justify-center">
                    <svg className="w-4.5 h-4.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </div>
                  <span className="text-[9px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md tracking-wider">ACTIVE</span>
                </div>
                <p className="text-2xl font-bold text-slate-900 tracking-tight">{summary.activeProjects}</p>
                <p className="text-xs text-slate-500 mt-1 font-medium">Active Constructions</p>
              </div>

              {/* Farmer Profiles */}
              <div className="bg-white border border-slate-200/60 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow duration-300">
                <div className="flex items-start justify-between mb-2.5">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl flex items-center justify-center">
                    <svg className="w-4.5 h-4.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <span className="text-[9px] font-mono font-bold text-blue-700 bg-blue-50 px-2 py-1 rounded-md tracking-wider">FARMERS</span>
                </div>
                <p className="text-2xl font-bold text-slate-900 tracking-tight">{summary.beneficiaries}</p>
                <p className="text-xs text-slate-500 mt-1 font-medium">Farmer Profiles</p>
              </div>
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
                  <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col xl:flex-row gap-3">
                    <div className="relative flex-1 flex gap-2">
                      <div className="relative flex-1">
                        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                        <input
                          type="text"
                          value={lguMapSearch}
                          onChange={(e) => setLguMapSearch(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleLguMapSearchSubmit();
                          }}
                          placeholder="Search project name or location (e.g. Bucari)..."
                          className="w-full pl-10 pr-3 py-2 border border-slate-200 rounded-xl text-xs bg-white focus:ring-2 focus:ring-emerald-500/20 outline-none"
                        />
                      </div>
                      <button
                        onClick={handleLguMapSearchSubmit}
                        className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm shrink-0"
                      >
                        Search
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2.5 items-center">
                      <select
                        value={lguMapYearFilter}
                        onChange={(e) => setLguMapYearFilter(e.target.value)}
                        className="px-4 py-2 border border-slate-200 rounded-xl text-xs bg-white focus:ring-2 focus:ring-emerald-500/20 outline-none cursor-pointer"
                      >
                        <option value="All">All Years</option>
                        {lguMapYearOptions.map(y => <option key={y} value={String(y)}>FY {y}</option>)}
                      </select>

                      <select
                        value={lguMapStatusFilter}
                        onChange={(e) => setLguMapStatusFilter(e.target.value)}
                        className="px-4 py-2 border border-slate-200 rounded-xl text-xs bg-white focus:ring-2 focus:ring-emerald-500/20 outline-none cursor-pointer"
                      >
                        <option value="All">All Statuses</option>
                        <option value="Proposed">Proposed</option>
                        <option value="On-Going">On-Going</option>
                        <option value="Completed">Completed</option>
                      </select>

                      <select
                        value={lguMapBarangayFilter}
                        onChange={(e) => setLguMapBarangayFilter(e.target.value)}
                        className="px-4 py-2 border border-slate-200 rounded-xl text-xs bg-white focus:ring-2 focus:ring-emerald-500/20 outline-none cursor-pointer"
                      >
                        <option value="All">All Barangays</option>
                        {lguMapBarangayOptions.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>

                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <span>Date From:</span>
                        <input
                          type="date"
                          value={lguMapDateFrom}
                          onChange={(e) => setLguMapDateFrom(e.target.value)}
                          className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs bg-white focus:ring-2 focus:ring-emerald-500/20 outline-none cursor-pointer"
                        />
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <span>Date To:</span>
                        <input
                          type="date"
                          value={lguMapDateTo}
                          onChange={(e) => setLguMapDateTo(e.target.value)}
                          className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs bg-white focus:ring-2 focus:ring-emerald-500/20 outline-none cursor-pointer"
                        />
                      </div>

                      <button
                        onClick={() => setLguMapShowOverdueOnly(prev => !prev)}
                        className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
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
                    reports={filteredReports}
                    showHeat={showHeat}
                    farmerBeneficiaries={beneficiaries}
                    markets={markets}
                    mapCenter={lguMapCenter}
                    mapZoom={lguMapZoom}
                    searchMarker={lguMapSearchMarker}
                  />
                </div>

                {/* Road Inventory Cards list (Full Width) */}
                <div className="space-y-4">
                  <RoadInventoryTab />
                </div>
              </div>
            )}

            {activeTab === 'beneficiaries' && (
              <section className="space-y-5">
                {/* Summary Metric Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Card 1: Total Beneficiaries */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="p-3 bg-teal-50 text-teal-700 rounded-xl">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Beneficiaries</p>
                      <h4 className="text-xl font-bold text-slate-900 mt-0.5">{beneficiaries.length}</h4>
                      <p className="text-[10px] text-slate-500 mt-0.5">Farmers in listing</p>
                    </div>
                  </div>

                  {/* Card 2: Total Cultivated Land */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="p-3 bg-emerald-50 text-emerald-700 rounded-xl">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 002 2h2a2.5 2.5 0 002.5-2.5V10a2 2 0 00-2-2h-1a2 2 0 00-2-2v-1a2 2 0 00-2-2H9a3 3 0 00-3 3v.152" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Cultivated Area</p>
                      <h4 className="text-xl font-bold text-slate-900 mt-0.5">
                        {beneficiaries.reduce((sum, b) => sum + Number(b.farmAreaHa || 0), 0).toFixed(2)} ha
                      </h4>
                      <p className="text-[10px] text-slate-500 mt-0.5">Land area supported</p>
                    </div>
                  </div>

                  {/* Card 3: Crop Distribution */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="p-3 bg-amber-50 text-amber-700 rounded-xl">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707-.707M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Top Crops</p>
                      <div className="flex gap-x-2 gap-y-0.5 flex-wrap mt-1 text-[10px] font-semibold text-slate-650">
                        {(() => {
                          const crops = {};
                          beneficiaries.forEach(b => {
                            if (b.crop) crops[b.crop] = (crops[b.crop] || 0) + 1;
                          });
                          const cropEntries = Object.entries(crops).sort((a, b) => b[1] - a[1]);
                          if (cropEntries.length === 0) return <span className="text-slate-400">No crops</span>;
                          return cropEntries.slice(0, 3).map(([crop, count]) => {
                            const cropTone = 
                              crop === 'Rice' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                              crop === 'Corn' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                              crop === 'Sugarcane' ? 'bg-purple-50 text-purple-700 border-purple-100' :
                              crop === 'Coconut' ? 'bg-sky-50 text-sky-700 border-sky-100' :
                              crop === 'Vegetables' ? 'bg-pink-50 text-pink-700 border-pink-100' :
                              'bg-slate-50 text-slate-700 border-slate-100';
                            return (
                              <span key={crop} className={`whitespace-nowrap border px-1.5 py-0.5 rounded ${cropTone}`}>{crop}: {count}</span>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Card 4: Validation Status */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="p-3 bg-sky-50 text-sky-700 rounded-xl">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Validation Progress</p>
                      <h4 className="text-sm font-bold text-slate-900 mt-0.5">
                        Validated: {beneficiaries.filter(b => b.validationStatus === 'Validated').length}
                      </h4>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Pending: {beneficiaries.filter(b => b.validationStatus === 'For Verification' || b.validationStatus === 'Under Review').length}
                      </p>
                    </div>
                  </div>
                </div>

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
                </div>

                <BeneficiaryCsvImport
                  user={user}
                  profile={profile}
                  municipalityScope={municipalityScope}
                  onImported={fetchBeneficiaries}
                />

                {beneficiarySubTab === 'register' ? (
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
                    <input required value={beneficiaryForm.rsbsaNumber} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, rsbsaNumber: e.target.value }))} placeholder="RSBSA number *" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <input value={beneficiaryForm.controlNo} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, controlNo: e.target.value }))} placeholder="Control number" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <input value={beneficiaryForm.contactNumber} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, contactNumber: e.target.value }))} placeholder="Contact number" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <input type="date" value={beneficiaryForm.birthday} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, birthday: e.target.value }))} placeholder="Birthday" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <select required value={beneficiaryForm.gender} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, gender: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                    <input value={beneficiaryForm.agency} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, agency: e.target.value }))} placeholder="Agency (e.g. DA)" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    
                    <select required value={beneficiaryForm.municipality || municipalityScope} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, municipality: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <option value="">Select municipality *</option>
                      {eligibleMunicipalities.map((municipality) => <option key={municipality} value={municipality}>{municipality}</option>)}
                    </select>
                    <select required value={beneficiaryForm.barangay} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, barangay: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <option value="">Select barangay *</option>
                      {getBarangays(beneficiaryForm.municipality || municipalityScope).map((barangay) => <option key={barangay} value={barangay}>{barangay}</option>)}
                    </select>
                    <select required value={beneficiaryForm.crop} onChange={(e) => setBeneficiaryForm((current) => ({ ...current, crop: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      {BENEFICIARY_CROPS.map((crop) => <option key={crop} value={crop}>{crop}</option>)}
                    </select>
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
                          <MapCenterController
                            center={
                              beneficiaryForm.farmLatitude && beneficiaryForm.farmLongitude
                                ? [Number(beneficiaryForm.farmLatitude), Number(beneficiaryForm.farmLongitude)]
                                : getMunicipalityCentroid(municipalityScope || beneficiaryForm.municipality)
                            }
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
                              <label className="text-[11px] font-semibold text-slate-500">Account Login Email</label>
                              <input
                                type="email"
                                required
                                value={beneficiaryForm.accountEmail}
                                onChange={(e) => setBeneficiaryForm((current) => ({ ...current, accountEmail: e.target.value }))}
                                placeholder="e.g. farmer.name@kalsatrack.gov.ph"
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
                              gender: 'Male',
                              agency: 'DA',
                              municipality: '',
                              barangay: '',
                              crop: 'Rice',
                              farmAreaHa: '',
                              linkedProjectId: '',
                              nearestMarketId: '',
                              farmLatitude: '',
                              farmLongitude: '',
                              benefitReason: '',
                              createAccount: false,
                              accountEmail: '',
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

                  {/* Title & Filter/Sort Toolbar */}
                  <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-slate-100 pb-4 mb-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Submitted Beneficiaries</p>
                        <p className="text-xs text-slate-500">Records visible to the current LGU account ({filteredBeneficiaries.length} total).</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Search Input */}
                        <div className="relative">
                          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                          </svg>
                          <input
                            type="text"
                            value={beneficiarySearch}
                            onChange={(e) => setBeneficiarySearch(e.target.value)}
                            placeholder="Search beneficiaries..."
                            className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white w-48 sm:w-56 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 items-center text-xs">
                      {/* Filter by Status */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Status</span>
                        <select
                          value={beneficiaryStatusFilter}
                          onChange={(e) => setBeneficiaryStatusFilter(e.target.value)}
                          className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500/20 outline-none cursor-pointer"
                        >
                          <option value="all">All Statuses</option>
                          <option value="For Verification">For Verification</option>
                          <option value="Validated">Validated</option>
                          <option value="Needs Correction">Needs Correction</option>
                          <option value="Duplicate Record">Duplicate Record</option>
                          <option value="Rejected">Rejected</option>
                        </select>
                      </div>

                      {/* Filter by Crop */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Crop Type</span>
                        <select
                          value={beneficiaryCropFilter}
                          onChange={(e) => setBeneficiaryCropFilter(e.target.value)}
                          className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500/20 outline-none cursor-pointer"
                        >
                          <option value="all">All Crops</option>
                          <option value="Rice">Rice</option>
                          <option value="Corn">Corn</option>
                          <option value="Sugarcane">Sugarcane</option>
                          <option value="Coconut">Coconut</option>
                          <option value="Vegetables">Vegetables</option>
                        </select>
                      </div>

                      {/* Sort By Option */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Sort By</span>
                        <select
                          value={beneficiarySortBy}
                          onChange={(e) => setBeneficiarySortBy(e.target.value)}
                          className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500/20 outline-none cursor-pointer"
                        >
                          <option value="newest">Newest Submitted</option>
                          <option value="oldest">Oldest Submitted</option>
                          <option value="name-asc">Name (A-Z)</option>
                          <option value="name-desc">Name (Z-A)</option>
                          <option value="area-desc">Farm Area (Largest)</option>
                          <option value="area-asc">Farm Area (Smallest)</option>
                        </select>
                      </div>
                    </div>
                  </div>

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
                                <th className="px-5 py-3.5">Status</th>
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

                                const statusTone =
                                  row.validationStatus === 'Validated' ? 'bg-emerald-50 text-emerald-700 border-emerald-250' :
                                  row.validationStatus === 'Needs Correction' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                  row.validationStatus === 'Duplicate Record' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                  row.validationStatus === 'Rejected' ? 'bg-red-50 text-red-700 border-red-200' :
                                  'bg-sky-50 text-sky-700 border-sky-200'; // For Verification

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
                                            📍 {Number(row.farmLatitude).toFixed(5)}, {Number(row.farmLongitude).toFixed(5)}
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

                                    {/* Status */}
                                    <td className="px-5 py-4">
                                      <span className={`inline-flex px-2.5 py-0.5 rounded-full border text-[10px] font-semibold tracking-wide ${statusTone}`}>
                                        {row.validationStatus}
                                      </span>
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
                                              gender: row.gender || 'Male',
                                              agency: row.agency || 'DA',
                                              municipality: row.municipality || '',
                                              barangay: row.barangay || '',
                                              crop: row.crop || 'Rice',
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
                                            if (confirm(`Are you sure you want to delete the profile of ${row.fullName}?`)) {
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
              />
            )}




            {activeTab === 'analytics' && (
              <LguAnalyticsTab
                reports={reports}
                escalations={escalations}
                projects={projects}
                findings={findings}
              />
            )}

            {/* Farmer Profile Modal */}
            {selectedFarmerForModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
                <div className="relative w-full max-w-4xl bg-white rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-slide-up">
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
                        className="rounded-full p-1.5 hover:bg-slate-200/80 text-slate-400 hover:text-slate-700 transition-colors"
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
                          <span>📍 Location & Infrastructure Map</span>
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
                              html: '<div style="background:#16a34a;color:#fff;width:22px;height:22px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:10px;font-weight:700">S</div>',
                              iconSize: [22, 22],
                              iconAnchor: [11, 11],
                            });

                            const endIcon = new L.DivIcon({
                              className: 'lgu-route-end',
                              html: '<div style="background:#dc2626;color:#fff;width:22px;height:22px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:10px;font-weight:700">E</div>',
                              iconSize: [22, 22],
                              iconAnchor: [11, 11],
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
                                        html: `<div style="background:#4338ca;color:#fff;width:28px;height:28px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.25);font-size:12px">🏪</div>`,
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
