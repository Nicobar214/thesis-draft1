import { useState } from 'react';
import { useBasemap } from './basemaps';

/**
 * What the route editor map shows, toggled from its Layers panel. One per
 * editor (Add Project, Edit Project), so each remembers its own choices.
 */
export default function useRouteEditorLayers() {
  const [layers, setLayers] = useState({
    existing: true,
    endpoints: true,
    overlap: true,
    Completed: true,
    'On-Going': true,
    Proposed: true,
    Other: true,
  });
  const [basemap, setBasemap] = useBasemap();
  const setLayer = (key, on) => setLayers((cur) => ({ ...cur, [key]: on }));
  return { layers, setLayer, basemap, setBasemap };
}
