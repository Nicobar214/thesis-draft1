/* FarmerDashboard.jsx - My Farm (Overview) page, at /farmer.
 * Shows the farmer's profile summary, the nearest FMR road project, the
 * nearest market, and a map connecting them with road-aligned polylines.
 */
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, CircleMarker, Tooltip, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabaseFarmer as supabase } from "../lib/supabase";
import { fetchRoadAlignedPolyline, calculatePolylineDistanceKm } from "../lib/mapRouteUtils";
import { storeGlyph, routeGlyph } from "../lib/mapMarkerIcons";
import { useFarmerRecord } from "../lib/useFarmerRecord";

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
  const { farmerRecord } = useFarmerRecord();
  const [fmrProjects, setFmrProjects] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [snappedFmrPath, setSnappedFmrPath] = useState(null);
  const [snappedSupplyPath, setSnappedSupplyPath] = useState(null);

  useEffect(() => {
    supabase.from("fmr_projects").select("*").then(({ data }) => setFmrProjects(data || []));
    supabase.from("market_locations").select("*").then(({ data }) => setMarkets(data || []));
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

  return (
      // On desktop the row fills the viewport below the header (h-24 = 6rem)
      // and the page padding (py-6 = 3rem); the map takes up the extra height
      // instead of leaving an empty band at the bottom of the screen.
      <div className="flex flex-col lg:flex-row gap-5 lg:min-h-[calc(100dvh-9rem)]">
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

        {/* Right Side: Map */}
        <section className="flex-1 flex flex-col gap-5 min-w-0">
          <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 gap-4">
            <div>
              <h3 className="font-bold text-slate-900 text-base sm:text-lg">Supply Chain Access Map</h3>
              <p className="text-xs text-slate-500 mt-0.5">Visualize your farm location routing through your linked Farm-to-Market Road project to the municipal market center.</p>
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
                      <span className="text-[10px] font-bold text-emerald-800">My Farm</span>
                    </Tooltip>
                  </CircleMarker>

                  {/* Linked FMR Project Markers */}
                  {nearestFmr && nearestFmr.start_latitude && nearestFmr.start_longitude && (
                    <>
                      <Marker
                        position={[Number(nearestFmr.start_latitude), Number(nearestFmr.start_longitude)]}
                        icon={new L.DivIcon({
                          className: 'fmr-endpoint-pin',
                          html: `<div style="background:#f59e0b;color:#fff;width:24px;height:24px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:10px;font-weight:bold">${routeGlyph(13)}</div>`,
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
        </section>
      </div>
  );
}
