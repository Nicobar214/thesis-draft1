import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Marker, CircleMarker, Tooltip, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";

import { supabase } from "../lib/supabase";
import { fetchRoadAlignedPolyline, calculatePolylineDistanceKm } from "../lib/mapRouteUtils";
import PublicReportForm from "../components/PublicReportForm";
import DAResolutionCertificate from "../components/publicReports/DAResolutionCertificate";
import PublicReportRouteMapPanel from "../components/publicReports/PublicReportRouteMapPanel";
import Icons from "../components/Icons";

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

export default function FarmerDashboard() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [farmerRecord, setFarmerRecord] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  const [selectedReportCert, setSelectedReportCert] = useState(null);
  const [certFieldFinding, setCertFieldFinding] = useState(null);
  const [certResolution, setCertResolution] = useState(null);
  const [showCertModal, setShowCertModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedMapReportId, setExpandedMapReportId] = useState(null);
  const [mapProjectByReportId, setMapProjectByReportId] = useState({});
  const [mapRouteByReportId, setMapRouteByReportId] = useState({});

  // Data states
  const [fmrProjects, setFmrProjects] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [harvestLogs, setHarvestLogs] = useState([]);
  const [myReports, setMyReports] = useState([]);
  const [harvestLoading, setHarvestLoading] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [snappedFmrPath, setSnappedFmrPath] = useState(null);
  const [snappedSupplyPath, setSnappedSupplyPath] = useState(null);

  const [harvestForm, setHarvestForm] = useState({
    crop: "",
    quantityKg: "",
    harvestDate: new Date().toISOString().split("T")[0],
    remarks: "",
  });

  const [notification, setNotification] = useState({ message: "", type: "" });

  const showNotification = (message, type = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification({ message: "", type: "" }), 4000);
  };

  // Resolve the FMR project for a report and toggle its inline route map.
  // project_id on public_reports can be stored as a prefixed string (e.g.
  // "fmr-<uuid>") rather than the raw fmr_projects.id, so a direct id match
  // can miss — always fall back to matching by project name.
  const toggleReportMap = async (rpt) => {
    if (expandedMapReportId === rpt.id) {
      setExpandedMapReportId(null);
      return;
    }
    setExpandedMapReportId(rpt.id);
    if (mapProjectByReportId[rpt.id] !== undefined) return;

    try {
      let projectRow = null;
      if (rpt.project_id) {
        const { data } = await supabase.from('fmr_projects').select('*').eq('id', rpt.project_id).maybeSingle();
        projectRow = data || null;
      }
      if (!projectRow && rpt.project_name) {
        const { data } = await supabase.from('fmr_projects').select('*').ilike('project_name', String(rpt.project_name)).limit(1).maybeSingle();
        projectRow = data || null;
      }
      setMapProjectByReportId((prev) => ({ ...prev, [rpt.id]: projectRow }));

      if (projectRow?.id) {
        const { data: routeRow } = await supabase.from('project_routes').select('*').eq('project_id', projectRow.id).maybeSingle();
        setMapRouteByReportId((prev) => ({ ...prev, [rpt.id]: routeRow || null }));
      } else {
        setMapRouteByReportId((prev) => ({ ...prev, [rpt.id]: null }));
      }
    } catch {
      setMapProjectByReportId((prev) => ({ ...prev, [rpt.id]: null }));
      setMapRouteByReportId((prev) => ({ ...prev, [rpt.id]: null }));
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  // 1. Fetch user authentication & farmer profile
  useEffect(() => {
    const initSession = async () => {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser) {
          navigate("/farmer/login");
          return;
        }
        setUser(currentUser);

        const { data: userProfile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", currentUser.id)
          .maybeSingle();

        setProfile(userProfile);

        const { data: farmer, error: farmerErr } = await supabase
          .from("farmer_beneficiaries")
          .select("*")
          .eq("user_id", currentUser.id)
          .maybeSingle();

        if (farmerErr) {
          console.error("Error fetching farmer beneficiary profile:", farmerErr);
        }

        if (farmer) {
          setFarmerRecord(farmer);
          setHarvestForm(prev => ({ ...prev, crop: farmer.crop }));
        }
      } catch (err) {
        console.error("Auth initialization error:", err);
      } finally {
        setLoading(false);
      }
    };
    initSession();
  }, [navigate]);

  // 2. Fetch markets, FMR projects, harvest logs, and submitted reports
  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      // Fetch FMR projects matching the farmer's municipality
      const { data: projects } = await supabase
        .from("fmr_projects")
        .select("*");
      setFmrProjects(projects || []);

      // Fetch all agricultural markets
      const { data: marketData } = await supabase
        .from("market_locations")
        .select("*");
      setMarkets(marketData || []);

      // Fetch farmer's own harvest logs
      const { data: logs } = await supabase
        .from("farmer_harvest_logs")
        .select("*")
        .eq("farmer_id", user.id)
        .order("harvest_date", { ascending: true });
      setHarvestLogs(logs || []);

      // Fetch farmer's submitted road reports
      const { data: reports } = await supabase
        .from("public_reports")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setMyReports(reports || []);
    } catch (err) {
      console.error("Error fetching data:", err);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchData();

      // Realtime subscription for harvest logs
      const subHarvests = supabase
        .channel("farmer-harvests")
        .on("postgres_changes", { event: "*", schema: "public", table: "farmer_harvest_logs", filter: `farmer_id=eq.${user.id}` }, fetchData)
        .subscribe();

      // Realtime subscription for public reports
      const subReports = supabase
        .channel("farmer-reports")
        .on("postgres_changes", { event: "*", schema: "public", table: "public_reports", filter: `user_id=eq.${user.id}` }, fetchData)
        .subscribe();

      return () => {
        supabase.removeChannel(subHarvests);
        supabase.removeChannel(subReports);
      };
    }
  }, [user, fetchData]);

  // 3. Log a new harvest record
  const handleHarvestSubmit = async (e) => {
    e.preventDefault();
    if (!user || !farmerRecord) return;

    const qty = Number(harvestForm.quantityKg);
    if (!qty || qty <= 0) {
      showNotification("Please enter a valid harvest quantity", "error");
      return;
    }

    setHarvestLoading(true);
    try {
      const { error } = await supabase.from("farmer_harvest_logs").insert({
        farmer_id: user.id,
        crop: harvestForm.crop || farmerRecord.crop,
        quantity_kg: qty,
        harvest_date: harvestForm.harvestDate,
        remarks: harvestForm.remarks.trim(),
      });

      if (error) throw error;

      showNotification("Harvest log submitted successfully!");
      setHarvestForm(prev => ({
        ...prev,
        quantityKg: "",
        remarks: "",
      }));
    } catch (err) {
      showNotification(`Failed to submit harvest log: ${err.message}`, "error");
    } finally {
      setHarvestLoading(false);
    }
  };

  // Compute stats and locations for mapping
  const farmLat = farmerRecord?.farm_latitude;
  const farmLng = farmerRecord?.farm_longitude;

  // Find nearest FMR road (straight-line pre-filter -- cheap candidate
  // selection; the actual displayed distance/route is road-snapped below)
  const { nearestFmr, distToFmr } = useMemo(() => {
    let nearest = null;
    let dist = Infinity;
    if (farmLat && farmLng && fmrProjects.length > 0) {
      fmrProjects.forEach(p => {
        const startLat = Number(p.start_latitude);
        const startLng = Number(p.start_longitude);
        const endLat = Number(p.end_latitude);
        const endLng = Number(p.end_longitude);
        if (startLat && startLng) {
          const d1 = haversineMeters(farmLat, farmLng, startLat, startLng);
          if (d1 < dist) {
            dist = d1;
            nearest = p;
          }
        }
        if (endLat && endLng) {
          const d2 = haversineMeters(farmLat, farmLng, endLat, endLng);
          if (d2 < dist) {
            dist = d2;
            nearest = p;
          }
        }
      });
    }
    return { nearestFmr: nearest, distToFmr: dist };
  }, [farmLat, farmLng, fmrProjects]);

  // Find nearest market (same straight-line pre-filter rationale as above)
  const { nearestMarket, distToMarket } = useMemo(() => {
    let nearest = null;
    let dist = Infinity;
    if (farmLat && farmLng && markets.length > 0) {
      markets.forEach(m => {
        const mLat = Number(m.latitude);
        const mLng = Number(m.longitude);
        if (mLat && mLng) {
          const d = haversineMeters(farmLat, farmLng, mLat, mLng);
          if (d < dist) {
            dist = d;
            nearest = m;
          }
        }
      });
    }
    return { nearestMarket: nearest, distToMarket: dist };
  }, [farmLat, farmLng, markets]);

  // Build Supply Chain line path for leaflet mapping
  const supplyChainPath = useMemo(() => {
    const path = [];
    if (farmLat && farmLng) {
      path.push([farmLat, farmLng]);
      if (nearestFmr) {
        const startLat = Number(nearestFmr.start_latitude);
        const startLng = Number(nearestFmr.start_longitude);
        if (startLat && startLng) {
          path.push([startLat, startLng]);
        }
      }
      if (nearestMarket) {
        path.push([Number(nearestMarket.latitude), Number(nearestMarket.longitude)]);
      }
    }
    return path;
  }, [farmLat, farmLng, nearestFmr, nearestMarket]);

  // Snap the FMR access line and the supply-chain path onto real road
  // geometry (OSRM) instead of leaving them as straight Euclidean lines.
  useEffect(() => {
    let cancelled = false;

    async function snapPaths() {
      const fmrStartLat = Number(nearestFmr?.start_latitude);
      const fmrStartLng = Number(nearestFmr?.start_longitude);
      const fmrEndLat = Number(nearestFmr?.end_latitude);
      const fmrEndLng = Number(nearestFmr?.end_longitude);

      const fmrPromise = (nearestFmr && fmrStartLat && fmrStartLng && fmrEndLat && fmrEndLng)
        ? fetchRoadAlignedPolyline([[fmrStartLat, fmrStartLng], [fmrEndLat, fmrEndLng]])
        : Promise.resolve(null);

      const supplyPromise = supplyChainPath.length > 1
        ? fetchRoadAlignedPolyline(supplyChainPath)
        : Promise.resolve(null);

      const [fmrSnapped, supplySnapped] = await Promise.all([fmrPromise, supplyPromise]);
      if (cancelled) return;
      setSnappedFmrPath(fmrSnapped);
      setSnappedSupplyPath(supplySnapped);
    }

    snapPaths();
    return () => { cancelled = true; };
  }, [nearestFmr, supplyChainPath]);

  const roadDistToFmr = snappedFmrPath ? calculatePolylineDistanceKm(snappedFmrPath) * 1000 : distToFmr;
  const roadDistToMarket = snappedSupplyPath ? calculatePolylineDistanceKm(snappedSupplyPath) * 1000 : distToMarket;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-emerald-50">
        <div className="text-center p-6">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-700 mx-auto mb-4"></div>
          <p className="text-emerald-700 font-bold text-base">Loading Farmer Portal...</p>
          <p className="text-xs text-slate-500 mt-1">Synchronizing farm logistics & maps</p>
        </div>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans pb-20 md:pb-6">
      {/* Dynamic Notification Popup */}
      {notification.message && (
        <div
          className={`fixed top-4 right-4 z-[9999] flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg transition-all duration-300 transform scale-100 ${
            notification.type === "error"
              ? "bg-red-50 text-red-800 border border-red-200"
              : "bg-emerald-50 text-emerald-800 border border-emerald-200"
          }`}
        >
          <span className="text-xs sm:text-sm font-semibold">{notification.message}</span>
        </div>
      )}

      {/* Header Panel */}
      <header className="bg-gradient-to-r from-emerald-900 via-emerald-800 to-teal-900 text-white shadow-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-white/20 rounded-xl flex items-center justify-center text-lg sm:text-xl shadow-inner">🌾</div>
            <div>
              <h1 className="text-base sm:text-lg font-extrabold tracking-tight">KalsaTrack</h1>
              <p className="text-[10px] sm:text-xs text-emerald-200 font-semibold uppercase tracking-wider">Farmer Oversight Portal</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-bold">{farmerRecord?.full_name || profile?.full_name || "Farmer User"}</p>
              <p className="text-xs text-emerald-200">RSBSA: {farmerRecord?.rsbsa_number || "N/A"}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="bg-emerald-950/60 hover:bg-emerald-950 text-emerald-100 hover:text-white px-3 py-2 rounded-xl text-xs font-bold border border-emerald-700/50 transition-colors flex items-center gap-1.5 active:scale-95"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col lg:flex-row gap-5">
        
        {/* Left Side: Summary Card */}
        <aside className="w-full lg:w-80 shrink-0 space-y-4 sm:space-y-6">
          {/* Profile Details */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-4 sm:space-y-5">
            <div className="flex items-center gap-3 pb-3 sm:pb-4 border-b border-slate-100">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center text-lg sm:text-xl font-bold border border-emerald-200">
                {farmerRecord?.first_name?.charAt(0) || "F"}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-slate-900 text-sm sm:text-base truncate">{farmerRecord?.full_name || "Farmer Account"}</h3>
                <p className="text-xs text-slate-500 truncate">{farmerRecord?.barangay || "N/A"}, {farmerRecord?.municipality || "Leon"}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-1 gap-2.5 sm:gap-3.5 text-xs text-slate-700">
              <div className="flex flex-col sm:flex-row sm:justify-between bg-slate-50 sm:bg-transparent p-2 sm:p-0 rounded-lg">
                <span className="text-slate-500 text-[11px] sm:text-xs">RSBSA Number:</span>
                <span className="font-bold text-slate-800">{farmerRecord?.rsbsa_number || "N/A"}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between bg-slate-50 sm:bg-transparent p-2 sm:p-0 rounded-lg">
                <span className="text-slate-500 text-[11px] sm:text-xs">Control ID:</span>
                <span className="font-medium text-slate-800">{farmerRecord?.control_no || "N/A"}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between bg-slate-50 sm:bg-transparent p-2 sm:p-0 rounded-lg">
                <span className="text-slate-500 text-[11px] sm:text-xs">Primary Crop:</span>
                <span className="font-semibold text-emerald-700 px-2 py-0.5 bg-emerald-50 rounded-full border border-emerald-200 w-fit">{farmerRecord?.crop || "N/A"}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between bg-slate-50 sm:bg-transparent p-2 sm:p-0 rounded-lg">
                <span className="text-slate-500 text-[11px] sm:text-xs">Farm Area Size:</span>
                <span className="font-bold text-slate-800">{farmerRecord?.farm_area_ha ? `${farmerRecord.farm_area_ha} Ha` : "N/A"}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between bg-slate-50 sm:bg-transparent p-2 sm:p-0 rounded-lg">
                <span className="text-slate-500 text-[11px] sm:text-xs">Contact Number:</span>
                <span className="font-medium text-slate-800">{farmerRecord?.contact_number || "N/A"}</span>
              </div>
            </div>
          </div>

          {/* Quick Metrics Card */}
          <div className="bg-gradient-to-br from-emerald-800 to-teal-800 text-white rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <h4 className="text-xs uppercase tracking-wider font-bold text-emerald-200">Logistics Summary</h4>
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-3 sm:space-y-4 lg:gap-0">
              <div>
                <p className="text-[11px] sm:text-xs text-emerald-100">Distance to FMR (by road)</p>
                <p className="text-xl sm:text-2xl font-bold">{roadDistToFmr !== Infinity ? `${(roadDistToFmr / 1000).toFixed(2)} km` : "N/A"}</p>
                <p className="text-[10px] text-emerald-200/80 mt-0.5 truncate">{farmerRecord?.service_area || "N/A"}</p>
              </div>
              <div className="lg:pt-3 lg:border-t lg:border-white/10">
                <p className="text-[11px] sm:text-xs text-emerald-100">Distance to Market (by road)</p>
                <p className="text-xl sm:text-2xl font-bold">{roadDistToMarket !== Infinity ? `${(roadDistToMarket / 1000).toFixed(2)} km` : "N/A"}</p>
                <p className="text-[10px] text-emerald-200/80 mt-0.5 truncate">{nearestMarket?.market_name || "N/A"}</p>
              </div>
            </div>
          </div>
        </aside>

        {/* Right Side: Tab Panel Content */}
        <section className="flex-1 flex flex-col gap-5 min-w-0">
          
          {/* Desktop/Tablet Horizontal Tabs */}
          <div className="hidden sm:flex border-b border-slate-200 gap-1 bg-white p-1.5 rounded-2xl border overflow-x-auto">
            <button
              onClick={() => setActiveTab("overview")}
              className={`py-2 px-3 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                activeTab === "overview" ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              📍 Logistics Map
            </button>
            <button
              onClick={() => setActiveTab("report_damage")}
              className={`py-2 px-3 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                activeTab === "report_damage" ? "bg-amber-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              ⚠️ Report Issue
            </button>
            <button
              onClick={() => setActiveTab("my_reports")}
              className={`py-2 px-3 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                activeTab === "my_reports" ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              📋 My Reports ({myReports.length})
            </button>
            <button
              onClick={() => setActiveTab("markets")}
              className={`py-2 px-3 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                activeTab === "markets" ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              🏪 Markets Directory
            </button>
          </div>

          {/* TAB 1: LOGISTICS MAP */}
          {activeTab === "overview" && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-4">
              <div>
                <h3 className="font-bold text-slate-900 text-base sm:text-lg">Supply Chain Access Map</h3>
                <p className="text-xs text-slate-500 mt-0.5">Visualize your farm location routing through your linked Farm-to-Market Road project to the municipal market center.</p>
              </div>

              <div className="h-[320px] sm:h-[420px] rounded-2xl overflow-hidden border border-slate-200 relative z-10 shadow-inner">
                {farmLat && farmLng ? (
                  <MapContainer
                    center={[farmLat, farmLng]}
                    zoom={14}
                    style={{ height: "100%", width: "100%" }}
                    scrollWheelZoom={true}
                  >
                    <TileLayer
                      attribution='&copy; OpenStreetMap contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    {/* Farmer Location Dot */}
                    <CircleMarker
                      center={[farmLat, farmLng]}
                      radius={9}
                      pathOptions={{
                        fillColor: "#10b981",
                        fillOpacity: 0.9,
                        color: "#ffffff",
                        weight: 2
                      }}
                    >
                      <Popup>
                        <div className="text-xs font-sans">
                          <p className="font-bold text-emerald-800">Your Farm Location</p>
                          <p className="text-slate-600">Crop: {farmerRecord?.crop}</p>
                          <p className="text-slate-600">Area: {farmerRecord?.farm_area_ha} Ha</p>
                        </div>
                      </Popup>
                      <Tooltip permanent direction="top" opacity={0.9}>
                        <span className="text-[10px] font-bold text-emerald-800">My Farm 🏡</span>
                      </Tooltip>
                    </CircleMarker>

                    {/* Linked FMR Project Markers */}
                    {nearestFmr && nearestFmr.start_latitude && nearestFmr.start_longitude && (
                      <>
                        <Marker
                          position={[Number(nearestFmr.start_latitude), Number(nearestFmr.start_longitude)]}
                          icon={new L.DivIcon({
                            className: 'fmr-endpoint-pin',
                            html: `<div style="background:#f59e0b;color:#fff;width:24px;height:24px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:10px;font-weight:bold">🛣️</div>`,
                            iconSize: [24, 24],
                            iconAnchor: [12, 12],
                          })}
                        >
                          <Popup>
                            <div className="text-xs font-sans">
                              <p className="font-bold text-amber-700">Linked FMR Access Point</p>
                              <p className="font-medium text-slate-800">{nearestFmr.project_name}</p>
                              <p className="text-slate-600">Status: {nearestFmr.status}</p>
                            </div>
                          </Popup>
                        </Marker>

                        {/* FMR Path (road-network-aligned, falls back to a straight line while snapping) */}
                        {nearestFmr.end_latitude && nearestFmr.end_longitude && (
                          <Polyline
                            positions={snappedFmrPath || [
                              [Number(nearestFmr.start_latitude), Number(nearestFmr.start_longitude)],
                              [Number(nearestFmr.end_latitude), Number(nearestFmr.end_longitude)]
                            ]}
                            pathOptions={{ color: "#3b82f6", weight: 4, dashArray: "5, 10" }}
                          >
                            <Popup>
                              <span className="text-xs font-sans font-semibold text-blue-700">{nearestFmr.project_name}</span>
                            </Popup>
                          </Polyline>
                        )}
                      </>
                    )}

                    {/* Markets Pin Layer */}
                    {markets.map(m => (
                      <Marker
                        key={m.id}
                        position={[Number(m.latitude), Number(m.longitude)]}
                        icon={new L.DivIcon({
                          className: 'market-pin',
                          html: `<div style="background:${m.id === nearestMarket?.id ? '#4338ca' : '#64748b'};color:#fff;width:28px;height:28px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:12px;box-shadow:0 2px 4px rgba(0,0,0,0.2)">🏪</div>`,
                          iconSize: [28, 28],
                          iconAnchor: [14, 14],
                        })}
                      >
                        <Popup>
                          <div className="text-xs font-sans p-1">
                            <p className="font-bold text-indigo-700">{m.market_name}</p>
                            <p className="font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded w-fit my-1">{m.market_type}</p>
                            <p className="text-slate-600">Distance from you: {(haversineMeters(farmLat, farmLng, Number(m.latitude), Number(m.longitude)) / 1000).toFixed(2)} km</p>
                          </div>
                        </Popup>
                      </Marker>
                    ))}

                    {/* Supply Chain Connection Polyline (road-network-aligned, falls back to a straight line while snapping) */}
                    {supplyChainPath.length > 1 && (
                      <Polyline
                        positions={snappedSupplyPath || supplyChainPath}
                        pathOptions={{ color: "#ec4899", weight: 3, dashArray: "4, 6" }}
                      />
                    )}
                  </MapContainer>
                ) : (
                  <div className="flex flex-col items-center justify-center bg-slate-100 h-full text-slate-500 p-4">
                    <p className="font-bold text-slate-700">Coordinates not defined</p>
                    <p className="text-xs text-center mt-1">Please ask your LGU officer to assign coordinate positions for your farm area.</p>
                  </div>
                )}
              </div>

              {/* Path Legend */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs bg-slate-50 p-3 rounded-xl border border-slate-100 font-medium text-slate-700">
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-emerald-500 inline-block border-2 border-white shadow-sm" />
                  <span>My Farm Coordinate</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-1 border-t-2 border-dashed border-blue-500 inline-block" />
                  <span>Linked FMR Road Project</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-1 border-t-2 border-dashed border-pink-500 inline-block" />
                  <span>Supply Path Connection</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: REPORT ROAD DAMAGE */}
          {activeTab === "report_damage" && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-amber-600 via-amber-700 to-orange-700 text-white rounded-2xl p-5 shadow-sm">
                <h3 className="font-extrabold text-base sm:text-lg">Report Road Damage or Impassable Sections</h3>
                <p className="text-xs text-amber-100 mt-1 leading-relaxed">
                  Experiencing potholes, washed out bridges, landslides, or impassable muddy sections on your Farm-to-Market Road? Submit an official report below. Your GPS location and linked road will be automatically recorded.
                </p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6">
                <PublicReportForm prefillCategory="safety" />
              </div>
            </div>
          )}

          {/* TAB 3: MY SUBMITTED REPORTS */}
          {activeTab === "my_reports" && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="font-bold text-slate-900 text-base sm:text-lg">My Submitted Road Reports</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Track the status of damage reports submitted from your account.</p>
                </div>
                <button
                  onClick={() => setActiveTab("report_damage")}
                  className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 w-full sm:w-auto"
                >
                  <span>⚠️ Submit New Report</span>
                </button>
              </div>

              {myReports.length === 0 ? (
                <div className="py-12 text-center text-slate-400 space-y-2">
                  <div className="text-3xl">📋</div>
                  <p className="font-semibold text-slate-700 text-sm">No reports submitted yet</p>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">If you encounter issues on your FMR access road, click "Submit New Report" to alert your LGU and DA engineers.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {myReports.map(rpt => {
                    const statusCls = 
                      rpt.status === 'resolved' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                      rpt.status === 'reviewed' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                      'bg-amber-100 text-amber-800 border-amber-200';

                    return (
                      <div key={rpt.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white transition-all space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <span className="font-bold text-slate-900 text-sm sm:text-base block">{rpt.project_name || 'FMR Road Issue'}</span>
                            <p className="text-xs text-slate-500">{rpt.barangay || 'N/A'}, {rpt.municipality || 'Leon'}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-bold border uppercase tracking-wider ${statusCls}`}>
                              {rpt.status || 'Pending'}
                            </span>
                          </div>
                        </div>

                        {rpt.description && (
                          <p className="text-xs text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200/80 italic">
                            "{rpt.description}"
                          </p>
                        )}

                        <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-200/50 gap-2">
                          <span>Submitted: {new Date(rpt.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          <span>Category: <strong className="text-slate-700 capitalize">{rpt.category || 'Road Issue'}</strong></span>
                          <span>Verification: <strong className="text-emerald-700 font-semibold">{rpt.verification || 'Reported'}</strong></span>
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleReportMap(rpt)}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold border border-slate-200 transition-all"
                        >
                          <Icons.MapPin />
                          <span>{expandedMapReportId === rpt.id ? 'Hide Report Pin & Project Route' : 'View Report Pin & Project Route'}</span>
                        </button>

                        {expandedMapReportId === rpt.id && (
                          mapProjectByReportId[rpt.id] === undefined ? (
                            <p className="text-xs text-slate-400 text-center py-3">Loading project route…</p>
                          ) : (
                            <PublicReportRouteMapPanel
                              project={mapProjectByReportId[rpt.id]}
                              routeRecord={mapRouteByReportId[rpt.id]}
                              reportLatitude={rpt.latitude}
                              reportLongitude={rpt.longitude}
                              heightClass="h-56"
                              title="Report Pin & Project Route"
                              showLegend={false}
                            />
                          )
                        )}

                        {rpt.status === 'resolved' ? (
                          <button
                            onClick={async () => {
                              setSelectedReportCert(rpt);
                              const [res1, res2] = await Promise.all([
                                supabase.from('public_report_field_findings').select('*').eq('report_id', rpt.id).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
                                supabase.from('public_report_resolutions').select('*').eq('report_id', rpt.id).order('resolved_at', { ascending: false }).limit(1).maybeSingle(),
                              ]);
                              setCertFieldFinding(res1?.data || null);
                              setCertResolution(res2?.data || null);
                              setShowCertModal(true);
                            }}
                            className="w-full mt-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                          >
                            <Icons.Document />
                            <span>View Official DA Resolution Certificate</span>
                          </button>
                        ) : (
                          <div className="w-full mt-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-500 rounded-xl text-xs font-semibold border border-slate-200">
                            <Icons.Clock />
                            <span>Resolution certificate is issued once the DA settles this road issue</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: MARKETS DIRECTORY */}
          {activeTab === "markets" && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-4">
              <div>
                <h3 className="font-bold text-slate-900 text-base sm:text-lg">Agricultural Markets & Distribution Hubs</h3>
                <p className="text-xs text-slate-500 mt-0.5">Find nearby trading posts, public markets, and collection centers to sell or distribute your farm output.</p>
              </div>

              {markets.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs sm:text-sm">
                  No market location coordinates found in database.
                </div>
              ) : (
                <>
                  {/* Desktop Table View */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 bg-slate-50">
                          <th className="py-3 px-4 font-semibold">Market Name</th>
                          <th className="py-3 px-4 font-semibold">Type</th>
                          <th className="py-3 px-4 font-semibold">Open Days/Hours</th>
                          <th className="py-3 px-4 font-semibold">Accepted Crops</th>
                          <th className="py-3 px-4 font-semibold">Estimated Distance</th>
                          <th className="py-3 px-4 font-semibold">Contact Info</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {markets.map(m => {
                          const dist = farmLat && farmLng
                            ? (haversineMeters(farmLat, farmLng, Number(m.latitude), Number(m.longitude)) / 1000).toFixed(2)
                            : null;
                          const isNearest = nearestMarket && nearestMarket.id === m.id;

                          return (
                            <tr key={m.id} className={`hover:bg-slate-50/80 transition-colors ${isNearest ? "bg-emerald-50/30" : ""}`}>
                              <td className="py-3.5 px-4">
                                <span className="font-bold text-slate-900 block">{m.market_name}</span>
                                <span className="text-[10px] text-slate-500">{m.barangay || ""}, {m.municipality}</span>
                              </td>
                              <td className="py-3.5 px-4">
                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">{m.market_type}</span>
                              </td>
                              <td className="py-3.5 px-4">
                                <span className="block font-medium">{m.operating_days || "N/A"}</span>
                                <span className="text-[10px] text-slate-500">{m.operating_hours || ""}</span>
                              </td>
                              <td className="py-3.5 px-4">
                                <div className="flex flex-wrap gap-1 max-w-[200px]">
                                  {m.commodities_accepted?.map(c => (
                                    <span key={c} className="bg-slate-100 text-[10px] px-1.5 py-0.5 rounded text-slate-600">{c}</span>
                                  )) || <span className="text-slate-400">All commodities</span>}
                                </div>
                              </td>
                              <td className="py-3.5 px-4 font-bold text-slate-800">
                                {dist ? `${dist} km` : "N/A"}
                                {isNearest && (
                                  <span className="ml-1 text-[9px] px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold uppercase tracking-wider">Nearest</span>
                                )}
                              </td>
                              <td className="py-3.5 px-4">
                                <span className="block font-semibold text-slate-800">{m.contact_person || "N/A"}</span>
                                <span className="text-[10px] text-slate-500">{m.contact_number || ""}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Card List View */}
                  <div className="block md:hidden space-y-3">
                    {markets.map(m => {
                      const dist = farmLat && farmLng
                        ? (haversineMeters(farmLat, farmLng, Number(m.latitude), Number(m.longitude)) / 1000).toFixed(2)
                        : null;
                      const isNearest = nearestMarket && nearestMarket.id === m.id;

                      return (
                        <div key={m.id} className={`p-4 rounded-xl border ${isNearest ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 bg-slate-50/50"} space-y-2`}>
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <h4 className="font-bold text-slate-900 text-sm">{m.market_name}</h4>
                              <p className="text-xs text-slate-500">{m.barangay || ""}, {m.municipality}</p>
                            </div>
                            {isNearest && (
                              <span className="text-[10px] px-2 py-0.5 bg-emerald-600 text-white rounded-full font-bold uppercase tracking-wider">Nearest</span>
                            )}
                          </div>

                          <div className="text-xs text-slate-700 space-y-1.5 pt-2 border-t border-slate-200/60">
                            <div className="flex justify-between">
                              <span className="text-slate-500">Market Type:</span>
                              <span className="font-semibold text-slate-800">{m.market_type}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Operating Schedule:</span>
                              <span className="font-medium text-slate-800">{m.operating_days || "Everyday"} ({m.operating_hours || "Daytime"})</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Distance from Farm:</span>
                              <span className="font-bold text-slate-900">{dist ? `${dist} km` : "N/A"}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </main>

      {/* Mobile Sticky Bottom Navigation Bar (PWA Mode) */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-[500] bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-lg px-2 py-1.5 flex justify-around items-center">
        <button
          onClick={() => setActiveTab("overview")}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded-xl transition-all ${
            activeTab === "overview" ? "text-emerald-800 font-bold" : "text-slate-500 font-medium"
          }`}
        >
          <Icons.MapPin />
          <span className="text-[10px]">Map</span>
        </button>

        <button
          onClick={() => setActiveTab("report_damage")}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded-xl transition-all ${
            activeTab === "report_damage" ? "text-amber-700 font-bold" : "text-slate-500 font-medium"
          }`}
        >
          <Icons.Warning />
          <span className="text-[10px]">Report</span>
        </button>

        <button
          onClick={() => setActiveTab("my_reports")}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded-xl transition-all relative ${
            activeTab === "my_reports" ? "text-emerald-800 font-bold" : "text-slate-500 font-medium"
          }`}
        >
          <Icons.Document />
          <span className="text-[10px]">Reports</span>
          {myReports.length > 0 && (
            <span className="absolute -top-1 -right-0.5 w-4 h-4 bg-emerald-700 text-white rounded-full text-[9px] flex items-center justify-center font-bold">
              {myReports.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("markets")}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded-xl transition-all ${
            activeTab === "markets" ? "text-emerald-800 font-bold" : "text-slate-500 font-medium"
          }`}
        >
          <Icons.Building />
          <span className="text-[10px]">Markets</span>
        </button>
      </nav>

      {showCertModal && selectedReportCert && (
        <DAResolutionCertificate
          report={selectedReportCert}
          fieldFinding={certFieldFinding}
          resolution={certResolution}
          onClose={() => setShowCertModal(false)}
        />
      )}
    </div>
  );
}
