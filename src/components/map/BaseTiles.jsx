import { TileLayer } from 'react-leaflet';
import { BASEMAPS, DEFAULT_BASEMAP } from '../../lib/basemaps';

/**
 * The tile layer(s) for a theme from lib/basemaps. Remounts when the theme changes.
 * Tiles stretch past a theme's last real zoom level (Terrain stops at 17) instead of
 * going blank when you keep zooming in.
 */
export default function BaseTiles({ basemap = DEFAULT_BASEMAP }) {
  const def = BASEMAPS[basemap] || BASEMAPS[DEFAULT_BASEMAP];
  return (
    <>
      <TileLayer
        key={basemap}
        url={def.url}
        attribution={def.attribution}
        maxNativeZoom={def.maxZoom}
        maxZoom={Math.max(def.maxZoom, 19)}
        {...(def.subdomains ? { subdomains: def.subdomains } : {})}
      />
      {def.overlay && (
        <TileLayer key={`${basemap}-labels`} url={def.overlay.url} maxNativeZoom={def.overlay.maxZoom} maxZoom={19} zIndex={5} />
      )}
    </>
  );
}
