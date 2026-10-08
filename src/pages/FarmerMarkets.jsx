/* FarmerMarkets.jsx - Nearby agricultural markets directory, at /farmer/markets */
import { useEffect, useMemo, useState } from "react";
import { supabaseFarmer as supabase } from "../lib/supabase";
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

export default function FarmerMarkets() {
  const { farmerRecord } = useFarmerRecord();
  const [markets, setMarkets] = useState([]);

  const farmLat = farmerRecord?.farm_latitude;
  const farmLng = farmerRecord?.farm_longitude;

  useEffect(() => {
    supabase.from("market_locations").select("*").then(({ data }) => setMarkets(data || []));
  }, []);

  // Same straight-line pre-filter rationale as the Overview page's nearest-FMR calc.
  const nearestMarket = useMemo(() => {
    let nearest = null;
    let dist = Infinity;
    if (farmLat && farmLng && markets.length > 0) {
      markets.forEach((m) => {
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
    return nearest;
  }, [farmLat, farmLng, markets]);

  return (
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
                  {markets.map((m) => {
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
                            {m.commodities_accepted?.map((c) => (
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
              {markets.map((m) => {
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
  );
}
