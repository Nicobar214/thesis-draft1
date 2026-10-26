// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { isStraightLine, roadsToAlign, useRoadAlignedLines } from '../useRoadAlignedLines';

const line = (id, points) => ({ project: { id }, points });
const me = [10.78, 122.39];

describe('roadsToAlign', () => {
  it('picks only pin-to-pin roads near the user, nearest first', () => {
    const lines = [
      line(1, [[10.79, 122.39], [10.79, 122.40]]),               // ~1.1 km away
      line(2, [[10.781, 122.385], [10.781, 122.395]]),           // ~110 m away
      line(3, [[10.781, 122.38], [10.781, 122.385], [10.781, 122.39]]), // mapped route: left alone
      line(4, [[11.5, 122.39], [11.5, 122.40]]),                 // ~80 km away
    ];
    expect(roadsToAlign(lines, me)).toEqual([2, 1]);
    expect(roadsToAlign(lines, null)).toEqual([]);
    expect(isStraightLine(lines[2].points)).toBe(false);
  });
});

describe('useRoadAlignedLines', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('replaces a nearby straight line with the road between its pins', async () => {
    const road = [[10.781, 122.385], [10.7825, 122.39], [10.781, 122.395]];
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ routes: [{ geometry: { coordinates: road.map(([la, ln]) => [ln, la]) } }] }),
    })));
    const lines = [line(2, [[10.781, 122.385], [10.781, 122.395]])];
    const { result } = renderHook(() => useRoadAlignedLines(lines, me));
    expect(result.current[0].aligned).toBeUndefined();
    await waitFor(() => expect(result.current[0].aligned).toBe(true));
    expect(result.current[0].points).toEqual(road);
  });
});
