import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import { cellPeak } from '../../lib/heatCells';

const EARTH_M_PER_PX_AT_Z0 = 156543.03392; // meters per pixel at zoom 0, on the equator

/**
 * Heat layer anchored to the ground rather than to the screen.
 *
 * leaflet.heat draws every blob a fixed number of pixels wide. Zoom out and one
 * blob swallows more and more of the map; zoom in and it looks like it shrinks.
 * Here the blob radius is defined in METERS and converted to pixels on every
 * zoom, so a cluster of farms covers the same piece of ground at any scale and
 * the blobs grow and shrink together with the map.
 *
 * Intensity is also fixed in absolute terms. The library's own zoom dimming is
 * switched off (maxZoom: 0) and the scale ceiling comes from the densest ground
 * cell in the data, so colors mean the same thing at every zoom.
 *
 * fixedMax: pin that ceiling yourself. A time-lapse passes the highest density
 * seen across ALL dates, so an area visibly brightens as reports pile up and
 * fades as they age out, instead of every frame rescaling to look equally hot.
 *
 * The layer is created once and its data swapped in place, so changing `points`
 * every frame (an animation) does not flicker.
 *
 * Pixel radius is clamped so blobs stay visible when zoomed far out and do not
 * balloon past the viewport when zoomed far in.
 *
 * points: [lat, lng, weight?]. Must render inside a MapContainer.
 */
export default function StableHeatLayer({
  visible = true,
  points,
  radiusMeters = 1200,
  minRadiusPx = 4,
  maxRadiusPx = 140,
  blurRatio = 0.6,
  gradient,
  minOpacity = 0.2,
  fixedMax,
}) {
  const map = useMap();
  const layerRef = useRef(null);
  const pointsRef = useRef(points);
  // Kept current for the create effect below, which must not re-run on every data change.
  useEffect(() => {
    pointsRef.current = points;
  });
  const gradientKey = gradient ? JSON.stringify(gradient) : '';

  // Create and destroy the layer; follow zoom by resizing the blobs.
  useEffect(() => {
    const factory = (window.L && window.L.heatLayer) || L.heatLayer;
    if (!visible || !factory) return undefined;

    const sizesAtZoom = (zoom) => {
      const lat = map.getCenter().lat;
      const metersPerPx = (EARTH_M_PER_PX_AT_Z0 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
      const radius = Math.min(maxRadiusPx, Math.max(minRadiusPx, radiusMeters / metersPerPx));
      return { radius, blur: Math.max(3, radius * blurRatio) };
    };

    const initial = sizesAtZoom(map.getZoom());
    const layer = factory(Array.isArray(pointsRef.current) ? pointsRef.current : [], {
      radius: initial.radius,
      blur: initial.blur,
      minOpacity,
      maxZoom: 0,
      max: 1,
      ...(gradientKey ? { gradient: JSON.parse(gradientKey) } : {}),
    }).addTo(map);
    layerRef.current = layer;

    const resize = () => layer.setOptions(sizesAtZoom(map.getZoom()));
    map.on('zoomend', resize);
    return () => {
      map.off('zoomend', resize);
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [map, visible, radiusMeters, minRadiusPx, maxRadiusPx, blurRatio, minOpacity, gradientKey]);

  // Swap the data and the scale ceiling in place.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const pts = Array.isArray(points) ? points : [];
    const peak = fixedMax ?? cellPeak(pts, radiusMeters, blurRatio);
    layer.setOptions({ max: Math.max(1, peak) * 1.25 });
    layer.setLatLngs(pts);
  }, [points, fixedMax, visible, radiusMeters, minRadiusPx, maxRadiusPx, blurRatio, minOpacity, gradientKey]);

  return null;
}
