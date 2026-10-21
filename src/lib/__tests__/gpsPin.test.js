import { describe, it, expect } from 'vitest';
import { pickBetterFix } from '../useGpsLocation';

describe('pickBetterFix', () => {
  it('keeps a sharp fix when a rougher one arrives', () => {
    const sharp = { lat: 10.7, lng: 122.5, accuracy: 12, at: 1000 };
    const rough = { lat: 10.701, lng: 122.501, accuracy: 160, at: 2000 };
    expect(pickBetterFix(sharp, rough, 2000)).toBe(sharp);
  });

  it('takes a sharper fix, and any fix once the current one is old', () => {
    const rough = { lat: 10.7, lng: 122.5, accuracy: 160, at: 0 };
    const sharp = { lat: 10.7001, lng: 122.5001, accuracy: 15, at: 500 };
    expect(pickBetterFix(rough, sharp, 500)).toBe(sharp);
    const later = { lat: 10.71, lng: 122.51, accuracy: 40, at: 40000 };
    expect(pickBetterFix(sharp, later, 40000)).toBe(later);
  });
});
