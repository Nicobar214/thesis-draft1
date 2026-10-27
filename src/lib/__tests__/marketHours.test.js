import { describe, it, expect } from 'vitest';
import { DAYS, formatDays, formatHours, formatTime, parseDays, parseHours } from '../marketHours';

describe('market days', () => {
  it('writes the picked days the short way', () => {
    expect(formatDays(DAYS)).toBe('Daily');
    expect(formatDays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])).toBe('Mon-Sat');
    expect(formatDays(['Fri', 'Mon', 'Wed'])).toBe('Mon, Wed, Fri');
    expect(formatDays(['Mon', 'Tue', 'Thu', 'Fri', 'Sat'])).toBe('Mon, Tue, Thu-Sat');
    expect(formatDays([])).toBe('');
  });

  it('reads back what it wrote, and common hand-typed forms', () => {
    expect(parseDays('Mon-Sat')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(parseDays('Daily')).toEqual(DAYS);
    expect(parseDays('Everyday')).toEqual(DAYS);
    expect(parseDays('Monday to Friday')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    expect(parseDays('Mon, Wed, Fri')).toEqual(['Mon', 'Wed', 'Fri']);
    expect(parseDays('Tue & Sat')).toEqual(['Tue', 'Sat']);
    expect(parseDays('')).toEqual([]);
  });

  it('says when it cannot read the text (so the form keeps it as typed)', () => {
    expect(parseDays('Market days only')).toBeNull();
  });
});

describe('market hours', () => {
  it('writes times the way people say them', () => {
    expect(formatTime('05:00')).toBe('5:00 AM');
    expect(formatTime('18:30')).toBe('6:30 PM');
    expect(formatTime('12:00')).toBe('12:00 NN');
    expect(formatTime('00:00')).toBe('12:00 MN');
    expect(formatHours({ open: '05:00', close: '18:00' })).toBe('5:00 AM - 6:00 PM');
    expect(formatHours({ allDay: true })).toBe('Open 24 hours');
    expect(formatHours({ open: '', close: '' })).toBe('');
  });

  it('reads back saved and hand-typed hours', () => {
    expect(parseHours('5:00 AM - 6:00 PM')).toEqual({ open: '05:00', close: '18:00', allDay: false });
    expect(parseHours('4 am to 12 nn')).toEqual({ open: '04:00', close: '12:00', allDay: false });
    expect(parseHours('Open 24 hours')).toEqual({ open: '', close: '', allDay: true });
    expect(parseHours('')).toEqual({ open: '', close: '', allDay: false });
    expect(parseHours('mornings')).toBeNull();
  });
});
