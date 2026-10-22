/* Zooming on every map in the app is done with the mouse wheel / trackpad
 * only: there are no +/- buttons.
 *
 * Leaflet's own wheel zoom jumps one step per wheel notch. This replaces it
 * with a continuous zoom: each wheel notch moves a target zoom, and the map
 * glides toward it frame by frame, around the mouse pointer (the same feel as
 * Google Maps). It is applied to every map, whatever its own scrollWheelZoom /
 * zoomControl props say, so all maps behave the same. (Pinch-zoom on phones is
 * Leaflet's touchZoom and is unchanged.)
 *
 * Based on the approach of Leaflet.SmoothWheelZoom (MIT). */
import L from 'leaflet';

export const SMOOTH_ZOOM_OPTIONS = {
  zoomSnap: 0.25,          // zoom can rest between whole levels
  smoothWheelZoom: true,
  smoothSensitivity: 1,    // higher = faster zoom per wheel notch
};

const ZOOM_PER_PIXEL = 1 / 200; // a mouse notch (~100 px) = half a zoom level
const MAX_PER_EVENT = 1;         // one fast flick never jumps more than a level

/* How far the wheel moved, in pixels, whatever unit the browser reports. */
function wheelPixels(e) {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1; // lines / pages
  return (e.deltaY || 0) * unit;
}
const EASE = 0.25;         // share of the remaining distance covered each frame
const WHEEL_IDLE_MS = 150; // no wheel event for this long = the user stopped scrolling

/* Every map: no +/- buttons, whatever the map's own zoomControl prop says. */
L.Map.addInitHook(function noZoomButtons() {
  if (this.zoomControl) {
    this.zoomControl.remove();
    this.zoomControl = null;
  }
});

/* Every map: re-measure when its box changes size. Leaflet only listens to the
 * window, so a map created inside a collapsed section, a hidden tab or an
 * opening dialog stays at its first (often zero) size and draws grey. */
L.Map.addInitHook(function watchContainerSize() {
  if (typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(() => this.invalidateSize({ pan: false }));
  observer.observe(this._container);
  this.on('unload', () => observer.disconnect());
});

const SmoothWheelZoom = L.Handler.extend({
  addHooks() {
    L.DomEvent.on(this._map._container, 'wheel', this._onWheel, this);
  },

  removeHooks() {
    L.DomEvent.off(this._map._container, 'wheel', this._onWheel, this);
    this._finish();
  },

  _onWheel(e) {
    L.DomEvent.preventDefault(e);
    L.DomEvent.stopPropagation(e);
    const map = this._map;
    if (!this._animating) this._begin();

    // Clamp only (map._limitZoom would also round to zoomSnap, which swallows
    // the small deltas a trackpad sends).
    const step = -wheelPixels(e) * ZOOM_PER_PIXEL * (map.options.smoothSensitivity || 1);
    const wanted = this._goalZoom + Math.max(-MAX_PER_EVENT, Math.min(MAX_PER_EVENT, step));
    this._goalZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), wanted));
    this._mouse = map.mouseEventToContainerPoint(e);
    this._mouseLatLng = map.containerPointToLatLng(this._mouse);

    // Still scrolling: the glide keeps going until the goal is reached, even
    // after the wheel stops.
    this._wheeling = true;
    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => { this._wheeling = false; }, WHEEL_IDLE_MS);
  },

  _begin() {
    const map = this._map;
    map._stop();
    if (map._panAnim) map._panAnim.stop();
    this._animating = true;
    this._moved = false;
    this._goalZoom = map.getZoom();
    this._frame = requestAnimationFrame(() => this._step());
  },

  _step() {
    if (!this._animating) return;
    const map = this._map;
    const zoom = map.getZoom();
    const diff = this._goalZoom - zoom;
    if (Math.abs(diff) > 0.001) {
      const next = Math.abs(diff) < 0.01 ? this._goalZoom : zoom + diff * EASE;
      // Keep the point under the mouse fixed while zooming.
      const offset = this._mouse.subtract(map.getSize().divideBy(2));
      const center = map.unproject(map.project(this._mouseLatLng, next).subtract(offset), next);
      if (!this._moved) {
        map._moveStart(true, false);
        this._moved = true;
      }
      map._move(center, next);
    } else if (!this._wheeling) {
      this._finish();
      return;
    }
    this._frame = requestAnimationFrame(() => this._step());
  },

  _finish() {
    if (!this._animating) return;
    this._animating = false;
    this._wheeling = false;
    cancelAnimationFrame(this._frame);
    clearTimeout(this._idleTimer);
    if (this._moved) this._map._moveEnd(true);
  },
});

L.Map.mergeOptions(SMOOTH_ZOOM_OPTIONS);
L.Map.addInitHook('addHandler', 'smoothWheelZoom', SmoothWheelZoom);

// The smooth handler replaces Leaflet's stepped one on every map, including
// maps that pass scrollWheelZoom={false}: the wheel is the only way to zoom.
L.Map.addInitHook(function useSmoothWheel() {
  this.scrollWheelZoom.disable();
  this.smoothWheelZoom.enable();
});
