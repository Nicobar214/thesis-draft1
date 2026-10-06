import { CheckIcon, MapIcon, TriangleAlertIcon, ZapIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { computePriorityScores, computeRoadGapPriorityScores, scoreTone, rankTone, factorBarTone } from '../../lib/priorityScoring';
import { boundsFromPoints, parsePointList } from '../../lib/mapRouteUtils';
import { GAP_PATH_OPTIONS, gapEndcapIcon } from '../map/routeMarkerIcons';
import { pinGlyph } from '../../lib/mapMarkerIcons';

const roadPinIcon = new L.DivIcon({
  className: 'prio-road-pin-marker',
  html: '<div style="background:#0f766e;color:#fff;width:28px;height:28px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:14px;box-shadow:0 2px 5px rgba(0,0,0,0.3)">' + pinGlyph(14) + '</div>',
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

function PriorityRoadMiniMap({ project, gap, onViewOnMap }) {
  // Geometry comes from the stored gap row. This panel used to default the start to
  // the Leon market centroid when a project had no coordinates, and invent an
  // endpoint 0.015 degrees north-east of it -- roughly 2.3 km on an arbitrary
  // diagonal -- then OSRM-snap that invented pair and draw the result as this
  // specific road. Nothing is drawn now unless there is real geometry to draw.
  const gapPoints = useMemo(() => parsePointList(gap?.gap_points), [gap]);

  const endpointPair = useMemo(() => {
    const pair = [
      [Number(gap?.start_latitude), Number(gap?.start_longitude)],
      [Number(gap?.end_latitude), Number(gap?.end_longitude)],
    ].filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
    return pair.length === 2 ? pair : [];
  }, [gap]);

  const points = gapPoints.length >= 2 ? gapPoints : endpointPair;

  if (points.length < 2) {
    return (
      <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-500">
        No mapped geometry for this gap yet.
      </div>
    );
  }

  const km = Number(gap?.gap_km);

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden shadow-xs">
      <div className="px-3.5 py-2 bg-slate-100/90 border-b border-slate-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 min-w-0">
          <span className="text-red-600 shrink-0"><MapIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />Unpaved gap:</span>
          <span className="text-slate-700 truncate">{gap?.source_road_name || project.project_name}</span>
        </div>
        {onViewOnMap && (
          <button
            type="button"
            onClick={() => onViewOnMap(project)}
            className="shrink-0 text-[11px] font-semibold text-teal-700 hover:text-teal-900 underline"
          >
            View on main map
          </button>
        )}
      </div>

      <div className="h-44 w-full relative z-0">
        <MapContainer
          center={points[0]}
          zoom={14}
          style={{ width: '100%', height: '100%' }}
          scrollWheelZoom={false}
          className="z-0"
        >
          <TileLayer
            attribution="&copy; OpenStreetMap"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* White casing under the dashed red, matching the main maps' gap styling. */}
          <Polyline positions={points} pathOptions={{ color: '#ffffff', weight: 7, opacity: 0.75 }} />
          <Polyline positions={points} pathOptions={GAP_PATH_OPTIONS} />

          {[points[0], points[points.length - 1]].map((position, index) => (
            <Marker key={index} position={position} icon={gapEndcapIcon} />
          ))}

          <Marker position={points[0]} icon={roadPinIcon}>
            <Popup>
              <div className="text-xs p-1 space-y-0.5">
                <p className="font-bold text-red-700">{gap?.source_road_name || project.project_name}</p>
                <p>
                  {gap?.barangay || project.barangay || 'Barangay not resolved'}
                  {gap?.barangay_end ? ` → ${gap.barangay_end}` : ''}, {project.municipality || 'Leon'}
                </p>
                {Number.isFinite(km) && (
                  <p>
                    {km.toFixed(2)} km unpaved{gap?.gap_type ? ` (${gap.gap_type})` : ''}
                  </p>
                )}
                {gap?.source_surface_summary && (
                  <p className="text-slate-600">{gap.source_surface_summary}</p>
                )}
              </div>
            </Popup>
          </Marker>

          <FitBoundsComponent points={points} />
        </MapContainer>
      </div>
    </div>
  );
}

const gapLegendItems = [
  { label: 'Gap Distance 40%', tone: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  { label: 'Connectivity 35%', tone: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  { label: 'Market Access 25%', tone: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
];

const agriLegendItems = [
  { label: 'Volume 40%', tone: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  { label: 'Severity 35%', tone: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  { label: 'Crop Value 25%', tone: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
];

function formatTimestamp(value) {
  if (!value) return 'Not calculated yet';
  return value.toLocaleString();
}

export default function PriorityTab({ projects, roadGaps = [], reports, escalations, onViewReports, onViewProjectDetail, onViewOnMap }) {
  const [moduleMode, setModuleMode] = useState('network_gaps'); // 'network_gaps' | 'agri_production'

  const computedGapScores = useMemo(
    () => computeRoadGapPriorityScores(roadGaps, projects, reports),
    [roadGaps, projects, reports]
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
      ? computeRoadGapPriorityScores(roadGaps, projects, reports)
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
              <CheckIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />Active: Pure road network geometry & edge-to-edge market gap scoring (Disregards missing farmer data)
            </span>
          ) : (
            <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 border border-amber-200 text-amber-800">
              <TriangleAlertIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />Agricultural production & farmgate price data not readily available — simulated mode
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(moduleMode === 'network_gaps' ? gapLegendItems : agriLegendItems).map((item) => (
          <span key={item.label} className={`px-3 py-1.5 rounded-full text-xs font-semibold ${item.tone}`}>
            <span className={`inline-block size-2 rounded-sm mr-1.5 ${item.dot}`} aria-hidden="true" />{item.label}
          </span>
        ))}
      </div>

      <div className="space-y-4">
        {rankings.slice((currentPage - 1) * itemsPerPage, (currentPage - 1) * itemsPerPage + itemsPerPage).map((entry) => {
          const { project, gap, bySeverity, cropData, score, rank, reason, hasEscalation } = entry;
          const hasGapDetails = moduleMode === 'network_gaps' && (entry.gapKm || entry.gapType || entry.gapReason);
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
                    {hasGapDetails && (
                      <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-800">
                        <p className="font-bold">{entry.gapKm || 0} km {entry.gapType || 'Road Network Gap'}</p>
                        {entry.gapReason && <p className="mt-0.5 text-red-700">{entry.gapReason}</p>}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {severityPills.map((pill) => (
                        <span key={pill.key} className={`px-2.5 py-1 rounded-full text-xs font-semibold ${pill.tone}`}>
                          {pill.label}
                        </span>
                      ))}
                      {hasEscalation && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
                          <ZapIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />Escalated
                        </span>
                      )}
                    </div>
                    {moduleMode === 'agri_production' && (
                      <p className="text-xs text-slate-400">
                        Simulated: {cropData.primary_crop} · {cropData.hectares.toLocaleString()} ha
                      </p>
                    )}

                    {/* Embedded map: real gap geometry under Module 1 */}
                    <PriorityRoadMiniMap project={project} gap={gap} onViewOnMap={onViewOnMap} />
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
