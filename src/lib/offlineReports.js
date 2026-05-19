const DB_NAME = 'kalsatrack-offline';
const DB_VERSION = 2;
const REPORT_STORE = 'reportQueue';
const ENGINEER_STORE = 'engineerQueue';
const PROJECT_STORE = 'cachedProjects';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(REPORT_STORE)) {
        db.createObjectStore(REPORT_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ENGINEER_STORE)) {
        db.createObjectStore(ENGINEER_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function createReportId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function withStore(storeName, mode, handler) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = handler(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function readAllFromStore(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const results = [];
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      }
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(results);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function enqueueReport(payload, photoBlob, options = {}) {
  const nowIso = new Date().toISOString();
  const id = options.id || createReportId();
  const record = {
    id,
    payload,
    photoBlob,
    photoPath: options.photoPath || null,
    authToken: options.authToken || null,
    createdAt: options.createdAt || nowIso,
    updatedAt: nowIso,
    status: options.status || 'pending',
    nextAttemptAt: options.nextAttemptAt || null,
    isSyncing: options.isSyncing || false,
    attempts: options.attempts || 0,
    lastError: options.lastError || null,
  };
  await withStore(REPORT_STORE, 'readwrite', (store) => store.put(record));
  const stored = await withStore(REPORT_STORE, 'readonly', (store) => store.get(id));
  console.info('[offline-report] Queue verify', { id, stored: !!stored, origin: window.location.origin });
  return record;
}

export async function enqueueEngineerUpdate(action, options = {}) {
  const nowIso = new Date().toISOString();
  const id = options.id || createReportId();
  const record = {
    id,
    type: action.type,
    reportId: action.reportId,
    engineerId: action.engineerId,
    payload: action.payload,
    activity: action.activity || null,
    notifications: action.notifications || null,
    createdAt: options.createdAt || nowIso,
    updatedAt: nowIso,
    status: options.status || 'pending',
    nextAttemptAt: options.nextAttemptAt || null,
    isSyncing: options.isSyncing || false,
    attempts: options.attempts || 0,
    lastError: options.lastError || null,
  };
  await withStore(ENGINEER_STORE, 'readwrite', (store) => store.put(record));
  const stored = await withStore(ENGINEER_STORE, 'readonly', (store) => store.get(id));
  console.info('[fe-offline] Queue verify', { id, stored: !!stored, origin: window.location.origin });
  return record;
}

export async function getQueuedReports() {
  let list = [];
  try {
    list = await readAllFromStore(REPORT_STORE);
  } catch (err) {
    console.warn('[offline-report] Queue read failed', err);
    list = [];
  }
  console.info('[offline-report] Queue read', { count: list.length, origin: window.location.origin });
  const nowIso = new Date().toISOString();
  const needsUpdate = list.filter((item) => (
    item && (
      item.status === undefined ||
      item.isSyncing === undefined ||
      item.updatedAt === undefined ||
      item.nextAttemptAt === undefined
    )
  ));

  if (needsUpdate.length > 0) {
    await Promise.all(needsUpdate.map((item) => updateQueuedReport(item.id, {
      status: item.status || 'pending',
      isSyncing: item.isSyncing ?? false,
      updatedAt: item.updatedAt || nowIso,
      nextAttemptAt: item.nextAttemptAt ?? null,
    })));
  }

  return list;
}

export async function getQueuedEngineerUpdates() {
  let list = [];
  try {
    list = await readAllFromStore(ENGINEER_STORE);
  } catch (err) {
    console.warn('[fe-offline] Queue read failed', err);
    list = [];
  }
  console.info('[fe-offline] Queue read', { count: list.length, origin: window.location.origin });
  const nowIso = new Date().toISOString();
  const needsUpdate = list.filter((item) => (
    item && (
      item.status === undefined ||
      item.isSyncing === undefined ||
      item.updatedAt === undefined ||
      item.nextAttemptAt === undefined
    )
  ));

  if (needsUpdate.length > 0) {
    await Promise.all(needsUpdate.map((item) => updateQueuedEngineerUpdate(item.id, {
      status: item.status || 'pending',
      isSyncing: item.isSyncing ?? false,
      updatedAt: item.updatedAt || nowIso,
      nextAttemptAt: item.nextAttemptAt ?? null,
    })));
  }

  return list;
}

export async function updateQueuedReport(id, patch) {
  return withStore(REPORT_STORE, 'readwrite', (store) => new Promise((resolve, reject) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const current = getReq.result;
      if (!current) {
        resolve(null);
        return;
      }
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
      const putReq = store.put(next);
      putReq.onsuccess = () => resolve(next);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  }));
}

export async function updateQueuedEngineerUpdate(id, patch) {
  return withStore(ENGINEER_STORE, 'readwrite', (store) => new Promise((resolve, reject) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const current = getReq.result;
      if (!current) {
        resolve(null);
        return;
      }
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
      const putReq = store.put(next);
      putReq.onsuccess = () => resolve(next);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  }));
}

export async function removeQueuedReport(id) {
  return withStore(REPORT_STORE, 'readwrite', (store) => store.delete(id));
}

export async function removeQueuedEngineerUpdate(id) {
  return withStore(ENGINEER_STORE, 'readwrite', (store) => store.delete(id));
}

export async function saveCachedProjects(projects) {
  const record = {
    key: 'fmr_projects',
    updatedAt: new Date().toISOString(),
    data: projects || [],
  };
  await withStore(PROJECT_STORE, 'readwrite', (store) => store.put(record));
  return record;
}

export async function loadCachedProjects() {
  return withStore(PROJECT_STORE, 'readonly', (store) => store.get('fmr_projects'));
}
