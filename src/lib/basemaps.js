import { useCallback, useState } from 'react';

/*
 * Map themes. 'street' is the original OpenStreetMap look and stays the default;
 * the rest are alternatives to compare.
 *
 * Every theme here works with NO API key. CARTO's Voyager / Positron / Dark Matter
 * were tried first, but CARTO now serves an "API KEY REQUIRED" placeholder tile to
 * keyless requests, so they were replaced with Esri and OpenStreetMap-community
 * tiles. Do not switch back to cartocdn.com without a key.
 *
 * Esri's tile services are free for development and non-commercial use with
 * attribution; a public production deployment should review Esri's terms.
 * Each map shows the credit line Leaflet builds from `attribution`.
 */

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ESRI = 'Tiles &copy; Esri';
const ESRI_SERVICE = 'https://server.arcgisonline.com/ArcGIS/rest/services';

export const DEFAULT_BASEMAP = 'street';

export const BASEMAPS = {
  street: {
    label: 'Street',
    hint: 'OpenStreetMap, the default look',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM,
    maxZoom: 19,
    swatch: 'linear-gradient(135deg,#f2efe9 55%,#aad3df 55%)',
  },
  streets: {
    label: 'Streets',
    hint: 'Esri street map with shaded relief; clean and different from the default',
    url: `${ESRI_SERVICE}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
    attribution: `${ESRI} &mdash; Esri, HERE, Garmin, OpenStreetMap contributors`,
    maxZoom: 19,
    swatch: 'linear-gradient(135deg,#f1ead6 55%,#a5c8e1 55%)',
  },
  light: {
    label: 'Light',
    hint: 'Neutral gray backdrop; best when many data layers are on',
    url: `${ESRI_SERVICE}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    attribution: `${ESRI} &mdash; Esri, HERE, Garmin`,
    maxZoom: 16,
    overlay: { url: `${ESRI_SERVICE}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, maxZoom: 16 },
    swatch: 'linear-gradient(135deg,#ececec 55%,#cfd6d9 55%)',
  },
  dark: {
    label: 'Dark',
    hint: 'Dark gray backdrop; heatmaps glow on it',
    url: `${ESRI_SERVICE}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    attribution: `${ESRI} &mdash; Esri, HERE, Garmin`,
    maxZoom: 16,
    overlay: { url: `${ESRI_SERVICE}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, maxZoom: 16 },
    swatch: 'linear-gradient(135deg,#3a3d42 55%,#1d1f23 55%)',
  },
  terrain: {
    label: 'Terrain',
    hint: 'Contours and hillshade; shows the slopes roads climb',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    attribution: `${OSM}, SRTM | Style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
    maxZoom: 17,
    swatch: 'linear-gradient(135deg,#d6e2b8 55%,#a9cfd6 55%)',
  },
  roads: {
    label: 'Roads',
    hint: 'CyclOSM: emphasises road and track types, useful for farm-to-market roads',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    subdomains: 'abc',
    attribution: `${OSM} | Style &copy; <a href="https://www.cyclosm.org">CyclOSM</a>`,
    maxZoom: 20,
    swatch: 'linear-gradient(135deg,#dfe8cd 55%,#8fbfd9 55%)',
  },
  satellite: {
    label: 'Satellite',
    hint: 'Aerial imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: ESRI,
    maxZoom: 19,
    swatch: 'linear-gradient(135deg,#46603f 55%,#1f3c52 55%)',
  },
  hybrid: {
    label: 'Satellite + labels',
    hint: 'Aerial imagery with place names and boundaries',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: ESRI,
    maxZoom: 19,
    overlay: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      maxZoom: 19,
    },
    swatch: 'linear-gradient(135deg,#46603f 55%,#1f3c52 55%)',
  },
};

export const BASEMAP_IDS = Object.keys(BASEMAPS);

const STORAGE_KEY = 'kalsatrack.basemap';

/** Selected theme, remembered per browser so every map opens on the one you picked. */
export function useBasemap() {
  const [id, setId] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return BASEMAPS[saved] ? saved : DEFAULT_BASEMAP;
    } catch {
      return DEFAULT_BASEMAP;
    }
  });
  const choose = useCallback((next) => {
    if (!BASEMAPS[next]) return;
    setId(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable: the choice just will not be remembered */
    }
  }, []);
  return [id, choose];
}
