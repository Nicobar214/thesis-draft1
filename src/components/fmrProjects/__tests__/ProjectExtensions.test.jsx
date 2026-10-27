// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ProjectExtensions from '../ProjectExtensions';

afterEach(cleanup);

const natureRow = {
  extended_on: '2026-10-28', previous_target: '2026-10-27', new_target: '2026-11-02', days_added: 6,
  da_reason: null, contractor_cause: 'act_of_nature', contractor_explanation: 'The project was hit by the typhoon.',
  evidence_count: 3, kind: 'act_of_nature', offense_no: 2, event_name: 'Typhoon Kristine', stopped_days: 5,
  document_count: 2, photo_count: 1, field_check: 'confirmed', checked_by: 'Engr. Jewel Von Limsiaco',
};
const photo = { extension_no: 1, kind: 'photo', storage_path: 'c1/1-photo.jpg', file_name: 'photo.jpg', mime_type: 'image/jpeg' };

function fakeClient() {
  return {
    rpc: vi.fn(async (fn) => (fn === 'project_extension_history' ? { data: [natureRow], error: null } : { data: [photo], error: null })),
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
  };
}

describe('ProjectExtensions (public)', () => {
  it('an act of nature: the documents are counted and kept private, only the photos can be opened', async () => {
    render(<ProjectExtensions projectId={347} client={fakeClient()} />);
    expect(await screen.findByText(/Act of nature: Typhoon Kristine, 5 days work stopped/)).toBeTruthy();
    expect(screen.getByText(/2 official documents checked by the DA \(kept private\)/)).toBeTruthy();
    expect(screen.getByText(/Site confirmed by Engr\. Jewel Von Limsiaco/)).toBeTruthy();
    expect(await screen.findByRole('button', { name: /View 1 photo/ })).toBeTruthy();
    expect(screen.queryByText(/3 evidence/)).toBeNull();
  });
});
