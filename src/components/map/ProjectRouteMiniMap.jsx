/* A small map of one FMR project's road: the route in its status color with the
 * S (start) and E (end) pins, framed to fit. Used in the Project Details dialog
 * in place of the bare start/end coordinates. */
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Polyline, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '../../lib/supabase';
import { boundsFromPoints, buildRoutePoints, getRouteStatusTheme } from '../../lib/mapRouteUtils';
import { useBasemap } from '../../lib/basemaps';
import BaseTiles from './BaseTiles';
import RouteEndpointMarkers from './RouteEndpointMarkers';
import { BasemapSwitch, ControlGroup, MapControlPanel } from './MapPanels';

function FitRoute({ points }) {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      const bounds = boundsFromPoints(points);
      if (bounds) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
    };
    fit();
    // The dialog opens with an animation: measure again once it has its final size.
    const timer = setTimeout(() => { map.invalidateSize(); fit(); }, 250);
    return () => clearTimeout(timer);
  }, [map, points]);
  return null;
}

/* The saved route for the project (the line drawn in the route editor), if any. */
function useRouteRecord(projectId) {
  const [state, setState] = useState({ projectId: null, row: null });
  useEffect(() => {
    if (projectId == null) return undefined;
    let active = true;
    supabase.from('project_routes').select('*').eq('project_id', projectId).maybeSingle()
      .then(({ data }) => { if (active) setState({ projectId, row: data || null }); });
    return () => { active = false; };
  }, [projectId]);
  return state.projectId === projectId ? state.row : null;
}

export default function ProjectRouteMiniMap({ project, className = 'h-64 sm:h-72' }) {
  const [basemap, setBasemap] = useBasemap();
  const routeRecord = useRouteRecord(project?.id);
  const routeData = useMemo(() => buildRoutePoints(project, routeRecord), [project, routeRecord]);
  // Memoized so switching the basemap does not re-frame the map.
  const points = useMemo(
    () => (routeData.points.length ? routeData.points : [routeData.startPoint, routeData.endPoint].filter(Boolean)),
    [routeData],
  );
  const theme = getRouteStatusTheme(project?.status);

  if (!points.length) return null;
  return (
    <div className={`relative overflow-hidden rounded-xl border border-slate-200 ${className}`}>
      <MapContainer center={points[0]} zoom={15} className="h-full w-full z-0" scrollWheelZoom={false} zoomControl>
        <BaseTiles basemap={basemap} />
        <FitRoute points={points} />
        {points.length >= 2 && (
          <>
            <Polyline positions={points} interactive={false} pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.9 }} />
            <Polyline positions={points} pathOptions={{ color: theme.line, weight: 5, opacity: 1 }}>
              <Tooltip sticky>{project.project_name}</Tooltip>
            </Polyline>
          </>
        )}
        <RouteEndpointMarkers project={project} routeData={routeData} lineColor={theme.line} />
      </MapContainer>
      {/* Same collapsible Layers button as the other maps, closed until opened. */}
      <MapControlPanel compact defaultOpen={false}>
        <ControlGroup label="Basemap">
          <BasemapSwitch value={basemap} onChange={setBasemap} />
        </ControlGroup>
      </MapControlPanel>
    </div>
  );
}
