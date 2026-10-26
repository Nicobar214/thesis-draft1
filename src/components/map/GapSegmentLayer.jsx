import { useMemo } from 'react';
import { Marker, Polyline, Popup, Tooltip } from 'react-leaflet';

import { makeGapResolver, PLACEMENT_LABELS } from '../../lib/gapGeometry';
import { GAP_PATH_OPTIONS, gapEndcapIcon } from './routeMarkerIcons';
import useMapZoom from './useMapZoom';

/** Zoom at or above which each gap carries a permanent "GAP n.nn km" label. */
const GAP_LABEL_ZOOM = 14;

/**
 * Renders rows from public.road_network_gaps as dashed red segments.
 *
 * A gap is the UNPAVED portion of a surveyed barangay road -- the Earth and/or
 * Gravel sub-segments recorded in Leon_barangay_roads.csv -- drawn on that road's
 * own mapped route (gapGeometry.js). The survey does not say where along the road
 * the unpaved part is, so the popup states what is known; pass `projects` and
 * `routesByProjectId` so the road can be found (without them the stored line is used).
 *
 * This replaces the four hardcoded demo segments that lived in LguRouteMap, whose
 * coordinates were hand-typed and all converged on the market point. Their code
 * comment said "Simulated" but the UI label did not, so LGU users read them as
 * surveyed. Every row here instead cites the road and surface breakdown it came
 * from, and the popup shows that provenance.
 */
export default function GapSegmentLayer({
  gaps = [],
  projects = [],
  routesByProjectId = {},
  showSurvey = false,
  visible = true,
  focusedGapId = null,
  onFocusGap = undefined,
}) {
  const zoom = useMapZoom();

  const segments = useMemo(() => {
    const resolve = makeGapResolver(projects, routesByProjectId);
    return (gaps || [])
      .map((gap) => {
        const geometry = resolve(gap);
        if (geometry.points.length < 2) return null;
        const storedKm = Number(gap.gap_km);
        return {
          gap,
          geometry,
          points: geometry.points,
          km: Number.isFinite(storedKm) && storedKm > 0 ? storedKm : geometry.unpavedKm,
        };
      })
      .filter(Boolean);
  }, [gaps, projects, routesByProjectId]);

  if (!visible || segments.length === 0) return null;

  return (
    <>
      {segments.map(({ gap, geometry, points, km }) => {
        const isFocused = focusedGapId != null && focusedGapId === gap.id;
        const handlers = onFocusGap
          ? {
              mouseover: () => onFocusGap(gap.id),
              mouseout: () => onFocusGap(null),
              click: () => onFocusGap(gap.id),
            }
          : undefined;

        const isReviewed = gap.gap_source === 'reviewed';

        return (
          <div key={gap.gap_code || gap.id}>
            {/* White casing so the dashed red stays legible over dark tiles. */}
            <Polyline
              positions={points}
              pathOptions={{ color: '#ffffff', weight: isFocused ? 9 : 7, opacity: 0.75 }}
              interactive={false}
            />
            <Polyline
              positions={points}
              pathOptions={{
                ...GAP_PATH_OPTIONS,
                weight: isFocused ? 5.5 : GAP_PATH_OPTIONS.weight,
                opacity: isFocused ? 1 : GAP_PATH_OPTIONS.opacity,
              }}
              eventHandlers={handlers}
            >
              {zoom >= GAP_LABEL_ZOOM && (
                <Tooltip permanent direction="center" className="kt-gap-label">
                  <span className="text-[10px] font-bold text-red-700">TO CONCRETE {km.toFixed(2)} km</span>
                </Tooltip>
              )}

              <Popup>
                <div className="p-1 space-y-1 text-xs text-slate-800 max-w-[260px]">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 font-bold text-[10px] uppercase">
                      Concreting need
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${
                        isReviewed ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {isReviewed ? 'Reviewed' : 'Inventory-derived'}
                    </span>
                  </div>

                  <p className="font-bold text-slate-900">{gap.source_road_name || gap.gap_code}</p>

                  <p>
                    <span className="font-semibold text-slate-500">Barangay:</span>{' '}
                    {gap.barangay || 'Unresolved'}
                    {gap.barangay_end ? ` → ${gap.barangay_end}` : ''}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-500">To concrete:</span>{' '}
                    {km.toFixed(2)} km{showSurvey && gap.gap_type ? ` (${gap.gap_type})` : ''}
                  </p>
                  {showSurvey && gap.surface_condition && (
                    <p>
                      <span className="font-semibold text-slate-500">Condition:</span>{' '}
                      {gap.surface_condition}
                    </p>
                  )}
                  {showSurvey && gap.source_surface_summary && (
                    <p className="text-[11px] text-slate-600">
                      <span className="font-semibold text-slate-500">Surveyed surfaces:</span>{' '}
                      {gap.source_surface_summary}
                    </p>
                  )}
                  <p className="text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-500">{PLACEMENT_LABELS[geometry.placement]}:</span>{' '}
                    {geometry.note}
                  </p>
                  {Number.isFinite(Number(gap.market_distance_km)) && (
                    <p>
                      <span className="font-semibold text-slate-500">To Leon market (stored):</span>{' '}
                      {Number(gap.market_distance_km).toFixed(2)} km, measured from the original gap line
                    </p>
                  )}
                  <p>
                    <span className="font-semibold text-slate-500">Connects:</span>{' '}
                    {gap.to_project_id
                      ? 'two funded FMR segments'
                      : 'open-ended — no funded project beyond this gap'}
                  </p>
                  {gap.gap_reason && (
                    <p className="text-slate-600 pt-1 border-t border-slate-100">{gap.gap_reason}</p>
                  )}
                </div>
              </Popup>
            </Polyline>

            {/* Endcaps, so it reads as a bounded missing stretch rather than an open line. */}
            {[points[0], points[points.length - 1]].map((position, index) => (
              <Marker
                key={`${gap.gap_code || gap.id}-cap-${index}`}
                position={position}
                icon={gapEndcapIcon}
                interactive={false}
                keyboard={false}
                zIndexOffset={300}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}
