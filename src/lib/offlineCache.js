/*
 * offlineCache.js — keep the last good copy of server data on the device, so
 * pages still show something useful with no signal (the farmer portal is used
 * in the field, often out of coverage).
 *
 *   cachedQuery(key, run)  run a Supabase query; on success save the result,
 *                          on failure (offline, timeout) return the saved copy
 *   useOnlineStatus()      true / false, updated on online/offline events
 *
 * Stored in IndexedDB (not localStorage) because project lists with route
 * geometry can be larger than localStorage allows.
 */
import { useEffect, useState } from 'react';

const DB_NAME = 'kalsatrack-offline-cache';
const STORE = 'kv';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
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

export async function cacheGet(key) {
  try {
    return (await withStore('readonly', (s) => s.get(key))) || null;
  } catch {
    return null;
  }
}

export async function cacheSet(key, data) {
  try {
    await withStore('readwrite', (s) => s.put({ data, savedAt: Date.now() }, key));
  } catch {
    /* storage full or unavailable: the app still works online */
  }
}

/**
 * Runs `run()` (which returns a Supabase { data, error } result). Returns
 * { data, fromCache, savedAt }. Throws only when the query failed AND nothing
 * was saved before.
 */
export async function cachedQuery(key, run) {
  try {
    const { data, error } = await run();
    if (error) throw error;
    await cacheSet(key, data);
    return { data, fromCache: false, savedAt: Date.now() };
  } catch (err) {
    const hit = await cacheGet(key);
    if (hit) return { data: hit.data, fromCache: true, savedAt: hit.savedAt };
    throw err;
  }
}

/** True when the browser reports a connection. */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/** A failed request that looks like "no connection", not a real server error. */
export function isConnectionError(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = `${err?.name || ''} ${err?.message || err || ''}`.toLowerCase();
  return /failed to fetch|networkerror|network request failed|load failed|fetch|timeout|retryable/.test(msg);
}

/**
 * The signed-in user. Asks the server first; with no connection it falls back to
 * the session saved on this device, so a signed-in user who opens the app
 * offline is not treated as signed out. Returns { user, offline }.
 */
export async function getCurrentUser(client) {
  try {
    const { data, error } = await client.auth.getUser();
    if (error && isConnectionError(error)) throw error;
    return { user: data?.user || null, offline: false };
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    const { data: { session } } = await client.auth.getSession();
    return { user: session?.user || null, offline: true };
  }
}

// The last role the server confirmed for each account (used when offline).
const ROLE_KEY = (uid) => `kt-role:${uid}`;
export function rememberRole(uid, role) {
  try { if (uid && role) localStorage.setItem(ROLE_KEY(uid), role); } catch { /* ignore */ }
}
export function rememberedRole(uid) {
  try { return uid ? localStorage.getItem(ROLE_KEY(uid)) : null; } catch { return null; }
}

/**
 * Same as cachedQuery, but answers in Supabase's own { data, error } shape, so an
 * existing query only needs wrapping:  await withOfflineCache('key', () => query)
 * `fromCache` is true when the answer is the copy saved on this device.
 */
export async function withOfflineCache(key, run) {
  try {
    const { data, fromCache, savedAt } = await cachedQuery(key, run);
    return { data, error: null, fromCache, savedAt };
  } catch (error) {
    return { data: null, error, fromCache: false };
  }
}
