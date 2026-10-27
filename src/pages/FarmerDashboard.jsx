/* FarmerDashboard.jsx - My Farm (Overview) page, at /farmer.
 * Shows the farmer's profile summary, the nearest FMR road project, the
 * nearest market, and a map connecting them with road-aligned polylines.
 */
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, CircleMarker, Tooltip, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabaseFarmer as supabase } from "../lib/supabase";
import { fetchRoadAlignedPolyline, calculatePolylineDistanceKm, buildRoutePoints, nearestPointOnPolyline } from "../lib/mapRouteUtils";
import { storeGlyph, routeGlyph, sproutGlyph } from "../lib/mapMarkerIcons";
import { SproutIcon, RouteIcon, StoreIcon } from "lucide-react";
import { useFarmerRecord } from "../lib/useFarmerRecord";
import { cachedQuery } from "../lib/offlineCache";
import FmrProjectDetailDialog from "../components/FmrProjectDetailDialog";
import { MapLegend, LegendGroup, LegendLine, LegendDot } from "../components/map/MapPanels";
import { useFarmerT } from '../lib/farmerI18n';

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

/* Leaflet measures its container once on mount. Inside this layout the map
 * sits in a flex column next to a fixed, collapsible sidebar, so its actual
 * pixel size can still be settling (sidebar collapse animation, fonts/async
 * content reflowing the left column) after that first measurement -- the
 * classic symptom is tiles only filling part of the box, or a grey strip
 * until the window is manually resized. A ResizeObserver on the map's own
 * container calls Leaflet's own resync any time that box's size actually
 * changes, which is the documented fix rather than a timing guess. */
function MapViewportFix() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

function FarmerMapCenterController({ farmLat, farmLng, nearestMarket }) {
  const map = useMap();
  useEffect(() => {
    if (!farmLat || !farmLng) return;

    if (nearestMarket && nearestMarket.latitude && nearestMarket.longitude) {
      const bounds = L.latLngBounds(
        [farmLat, farmLng],
        [Number(nearestMarket.latitude), Number(nearestMarket.longitude)]
      );
      map.fitBounds(bounds, { padding: [50, 50] });
    } else {
      map.setView([farmLat, farmLng], 14);
    }
  }, [farmLat, farmLng, nearestMarket, map]);

  return null;
}

export default function FarmerDashboard() {
  const { t } = useFarmerT();
  const { farmerRecord } = useFarmerRecord();
  const [fmrProjects, setFmrProjects] = useState([]);
  const [markets, setMarkets] = useState([]);
  // Snapped lines with the key they were computed for, so a stale one is never drawn.
  const [snappedFmr, setSnappedFmr] = useState({ key: '', line: null });
  const [routesByProjectId, setRoutesByProjectId] = useState({});
  // Linked FMR road details (same dialog as the Road Projects page).
  const [roadDetailsOpen, setRoadDetailsOpen] = useState(false);
  const [roadTranches, setRoadTranches] = useState([]);
  const openRoadDetails = async (project) => {
    setRoadTranches([]);
    setRoadDetailsOpen(true);
    try {
      // Same saved copy as the Road Projects page, so this also works offline.
      const { data } = await cachedQuery("project_tranches:all", () => supabase
        .from("project_tranches")
        .select("id, project_id, tranche_order, tranche_name, percentage, amount, required_progress, status, released_amount, released_date")
        .order("tranche_order", { ascending: true }));
      setRoadTranches((data || []).filter((tr) => tr.project_id === project.id));
    } catch {
      /* details still open without the budget breakdown */
    }
  };
  const [snappedSupply, setSnappedSupply] = useState({ key: '', line: null });

  // Saved on the device (lib/offlineCache.js), so My Farm still works offline.
  useEffect(() => {
    const load = () => {
      cachedQuery("fmr_projects:all", () => supabase.from("fmr_projects").select("*"))
        .then(({ data }) => setFmrProjects(data || []))
        .catch(() => {});
      cachedQuery("market_locations:all", () => supabase.from("market_locations").select("*"))
        .then(({ data }) => setMarkets(data || []))
        .catch(() => {});
      // Saved road lines (snapped or mapped), the same ones every other map draws.
      cachedQuery("project_routes:all", () => supabase.from("project_routes").select("*"))
        .then(({ data }) => setRoutesByProjectId(Object.fromEntries((data || []).map((r) => [r.project_id, r]))))
        .catch(() => {});
    };
    load();
    window.addEventListener("online", load);
    return () => window.removeEventListener("online", load);
  }, []);

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

  // The linked road as drawn on every other map: its saved route when there is
  // one, otherwise the line between its pins (snapped below).
  const fmrLine = useMemo(
    () => (nearestFmr ? buildRoutePoints(nearestFmr, routesByProjectId[nearestFmr.id] || null) : null),
    [nearestFmr, routesByProjectId],
  );

  // A saved route is drawn as is; a 2-pin road uses its snapped line once it arrives.
  const fmrKey = fmrLine && fmrLine.points.length === 2 ? JSON.stringify(fmrLine.points) : '';
  const snappedFmrPath = !fmrLine || fmrLine.points.length < 2
    ? null
    : fmrLine.points.length > 2 ? fmrLine.points : (snappedFmr.key === fmrKey ? snappedFmr.line : null);

  // Where the farm meets the road: the nearest point ON the road, not its start pin.
  const accessPoint = useMemo(() => {
    if (!farmLat || !farmLng || !fmrLine?.points?.length) return null;
    return nearestPointOnPolyline([Number(farmLat), Number(farmLng)], snappedFmrPath || fmrLine.points)?.point || null;
  }, [farmLat, farmLng, fmrLine, snappedFmrPath]);

  // Build Supply Chain line path for leaflet mapping: farm -> road -> market.
  const supplyChainPath = useMemo(() => {
    const path = [];
    if (farmLat && farmLng) {
      path.push([Number(farmLat), Number(farmLng)]);
      if (accessPoint) path.push(accessPoint);
      if (nearestMarket) {
        path.push([Number(nearestMarket.latitude), Number(nearestMarket.longitude)]);
      }
    }
    return path;
  }, [farmLat, farmLng, accessPoint, nearestMarket]);

  // The linked road: its saved route as is; only a road known by its two pins
  // is snapped here (with its declared length, so a wrong pin is not routed).
  useEffect(() => {
    if (!fmrKey) return undefined;
    let cancelled = false;
    fetchRoadAlignedPolyline(fmrLine.points, { alongLine: true, declaredKm: fmrLine.declaredLengthKm })
      .then((line) => { if (!cancelled) setSnappedFmr({ key: fmrKey, line }); });
    return () => { cancelled = true; };
    // fmrKey stands for fmrLine's points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fmrKey]);

  // The trip to market, routed by road as two drives: farm -> road access point,
  // then access point -> market. Each is plain A-to-B routing (any road may be
  // used), so the drive is not refused for leaving the straight line, which a
  // single 3-point "follow this line" request was.
  const supplyKey = supplyChainPath.length >= 2 ? JSON.stringify(supplyChainPath) : '';
  useEffect(() => {
    if (!supplyKey) return undefined;
    let cancelled = false;
    const legs = supplyChainPath.slice(1).map((to, i) => fetchRoadAlignedPolyline([supplyChainPath[i], to]));
    Promise.all(legs).then((parts) => {
      if (cancelled) return;
      const joined = parts.reduce((all, part, i) => (i === 0 ? [...part] : [...all, ...part.slice(1)]), []);
      setSnappedSupply({ key: supplyKey, line: joined.length > supplyChainPath.length ? joined : null });
    });
    return () => { cancelled = true; };
    // supplyKey stands for supplyChainPath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplyKey]);
  const snappedSupplyPath = snappedSupply.key === supplyKey ? snappedSupply.line : null;

  const roadDistToFmr = snappedFmrPath ? calculatePolylineDistanceKm(snappedFmrPath) * 1000 : distToFmr;
  const roadDistToMarket = snappedSupplyPath ? calculatePolylineDistanceKm(snappedSupplyPath) * 1000 : distToMarket;

  return (
      // On desktop the row fills the viewport below the header (h-24 = 6rem)
      // and the page padding (py-6 = 3rem); the map takes up the extra height
      // instead of leaving an empty band at the bottom of the screen.
      <div className="flex flex-col lg:flex-row gap-5 lg:min-h-[calc(100dvh-9rem)]">
        {/* Left Side: Summary Card */}
        <aside className="w-full lg:w-80 shrink-0 space-y-4 sm:space-y-6" data-tour="farm-summary">
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
                <span className="text-slate-500 text-[11px] sm:text-xs">{t('farm.rsbsa')}</span>
                <span className="font-bold text-slate-800">{farmerRecord?.rsbsa_number || "N/A"}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between bg-slate-50 sm:bg-transparent p-2 sm:p-0 rounded-lg">
                <span className="text-slate-500 text-[11px] sm:text-xs">{t('farm.control')}</span>
                <span className="font-medium text-slate-800">{farmerRecord?.control_no || "N/A"}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between bg-slate-50 sm:bg-transparent p-2 sm:p-0 rounded-lg">
                <span className="text-slate-500 text-[11px] sm:text-xs">{t('farm.crop')}</span>
                <span className="font-semibold text-emerald-700 px-2 py-0.5 bg-emerald-50 rounded-full border border-emerald-200 w-fit">{farmerRecord?.crop || "N/A"}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between bg-slate-50 sm:bg-transparent p-2 sm:p-0 rounded-lg">
                <span className="text-slate-500 text-[11px] sm:text-xs">{t('farm.area')}</span>
                <span className="font-bold text-slate-800">{farmerRecord?.farm_area_ha ? `${farmerRecord.farm_area_ha} Ha` : "N/A"}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between bg-slate-50 sm:bg-transparent p-2 sm:p-0 rounded-lg">
                <span className="text-slate-500 text-[11px] sm:text-xs">{t('farm.contact')}</span>
                <span className="font-medium text-slate-800">{farmerRecord?.contact_number || "N/A"}</span>
              </div>
            </div>
          </div>

          {/* Quick Metrics Card */}
          <div className="bg-gradient-to-br from-emerald-800 to-teal-800 text-white rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <h4 className="text-xs uppercase tracking-wider font-bold text-emerald-200">{t('farm.logistics')}</h4>
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-3 sm:space-y-4 lg:gap-0">
              <div>
                <p className="text-[11px] sm:text-xs text-emerald-100">{t('farm.distFmr')}</p>
                <p className="text-xl sm:text-2xl font-bold">{roadDistToFmr !== Infinity ? `${(roadDistToFmr / 1000).toFixed(2)} km` : "N/A"}</p>
                <p className="text-[10px] text-emerald-200/80 mt-0.5 truncate">{farmerRecord?.service_area || "N/A"}</p>
              </div>
              <div className="lg:pt-3 lg:border-t lg:border-white/10">
                <p className="text-[11px] sm:text-xs text-emerald-100">{t('farm.distMarket')}</p>
                <p className="text-xl sm:text-2xl font-bold">{roadDistToMarket !== Infinity ? `${(roadDistToMarket / 1000).toFixed(2)} km` : "N/A"}</p>
                <p className="text-[10px] text-emerald-200/80 mt-0.5 truncate">{nearestMarket?.market_name || "N/A"}</p>
              </div>
            </div>
          </div>
        </aside>

        {/* Right Side: Map */}
        <section className="flex-1 flex flex-col gap-5 min-w-0">
          <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 gap-4" data-tour="farm-map">
            <div>
              <h3 className="font-bold text-slate-900 text-base sm:text-lg">{t('farm.mapTitle')}</h3>
              <p className="text-xs text-slate-500 mt-0.5">{t('farm.mapDesc')}</p>
            </div>

            <div className="h-[320px] sm:h-[420px] lg:h-auto lg:flex-1 lg:min-h-[420px] rounded-2xl overflow-hidden border border-slate-200 relative z-10 shadow-inner">
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
                  <MapViewportFix />
                  <FarmerMapCenterController
                     farmLat={farmLat}
                     farmLng={farmLng}
                     nearestMarket={nearestMarket}
                   />

                  {/* Farm: green pin with a sprout, the same symbol as in the legend. */}
                  <Marker
                    position={[farmLat, farmLng]}
                    icon={new L.DivIcon({
                      className: 'farm-pin',
                      html: `<div style="background:#10b981;color:#fff;width:26px;height:26px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.2)">${sproutGlyph(14)}</div>`,
                      iconSize: [26, 26],
                      iconAnchor: [13, 13],
                    })}
                  >
                    <Popup>
                      <div className="text-xs font-sans">
                        <p className="font-bold text-emerald-800">{t('farm.yourFarm')}</p>
                        <p className="text-slate-600">Crop: {farmerRecord?.crop}</p>
                        <p className="text-slate-600">Area: {farmerRecord?.farm_area_ha} Ha</p>
                      </div>
                    </Popup>
                    <Tooltip permanent direction="top" offset={[0, -14]} opacity={0.9}>
                      <span className="text-[10px] font-bold text-emerald-800">{t('farm.myFarm')}</span>
                    </Tooltip>
                  </Marker>

                  {/* Linked FMR Project Markers */}
                  {nearestFmr && (accessPoint || (nearestFmr.start_latitude && nearestFmr.start_longitude)) && (
                    <>
                      <Marker
                        position={accessPoint || [Number(nearestFmr.start_latitude), Number(nearestFmr.start_longitude)]}
                        icon={new L.DivIcon({
                          className: 'fmr-endpoint-pin',
                          html: `<div style="background:#f59e0b;color:#fff;width:24px;height:24px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:10px;font-weight:bold">${routeGlyph(13)}</div>`,
                          iconSize: [24, 24],
                          iconAnchor: [12, 12],
                        })}
                      >
                        <Popup>
                          <div className="text-xs font-sans">
                            <p className="font-bold text-amber-700">{t('farm.accessPoint')}</p>
                            <p className="font-medium text-slate-800">{nearestFmr.project_name}</p>
                            <p className="text-slate-600">Status: {nearestFmr.status}</p>
                            <button
                              type="button"
                              onClick={() => openRoadDetails(nearestFmr)}
                              className="mt-1.5 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700"
                            >
                              {t('farm.viewRoadDetails')}
                            </button>
                          </div>
                        </Popup>
                      </Marker>

                      {/* FMR Path: solid once genuinely snapped to road geometry (more
                          vertices than the raw 2-point line), dashed while that hasn't
                          happened -- so success is visible instead of looking identical
                          to the straight-line fallback either way. */}
                      {nearestFmr.end_latitude && nearestFmr.end_longitude && (
                        <Polyline
                          positions={snappedFmrPath || [
                            [Number(nearestFmr.start_latitude), Number(nearestFmr.start_longitude)],
                            [Number(nearestFmr.end_latitude), Number(nearestFmr.end_longitude)]
                          ]}
                          pathOptions={{ color: "#3b82f6", weight: 5, ...(snappedFmrPath?.length > 2 ? {} : { dashArray: "5, 10" }) }}
                          eventHandlers={{ click: () => openRoadDetails(nearestFmr) }}
                        >
                          <Tooltip sticky direction="top" opacity={0.95}>
                            <span className="text-xs font-semibold text-blue-700">{nearestFmr.project_name}</span>
                          </Tooltip>
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
                        html: `<div style="background:${m.id === nearestMarket?.id ? '#4338ca' : '#64748b'};color:#fff;width:28px;height:28px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:12px;box-shadow:0 2px 4px rgba(0,0,0,0.2)">${storeGlyph(14)}</div>`,
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

                  {/* Supply Chain Connection: same solid-when-snapped rule as the FMR
                      path above -- a genuine route has more vertices than the raw
                      farm/FMR/market waypoints it was built from. */}
                  {supplyChainPath.length > 1 && (
                    <Polyline
                      positions={snappedSupplyPath || supplyChainPath}
                      pathOptions={{ color: "#ec4899", weight: 3, ...(snappedSupplyPath?.length > supplyChainPath.length ? {} : { dashArray: "4, 6" }) }}
                    />
                  )}
                </MapContainer>
              ) : (
                <div className="flex flex-col items-center justify-center bg-slate-100 h-full text-slate-500 p-4">
                  <p className="font-bold text-slate-700">{t('farm.noCoords')}</p>
                  <p className="text-xs text-center mt-1">{t('farm.noCoordsBody')}</p>
                </div>
              )}

              {/* Same legend panel and grouping as the citizen maps. */}
              {farmLat && farmLng && (
                <MapLegend compact>
                  {/* No headings: lines vs dots already say route vs place. Only what is on the map. */}
                  <LegendGroup>
                    {nearestFmr && <LegendLine color="bg-blue-500" label={t('farm.legend.yourRoad')} />}
                    {supplyChainPath.length > 1 && <LegendLine color="bg-pink-500" label={t('farm.legend.farmToMarket')} />}
                  </LegendGroup>
                  <LegendGroup>
                    <LegendDot color="bg-emerald-500" icon={SproutIcon} label={t('farm.legend.myFarm')} />
                    {nearestFmr && <LegendDot color="bg-amber-500" icon={RouteIcon} label={t('farm.legend.access')} />}
                    {nearestMarket && <LegendDot color="bg-indigo-700" icon={StoreIcon} label={t('farm.legend.nearestMarket')} />}
                    {markets.length > 1 && <LegendDot color="bg-slate-500" icon={StoreIcon} label={t('farm.legend.otherMarket')} />}
                  </LegendGroup>
                </MapLegend>
              )}
            </div>
          </div>
        </section>
        {roadDetailsOpen && nearestFmr && (
          <FmrProjectDetailDialog
            project={nearestFmr}
            tranches={roadTranches}
            onClose={() => setRoadDetailsOpen(false)}
          />
        )}
      </div>
  );
}
