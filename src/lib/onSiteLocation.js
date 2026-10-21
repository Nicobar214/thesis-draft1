/* On-site location for evidence photos (repair verification, LGU and
 * contractor after-photos). The server re-checks distance, accuracy and age:
 * these limits only stop someone before they waste a trip. */

// Mirrors the server limit in verify_public_report_repair. The server is the
// authority; this only stops the engineer before they waste a trip.
export const MAX_DISTANCE_M = 500;
// A fix this loose could put the engineer anywhere within a few blocks.
export const MAX_ACCURACY_M = 100;
// A single getCurrentPosition() call often returns the device's first, worst
// fix (cold GPS, stale cell/Wi-Fi positioning) even when a much better one
// arrives a few seconds later. Rather than judge the engineer on that first
// read, sample for up to this long and keep the most accurate fix seen.
export const POSITION_POLL_MS = 9000;
// Stop polling early once a fix this good arrives -- no reason to make the
// engineer wait out the full window if GPS has already locked on well.
export const ACCURACY_GOOD_ENOUGH_M = 25;

export function readPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        capturedAt: new Date().toISOString(),
      }),
      reject,
      // maximumAge 0: never accept a cached position.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

export function geoErrorMessage(err) {
  if (err?.message === 'unsupported') return 'This device cannot provide a location.';
  if (err?.code === 1) return 'Location permission was denied. Allow location for this site and try again.';
  return 'Could not read your location. Move to open sky and try again.';
}

/**
 * Sample position fixes for up to `durationMs` and resolve with the most
 * accurate one seen, instead of trusting whatever getCurrentPosition()
 * happens to return first. Resolves early once a fix is already good enough.
 * `onSample` fires on every improved fix, so the UI can show live progress.
 */
export function readBestPosition({ durationMs = POSITION_POLL_MS, goodEnoughM = ACCURACY_GOOD_ENOUGH_M, onSample } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('unsupported'));
      return;
    }
    let best = null;
    let watchId = null;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      if (best) resolve(best);
      else reject(new Error('timeout'));
    };

    const timer = setTimeout(finish, durationMs);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const sample = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: new Date().toISOString(),
        };
        if (!best || sample.accuracy < best.accuracy) {
          best = sample;
          onSample?.(sample);
        }
        if (sample.accuracy <= goodEnoughM) finish();
      },
      (err) => {
        // A fix already in hand survives a later error (e.g. a transient
        // signal drop); only reject outright if nothing has come in yet.
        if (!best) {
          settled = true;
          if (watchId !== null) navigator.geolocation.clearWatch(watchId);
          clearTimeout(timer);
          reject(err);
        }
      },
      { enableHighAccuracy: true, timeout: durationMs, maximumAge: 0 }
    );
  });
}

/* TEMPORARY (testing): wider limits for the LGU/contractor after-photo only,
 * matching supabase_handler_photo_testing_limits.sql. Set to null to go back to
 * the normal on-site limits above. The engineer's check never uses this. */
export const HANDLER_PHOTO_TEST_LIMITS = { maxDistanceM: 50000, maxAccuracyM: 1000 };

/**
 * Is a geotagged photo usable as on-site evidence? `distanceM` is how far the
 * fix is from the site (null when the site has no location, which is not
 * checked). Mirrors the server checks, so the engineer learns it before
 * submitting. Returns { ok, distanceM, problem } with a plain-language problem.
 */
export function onSiteCheck({ accuracy, distanceM }, { maxDistanceM = MAX_DISTANCE_M, maxAccuracyM = MAX_ACCURACY_M, place = 'the site' } = {}) {
  if (!Number.isFinite(accuracy) || accuracy > maxAccuracyM) {
    return {
      ok: false,
      distanceM,
      problem: `GPS is not precise enough (±${Number.isFinite(accuracy) ? Math.round(accuracy) : '?'} m, needs ±${maxAccuracyM} m or better). Move to open sky and retake.`,
    };
  }
  if (distanceM != null && distanceM > maxDistanceM) {
    return {
      ok: false,
      distanceM,
      problem: `You are ${distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : `${Math.round(distanceM)} m`} from ${place} (must be within ${maxDistanceM} m). Take the photo on site.`,
    };
  }
  return { ok: true, distanceM, problem: null };
}
