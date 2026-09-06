import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { computePriorityScores, computeRoadGapPriorityScores, scoreTone, rankTone, factorBarTone } from '../../lib/priorityScoring';
import roadInventory from '../../data/leonRoadInventory.json';
import { boundsFromPoints, fetchRoadAlignedPolyline } from '../../lib/mapRouteUtils';

const roadPinIcon = new L.DivIcon({
  className: 'prio-road-pin-marker',
  html: '<div style="background:#0f766e;color:#fff;width:28px;height:28px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:14px;box-shadow:0 2px 5px rgba(0,0,0,0.3)">📍</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function FitBoundsComponent({ points }) {
  const map = useMap();
  useEffect(() => {
    if (Array.isArray(points) && points.length > 0) {
      const bounds = boundsFromPoints(points);
      if (bounds) {
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    }
  }, [map, points]);
  return null;
}

function PriorityRoadMiniMap({ project, onViewOnMap }) {
  const [roadPolyline, setRoadPolyline] = useState([]);

  const baseStart = useMemo(() => {
    const lat = Number(project.start_latitude || 10.7853);
    const lng = Number(project.start_longitude || 122.3831);
    return [lat, lng];
  }, [project]);

  const baseEnd = useMemo(() => {
    const lat = Number(project.end_latitude);
    const lng = Number(project.end_longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
    return [baseStart[0] + 0.015, baseStart[1] + 0.015];
  }, [project, baseStart]);

  useEffect(() => {
    let active = true;
    const initialPoints = [baseStart, baseEnd];
    fetchRoadAlignedPolyline(initialPoints).then((snapped) => {
      if (active) {
        setRoadPolyline(snapped && snapped.length >= 2 ? snapped : initialPoints);
      }
    });
    return () => { active = false; };
  }, [baseStart, baseEnd]);

  const mapPoints = roadPolyline.length >= 2 ? roadPolyline : [baseStart, baseEnd];

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden shadow-xs">
      <div className="px-3.5 py-2 bg-slate-100/90 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
          <span className="text-teal-600">🗺 Visual Map Location:</span>
          <span className="text-slate-700">{project.project_name}</span>
        </div>
      </div>

      <div className="h-44 w-full relative z-0">
        <MapContainer
          center={baseStart}
          zoom={13}
          style={{ width: '100%', height: '100%' }}
          scrollWheelZoom={false}
          className="z-0"
        >
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {roadPolyline.length >= 2 && (
            <Polyline
              positions={roadPolyline}
              pathOptions={{ color: '#0f766e', weight: 4.5, opacity: 0.9 }}
            />
          )}

          <Marker position={baseStart} icon={roadPinIcon}>
            <Popup>
              <div className="text-xs p-1">
                <p className="font-bold text-teal-700">{project.project_name}</p>
                <p>{project.barangay}, {project.municipality || 'Leon'}</p>
              </div>
            </Popup>
          </Marker>

          <FitBoundsComponent points={mapPoints} />
        </MapContainer>
      </div>
    </div>
  );
}

const gapLegendItems = [
  { label: 'Gap Distance 40%', tone: 'bg-blue-100 text-blue-700', icon: '🟦' },
  { label: 'Connectivity 35%', tone: 'bg-red-100 text-red-700', icon: '🟥' },
  { label: 'Market Access 25%', tone: 'bg-emerald-100 text-emerald-700', icon: '🟩' },
];

const agriLegendItems = [
  { label: 'Volume 40%', tone: 'bg-blue-100 text-blue-700', icon: '🟦' },
  { label: 'Severity 35%', tone: 'bg-red-100 text-red-700', icon: '🟥' },
  { label: 'Crop Value 25%', tone: 'bg-amber-100 text-amber-700', icon: '🟨' },
];

function formatTimestamp(value) {
  if (!value) return 'Not calculated yet';
  return value.toLocaleString();
}

export default function PriorityTab({ projects, reports, escalations, onViewReports, onViewProjectDetail, onViewOnMap }) {
  const [moduleMode, setModuleMode] = useState('network_gaps'); // 'network_gaps' | 'agri_production'

  const computedGapScores = useMemo(
    () => computeRoadGapPriorityScores(projects, roadInventory, reports),
    [projects, reports]
  );

  const computedAgriScores = useMemo(
    () => computePriorityScores(projects, reports, escalations),
    [projects, reports, escalations]
  );

  const activeComputed = moduleMode === 'network_gaps' ? computedGapScores : computedAgriScores;

  const [rankings, setRankings] = useState(activeComputed);
  const [lastCalculated, setLastCalculated] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  useEffect(() => {
    setRankings(activeComputed);
    setLastCalculated(new Date());
    setCurrentPage(1);
  }, [activeComputed]);

  const handleRecalculate = () => {
    setRankings(moduleMode === 'network_gaps' 
      ? computeRoadGapPriorityScores(projects, roadInventory, reports)
      : computePriorityScores(projects, reports, escalations)
    );
    setLastCalculated(new Date());
  };

  if (!projects || projects.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
        <p className="text-lg font-semibold text-slate-800">No FMR projects found. Add projects first.</p>
        <p className="text-sm text-slate-500 mt-2">Priority rankings appear once projects are available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Dual Prioritization Criteria Selector Header */}
      <div className="rounded-2xl border border-teal-200 bg-gradient-to-r from-teal-900 to-slate-900 p-6 text-white shadow-md">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-teal-500/20 text-teal-300 border border-teal-500/30 mb-2">
              Dual Prioritization Engine
            </span>
            <h2 className="text-xl font-bold tracking-tight">FMR Investment Prioritization Criteria</h2>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl">
              Configurable scoring criteria based on physical road connectivity gaps vs agricultural production data.
            </p>
          </div>
          <div className="flex items-center bg-slate-800/80 p-1.5 rounded-xl border border-slate-700">
            <button
              type="button"
              onClick={() => setModuleMode('network_gaps')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                moduleMode === 'network_gaps'
                  ? 'bg-teal-500 text-slate-950 shadow-md'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Module 1: Road Network Gaps (Active)
            </button>
            <button
              type="button"
              onClick={() => setModuleMode('agri_production')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                moduleMode === 'agri_production'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Module 2: Agri Production (Pending Data)
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              {moduleMode === 'network_gaps' ? 'Module 1: Road Network Gaps Rankings' : 'Module 2: Agricultural Production Rankings'}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              {moduleMode === 'network_gaps'
                ? 'Edge-to-edge connectivity between barangay roads and Leon Public Market. Weighted by Gap Distance (40%), Network Connectivity (35%), and Market Access (25%).'
                : 'Weighted by report volume (40%), severity (35%), and simulated crop value (25%).'}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <button
              type="button"
              onClick={handleRecalculate}
              className="px-4 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition"
            >
              Recalculate
            </button>
            <span className="text-xs text-slate-400">Last calculated: {formatTimestamp(lastCalculated)}</span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {moduleMode === 'network_gaps' ? (
            <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-teal-50 border border-teal-200 text-teal-800">
              ✓ Active: Pure road network geometry & edge-to-edge market gap scoring (Disregards missing farmer data)
            </span>
          ) : (
            <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 border border-amber-200 text-amber-800">
              ⚠ Agricultural production & farmgate price data not readily available — simulated mode
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(moduleMode === 'network_gaps' ? gapLegendItems : agriLegendItems).map((item) => (
          <span key={item.label} className={`px-3 py-1.5 rounded-full text-xs font-semibold ${item.tone}`}>
            {item.icon} {item.label}
          </span>
        ))}
      </div>

      <div className="space-y-4">
        {(() => {
          const start = (currentPage - 1) * itemsPerPage;
          const end = start + itemsPerPage;
          return rankings.slice(start, end).map((entry) => {
            return entry;
          });
        })() && null}
        {rankings.slice((currentPage - 1) * itemsPerPage, (currentPage - 1) * itemsPerPage + itemsPerPage).map((entry) => {
          const { project, bySeverity, cropData, score, rank, reason, hasEscalation } = entry;
          const severityPills = [
            { key: 'safety', label: `Safety ×${bySeverity.safety}`, tone: 'bg-red-100 text-red-700' },
            { key: 'flood', label: `Flood ×${bySeverity.flood}`, tone: 'bg-sky-100 text-sky-700' },
            { key: 'issue', label: `Issue ×${bySeverity.issue}`, tone: 'bg-amber-100 text-amber-700' },
            { key: 'general', label: `General ×${bySeverity.general}`, tone: 'bg-slate-100 text-slate-600' },
          ].filter((item) => bySeverity[item.key] > 0);

          return (
            <div
              key={project.id}
              role="button"
              tabIndex={0}
              onClick={() => onViewProjectDetail && onViewProjectDetail(project)}
              onKeyDown={(event) => {
                if ((event.key === 'Enter' || event.key === ' ') && onViewProjectDetail) {
                  event.preventDefault();
                  onViewProjectDetail(project);
                }
              }}
              className="rounded-2xl border border-slate-200 bg-white p-4 transition-all hover:shadow-md hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500/20 cursor-pointer"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                <div className="flex items-start gap-4 lg:w-2/3">
                  <div className={`h-14 w-14 rounded-2xl flex items-center justify-center text-2xl font-bold ${rankTone(rank)}`}>
                    {rank}
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="text-lg font-semibold text-slate-900">{project.project_name}</p>
                      <p className="text-sm text-slate-500">
                        {(project.municipality || 'Unknown municipality')} · {(project.barangay || 'Unknown barangay')}
                      </p>
                    </div>
                    <p className="text-sm text-slate-500 italic">{reason}</p>
                    <div className="flex flex-wrap gap-2">
                      {severityPills.map((pill) => (
                        <span key={pill.key} className={`px-2.5 py-1 rounded-full text-xs font-semibold ${pill.tone}`}>
                          {pill.label}
                        </span>
                      ))}
                      {hasEscalation && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
                          ⚡ Escalated
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      Simulated: {cropData.primary_crop} · {cropData.hectares.toLocaleString()} ha
                    </p>

                    {/* Embedded Visual Map Preview */}
                    <PriorityRoadMiniMap project={project} onViewOnMap={onViewOnMap} />
                  </div>
                </div>

                <div className="lg:w-1/3 lg:pl-6 lg:border-l lg:border-slate-100 space-y-3">
                  <div className="flex items-end justify-between">
                    <p className={`text-3xl font-bold ${scoreTone(score)}`}>{`${score}%`}</p>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onViewReports && onViewReports(project);
                      }}
                      className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      View Reports
                    </button>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full ${scoreTone(score)} bg-current`} style={{ width: `${score}%` }} />
                  </div>
                  <div className="space-y-2">
                    {(moduleMode === 'network_gaps'
                      ? [
                          { key: 'G', label: 'Gap Distance', value: entry.G },
                          { key: 'E', label: 'Connectivity', value: entry.E },
                          { key: 'M', label: 'Market Access', value: entry.M },
                        ]
                      : [
                          { key: 'V', label: 'Volume', value: entry.V },
                          { key: 'S', label: 'Severity', value: entry.S },
                          { key: 'C', label: 'Crop Value', value: entry.C },
                        ]
                    ).map((factor) => (
                      <div key={factor.key} className="flex items-center gap-2">
                        <span className="w-6 text-xs font-semibold text-slate-500" title={factor.label}>{factor.key}</span>
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${factorBarTone(factor.key)}`}
                            style={{ width: `${factor.value}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500 w-8 text-right">{`${factor.value}%`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {/* Pagination controls */}
        {rankings.length > itemsPerPage && (
          <div className="flex items-center justify-center gap-3 mt-2">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1 rounded-md border border-slate-200 bg-white text-sm font-semibold hover:bg-slate-50"
            >
              Previous
            </button>
            <div className="text-sm text-slate-600">Page {currentPage} of {Math.ceil(rankings.length / itemsPerPage)}</div>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(Math.ceil(rankings.length / itemsPerPage), p + 1))}
              className="px-3 py-1 rounded-md border border-slate-200 bg-white text-sm font-semibold hover:bg-slate-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
