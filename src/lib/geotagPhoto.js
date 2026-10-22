/* The KalsaTrack camera's evidence photo, shared by every on-site check that
 * uses it (progress certification, priority validations and inspections):
 * a live-camera frame stamped with the best GPS fix, the time and a
 * verification QR (photoAttestation.js), and its distance to the road. */
import { attestPhoto, registerAttestation } from './photoAttestation';
import { readBestPosition } from './onSiteLocation';
import { haversineMeters, nearestPointOnRoute } from '../components/publicReports/routeGeometry';

/** Stamp a camera frame with the engineer's best GPS fix. */
export async function captureGeotagPhoto(frame, { kind, label, onSample } = {}) {
  const fix = await readBestPosition({ onSample });
  const { blob, attestation } = await attestPhoto(frame, {
    kind,
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracy: fix.accuracy,
    capturedAt: fix.capturedAt,
    label,
  });
  return {
    file: new File([blob], `${kind}-${Date.now()}.jpg`, { type: 'image/jpeg' }),
    attestation,
  };
}

/** Metres from a point to a road line (null when the road has no location). */
export function distanceToRoad(points, at) {
  if (!Array.isArray(points) || !at) return null;
  if (points.length >= 2) return nearestPointOnRoute(points, at)?.distanceMeters ?? null;
  if (points.length === 1) return haversineMeters(points[0], at);
  return null;
}

/**
 * Upload stamped photos under `<folder>/<user id>/<recordId>/` in `bucket` and
 * register their attestations. Returns what the server stores per photo.
 * Uploaded files are removed again if any upload fails.
 */
export async function uploadGeotagPhotos(client, { bucket, folder, recordId, photos }) {
  const { data: auth } = await client.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) throw new Error('Your session has expired. Sign in again.');

  const done = [];
  try {
    for (const [i, photo] of photos.entries()) {
      const path = `${folder}/${userId}/${recordId}/${Date.now()}-${i + 1}.jpg`;
      const { error } = await client.storage.from(bucket).upload(path, photo.file, { contentType: 'image/jpeg' });
      if (error) throw error;
      const { data } = client.storage.from(bucket).getPublicUrl(path);
      const a = photo.attestation;
      done.push({
        url: data.publicUrl,
        path,
        latitude: a.latitude,
        longitude: a.longitude,
        accuracy_m: a.accuracy,
        captured_at: a.capturedAt,
        code: a.code,
        attestation: a,
      });
    }
  } catch (err) {
    if (done.length) await client.storage.from(bucket).remove(done.map((p) => p.path));
    throw err;
  }
  await Promise.all(done.map((p) => registerAttestation(client, p.attestation, { recordId, bucket, path: p.path })));
  return done.map(({ attestation, ...rest }) => rest); // eslint-disable-line no-unused-vars
}
