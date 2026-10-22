import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  connectToPins, fetchRoadAlignedPolyline, maxDeviationMeters, removeRouteSpikes, smoothRouteCorners,
} from '../mapRouteUtils';

// ~11 m per 0.0001 deg of latitude near Iloilo.
const north = (m) => m / 111320;
const line = (...metres) => metres.map((m) => [10.78 + north(m), 122.39]);

describe('removeRouteSpikes', () => {
  it('cuts an out-and-back spike and keeps the road on both sides', () => {
    // Road east, a 60 m detour north to a via-point and back, road continues east.
    const pts = [[10.78, 122.39], [10.78, 122.3905], [10.78 + north(60), 122.3905], [10.78, 122.3905], [10.78, 122.391]];
    expect(removeRouteSpikes(pts)).toEqual([[10.78, 122.39], [10.78, 122.3905], [10.78, 122.391]]);
  });

  it('leaves a straight road alone', () => {
    const pts = line(0, 100, 200, 300, 400);
    expect(removeRouteSpikes(pts)).toEqual(pts);
  });

  it('keeps every vertex of a densely sampled road', () => {
    const pts = line(0, 4, 8, 12, 16, 20, 24, 28);
    expect(removeRouteSpikes(pts)).toEqual(pts);
  });

  it('does not cut a long genuine loop', () => {
    // Out 1 km and back: longer than a spike can be, so it is real road.
    const pts = line(0, 250, 500, 750, 1000, 750, 500, 250, 0);
    expect(removeRouteSpikes(pts)).toHaveLength(pts.length);
  });
});

describe('fetchRoadAlignedPolyline', () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (coordsLatLng) => vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ routes: [{ geometry: { coordinates: coordsLatLng.map(([la, ln]) => [ln, la]) } }] }),
  })));

  it('keeps a drawn route as drawn when the snapped line takes another road', async () => {
    const drawn = [[10.70, 122.30], [10.701, 122.30], [10.702, 122.30]];
    respond([[10.70, 122.30], [10.701, 122.31], [10.702, 122.30]]); // ~1 km off to the east
    expect(await fetchRoadAlignedPolyline(drawn)).toBe(drawn);
  });

  it('returns the cleaned road line when it follows the drawn route', async () => {
    const drawn = [[10.71, 122.30], [10.711, 122.30], [10.712, 122.30]];
    const road = [[10.71, 122.30], [10.7105, 122.3001], [10.711, 122.3001], [10.7115, 122.3001], [10.712, 122.30]];
    respond(road);
    expect(await fetchRoadAlignedPolyline(drawn, { smooth: false })).toEqual(road);
    const smooth = await fetchRoadAlignedPolyline(drawn);
    expect(smooth[0]).toEqual(road[0]);
    expect(smooth.at(-1)).toEqual(road.at(-1));
    expect(maxDeviationMeters(smooth, road)).toBeLessThan(7);
  });

  it('reaches the end pin when the known road stops short of it', async () => {
    const drawn = [[10.72, 122.30], [10.723, 122.30]];
    respond([[10.72, 122.30], [10.721, 122.30], [10.7215, 122.30]]); // road ends ~165 m early
    const out = await fetchRoadAlignedPolyline(drawn, { smooth: false });
    expect(out.at(-1)).toEqual([10.723, 122.30]);
    expect(out[0]).toEqual([10.72, 122.30]);
  });
});

describe('connectToPins / smoothRouteCorners', () => {
  it('adds a link only where the line misses a pin', () => {
    const road = [[10.78, 122.39], [10.781, 122.39]];
    expect(connectToPins(road, [10.78, 122.39], [10.781, 122.39])).toEqual(road);
    expect(connectToPins(road, [10.7795, 122.39], [10.781, 122.39])).toHaveLength(3);
  });

  it('rounds a right-angle corner by a few metres only', () => {
    const corner = [[10.78, 122.39], [10.781, 122.39], [10.781, 122.391]];
    const out = smoothRouteCorners(corner);
    expect(out[0]).toEqual(corner[0]);
    expect(out.at(-1)).toEqual(corner.at(-1));
    expect(out.length).toBeGreaterThan(corner.length);
    expect(maxDeviationMeters(out, corner)).toBeLessThan(6);
  });
});
