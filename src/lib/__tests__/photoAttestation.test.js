import { describe, it, expect } from 'vitest';
import { generateAttestationCode, sha256Hex, formatCaptureTime, verificationOrigin } from '../photoAttestation';

describe('photoAttestation', () => {
  it('generates 12-character Crockford codes the database accepts', () => {
    const re = /^[0-9A-HJKMNP-TV-Z]{12}$/;
    for (let i = 0; i < 200; i += 1) expect(generateAttestationCode()).toMatch(re);
  });

  it('does not repeat codes', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateAttestationCode()));
    expect(codes.size).toBe(1000);
  });

  it('fingerprints content with SHA-256', async () => {
    const hash = await sha256Hex(new Blob(['abc']));
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('formats capture time in Philippine time', () => {
    expect(formatCaptureTime('2026-10-12T02:24:05Z')).toBe('Oct 12, 2026, 10:24:05 AM PHT');
  });
});

describe('verificationOrigin', () => {
  it('uses the configured public site so other phones can open the QR', () => {
    expect(verificationOrigin({ VITE_PUBLIC_SITE_URL: 'https://kalsatrack.example/' }, { origin: 'http://localhost:5173', hostname: 'localhost' }))
      .toBe('https://kalsatrack.example');
  });

  it('falls back to the current site when nothing is configured', () => {
    expect(verificationOrigin({}, { origin: 'https://kalsatrack.example', hostname: 'kalsatrack.example' }))
      .toBe('https://kalsatrack.example');
  });
});
