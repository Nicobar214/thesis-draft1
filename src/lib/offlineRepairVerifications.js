/*
 * Offline queue for repair-verification evidence.
 *
 * An engineer standing at a remote site may have no signal. GPS and the camera
 * work without one, so the evidence (stamped photo, shutter-time coordinates,
 * capture time) is saved on the device and uploaded when the app is next online.
 * Nothing is trusted because it was queued: the server runs the same checks at
 * sync time (assigned engineer, separation of duties, 500 m, accuracy, capture
 * not older than 48 h, repair still awaiting verification).
 *
 * This lives in its own IndexedDB database so it cannot collide with the
 * version of 'kalsatrack-offline' that the service worker also opens.
 */
import { verifyPublicReportRepair } from '../services/publicReportWorkflow';

const DB_NAME = 'kalsatrack-repair-evidence';
const DB_VERSION = 1;
const QUEUE_STORE = 'queue';
const ACTION_STORE = 'actions';
const PHOTO_BUCKET = 'public-report-photos';
export const REPAIR_SYNC_EVENT = 'repair-verification-sync';

let syncInFlight = null;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: 'actionId' });
      if (!db.objectStoreNames.contains(ACTION_STORE)) db.createObjectStore(ACTION_STORE, { keyPath: 'reportId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(store, mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const result = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(result?.result ?? result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const requestResult = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function readAll(store, filter) {
  const db = await openDb();
  try {
    const tx = db.transaction(store, 'readonly');
    const all = await requestResult(tx.objectStore(store).getAll());
    return filter ? all.filter(filter) : all;
  } finally {
    db.close();
  }
}

/** True when an error means "no connection" rather than "the server said no". */
export function isNetworkError(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = String(err?.message || err || '');
  return err instanceof TypeError || /failed to fetch|networkerror|network request failed|load failed|timed? ?out|offline/i.test(msg);
}

// ── Queue ────────────────────────────────────────────────────

export async function enqueueRepairVerification(item) {
  const record = {
    actionId: item.actionId,
    reportId: item.reportId,
    engineerId: item.engineerId,
    photoBlob: item.photoBlob,
    latitude: item.latitude,
    longitude: item.longitude,
    accuracyMeters: item.accuracyMeters ?? null,
    capturedAt: item.capturedAt,
    note: item.note || null,
    status: 'queued', // queued | rejected
    lastError: null,
    queuedAt: new Date().toISOString(),
  };
  await withStore(QUEUE_STORE, 'readwrite', (s) => s.put(record));
  return record;
}

export async function getQueuedRepairVerification(actionId) {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(QUEUE_STORE, 'readonly');
      return (await requestResult(tx.objectStore(QUEUE_STORE).get(actionId))) || null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function listQueuedRepairVerifications() {
  try {
    return await readAll(QUEUE_STORE);
  } catch {
    return [];
  }
}

export async function discardQueuedRepairVerification(actionId) {
  await withStore(QUEUE_STORE, 'readwrite', (s) => s.delete(actionId));
}

async function patchQueued(actionId, patch) {
  const current = await getQueuedRepairVerification(actionId);
  if (!current) return;
  await withStore(QUEUE_STORE, 'readwrite', (s) => s.put({ ...current, ...patch }));
}

// ── Cached follow-up, so the panel can open with no signal ───

export async function cacheRepairAction(reportId, action) {
  try {
    await withStore(ACTION_STORE, 'readwrite', (s) => s.put({ reportId, action, cachedAt: Date.now() }));
  } catch {
    /* caching is a convenience; ignore */
  }
}

export async function getCachedRepairAction(reportId) {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(ACTION_STORE, 'readonly');
      const row = await requestResult(tx.objectStore(ACTION_STORE).get(reportId));
      return row?.action || null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

// ── Sync ─────────────────────────────────────────────────────

async function uploadAndVerify(client, item) {
  const path = `repair-verifications/${item.reportId}/${Date.now()}.jpg`;
  const { error: uploadErr } = await client.storage
    .from(PHOTO_BUCKET)
    .upload(path, item.photoBlob, { upsert: false, contentType: 'image/jpeg' });
  if (uploadErr) throw uploadErr;

  const { data: pub } = client.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) throw new Error('Photo uploaded but no public URL was returned.');

  await verifyPublicReportRepair(client, {
    actionId: item.actionId,
    photoUrl: pub.publicUrl,
    latitude: item.latitude,
    longitude: item.longitude,
    accuracyMeters: item.accuracyMeters,
    note: item.note,
    capturedAt: item.capturedAt,
  });
}

/**
 * Upload every queued verification that belongs to the signed-in engineer.
 * Safe to call repeatedly: one run at a time, and an item is only removed after
 * the server accepts it. A connection failure leaves the queue untouched; a
 * server rejection marks the item 'rejected' with the reason, so the engineer
 * can read it and retake the photo.
 * Returns { synced, rejected, pending }.
 */
export function syncRepairVerifications(client, { onResult } = {}) {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const summary = { synced: 0, rejected: 0, pending: 0 };
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        summary.pending = (await listQueuedRepairVerifications()).length;
        return summary;
      }

      const { data: sessionData } = await client.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (!userId) {
        summary.pending = (await listQueuedRepairVerifications()).length;
        return summary;
      }

      const items = (await listQueuedRepairVerifications()).filter(
        (i) => i.engineerId === userId && i.status === 'queued'
      );

      for (const item of items) {
        try {
          await uploadAndVerify(client, item);
          await discardQueuedRepairVerification(item.actionId);
          summary.synced += 1;
          if (onResult) onResult({ type: 'synced', item });
        } catch (err) {
          if (isNetworkError(err)) {
            summary.pending += 1;
            break; // connection dropped again; try the rest next time
          }
          await patchQueued(item.actionId, { status: 'rejected', lastError: String(err?.message || err) });
          summary.rejected += 1;
          if (onResult) onResult({ type: 'rejected', item, error: err });
        }
      }
      return summary;
    } finally {
      syncInFlight = null;
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(REPAIR_SYNC_EVENT));
    }
  })();

  return syncInFlight;
}
