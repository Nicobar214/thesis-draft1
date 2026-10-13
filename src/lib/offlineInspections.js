/*
 * offlineInspections.js — field inspections finished with no signal.
 *
 * The camera, GPS and photo stamp all work offline, so the engineer can finish
 * the inspection on site. The findings and the stamped photo are saved on the
 * device and sent through the SAME controlled RPC as an online submit when the
 * connection returns (the server still checks the assignment and status then).
 *
 *   sendInspection(client, item)       upload photo, register stamp, call RPC
 *   enqueueInspection(item)            keep for later
 *   listQueuedInspections(engineerId)  what is still waiting
 *   syncQueuedInspections(client)      send everything; safe to call repeatedly
 */
import { startPublicReportInspection, submitPublicReportInspection } from '../services/publicReportWorkflow';
import { registerAttestation } from './photoAttestation';
import { isConnectionError } from './offlineCache';

const DB_NAME = 'kalsatrack-inspection-queue';
const STORE = 'inspections';
const PHOTO_BUCKETS = ['public-report-photos', 'public-photos'];
export const INSPECTION_QUEUE_EVENT = 'kt:inspection-queue-changed';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const announce = () => window.dispatchEvent(new CustomEvent(INSPECTION_QUEUE_EVENT));

async function notifyAfterInspection(client, report) {
  try {
    const { data: admins } = await client.from('profiles').select('id').eq('role', 'admin').limit(5);
    if (Array.isArray(admins) && admins.length) {
      await client.from('notifications').insert(admins.map((adm) => ({
        user_id: adm.id,
        type: 'public_report_field_finding',
        title: 'Field findings submitted',
        message: `Field findings are available for report ${String(report.id).slice(0, 8)}.`,
        is_read: false,
      })));
    }
  } catch { /* deployments without notifications */ }
  if (!report?.user_id) return;
  try {
    await client.from('notifications').insert({
      user_id: report.user_id,
      type: 'public_report_field_update',
      title: 'Public report update',
      message: 'Field inspection was completed and is now awaiting DA admin review.',
      report_id: report.id,
      is_read: false,
    });
  } catch { /* deployments without notifications */ }
}

/**
 * item: { report: {id, user_id}, findings: {conditionObserved, recommendedAction,
 * estimatedCostRange, siteRating, certified}, photoBlob, photoExt, geo, attestation }
 */
export async function sendInspection(client, item) {
  const { report, findings, photoBlob, geo } = item;

  // Started on site with no signal: open the inspection on the server first.
  // If it is already open (an earlier attempt got this far), carry on to submit;
  // the submit RPC still refuses anything the engineer may not do.
  if (item.needsStart) {
    try {
      await startPublicReportInspection(client, { reportId: report.id });
    } catch (err) {
      if (isConnectionError(err)) throw err;
    }
  }

  const ext = item.photoExt || 'jpg';
  const path = `field-findings/${report.id}/${Date.now()}.${ext}`;

  let bucketUsed = '';
  let lastUploadError = null;
  for (const bucket of PHOTO_BUCKETS) {
    const { error } = await client.storage
      .from(bucket)
      .upload(path, photoBlob, { upsert: false, contentType: photoBlob.type || 'image/jpeg' });
    if (!error) { bucketUsed = bucket; break; }
    lastUploadError = error;
    if (isConnectionError(error)) throw error;
  }
  if (!bucketUsed) {
    const reason = lastUploadError?.message || 'Storage bucket not found';
    throw new Error(`${reason}. Create bucket public-report-photos (preferred) or public-photos.`);
  }

  const { data: pub } = client.storage.from(bucketUsed).getPublicUrl(path);
  const photoUrl = pub?.publicUrl || '';
  if (!photoUrl) throw new Error('Photo upload completed but public URL was not generated.');

  await registerAttestation(client, item.attestation, { recordId: report.id, bucket: bucketUsed, path });

  await submitPublicReportInspection(client, {
    reportId: report.id,
    conditionObserved: findings.conditionObserved,
    recommendedAction: findings.recommendedAction,
    siteRating: findings.siteRating,
    fieldPhotoUrl: photoUrl,
    certified: findings.certified,
    estimatedCostRange: findings.estimatedCostRange || null,
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null,
    gpsAccuracyMeters: geo?.accuracy ?? null,
  });

  await notifyAfterInspection(client, report);
}

export async function enqueueInspection(item) {
  const record = {
    ...item,
    id: `${item.report.id}`, // one waiting inspection per report; a newer one replaces it
    queuedAt: new Date().toISOString(),
    lastError: null,
  };
  await withStore('readwrite', (s) => s.put(record));
  announce();
  return record;
}

export async function listQueuedInspections(engineerId) {
  try {
    const all = (await withStore('readonly', (s) => s.getAll())) || [];
    return engineerId ? all.filter((r) => r.engineerId === engineerId) : all;
  } catch {
    return [];
  }
}

export async function discardQueuedInspection(id) {
  await withStore('readwrite', (s) => s.delete(id));
  announce();
}

let syncInFlight = null;

/** Returns { sent, failed, pending }. Stops early when the connection drops. */
export function syncQueuedInspections(client) {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const summary = { sent: 0, failed: 0, pending: 0 };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      summary.pending = (await listQueuedInspections()).length;
      return summary;
    }
    const { data: { session } } = await client.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return summary;
    const items = (await listQueuedInspections(uid))
      .filter((r) => !r.lastError)
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));

    for (const item of items) {
      try {
        await sendInspection(client, item);
        await withStore('readwrite', (s) => s.delete(item.id));
        summary.sent += 1;
      } catch (err) {
        if (isConnectionError(err)) { summary.pending += 1; break; }
        // The server refused it (e.g. the report was reassigned): keep it so the
        // engineer sees why, instead of silently dropping their work.
        summary.failed += 1;
        await withStore('readwrite', (s) => s.put({ ...item, lastError: err?.message || 'Could not send' }));
      }
    }
    if (summary.sent || summary.failed) announce();
    return summary;
  })().finally(() => { syncInFlight = null; });
  return syncInFlight;
}
