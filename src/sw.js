/* eslint-disable no-restricted-globals */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const DB_NAME = 'kalsatrack-offline';
const DB_VERSION = 1;
const REPORT_STORE = 'reportQueue';

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 5000;
const MAX_DELAY_MS = 5 * 60 * 1000;
let queueProcessInFlight = null;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

const navigationHandler = createHandlerBoundToURL('/index.html');
registerRoute(
  new NavigationRoute(navigationHandler, {
    denylist: [/^\/api\//, /^\/auth\//, /^\/rest\/v1\//]
  })
);

registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'gstatic-fonts-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

registerRoute(
  ({ url }) => /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/i.test(url.href),
  new CacheFirst({
    cacheName: 'osm-tiles-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

registerRoute(
  ({ request, url }) => {
    const isRuntimeAsset = request.destination === 'image' || request.destination === 'style' || request.destination === 'script';
    return isRuntimeAsset && !url.pathname.startsWith('/assets/');
  },
  new StaleWhileRevalidate({
    cacheName: 'static-runtime-assets',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(REPORT_STORE)) {
        db.createObjectStore(REPORT_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, handler) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REPORT_STORE, mode);
    const store = tx.objectStore(REPORT_STORE);
    const result = handler(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function getQueuedReports() {
  return withStore('readonly', (store) => store.getAll());
}

async function updateQueuedReport(id, patch) {
  return withStore('readwrite', (store) => new Promise((resolve, reject) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const current = getReq.result;
      if (!current) {
        resolve(null);
        return;
      }
      const next = { ...current, ...patch };
      const putReq = store.put(next);
      putReq.onsuccess = () => resolve(next);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  }));
}

async function removeQueuedReport(id) {
  return withStore('readwrite', (store) => store.delete(id));
}

function computeNextAttemptMs(attempts) {
  const delay = Math.min(BASE_DELAY_MS * (2 ** Math.max(attempts - 1, 0)), MAX_DELAY_MS);
  return Date.now() + delay;
}

function canAttemptSync(item) {
  const status = item.status || 'pending';
  if (status === 'synced') return false;
  if (item.isSyncing) return false;
  if ((item.attempts || 0) >= MAX_ATTEMPTS) return false;
  if (item.nextAttemptAt) {
    const nextTs = new Date(item.nextAttemptAt).getTime();
    if (Number.isFinite(nextTs) && nextTs > Date.now()) return false;
  }
  return true;
}

function buildAuthHeaders(authToken) {
  const token = authToken || SUPABASE_KEY;
  return {
    apikey: SUPABASE_KEY || '',
    Authorization: `Bearer ${token}`,
  };
}

async function uploadPhoto(item) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing Supabase environment variables');
  }

  const path = item.photoPath || `reports/${Date.now()}_${item.id}.jpg`;
  const endpoint = `${SUPABASE_URL}/storage/v1/object/public-report-photos/${path}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(item.authToken),
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true',
    },
    body: item.photoBlob,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Photo upload failed');
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/public-report-photos/${path}`;
  return { path, publicUrl };
}

async function insertReport(item, photoUrl) {
  const endpoint = `${SUPABASE_URL}/rest/v1/public_reports`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(item.authToken),
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ ...item.payload, photo_url: photoUrl }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Report insert failed');
  }
}

async function processQueue() {
  const items = await getQueuedReports();
  if (!items || items.length === 0) return;

  const pending = items.filter(canAttemptSync);
  if (pending.length === 0) return;

  console.info(`[sw-sync] Start: ${pending.length} queued`);
  for (const item of pending) {
    try {
      await updateQueuedReport(item.id, { isSyncing: true, status: 'pending' });
      console.info(`[sw-sync] Sending report ${item.id}`);
      const upload = await uploadPhoto(item);
      await insertReport(item, upload.publicUrl);
      await updateQueuedReport(item.id, { status: 'synced', isSyncing: false, lastError: null });
      await removeQueuedReport(item.id);
    } catch (err) {
      const nextAttempts = (item.attempts || 0) + 1;
      const shouldRetry = nextAttempts < MAX_ATTEMPTS;
      const nextAttemptAt = shouldRetry ? new Date(computeNextAttemptMs(nextAttempts)).toISOString() : null;
      await updateQueuedReport(item.id, {
        attempts: nextAttempts,
        status: 'failed',
        isSyncing: false,
        lastError: err?.message || 'Background sync failed',
        nextAttemptAt,
      });
      if (!shouldRetry) {
        console.warn(`[sw-sync] Max attempts reached for ${item.id}`);
      }
    }
  }
  console.info('[sw-sync] Complete');
}

function runProcessQueue() {
  if (queueProcessInFlight) return queueProcessInFlight;
  queueProcessInFlight = processQueue().finally(() => {
    queueProcessInFlight = null;
  });
  return queueProcessInFlight;
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-reports') {
    event.waitUntil(runProcessQueue());
  }
});

self.addEventListener('message', (event) => {
  if (event?.data?.type === 'SYNC_OFFLINE_REPORTS') {
    event.waitUntil(runProcessQueue());
  }
});
