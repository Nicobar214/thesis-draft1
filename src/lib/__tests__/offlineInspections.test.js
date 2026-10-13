import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
vi.mock('../../services/publicReportWorkflow', () => ({
  startPublicReportInspection: vi.fn(async () => { calls.push('start'); }),
  submitPublicReportInspection: vi.fn(async () => { calls.push('submit'); }),
}));
vi.mock('../photoAttestation', () => ({
  registerAttestation: vi.fn(async () => { calls.push('attest'); }),
}));

import { sendInspection } from '../offlineInspections';
import { startPublicReportInspection, submitPublicReportInspection } from '../../services/publicReportWorkflow';

function fakeClient({ uploadError = null } = {}) {
  return {
    storage: {
      from: () => ({
        upload: vi.fn(async () => { calls.push('upload'); return { error: uploadError }; }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://x/photo.jpg' } }),
      }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }),
      insert: async () => ({ error: null }),
    }),
  };
}

const item = (extra = {}) => ({
  report: { id: 'r1', user_id: null },
  findings: { conditionObserved: 'Potholes', recommendedAction: 'Patch', siteRating: 3, certified: true, estimatedCostRange: '' },
  photoBlob: new Blob(['x'], { type: 'image/jpeg' }),
  photoExt: 'jpg',
  geo: { latitude: 10.9, longitude: 122.4, accuracy: 8 },
  attestation: null,
  ...extra,
});

describe('sendInspection', () => {
  beforeEach(() => { calls.length = 0; vi.clearAllMocks(); });

  it('uploads, registers the stamp, then submits through the RPC', async () => {
    await sendInspection(fakeClient(), item());
    expect(calls).toEqual(['upload', 'attest', 'submit']);
    expect(startPublicReportInspection).not.toHaveBeenCalled();
    expect(submitPublicReportInspection.mock.calls[0][1]).toMatchObject({
      reportId: 'r1', fieldPhotoUrl: 'https://x/photo.jpg', latitude: 10.9, gpsAccuracyMeters: 8, estimatedCostRange: null,
    });
  });

  it('opens the inspection first when it was started offline', async () => {
    await sendInspection(fakeClient(), item({ needsStart: true }));
    expect(calls[0]).toBe('start');
    expect(calls.at(-1)).toBe('submit');
  });

  it('still submits when the inspection was already opened by an earlier attempt', async () => {
    startPublicReportInspection.mockRejectedValueOnce(new Error('Inspection already in progress'));
    await sendInspection(fakeClient(), item({ needsStart: true }));
    expect(submitPublicReportInspection).toHaveBeenCalledTimes(1);
  });

  it('stops on a dropped connection so the item stays queued', async () => {
    await expect(sendInspection(fakeClient({ uploadError: { message: 'Failed to fetch' } }), item()))
      .rejects.toMatchObject({ message: 'Failed to fetch' });
    expect(submitPublicReportInspection).not.toHaveBeenCalled();
  });
});
