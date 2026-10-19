import { describe, it, expect } from 'vitest';
import { translate, missingTranslations, FARMER_LANGUAGES } from '../farmerI18n';

describe('farmerI18n', () => {
  it('has every English text in Hiligaynon and Tagalog', () => {
    expect(missingTranslations()).toEqual({ hil: [], tl: [] });
  });

  it('translates and fills in values', () => {
    expect(translate('hil', 'nav.myFarm')).toBe('Akon Uma');
    expect(translate('tl', 'nav.myFarm')).toBe('Aking Bukid');
    expect(translate('en', 'banner.waiting', { n: 3 })).toBe('3 waiting to send.');
  });

  it('falls back to English, then to the key', () => {
    expect(translate('xx', 'nav.harvest')).toBe('Harvest');
    expect(translate('hil', 'no.such.key')).toBe('no.such.key');
  });

  it('offers the three languages', () => {
    expect(FARMER_LANGUAGES.map((l) => l.code)).toEqual(['en', 'hil', 'tl']);
  });
});
