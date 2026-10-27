import { describe, it, expect } from 'vitest';
import { groupMobile, mobileHint, mobileLocalPart, toE164Mobile } from '../phMobile';

describe('Philippine mobile numbers', () => {
  it('keeps only the 10 digits after +63, whatever was typed or pasted', () => {
    expect(mobileLocalPart('09123456789')).toBe('9123456789');
    expect(mobileLocalPart('+63 912 345 6789')).toBe('9123456789');
    expect(mobileLocalPart('639123456789')).toBe('9123456789');
    expect(mobileLocalPart('912-345-6789')).toBe('9123456789');
    expect(mobileLocalPart('912345678999')).toBe('9123456789'); // stops at 10
    expect(mobileLocalPart('abc')).toBe('');
  });

  it('saves a complete number as +63 plus 10 digits (12 digits)', () => {
    expect(toE164Mobile('9123456789')).toBe('+639123456789');
    expect(toE164Mobile('912345678')).toBe('');
    expect(toE164Mobile('8123456789')).toBe('');
  });

  it('gives a friendly note while typing', () => {
    expect(mobileHint('')).toBeNull();
    expect(mobileHint('812')).toMatchObject({ tone: 'error' });
    expect(mobileHint('91234567')).toEqual({ tone: 'hint', text: 'Almost there: 2 more digits to go.' });
    expect(mobileHint('912345678')).toEqual({ tone: 'hint', text: 'Almost there: 1 more digit to go.' });
    expect(mobileHint('9123456789')).toMatchObject({ tone: 'ok' });
  });

  it('groups the digits for showing', () => {
    expect(groupMobile('9123456789')).toBe('912 345 6789');
    expect(groupMobile('9123')).toBe('912 3');
  });
});
