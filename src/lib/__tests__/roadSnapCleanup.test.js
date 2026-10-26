import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  connectToPins, decodePolyline, fetchRoadAlignedPolyline, maxDeviationMeters, removeRouteSpikes, resetRoadSnapState, smoothRouteCorners, snapToRoad,
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
  beforeEach(() => resetRoadSnapState());
  afterEach(() => vi.unstubAllGlobals());
  // Valhalla answers with an encoded polyline (6 decimals) per leg.
  const enc = (pts) => {
    let out = ''; let pLat = 0; let pLng = 0;
    const one = (v) => { let x = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (x >= 0x20) { s += String.fromCharCode((0x20 | (x & 0x1f)) + 63); x >>= 5; } return s + String.fromCharCode(x + 63); };
    pts.forEach(([la, ln]) => { const a = Math.round(la * 1e6); const b = Math.round(ln * 1e6); out += one(a - pLat) + one(b - pLng); pLat = a; pLng = b; });
    return out;
  };
  // Every router answers with this road, each in its own format (which router
  // leads depends on which ones earlier tests put to rest).
  const respond = (coordsLatLng) => vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: true,
    json: async () => (String(url).includes('valhalla')
      ? { trip: { legs: [{ shape: enc(coordsLatLng) }] } }
      : { routes: [{ geometry: { coordinates: coordsLatLng.map(([la, ln]) => [ln, la]) } }] }),
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

  // Project 147: pins 0.88 km apart, OSRM's shortest drive was a 7 km loop over
  // other roads, up to 2.2 km away. A trip may take it; a project road may not.
  const pins = [[10.74, 122.30], [10.748, 122.30]];
  const loop = [[10.74, 122.30], [10.74, 122.32], [10.748, 122.32], [10.748, 122.30]]; // ~2.2 km east and back

  it('lets an A-to-B trip take the long way round', async () => {
    respond(loop);
    expect(await fetchRoadAlignedPolyline(pins, { smooth: false })).toEqual(loop);
  });

  it('keeps a two-pin project road straight when the snap loops away (alongLine)', async () => {
    respond(loop);
    const result = await snapToRoad(pins, { smooth: false, alongLine: true });
    expect(result).toEqual({ points: pins, snapped: false, reason: 'strayed' });
    expect(await fetchRoadAlignedPolyline(pins, { alongLine: true })).toBe(pins);
  });

  it('asks the second server when the first one hangs, and cancels the first', async () => {
    const drawn = [[10.77, 122.30], [10.771, 122.30]];
    const road = [[10.77, 122.30], [10.7705, 122.3001], [10.771, 122.30]];
    const aborted = [];
    vi.stubGlobal('fetch', vi.fn((url, { signal } = {}) => {
      if (String(url).includes('router.project-osrm.org')) {
        // Hangs until cancelled.
        return new Promise((_, reject) => signal?.addEventListener('abort', () => { aborted.push(url); reject(new Error('aborted')); }));
      }
      return Promise.resolve({ ok: true, json: async () => ({ routes: [{ geometry: { coordinates: road.map(([la, ln]) => [ln, la]) } }] }) });
    }));
    const started = Date.now();
    const result = await snapToRoad(drawn, { smooth: false, alongLine: true });
    expect(result.snapped).toBe(true);
    expect(result.points).toEqual(road);
    expect(Date.now() - started).toBeLessThan(3000); // the hedge, not a 15 s hang
    expect(aborted).toHaveLength(1);
  });

  it('uses the Valhalla router when both OSRM servers are down', async () => {
    const drawn = [[10.80, 122.30], [10.801, 122.30]];
    const road = [[10.8, 122.3], [10.8005, 122.3001], [10.801, 122.3]];
    vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).includes('valhalla')
      ? { ok: true, json: async () => ({ trip: { legs: [{ shape: enc(road) }] } }) }
      : { ok: false, status: 503 })));
    const result = await snapToRoad(drawn, { smooth: false, alongLine: true });
    expect(result.snapped).toBe(true);
    expect(result.points).toEqual(road);
  });

  it('sends at most 2 requests at once, the button ahead of background snapping', async () => {
    const waiting = [];
    let inFlight = 0;
    let most = 0;
    vi.stubGlobal('fetch', vi.fn((url) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      return new Promise((resolve) => waiting.push({ url: String(url), resolve }));
    }));
    const answer = () => {
      const job = waiting.shift();
      const [a, b] = job.url.match(/driving\/([\d.]+),([\d.]+)/).slice(1).map(Number);
      inFlight -= 1;
      job.resolve({ ok: true, json: async () => ({ routes: [{ geometry: { coordinates: [[a, b], [a + 0.00005, b + 0.0005], [a, b + 0.001]] } }] }) });
    };
    const road = (i) => [[10.9 + i * 0.01, 122.30], [10.901 + i * 0.01, 122.30]];
    const background = [0, 1, 2, 3].map((i) => snapToRoad(road(i), { smooth: false }));
    const button = snapToRoad(road(9), { smooth: false, priority: 'high' });
    await new Promise((r) => setTimeout(r, 0));
    expect(waiting).toHaveLength(2); // two background roads started, the rest wait
    answer();
    await new Promise((r) => setTimeout(r, 0));
    expect(waiting.at(-1).url).toContain('10.99'); // the freed slot went to the button
    while (waiting.length) { answer(); await new Promise((r) => setTimeout(r, 0)); }
    await Promise.all([...background, button]);
    expect(most).toBe(2);
  });

  it('decodes the encoded polyline format', () => {
    // Google's reference example (5 decimals).
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  });

  it('shares one request between callers asking for the same road', async () => {
    const drawn = [[10.79, 122.30], [10.791, 122.30]];
    respond([[10.79, 122.30], [10.7905, 122.3001], [10.791, 122.30]]);
    const [a, b] = await Promise.all([snapToRoad(drawn, { smooth: false }), snapToRoad(drawn, { smooth: false })]);
    expect(a.points).toEqual(b.points);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('says a failed request failed, and tries again next time', async () => {
    const drawn = [[10.76, 122.30], [10.761, 122.30]];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    expect(await snapToRoad(drawn)).toEqual({ points: drawn, snapped: false, reason: 'failed' });
    respond([[10.76, 122.30], [10.7605, 122.3001], [10.761, 122.30]]);
    expect((await snapToRoad(drawn, { smooth: false, alongLine: true })).snapped).toBe(true);
  });
});

describe('connectToPins / smoothRouteCorners', () => {
  it('adds a link only where the line misses a pin', () => {
    const road = [[10.78, 122.39], [10.781, 122.39]];
    expect(connectToPins(road, [10.78, 122.39], [10.781, 122.39])).toEqual(road);
    expect(connectToPins(road, [10.7795, 122.39], [10.781, 122.39])).toHaveLength(3);
  });

  // The "L" at the road's end: OSRM stops on the centre line right beside a pin
  // set on the road's edge, and a link at 90 degrees joined them.
  const east = (m) => m / (111320 * Math.cos((10.78 * Math.PI) / 180));
  const road = [[10.78, 122.39], [10.78, 122.39 + east(100)], [10.78, 122.39 + east(200)]]; // 200 m east
  const bearingDeg = (a, b) => (Math.atan2((b[0] - a[0]) * 111320, (b[1] - a[1]) * 111320 * Math.cos((10.78 * Math.PI) / 180)) * 180) / Math.PI;

  it('joins a pin beside the road at a shallow angle, not an L hook', () => {
    const pin = [10.78 + north(12), 122.39 + east(200)]; // 12 m off the centre line, beside the end
    const out = connectToPins(road, road[0], pin);
    expect(out.at(-1)).toEqual(pin);
    const angle = Math.abs(bearingDeg(out.at(-2), out.at(-1)));
    expect(angle).toBeLessThan(25); // nearly along the road (0 deg = east), not 90 deg
    expect(maxDeviationMeters(out, road)).toBeLessThanOrEqual(12.5);
  });

  it('never moves the pins, even when OSRM stops a metre or two short', () => {
    const start = [10.78 + north(2), 122.39];
    const end = [10.78, 122.39 + east(201)];
    const out = connectToPins(road, start, end);
    expect(out[0]).toEqual(start);
    expect(out.at(-1)).toEqual(end);
    expect(out).toHaveLength(road.length);
  });

  it('keeps a straight link to a pin well off the mapped road (unmapped stretch)', () => {
    const pin = [10.78 + north(120), 122.39 + east(200)];
    const out = connectToPins(road, road[0], pin);
    expect(out.slice(0, -1)).toEqual(road);
    expect(out.at(-1)).toEqual(pin);
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
