import { describe, it, expect, vi } from 'vitest';

vi.mock('../photoAttestation', () => ({ registerAttestation: vi.fn(async () => true) }));
import { registerAttestation } from '../photoAttestation';
import { EVIDENCE_MAX_BYTES, evidenceSummary, fileProblem, uploadEvidence } from '../evidence';

const file = (name, type, size = 1000) => ({ name, type, size });

describe('supporting evidence', () => {
  it('accepts photos and PDFs up to 10 MB only', () => {
    expect(fileProblem(file('a.jpg', 'image/jpeg'))).toBeNull();
    expect(fileProblem(file('a.pdf', 'application/pdf'))).toBeNull();
    expect(fileProblem(file('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toMatch(/not a photo/);
    expect(fileProblem(file('big.jpg', 'image/jpeg', EVIDENCE_MAX_BYTES + 1))).toMatch(/10 MB/);
  });

  it('summarises what is attached', () => {
    expect(evidenceSummary([{ kind: 'photo' }, { kind: 'photo' }, { kind: 'file' }])).toBe('2 photos, 1 file');
    expect(evidenceSummary([])).toBe('None');
  });

  it('uploads every item, registers camera photos, and returns what to store', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const client = { storage: { from: () => ({ upload, remove: vi.fn() }) } };
    const attestation = { code: 'ABCDEFGHJKMN', latitude: 10.7, longitude: 122.3, accuracy: 6, capturedAt: '2026-10-27T01:00:00Z' };
    const rows = await uploadEvidence(client, {
      bucket: 'delay-evidence',
      prefix: 'case-1',
      items: [
        { kind: 'photo', name: 'Camera photo.jpg', file: file('x.jpg', 'image/jpeg'), attestation },
        { kind: 'file', name: 'Delivery receipt.pdf', file: file('r.pdf', 'application/pdf') },
      ],
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(rows[0]).toMatchObject({ kind: 'photo', latitude: 10.7, accuracy_m: 6, attestation_code: 'ABCDEFGHJKMN' });
    expect(rows[0].storage_path).toMatch(/^case-1\/\d+-1-Camera-photo\.jpg$/);
    expect(rows[1]).toMatchObject({ kind: 'file', file_name: 'Delivery receipt.pdf', latitude: null });
    expect(registerAttestation).toHaveBeenCalledTimes(1);
  });

  it('removes what it uploaded when a later upload fails', async () => {
    const remove = vi.fn(async () => ({}));
    const upload = vi.fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error('network down') });
    const client = { storage: { from: () => ({ upload, remove }) } };
    await expect(uploadEvidence(client, {
      bucket: 'b', prefix: 'p',
      items: [{ kind: 'file', name: 'one.pdf', file: file('one.pdf', 'application/pdf') }, { kind: 'file', name: 'two.pdf', file: file('two.pdf', 'application/pdf') }],
    })).rejects.toThrow('network down');
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(/^p\/\d+-1-one\.pdf$/)]);
  });
});
