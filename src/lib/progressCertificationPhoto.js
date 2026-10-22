/* The field engineer's own geotagged site photo, required when certifying or
 * disputing a contractor's progress claim. Stamped and fingerprinted like every
 * other evidence photo (lib/photoAttestation.js), uploaded under the engineer's
 * folder in progress-photos, then linked to the update by
 * attach_progress_certification_photo (supabase_progress_certification_photo.sql). */
import { registerAttestation } from './photoAttestation';
// Photos come from the shared KalsaTrack camera (components/camera/GeotagCamera.jsx).

const BUCKET = 'progress-photos';

/** Upload the stamped photo and link it to the progress update. Throws on failure. */
export async function attachCertificationPhoto(client, updateId, photo) {
  const { data: auth } = await client.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) throw new Error('Your session has expired. Sign in again.');

  const path = `certifications/${userId}/${updateId}/${Date.now()}.jpg`;
  const { error: uploadError } = await client.storage.from(BUCKET).upload(path, photo.file, { contentType: 'image/jpeg' });
  if (uploadError) throw uploadError;
  const { data: urlData } = client.storage.from(BUCKET).getPublicUrl(path);

  const a = photo.attestation;
  const { error } = await client.rpc('attach_progress_certification_photo', {
    p_progress_update_id: updateId,
    p_photo_url: urlData.publicUrl,
    p_photo_path: path,
    p_latitude: a.latitude,
    p_longitude: a.longitude,
    p_accuracy_m: a.accuracy,
    p_captured_at: a.capturedAt,
    p_attestation_code: a.code,
  });
  if (error) {
    await client.storage.from(BUCKET).remove([path]);
    throw error;
  }
  await registerAttestation(client, a, { recordId: updateId, bucket: BUCKET, path });
}
