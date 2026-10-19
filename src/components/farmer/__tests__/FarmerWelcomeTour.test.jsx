// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import FarmerWelcomeTour from '../FarmerWelcomeTour';
import { FarmerI18nProvider, useFarmerLanguageState } from '../../../lib/farmerI18n';

function WithLanguage({ children }) {
  const i18n = useFarmerLanguageState();
  return <FarmerI18nProvider value={i18n}>{children}</FarmerI18nProvider>;
}

describe('FarmerWelcomeTour', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('lets the farmer pick a language on the first slide, and the guide follows it', () => {
    render(<WithLanguage><FarmerWelcomeTour userId="farmer-1" /></WithLanguage>);
    expect(screen.getByText('Welcome to KalsaTrack')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Hiligaynon' }));
    expect(screen.getByText('Maayong pag-abot sa KalsaTrack')).toBeTruthy();
    expect(localStorage.getItem('kt-farmer-lang')).toBe('hil');

    fireEvent.click(screen.getByText('Sunod'));          // "Next"
    expect(screen.getByText('Akon Uma')).toBeTruthy();   // "My Farm"
  });

  it('ends with where to change the language later', () => {
    render(<WithLanguage><FarmerWelcomeTour userId="farmer-2" /></WithLanguage>);
    for (let i = 0; i < 7; i += 1) fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Language')).toBeTruthy();
    expect(screen.getByText('Get Started')).toBeTruthy();
  });
});
