import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { supabase, supabaseAdmin } from '../lib/supabase';
import LguRouteMap from '../components/lgu/LguRouteMap';
import LguForActionTab from '../components/lgu/LguForActionTab';
import LguAnalyticsTab from '../components/lgu/LguAnalyticsTab';
import RoadInventoryTab from '../components/lgu/RoadInventoryTab';
import RoadConditionManagement from '../components/lgu/RoadConditionManagement';
import MarketManagement from '../components/lgu/MarketManagement';
import { getBarangays, getMunicipalities } from '../data/iloiloLocations';
import { BENEFICIARY_CROPS } from '../utils/farmerBeneficiaryData';
import { getMunicipalityCentroid } from '../lib/mapRouteUtils';
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

      return matchesSearch && matchesStatus && matchesYear;
    });
  }, [projects, lguMapSearch, lguMapStatusFilter, lguMapYearFilter]);

  const filteredBeneficiaries = useMemo(() => {
    const query = beneficiarySearch.trim().toLowerCase();
    return beneficiaries.filter((row) => {
      if (beneficiaryStatusFilter !== 'all' && row.validationStatus !== beneficiaryStatusFilter) return false;
      if (!query) return true;
      return [row.fullName, row.beneficiaryId, row.rsbsaNumber, row.municipality, row.barangay, row.linkedProject]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [beneficiaries, beneficiarySearch, beneficiaryStatusFilter]);

  const showNotification = (message) => {
    window.alert(message);
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
    return {
      total: filteredReports.length,
      pending: filteredReports.filter((r) => r.status === 'pending').length,
      resolved: filteredReports.filter((r) => r.status === 'resolved').length,
      escalated: escalations.filter((r) => ['for_action', 'endorsed', 'rejected', 'more_info_requested'].includes(r.escalation_status)).length,
      beneficiaries: beneficiaries.length,
    };
  }, [filteredReports, escalations, beneficiaries]);

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

  const handleDecision = async (row, decision, remarks) => {
    const now = new Date().toISOString();

    await supabase.from('public_report_lgu_decisions').insert({
      escalation_id: row.id,
      report_id: row.report_id,
      decision,
      remarks,
      lgu_user_id: user.id,
      lgu_name: profile?.full_name || profile?.email || user.email,
      municipality: row.municipality || municipalityScope || null,
      created_at: now,
    });

    await supabase
      .from('public_report_lgu_escalations')
      .update({
        escalation_status: decision,
        decision_at: now,
        decision_by: profile?.full_name || profile?.email || user.email,
        decision_remarks: remarks,
      })
      .eq('id', row.id);

    const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin');
    if (Array.isArray(admins) && admins.length > 0) {
      const rows = admins.map((adm) => ({
        user_id: adm.id,
        type: 'lgu_decision',
        title: 'LGU decision received',
        message: `LGU marked report ${String(row.report_id || '').slice(0, 8)} as ${decision.replace(/_/g, ' ')}.`,
        report_id: row.report_id,
        is_read: false,
        created_at: now,
      }));
      await supabase.from('notifications').insert(rows);
    }

    showNotification('LGU decision recorded.');
    await fetchAll();
  };

  const exportPdf = () => {
    window.print();
  };

  const navItems = [
    { id: 'overview', label: 'Overview', description: 'Summary and route map' },
    { id: 'beneficiaries', label: 'Beneficiaries', description: 'Register farmer beneficiaries' },
    { id: 'markets', label: 'Markets', description: 'Register agricultural markets' },
    { id: 'for_action', label: 'For Action', description: 'Items needing LGU action' },
    { id: 'analytics', label: 'Analytics', description: 'Trends and reporting' },
    { id: 'road_inventory', label: 'Road Inventory', description: 'CSV-backed road list' },
    { id: 'road_condition_management', label: 'Road Conditions', description: 'Inspections and history' },
  ];

  const activeSection = navItems.find((item) => item.id === activeTab) || navItems[0];

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside className={`fixed inset-y-0 left-0 z-40 w-80 border-r border-slate-800 bg-slate-900 text-white shadow-2xl transition-transform duration-300 lg:static lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-700/60 px-6 py-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">LGU Oversight Portal</p>
                <h1 className="mt-2 text-2xl font-bold text-white">KalsaTrack LGU</h1>
                <p className="mt-2 text-sm text-slate-300">Road inventory and road condition tools for municipal review.</p>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs font-semibold text-slate-300 lg:hidden"
              >
                Close
              </button>
            </div>
            <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-800/70 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Scope</p>
              <p className="mt-1 text-sm font-semibold text-white">{municipalityScope || 'All municipalities (RLS controlled)'}</p>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-4">
            <p className="px-3 pb-3 text-xs font-bold uppercase tracking-[0.25em] text-slate-500">Main Menu</p>
            <div className="space-y-2">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setSidebarOpen(false);
                  }}
                  className={`flex w-full items-start gap-4 rounded-2xl px-4 py-4 text-left transition-all duration-200 ${activeTab === item.id ? 'bg-teal-500 text-white shadow-lg shadow-teal-500/20' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                >
                  <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${activeTab === item.id ? 'bg-white/20' : 'bg-slate-800'}`}>
                    <span className="text-sm font-bold">{String(item.label || '').slice(0, 1)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-5">{item.label}</p>
                    <p className={`mt-1 text-xs leading-4 ${activeTab === item.id ? 'text-teal-50' : 'text-slate-400'}`}>{item.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </nav>

          <div className="border-t border-slate-700/60 px-4 py-4">
            <button
              onClick={exportPdf}
              className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
            >
              Export PDF
            </button>
            <button
              onClick={handleSignOut}
              className="mt-3 w-full rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 hover:bg-red-500/20"
            >
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setSidebarOpen((open) => !open)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden"
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

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 lg:px-6">
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Total Reports', summary.total, 'default'],
            ['Pending', summary.pending, 'pending'],
            ['Resolved', summary.resolved, 'resolved'],
            ['Escalated', summary.escalated, 'escalated'],
            ['Farmer Profiles', summary.beneficiaries, 'resolved'],
          ].map(([label, value, tone]) => (
            <div key={label} className={`rounded-xl border px-4 py-3 ${cardTone(tone)}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide">{label}</p>
              <p className="mt-1 text-2xl font-bold leading-none">{value}</p>
            </div>
          ))}
          </section>

          <section className="mt-5 rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">Report Filters</p>
                <p className="text-xs text-slate-500">
                  {activeFilterCount > 0 ? `${activeFilterCount} active filter${activeFilterCount > 1 ? 's' : ''}` : 'Showing all reports'}
                </p>
              </div>
              <button
                onClick={() => setFiltersOpen((open) => !open)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {filtersOpen ? 'Hide Filters' : 'Show Filters'}
              </button>
            </div>

            {filtersOpen && (
              <div className="grid grid-cols-1 gap-2 border-t border-slate-100 p-3 md:grid-cols-2 xl:grid-cols-6">
                <select value={barangayFilter} onChange={(e) => setBarangayFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  {uniqueBarangays.map((value) => <option key={value} value={value}>{value === 'all' ? 'All Barangays' : value}</option>)}
                </select>
                <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  {uniqueProjects.map((value) => <option key={value} value={value}>{value === 'all' ? 'All Projects' : value}</option>)}
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <option value="all">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="resolved">Resolved</option>
                </select>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                  <input type="checkbox" checked={showHeat} onChange={(e) => setShowHeat(e.target.checked)} />
                  Heatmap
                </label>
              </div>
            )}
          </section>

          <section className="mt-5">
            {activeTab === 'overview' && (
              <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Route Map</p>
                        <p className="text-xs text-slate-500">Projects and citizen reports in view.</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{filteredReports.length} reports</span>
                    </div>

                    {/* LGU Map Projects Filter Toolbar */}
                    <div className="p-3 border-b border-slate-100 bg-slate-50/55 flex flex-col md:flex-row gap-2">
                      <div className="relative flex-1">
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                        <input
                          type="text"
                          value={lguMapSearch}
                          onChange={(e) => setLguMapSearch(e.target.value)}
                          placeholder="Search projects (e.g. LGU, CSV, road name)..."
                          className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                        />
                      </div>

                      <select
                        value={lguMapYearFilter}
                        onChange={(e) => setLguMapYearFilter(e.target.value)}
                        className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-emerald-500 outline-none"
                      >
                        <option value="All">All Years</option>
                        {lguMapYearOptions.map(y => <option key={y} value={String(y)}>FY {y}</option>)}
                      </select>

                      <select
                        value={lguMapStatusFilter}
                        onChange={(e) => setLguMapStatusFilter(e.target.value)}
                        className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-emerald-500 outline-none"
                      >
                        <option value="All">All Statuses</option>
                        <option value="Proposed">Proposed</option>
                        <option value="On-Going">On-Going</option>
                        <option value="Completed">Completed</option>
                      </select>
                    </div>

                    <LguRouteMap
                      projects={filteredMapProjects}
                      routesByProjectId={routesByProjectId}
                      reports={filteredReports}
                      showHeat={showHeat}
                      farmerBeneficiaries={beneficiaries}
                      markets={markets}
                    />
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 overflow-x-auto">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">Reports In Jurisdiction</p>
                      <span className="text-xs font-medium text-slate-500">Latest first</span>
                    </div>
                    <table className="w-full min-w-[680px] text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                          <th className="py-2 pr-3">Date</th>
                          <th className="py-2 pr-3">Project</th>
                          <th className="py-2 pr-3">Location</th>
                          <th className="py-2 pr-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredReports.slice(0, 8).map((row) => (
                          <tr key={row.id} className="border-b border-slate-100 last:border-0">
                            <td className="py-2 pr-3 text-slate-600">{new Date(row.created_at).toLocaleDateString()}</td>
                            <td className="py-2 pr-3 font-medium text-slate-900">{row.project_name || 'N/A'}</td>
                            <td className="py-2 pr-3 text-slate-700">{row.barangay || 'N/A'}, {row.municipality || 'N/A'}</td>
                            <td className="py-2 pr-3">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ${statusTone(row.status)}`}>
                                {row.status || 'pending'}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {filteredReports.length === 0 && (
                          <tr>
                            <td className="py-4 text-slate-500" colSpan={4}>No reports match the selected filters.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-xl border border-emerald-200 bg-white p-4 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Road Inventory</p>
                      <p className="text-xs text-slate-500">Leon barangay roads snapshot from the CSV data.</p>
                    </div>
                    <button
                      onClick={() => setActiveTab('road_inventory')}
                      className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      Open
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Roads</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">{roadInventoryStats.totalRoads}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Total Km</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">{roadInventoryStats.totalKm.toFixed(2)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Concrete Roads</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">{roadInventoryStats.concreteRoads}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Needs Attention</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">{roadInventoryStats.highPriority}</p>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left text-slate-500 border-b border-slate-200">
                          <th className="px-3 py-2">Road</th>
                          <th className="px-3 py-2">Condition</th>
                          <th className="px-3 py-2 text-right">Km</th>
                        </tr>
                      </thead>
                      <tbody>
                        {roadInventoryStats.preview.map((row) => (
                          <tr key={`${row.roadName}-${row.yearConstructed}-${row.lengthKm}`} className="border-t border-slate-100">
                            <td className="px-3 py-2">
                              <p className="font-medium text-slate-900">{row.roadName || 'N/A'}</p>
                              <p className="text-xs text-slate-500">{row.barangay || 'N/A'}</p>
                            </td>
                            <td className="px-3 py-2 text-slate-700">{row.condition || 'N/A'}</td>
                            <td className="px-3 py-2 text-right text-slate-700">{Number(row.lengthKm || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'beneficiaries' && (
              <section className="space-y-5">
                <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Register Farmer Beneficiary</p>
                      <p className="text-xs text-slate-500">Register a farmer beneficiary profile. Profiles are submitted directly to the DA dashboard.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={beneficiarySearch}
                        onChange={(e) => setBeneficiarySearch(e.target.value)}
                        placeholder="Search beneficiaries"
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                      <select
                        value={beneficiaryStatusFilter}
                        onChange={(e) => setBeneficiaryStatusFilter(e.target.value)}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      >
                        <option value="all">All Statuses</option>
                        <option value="Validated">Validated</option>
                      </select>
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
                            const fullQuery = `${queryVal}, ${municipalityScope || beneficiaryForm.municipality || 'Iloilo'}, Iloilo`;
                            try {
                              const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullQuery)}`);
                              const results = await res.json();
                              if (results && results.length > 0) {
                                const { lat, lon } = results[0];
                                setBeneficiaryForm(curr => ({
                                  ...curr,
                                  farmLatitude: lat,
                                  farmLongitude: lon
                                }));
                              } else {
                                alert("No location found. Please try a different query or click directly on the map.");
                              }
                            } catch (err) {
                              console.error(err);
                            }
                          }}
                          className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition-colors"
                        >
                          Search
                        </button>
                      </div>

                      <div style={{ height: '280px', width: '100%', position: 'relative' }}>
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

                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">Submitted Beneficiaries</p>
                    <p className="text-xs text-slate-500">Records visible to the current LGU account.</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1100px] text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Farmer Details</th>
                          <th className="px-4 py-3">Location & Coordinates</th>
                          <th className="px-4 py-3">Crop / Land Area</th>
                          <th className="px-4 py-3">Linked Infrastructure & Market</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Last Updated</th>
                          <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {beneficiariesLoading ? (
                          <tr><td className="px-4 py-5 text-slate-500" colSpan={7}>Loading beneficiary records...</td></tr>
                        ) : filteredBeneficiaries.length === 0 ? (
                          <tr><td className="px-4 py-5 text-slate-500" colSpan={7}>No beneficiary records yet.</td></tr>
                        ) : filteredBeneficiaries.map((row) => (
                          <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3">
                              <p className="font-semibold text-slate-900">{row.fullName}</p>
                              <div className="text-xs text-slate-500 space-y-0.5">
                                <p><span className="font-medium text-slate-400">RSBSA:</span> {row.rsbsaNumber}</p>
                                {row.controlNo && <p><span className="font-medium text-slate-400">Control:</span> {row.controlNo}</p>}
                                {row.gender && <p><span className="font-medium text-slate-400">Gender:</span> {row.gender} • <span className="font-medium text-slate-400">Age:</span> {row.birthday ? new Date().getFullYear() - new Date(row.birthday).getFullYear() : 'N/A'}</p>}
                                {row.contactNumber && <p><span className="font-medium text-slate-400">Contact:</span> {row.contactNumber}</p>}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              <p className="font-medium text-slate-800">{row.barangay}, {row.municipality}</p>
                              {row.farmLatitude && row.farmLongitude ? (
                                <p className="text-xs font-mono text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded w-fit mt-1 border border-emerald-100">
                                  📍 {Number(row.farmLatitude).toFixed(5)}, {Number(row.farmLongitude).toFixed(5)}
                                </p>
                              ) : (
                                <p className="text-xs text-slate-400 mt-1 italic">No coordinates set</p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              <p className="font-semibold text-slate-800">{row.crop || 'N/A'}</p>
                              <p className="text-xs text-slate-500">{row.farmAreaHa ? `${row.farmAreaHa.toFixed(2)} Hectares` : '0.00 ha'}</p>
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              <div className="space-y-0.5 text-xs text-slate-600">
                                <p><span className="font-medium text-slate-700">Road:</span> {row.linkedProject || 'N/A'}</p>
                                <p><span className="font-medium text-slate-700">Distance:</span> {row.distanceToFmrKm ? `${row.distanceToFmrKm} km` : 'N/A'}</p>
                                <p><span className="font-medium text-slate-700">Market:</span> {markets.find(m => m.id === row.nearestMarketId)?.market_name || 'N/A'}</p>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                row.validationStatus === 'Validated' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-700'
                              }`}>
                                {row.validationStatus}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-500 text-xs">{row.lastUpdated.toLocaleDateString()}</td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end gap-2.5">
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
                                  className="text-xs font-semibold text-red-600 hover:text-red-800 transition-colors"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'markets' && (
              <MarketManagement
                user={user}
                profile={profile}
                municipalityScope={municipalityScope}
              />
            )}

            {activeTab === 'for_action' && (
              <LguForActionTab
                escalations={escalations}
                findings={findings}
                loading={loading}
                onDecision={handleDecision}
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

            {activeTab === 'road_inventory' && (
              <RoadInventoryTab />
            )}

            {activeTab === 'road_condition_management' && (
              <RoadConditionManagement />
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
