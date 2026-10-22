import { describe, it, expect } from 'vitest';
import { lowerKeepAcronyms } from '../textCase';

describe('lowerKeepAcronyms', () => {
  it('keeps acronyms and lowercases ordinary words', () => {
    expect(lowerKeepAcronyms('DA FMR Project')).toBe('DA FMR project');
    expect(lowerKeepAcronyms('LGU Municipality')).toBe('LGU municipality');
    expect(lowerKeepAcronyms('Contract Amount')).toBe('contract amount');
    expect(lowerKeepAcronyms('(DA-RAED) Region')).toBe('(DA-RAED) region');
  });
  it('lowercases a single capitalised word', () => {
    expect(lowerKeepAcronyms('Status')).toBe('status');
    expect(lowerKeepAcronyms(null)).toBe('');
  });
});
