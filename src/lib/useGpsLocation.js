import { useCallback, useEffect, useRef, useState } from 'react';

/** What to tell the user for each way a GPS lookup can fail. */
export function describeGpsError(err) {
  if (err?.code === 1) {
    return 'Location permission denied. Open your browser settings, enable Location for this site, then tap "Try Again".';
  }
  if (err?.code === 3) return 'GPS timed out. Move to open sky and try again.';
  return `Unable to get your location: ${err?.message}`;
}

const SLOW_FIX_MS = 5000;

/**
 * The user's GPS position for the report form.
 *
 * Starts looking up on mount, keeps a watcher running to correct drift once a first
 * fix arrives, and says so (gpsSlow) when the fix is taking a while. The watcher is
 * always cleared on unmount and on reset.
 *
 *   const { gps, gpsError, gpsLoading, gpsSlow, acquireGps, resetGps } = useGpsLocation();
 *   gps = { lat, lng, accuracy } | null
 */
export function useGpsLocation() {
  const [gps, setGps] = useState(null);
  const [gpsError, setGpsError] = useState(null);
  // Start as loading when geolocation exists: the mount effect starts the lookup
  // immediately, so this avoids painting a "Detect My Location" button for one frame.
  const [gpsLoading, setGpsLoading] = useState(() => typeof navigator !== 'undefined' && Boolean(navigator.geolocation));
  const [gpsSlow, setGpsSlow] = useState(false);
  const watchRef = useRef(null);

  const clearWatch = useCallback(() => {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  }, []);

  const acquireGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by this browser.');
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setGpsLoading(false);
        // Keep correcting drift after the first fix.
        clearWatch();
        watchRef.current = navigator.geolocation.watchPosition(
          (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
          () => {},
          { enableHighAccuracy: true, maximumAge: 5000 },
        );
      },
      (err) => {
        setGpsLoading(false);
        setGpsError(describeGpsError(err));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }, [clearWatch]);

  // If the fix is taking a while, say so instead of leaving a silent spinner.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the flag when the lookup ends
    if (!gpsLoading) { setGpsSlow(false); return undefined; }
    const timer = setTimeout(() => setGpsSlow(true), SLOW_FIX_MS);
    return () => clearTimeout(timer);
  }, [gpsLoading]);

  // Auto-start on mount; stop watching on unmount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the browser's GPS lookup
    acquireGps();
    return clearWatch;
  }, [acquireGps, clearWatch]);

  /** Forget the position and show "loading" until the caller restarts the lookup. */
  const resetGps = useCallback(() => {
    clearWatch();
    setGps(null);
    setGpsError(null);
    setGpsLoading(Boolean(navigator.geolocation));
  }, [clearWatch]);

  return { gps, gpsError, gpsLoading, gpsSlow, acquireGps, resetGps };
}

export default useGpsLocation;
