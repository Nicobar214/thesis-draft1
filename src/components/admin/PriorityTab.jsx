import { RotateCwIcon, TriangleAlertIcon, ZapIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { computePriorityScores, computeRoadGapPriorityScores, GAP_WEIGHTS } from '../../lib/priorityScoring';
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
      <div className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
        No mapped geometry for this gap yet.
      </div>
    );
  }

  const km = Number(gap?.gap_km);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <span className="text-xs font-medium text-slate-500">Unpaved section</span>
        {onViewOnMap && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onViewOnMap(project); }}
            className="shrink-0 text-xs font-semibold text-teal-700 hover:text-teal-900"
          >
            View on map
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

// One definition per module, used by both the toolbar and each card's
// breakdown, so labels and weights can't disagree. Gap weights come straight
// from the scorer.
const pct = (w) => `${Math.round(w * 100)}%`;
const FACTORS = {
  network_gaps: [
    { key: 'G', label: 'Gap length', weight: pct(GAP_WEIGHTS.G) },
    { key: 'A', label: 'Access', weight: pct(GAP_WEIGHTS.A) },
    { key: 'C', label: 'Surface condition', weight: pct(GAP_WEIGHTS.C) },
  ],
  agri_production: [
    { key: 'V', label: 'Report volume', weight: '40%' },
    { key: 'S', label: 'Severity', weight: '35%' },
    { key: 'C', label: 'Crop value', weight: '25%' },
  ],
};
const factorsFor = (mode) => FACTORS[mode] || FACTORS.network_gaps;

// Priority tier from the score. Color appears only here and in the gap line on
// the map; everything else on the card is neutral.
function priorityTier(score) {
  if (score >= 70) return { label: 'High priority', cls: 'bg-rose-50 text-rose-700 ring-rose-200' };
  if (score >= 40) return { label: 'Medium priority', cls: 'bg-amber-50 text-amber-700 ring-amber-200' };
  return { label: 'Low priority', cls: 'bg-slate-100 text-slate-600 ring-slate-200' };
}

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

      {/* Slim toolbar: the scoring weights as plain text, and recalculation. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">
          <span className="font-medium text-slate-700">{rankings.length} ranked</span>
          <span className="mx-2 text-slate-300">|</span>
          {factorsFor(moduleMode).map((f) => `${f.label} ${f.weight}`).join(' · ')}
          {moduleMode === 'agri_production' && (
            <span className="ml-2 inline-flex items-center gap-1 text-amber-700">
              <TriangleAlertIcon className="size-3.5" aria-hidden="true" />Simulated crop data
            </span>
          )}
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">Updated {formatTimestamp(lastCalculated)}</span>
          <button
            type="button"
            onClick={handleRecalculate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <RotateCwIcon className="size-3.5" aria-hidden="true" />
            Recalculate
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {rankings.slice((currentPage - 1) * itemsPerPage, (currentPage - 1) * itemsPerPage + itemsPerPage).map((entry) => {
          const { project, gap, bySeverity, cropData, score, rank, hasEscalation } = entry;
          const isGaps = moduleMode === 'network_gaps';
          const tier = priorityTier(score);
          const title = (isGaps && gap?.source_road_name) || project.project_name;
          const place = [
            project.municipality || 'Leon',
            [gap?.barangay || project.barangay, gap?.barangay_end || project.barangay_end].filter(Boolean).join(' → '),
          ].filter(Boolean).join(' · ');

          const surfaceType = /earth/i.test(entry.gapType || '') ? 'Earth' : /gravel/i.test(entry.gapType || '') ? 'Gravel' : null;
          const facts = isGaps
            ? [
                { label: 'Unpaved length', value: `${Number(entry.gapKm || 0).toFixed(2)} km` },
                { label: 'Surface', value: [surfaceType, entry.surfaceCondition].filter(Boolean).join(' · ') || '—' },
                { label: 'To market', value: Number.isFinite(entry.marketKm) ? `${entry.marketKm.toFixed(1)} km` : '—' },
                { label: 'Network', value: entry.joinsTwoSegments ? 'Joins 2 FMR roads' : 'Single road' },
              ]
            : [
                { label: 'Primary crop', value: cropData.primary_crop },
                { label: 'Area', value: `${cropData.hectares.toLocaleString()} ha` },
              ];
          const severityChips = [
            { key: 'safety', label: 'Safety' },
            { key: 'flood', label: 'Flood' },
            { key: 'issue', label: 'Issue' },
            { key: 'general', label: 'General' },
          ].filter((item) => bySeverity[item.key] > 0);

          return (
            <article
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
              className="group cursor-pointer rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-teal-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
            >
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
                <div className="min-w-0 space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sm font-semibold tabular-nums text-white">
                      {rank}
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-slate-900 group-hover:text-teal-800">{title}</h3>
                      <p className="text-sm text-slate-500">{place}</p>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                    {facts.map((f) => (
                      <div key={f.label} className="min-w-0">
                        <dt className="text-xs text-slate-500">{f.label}</dt>
                        <dd className="mt-0.5 truncate text-sm font-semibold text-slate-900">{f.value}</dd>
                      </div>
                    ))}
                  </dl>

                  {(severityChips.length > 0 || hasEscalation) && (
                    <div className="flex flex-wrap gap-1.5">
                      {severityChips.map((chip) => (
                        <span key={chip.key} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {chip.label} <span className="tabular-nums text-slate-900">{bySeverity[chip.key]}</span>
                        </span>
                      ))}
                      {hasEscalation && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          <ZapIcon className="size-3" aria-hidden="true" />Escalated
                        </span>
                      )}
                    </div>
                  )}

                  {isGaps && <PriorityRoadMiniMap project={project} gap={gap} onViewOnMap={onViewOnMap} />}
                </div>

                <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-slate-500">Priority score</p>
                      <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-slate-900">
                        {score}<span className="text-base font-medium text-slate-400">/100</span>
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tier.cls}`}>{tier.label}</span>
                  </div>

                  <div className="space-y-2.5">
                    {factorsFor(moduleMode).map((f) => {
                      const value = Math.min(100, Math.max(0, Number(entry[f.key]) || 0));
                      return (
                        <div key={f.key}>
                          <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="text-slate-600">{f.label} <span className="text-slate-400">{f.weight}</span></span>
                            <span className="font-semibold tabular-nums text-slate-900">{value}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-teal-600" style={{ width: `${value}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onViewReports && onViewReports(project);
                    }}
                    className="mt-auto w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    View reports{entry.reportCount > 0 ? ` (${entry.reportCount})` : ''}
                  </button>
                </div>
              </div>
            </article>
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
