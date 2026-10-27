import { memo, useEffect, useState } from 'react';
import { Polyline, Tooltip, useMap } from 'react-leaflet';
import { TriangleAlertIcon, CircleCheckIcon } from 'lucide-react';

import RouteEndpointMarkers from './RouteEndpointMarkers';
import { MapLegend, LegendGroup, LegendLine, LegendDot, MapControlPanel, ControlGroup, LayerToggle, BasemapSwitch } from './MapPanels';
import { getRouteStatusTheme, normalizeRouteStatus } from '../../lib/mapRouteUtils';

function fmtMeters(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

const STATUSES = ['Completed', 'On-Going', 'Proposed'];
const statusOf = (p) => (STATUSES.includes(normalizeRouteStatus(p.status)) ? normalizeRouteStatus(p.status) : 'Other');

/**
 * Map layer for the project route editors: every other FMR project's road in
 * its status color (same as the main map) with its S/E markers, and the
 * stretches the new route overlaps highlighted in red.
 * projects: [{ id, name, status, project, route, line }]
 */
/* The visible map area (padded), updated when the map stops moving. */
function useViewBounds(padRatio = 0.3) {
  const map = useMap();
  const [bounds, setBounds] = useState(() => map.getBounds().pad(padRatio));
  useEffect(() => {
    const update = () => setBounds(map.getBounds().pad(padRatio));
    map.on('moveend', update);
    return () => { map.off('moveend', update); };
  }, [map, padRatio]);
  return bounds;
}

/* Memoized: the admin page re-renders on every keystroke in the form, and this
 * layer has ~300 roads; it only needs to redraw when its own props change. S/E
 * markers are drawn only for roads in (or near) view, which is where they can
 * be seen anyway, instead of ~600 markers at once. */
export const ExistingRoutesLayer = memo(function ExistingRoutesLayer({ projects = [], overlap, layers }) {
  const view = useViewBounds();
  const inView = (line) => line.some(([lat, lng]) => view.contains([lat, lng]));
  const overlapIds = new Set((overlap?.overlaps || []).map((o) => String(o.id)));
  const visible = layers?.existing === false
    ? []
    : projects.filter((p) => p.line?.length >= 2 && layers?.[statusOf(p)] !== false);
  return (
    <>
      {visible.map((p) => {
        const theme = getRouteStatusTheme(p.status);
        const hit = layers?.overlap !== false && overlapIds.has(String(p.id));
        return (
          <div key={`existing-${p.id}`}>
            {hit && <Polyline positions={p.line} pathOptions={{ color: '#dc2626', weight: 10, opacity: 0.3 }} />}
            <Polyline positions={p.line} pathOptions={{ color: theme.line, weight: hit ? 5 : 3.4, opacity: hit ? 0.95 : 0.72 }}>
              <Tooltip sticky>{p.name}</Tooltip>
            </Polyline>
            {layers?.endpoints !== false && inView(p.line) && (
              <RouteEndpointMarkers
                project={p.project}
                routeData={{ ...p.route, startPoint: p.line[0], endPoint: p.line[p.line.length - 1] }}
                displayPoints={p.line}
                lineColor={theme.line}
                showArrow={false}
              />
            )}
          </div>
        );
      })}
      {layers?.overlap !== false && (overlap?.segments || []).map((seg, i) => (
        <Polyline key={`overlap-seg-${i}`} positions={seg} pathOptions={{ color: '#dc2626', weight: 9, opacity: 0.35 }} />
      ))}
    </>
  );
});

/* Legend + Layers panel, rendered next to the MapContainer (inside its
 * `relative` wrapper), same components as the main map. */
export function RouteEditorMapPanels({ projects = [], overlap, layers, setLayer, basemap, setBasemap }) {
  const count = (status) => projects.filter((p) => p.line?.length >= 2 && statusOf(p) === status).length;
  const hasOverlap = (overlap?.overlaps || []).length > 0;
  return (
    <>
      <MapLegend compact defaultOpen>
        <LegendGroup label="Your route">
          <LegendLine color="bg-teal-600" label="New route" />
          {hasOverlap && layers.overlap && <LegendLine color="bg-red-500" label="Overlap" />}
        </LegendGroup>
        {layers.existing && (
          <LegendGroup label="Existing FMR">
            {layers.Completed && count('Completed') > 0 && <LegendLine color="bg-emerald-500" label="Completed" count={count('Completed')} />}
            {layers['On-Going'] && count('On-Going') > 0 && <LegendLine color="bg-amber-500" label="On-Going" count={count('On-Going')} />}
            {layers.Proposed && count('Proposed') > 0 && <LegendLine color="bg-blue-500" label="Proposed" count={count('Proposed')} />}
            {layers.Other && count('Other') > 0 && <LegendLine color="bg-slate-500" label="Other" count={count('Other')} />}
            {layers.endpoints && <LegendDot color="bg-emerald-600" text="S" label="Start" />}
            {layers.endpoints && <LegendDot color="bg-orange-500" text="E" label="End" />}
          </LegendGroup>
        )}
      </MapLegend>
      <MapControlPanel compact>
        <ControlGroup label="Layers">
          <LayerToggle checked={layers.existing} onChange={(on) => setLayer('existing', on)} label="Existing FMR roads" />
          <LayerToggle checked={layers.endpoints} onChange={(on) => setLayer('endpoints', on)} label="Start / end markers" />
          <LayerToggle checked={layers.overlap} onChange={(on) => setLayer('overlap', on)} label="Overlap highlight" accent="text-red-600 focus:ring-red-500" />
        </ControlGroup>
        {layers.existing && (
          <ControlGroup label="Status">
            {[...STATUSES, 'Other'].filter((s) => count(s) > 0).map((s) => (
              <LayerToggle key={s} checked={layers[s]} onChange={(on) => setLayer(s, on)} label={`${s} (${count(s)})`} />
            ))}
          </ControlGroup>
        )}
        <ControlGroup label="Basemap">
          <BasemapSwitch value={basemap} onChange={setBasemap} />
        </ControlGroup>
      </MapControlPanel>
    </>
  );
}

/* Under the map: what the colored lines are, and any overlap found. */
export function RouteOverlapNotice({ overlap, routeReady }) {
  const overlaps = overlap?.overlaps || [];
  if (!routeReady) {
    return (
      <p className="text-[11px] text-slate-500">
        Colored lines are existing FMR projects (open Layers to hide them). Draw the new route along a road that is not already covered.
      </p>
    );
  }
  if (overlaps.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
        <CircleCheckIcon className="size-3.5" aria-hidden="true" /> No overlap with existing FMR projects.
      </p>
    );
  }
  const major = overlaps.some((o) => o.share >= 0.5);
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs ${major ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      <TriangleAlertIcon className={`mt-0.5 size-4 shrink-0 ${major ? 'text-red-500' : 'text-amber-500'}`} aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-semibold">
          {major ? 'This route mostly repeats an existing FMR project.' : 'Part of this route runs on an existing FMR project.'}
        </p>
        <ul className="space-y-0.5">
          {overlaps.map((o) => (
            <li key={o.id}>
              <strong>{o.name}</strong>: {fmtMeters(o.overlapMeters)} shared ({Math.round(o.share * 100)}% of your route)
            </li>
          ))}
        </ul>
        <p>Adjust the start, end or waypoints so the new road continues from the existing one instead of covering it again (shown in red).</p>
      </div>
    </div>
  );
}
