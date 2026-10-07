import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The sync code talks to Supabase; replace it with a controllable stand-in.
const mocks = vi.hoisted(() => {
  const upload = vi.fn();
  const getPublicUrl = vi.fn();
  const insert = vi.fn();
  return {
    upload,
    getPublicUrl,
    insert,
    supabase: {
      storage: { from: () => ({ upload, getPublicUrl }) },
      from: () => ({ insert }),
    },
  };
});
vi.mock('../supabase', () => ({ supabase: mocks.supabase }));

import {
  enqueueReport,
  getQueuedReports,
  loadCachedProjects,
  removeQueuedReport,
  saveCachedProjects,
  updateQueuedReport,
} from '../offlineReports';
import { requestBackgroundSync, syncQueuedReports, triggerQueuedSync } from '../offlineSync';

beforeAll(() => {
  // The queue logs window.location.origin; there is no window in Node.
  globalThis.window = { location: { origin: 'http://localhost' } };
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  mocks.upload.mockReset().mockResolvedValue({ error: null });
  mocks.getPublicUrl.mockReset().mockReturnValue({ data: { publicUrl: 'https://cdn.test/photo.jpg' } });
  mocks.insert.mockReset().mockResolvedValue({ error: null });
});

afterEach(async () => {
  // Start every test with an empty queue.
  for (const item of await getQueuedReports()) await removeQueuedReport(item.id);
  vi.unstubAllGlobals();
});

const payload = { description: 'Pothole', project_id: 'fmr-1' };
const photo = () => new Blob(['jpeg-bytes'], { type: 'image/jpeg' });

describe('saving a report while offline', () => {
  it('keeps the report, the photo and the sign-in token for later', async () => {
    const saved = await enqueueReport(payload, photo(), { photoPath: 'reports/a.jpg', authToken: 'tok' });

    const [stored] = await getQueuedReports();
    expect(stored.id).toBe(saved.id);
    expect(stored.payload).toEqual(payload);
    expect(stored.photoPath).toBe('reports/a.jpg');
    expect(stored.authToken).toBe('tok');
    expect(stored.status).toBe('pending');
    expect(stored.attempts).toBe(0);
    expect(stored.photoBlob.size).toBe('jpeg-bytes'.length);
  });

  it('keeps several reports side by side', async () => {
    await enqueueReport(payload, photo());
    await enqueueReport({ ...payload, description: 'Second' }, photo());
    expect(await getQueuedReports()).toHaveLength(2);
  });

  it('can update and remove a queued report', async () => {
    const { id } = await enqueueReport(payload, photo());
    await updateQueuedReport(id, { attempts: 3 });
    expect((await getQueuedReports())[0].attempts).toBe(3);

    await removeQueuedReport(id);
    expect(await getQueuedReports()).toHaveLength(0);
  });

  it('returns null when updating a report that no longer exists', async () => {
    expect(await updateQueuedReport('missing', { attempts: 1 })).toBeNull();
  });
});

describe('the offline project cache', () => {
  it('stores and returns the project list', async () => {
    await saveCachedProjects([{ id: 1 }, { id: 2 }]);
    const cached = await loadCachedProjects();
    expect(cached.data).toEqual([{ id: 1 }, { id: 2 }]);
    expect(cached.updatedAt).toBeTruthy();
  });
});

describe('syncing queued reports when back online', () => {
  it('uploads the photo, saves the report with its photo link, and clears the queue', async () => {
    await enqueueReport(payload, photo(), { photoPath: 'reports/a.jpg' });

    const result = await syncQueuedReports();

    expect(result).toEqual({ processed: 1, success: 1, failed: 0 });
    expect(mocks.upload).toHaveBeenCalledWith('reports/a.jpg', expect.anything(), expect.objectContaining({ contentType: 'image/jpeg' }));
    expect(mocks.insert).toHaveBeenCalledWith({ ...payload, photo_url: 'https://cdn.test/photo.jpg' });
    expect(await getQueuedReports()).toHaveLength(0);
  });

  it('does nothing when the queue is empty', async () => {
    expect(await syncQueuedReports()).toEqual({ processed: 0, success: 0, failed: 0 });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('keeps a failed report, counts the attempt, and schedules a retry', async () => {
    mocks.insert.mockResolvedValue({ error: new Error('server unavailable') });
    await enqueueReport(payload, photo(), { photoPath: 'reports/a.jpg' });

    const result = await syncQueuedReports();

    expect(result).toEqual({ processed: 1, success: 0, failed: 1 });
    const [item] = await getQueuedReports();
    expect(item.attempts).toBe(1);
    expect(item.status).toBe('failed');
    expect(item.isSyncing).toBe(false);
    expect(item.lastError).toBe('server unavailable');
    expect(new Date(item.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('keeps the report if the photo upload fails, without saving a report that has no photo', async () => {
    mocks.upload.mockResolvedValue({ error: new Error('storage full') });
    await enqueueReport(payload, photo(), { photoPath: 'reports/a.jpg' });

    await syncQueuedReports();

    expect(mocks.insert).not.toHaveBeenCalled();
    expect((await getQueuedReports())[0].lastError).toBe('storage full');
  });

  it('waits for the retry time instead of hammering the server', async () => {
    const soon = new Date(Date.now() + 60_000).toISOString();
    await enqueueReport(payload, photo(), { nextAttemptAt: soon, attempts: 1, status: 'failed' });

    const result = await syncQueuedReports();

    expect(result.processed).toBe(0);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('retries once the wait is over', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    await enqueueReport(payload, photo(), { nextAttemptAt: past, attempts: 1, status: 'failed' });

    const result = await syncQueuedReports();

    expect(result.success).toBe(1);
  });

  it('gives up after five failed attempts and stops retrying', async () => {
    mocks.insert.mockResolvedValue({ error: new Error('still broken') });
    await enqueueReport(payload, photo(), { attempts: 4, status: 'failed' });

    await syncQueuedReports(); // the fifth attempt

    const [item] = await getQueuedReports();
    expect(item.attempts).toBe(5);
    expect(item.nextAttemptAt).toBeNull();

    mocks.upload.mockClear();
    const again = await syncQueuedReports();
    expect(again.processed).toBe(0);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('skips a report that another tab is already sending', async () => {
    await enqueueReport(payload, photo(), { isSyncing: true });
    expect((await syncQueuedReports()).processed).toBe(0);
  });

  it('sends each report once even if sync is triggered twice at the same moment', async () => {
    await enqueueReport(payload, photo(), { photoPath: 'reports/a.jpg' });

    const [first, second] = await Promise.all([syncQueuedReports(), syncQueuedReports()]);

    expect(first).toEqual(second); // both callers get the same run
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it('sends the other reports even when one fails', async () => {
    mocks.insert
      .mockResolvedValueOnce({ error: new Error('bad row') })
      .mockResolvedValueOnce({ error: null });
    await enqueueReport({ ...payload, description: 'first' }, photo(), { photoPath: 'reports/1.jpg' });
    await enqueueReport({ ...payload, description: 'second' }, photo(), { photoPath: 'reports/2.jpg' });

    const result = await syncQueuedReports();

    expect(result).toEqual({ processed: 2, success: 1, failed: 1 });
    expect(await getQueuedReports()).toHaveLength(1);
  });
});

describe('deciding when to sync', () => {
  it('does not try to sync while offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(await triggerQueuedSync()).toEqual({ scheduled: false, skipped: true });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('syncs directly when there is no background-sync service worker', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    await enqueueReport(payload, photo(), { photoPath: 'reports/a.jpg' });

    const result = await triggerQueuedSync();

    expect(result.success).toBe(1);
  });

  it('reports that background sync is unavailable without a service worker', async () => {
    vi.stubGlobal('navigator', {});
    expect(await requestBackgroundSync()).toBe(false);
  });

  it('reports that background sync is unavailable before a worker takes control', async () => {
    vi.stubGlobal('navigator', { serviceWorker: { controller: null } });
    expect(await requestBackgroundSync()).toBe(false);
  });
});
