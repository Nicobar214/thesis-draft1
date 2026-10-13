/*
 * offlineHarvests.js — harvests logged with no signal are saved on the device
 * (IndexedDB, photo included) and sent to farmer_harvest_logs when the
 * connection returns. Same idea as the road-report queue (offlineReports.js).
 *
 *   enqueueHarvest(item)            save a new harvest for later
 *   listQueuedHarvests(farmerId)    what is still waiting (shown in the list)
 *   syncQueuedHarvests(client)      send everything; safe to call repeatedly
 */
import { isConnectionError } from './offlineCache';

const DB_NAME = 'kalsatrack-harvest-queue';
const STORE = 'harvests';
const PHOTO_BUCKET = 'farmer-harvest-photos';
export const HARVEST_QUEUE_EVENT = 'kt:harvest-queue-changed';

function openDb() {
  return new Promise((resolve, reject) => {
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

const announce = () => window.dispatchEvent(new CustomEvent(HARVEST_QUEUE_EVENT));

/** item: { farmerId, payload (farmer_harvest_logs columns), photoBlob?, photoExt? } */
export async function enqueueHarvest(item) {
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    farmerId: item.farmerId,
    payload: item.payload,
    photoBlob: item.photoBlob || null,
    photoExt: item.photoExt || 'jpg',
    queuedAt: new Date().toISOString(),
    lastError: null,
  };
  await withStore('readwrite', (s) => s.put(record));
  announce();
  return record;
}

export async function listQueuedHarvests(farmerId) {
  try {
    const all = (await withStore('readonly', (s) => s.getAll())) || [];
    return farmerId ? all.filter((r) => r.farmerId === farmerId) : all;
  } catch {
    return [];
  }
}

let syncInFlight = null;

/** Returns { sent, failed, pending }. Stops early when the connection drops. */
export function syncQueuedHarvests(client) {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const summary = { sent: 0, failed: 0, pending: 0 };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      summary.pending = (await listQueuedHarvests()).length;
      return summary;
    }
    const { data: { session } } = await client.auth.getSession();
    const uid = session?.user?.id;
    const items = (await listQueuedHarvests(uid)).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));

    for (const item of items) {
      try {
        let photoPath = null;
        if (item.photoBlob) {
          const path = `harvests/${item.farmerId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${item.photoExt}`;
          const { error: upErr } = await client.storage.from(PHOTO_BUCKET).upload(path, item.photoBlob, { contentType: item.photoBlob.type || 'image/jpeg' });
          if (upErr) throw upErr;
          photoPath = path;
        }
        const { error } = await client.from('farmer_harvest_logs').insert({ ...item.payload, photo_path: photoPath, farmer_id: item.farmerId });
        if (error) throw error;
        await withStore('readwrite', (s) => s.delete(item.id));
        summary.sent += 1;
      } catch (err) {
        if (isConnectionError(err)) { summary.pending += 1; break; }
        summary.failed += 1;
        await withStore('readwrite', (s) => s.put({ ...item, lastError: err?.message || 'Could not send' }));
      }
    }
    if (summary.sent || summary.failed) announce();
    return summary;
  })().finally(() => { syncInFlight = null; });
  return syncInFlight;
}
