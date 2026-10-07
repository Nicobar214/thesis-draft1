// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { describeGpsError, useGpsLocation } from '../useGpsLocation';

function stubGeolocation(overrides = {}) {
  const geo = {
    getCurrentPosition: vi.fn(),
    watchPosition: vi.fn(() => 42),
    clearWatch: vi.fn(),
    ...overrides,
  };
  Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
  return geo;
}

const position = (lat, lng, accuracy) => ({ coords: { latitude: lat, longitude: lng, accuracy } });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete navigator.geolocation;
});

describe('describeGpsError', () => {
  it('explains each failure in plain words', () => {
    expect(describeGpsError({ code: 1 })).toMatch(/permission denied/i);
    expect(describeGpsError({ code: 3 })).toMatch(/timed out/i);
    expect(describeGpsError({ code: 2, message: 'no satellites' })).toBe('Unable to get your location: no satellites');
  });
});

describe('useGpsLocation', () => {
  it('finds the position on mount and starts watching for drift', () => {
    const geo = stubGeolocation();
    geo.getCurrentPosition.mockImplementation((ok) => ok(position(10, 122, 8)));

    const { result } = renderHook(() => useGpsLocation());

    expect(result.current.gps).toEqual({ lat: 10, lng: 122, accuracy: 8 });
    expect(result.current.gpsLoading).toBe(false);
    expect(result.current.gpsError).toBeNull();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it('follows the watcher as the position drifts', () => {
    let onDrift;
    const geo = stubGeolocation({ watchPosition: vi.fn((ok) => { onDrift = ok; return 7; }) });
    geo.getCurrentPosition.mockImplementation((ok) => ok(position(10, 122, 8)));
    const { result } = renderHook(() => useGpsLocation());

    act(() => onDrift(position(10.001, 122.001, 5)));

    expect(result.current.gps).toEqual({ lat: 10.001, lng: 122.001, accuracy: 5 });
  });

  it('stops watching when the form goes away', () => {
    const geo = stubGeolocation();
    geo.getCurrentPosition.mockImplementation((ok) => ok(position(10, 122, 8)));
    const { unmount } = renderHook(() => useGpsLocation());

    unmount();

    expect(geo.clearWatch).toHaveBeenCalledWith(42);
  });

  it('reports a denied permission and stops loading', () => {
    const geo = stubGeolocation();
    geo.getCurrentPosition.mockImplementation((_ok, fail) => fail({ code: 1, message: 'denied' }));

    const { result } = renderHook(() => useGpsLocation());

    expect(result.current.gps).toBeNull();
    expect(result.current.gpsLoading).toBe(false);
    expect(result.current.gpsError).toMatch(/permission denied/i);
  });

  it('can try again after a failure', () => {
    const geo = stubGeolocation();
    geo.getCurrentPosition.mockImplementationOnce((_ok, fail) => fail({ code: 3 }));
    const { result } = renderHook(() => useGpsLocation());
    expect(result.current.gpsError).toMatch(/timed out/i);

    geo.getCurrentPosition.mockImplementation((ok) => ok(position(10, 122, 9)));
    act(() => result.current.acquireGps());

    expect(result.current.gps).toEqual({ lat: 10, lng: 122, accuracy: 9 });
    expect(result.current.gpsError).toBeNull();
  });

  it('replaces the old watcher instead of stacking a second one', () => {
    const geo = stubGeolocation({ watchPosition: vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(2) });
    geo.getCurrentPosition.mockImplementation((ok) => ok(position(10, 122, 8)));
    const { result } = renderHook(() => useGpsLocation());

    act(() => result.current.acquireGps());

    expect(geo.clearWatch).toHaveBeenCalledWith(1);
  });

  it('says so when the browser has no geolocation at all', () => {
    // navigator.geolocation is left undefined
    const { result } = renderHook(() => useGpsLocation());
    expect(result.current.gpsLoading).toBe(false);
    expect(result.current.gpsError).toMatch(/not supported/i);
  });

  it('only admits the fix is slow after five seconds', () => {
    vi.useFakeTimers();
    stubGeolocation(); // never answers
    const { result } = renderHook(() => useGpsLocation());
    expect(result.current.gpsLoading).toBe(true);
    expect(result.current.gpsSlow).toBe(false);

    act(() => { vi.advanceTimersByTime(4900); });
    expect(result.current.gpsSlow).toBe(false);

    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current.gpsSlow).toBe(true);
  });

  it('forgets the position on reset and shows loading until restarted', () => {
    const geo = stubGeolocation();
    geo.getCurrentPosition.mockImplementation((ok) => ok(position(10, 122, 8)));
    const { result } = renderHook(() => useGpsLocation());

    act(() => result.current.resetGps());

    expect(result.current.gps).toBeNull();
    expect(result.current.gpsLoading).toBe(true);
    expect(geo.clearWatch).toHaveBeenCalledWith(42);
  });
});
