/* Supporting evidence: geotagged photos from the KalsaTrack camera and files
 * (images, PDFs) attached to a contractor's delay explanation or an LGU project
 * proposal. Items are kept in the form until it is sent, then uploaded together
 * (uploadEvidence), so nothing half-finished is left in storage.
 *
 * An item: { id, kind: 'photo' | 'file', file, preview, name, attestation?, category? }
 *   category (act-of-nature claims): 'document' (advisory, LGU/barangay notice) | 'photo'
 * Stored:   { kind, storage_path, file_name, mime_type, size_bytes,
 *             latitude, longitude, accuracy_m, captured_at, attestation_code } */
import { registerAttestation } from './photoAttestation';

export const EVIDENCE_MAX_ITEMS = 8;
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB, as the storage bucket allows
export const EVIDENCE_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const ACCEPTED = EVIDENCE_ACCEPT.split(',');

let seq = 0;
const nextId = () => `ev-${Date.now()}-${(seq += 1)}`;

/** Why a picked file cannot be attached, or null. */
export function fileProblem(file) {
  if (!file) return 'No file was chosen.';
  if (!ACCEPTED.includes(file.type)) return `"${file.name}" is not a photo (JPG, PNG, WebP) or a PDF.`;
  if (file.size > EVIDENCE_MAX_BYTES) return `"${file.name}" is larger than 10 MB.`;
  return null;
}

/** A photo from GeotagCamera -> an evidence item (GPS + verification QR stamped on it). */
export function photoToEvidence(photo) {
  return { id: nextId(), kind: 'photo', file: photo.file, preview: photo.preview, name: photo.file?.name || 'Camera photo', attestation: photo.attestation };
}

/** A picked file -> an evidence item. */
export function fileToEvidence(file) {
  return { id: nextId(), kind: 'file', file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null, name: file.name };
}

const safeName = (name) => String(name || 'file').normalize('NFD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(-60);

/**
 * Upload the items to `bucket` under `prefix/` and register camera photos for
 * /verify. Returns what to store per item. If any upload fails, the files
 * already uploaded in this call are removed and the error is thrown.
 */
export async function uploadEvidence(client, { bucket, prefix, items }) {
  const done = [];
  try {
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      const path = `${prefix}/${Date.now()}-${i + 1}-${safeName(it.name)}`;
      const { error } = await client.storage.from(bucket).upload(path, it.file, { upsert: false, contentType: it.file.type || undefined });
      if (error) throw error;
      const a = it.attestation || null;
      done.push({
        kind: it.kind,
        storage_path: path,
        file_name: it.name,
        mime_type: it.file.type || null,
        size_bytes: it.file.size ?? null,
        latitude: a?.latitude ?? null,
        longitude: a?.longitude ?? null,
        accuracy_m: a?.accuracy ?? null,
        captured_at: a?.capturedAt ?? null,
        attestation_code: a?.code ?? null,
        // Only when set, so other evidence still saves before supabase_overdue_v2_patch2.sql.
        ...(it.category ? { category: it.category } : {}),
      });
      if (a) await registerAttestation(client, a, { bucket, path });
    }
    return done;
  } catch (err) {
    if (done.length) await client.storage.from(bucket).remove(done.map((d) => d.storage_path)).catch(() => {});
    throw err;
  }
}

/** Stored evidence split for an act-of-nature claim: official documents, and the rest (photos of what happened). */
export function splitEvidence(rows = []) {
  return {
    documents: rows.filter((r) => r.category === 'document'),
    photos: rows.filter((r) => r.category !== 'document'),
  };
}

/** "2 photos, 1 file" */
export function evidenceSummary(items) {
  const photos = items.filter((i) => i.kind === 'photo').length;
  const files = items.length - photos;
  return [photos && `${photos} photo${photos === 1 ? '' : 's'}`, files && `${files} file${files === 1 ? '' : 's'}`].filter(Boolean).join(', ') || 'None';
}
