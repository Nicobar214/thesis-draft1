import { useEffect, useState } from 'react';
import { useMap } from 'react-leaflet';

/**
 * Track the Leaflet map's current zoom level.
 *
 * Map layers use this to thin themselves out when the view is dense: Leon alone
 * has ~149 project routes, so labelled start/end pins and permanent gap labels are
 * only worth drawing once the user is zoomed in enough to read them.
 *
 * Lives in its own module so the component files stay fast-refresh friendly.
 */
export default function useMapZoom() {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());

  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); };
  }, [map]);

  return zoom;
}
