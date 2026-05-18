import { supabase } from './supabase';
import { getQueuedReports, removeQueuedReport, updateQueuedReport } from './offlineReports';

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 5000;
const MAX_DELAY_MS = 5 * 60 * 1000;
let syncInFlight = null;
const SW_READY_TIMEOUT_MS = 1500;

function buildPhotoPath(id) {
  return `reports/${Date.now()}_${id}.jpg`;
}

async function uploadQueuedPhoto(item) {
  const path = item.photoPath || buildPhotoPath(item.id);
  const { error: uploadError } = await supabase
    .storage
    .from('public-report-photos')
    .upload(path, item.photoBlob, { contentType: 'image/jpeg', upsert: true });

  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage.from('public-report-photos').getPublicUrl(path);
  return { path, publicUrl: urlData.publicUrl };
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

export async function syncQueuedReports() {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    console.info('[offline-sync] syncQueuedReports invoked');
    let queued = [];
    try {
      const result = await getQueuedReports();
      queued = Array.isArray(result) ? result : [];
    } catch (err) {
      console.warn('[offline-sync] Failed to read queue', err);
      queued = [];
    }

    console.info(`[offline-sync] Queue size: ${queued.length}`);

    const pending = queued.filter(canAttemptSync);
    if (pending.length === 0) {
      if (queued.length > 0) {
        const snapshot = queued.map((item) => ({
          id: item?.id,
          status: item?.status,
          isSyncing: item?.isSyncing,
          attempts: item?.attempts,
          nextAttemptAt: item?.nextAttemptAt,
        }));
        console.info('[offline-sync] Queue snapshot', snapshot);
      }
      console.info('[offline-sync] No pending items');
      return { processed: 0, success: 0, failed: 0 };
    }

    console.info(`[offline-sync] Sync start: ${pending.length} queued`);
    let success = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        await updateQueuedReport(item.id, { isSyncing: true, status: 'pending' });
        console.info(`[offline-sync] Sending report ${item.id}`);

        const upload = await uploadQueuedPhoto(item);
        const payload = { ...item.payload, photo_url: upload.publicUrl };

        const { error: insertError } = await supabase
          .from('public_reports')
          .insert(payload);

        if (insertError) throw insertError;

        await updateQueuedReport(item.id, { status: 'synced', isSyncing: false, lastError: null });
        await removeQueuedReport(item.id);
        success += 1;
      } catch (err) {
        const nextAttempts = (item.attempts || 0) + 1;
        const shouldRetry = nextAttempts < MAX_ATTEMPTS;
        const nextAttemptAt = shouldRetry ? new Date(computeNextAttemptMs(nextAttempts)).toISOString() : null;
        failed += 1;
        await updateQueuedReport(item.id, {
          attempts: nextAttempts,
          status: 'failed',
          isSyncing: false,
          lastError: err?.message || 'Sync failed',
          nextAttemptAt,
        });
        if (!shouldRetry) {
          console.warn(`[offline-sync] Max attempts reached for ${item.id}`);
        }
      }
    }

    console.info(`[offline-sync] Sync complete: ${success} success, ${failed} failed`);
    return { processed: pending.length, success, failed };
  })().finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}

export async function requestBackgroundSync() {
  if (!('serviceWorker' in navigator)) return false;

  if (!navigator.serviceWorker.controller) {
    console.info('[offline-sync] No active service worker controller');
    return false;
  }

  try {
    const readyPromise = navigator.serviceWorker.ready;
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS);
    });
    const registration = await Promise.race([readyPromise, timeoutPromise]);
    if (!registration) {
      console.info('[offline-sync] Service worker ready timeout');
      return false;
    }
    if ('sync' in registration) {
      await registration.sync.register('sync-offline-reports');
    }
    if (registration.active) {
      registration.active.postMessage({ type: 'SYNC_OFFLINE_REPORTS' });
    }
    return true;
  } catch {
    return false;
  }
}

export async function triggerQueuedSync() {
  if (!navigator.onLine) {
    console.info('[offline-sync] Offline - sync skipped');
    return { scheduled: false, skipped: true };
  }
  console.info('[offline-sync] Triggering sync');
  const scheduled = await requestBackgroundSync();
  if (scheduled) {
    console.info('[offline-sync] Background sync scheduled');
    return { scheduled: true };
  }
  return syncQueuedReports();
}
