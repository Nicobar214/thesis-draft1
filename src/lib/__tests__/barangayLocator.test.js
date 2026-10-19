import { describe, it, expect } from 'vitest';
import LEON_BARANGAYS from '../../data/leonBarangays';
import { checkPinInBarangay, lineCrossesBarangay, nearestBarangay, hasBarangayCenters } from '../barangayLocator';

const center = (name) => LEON_BARANGAYS.find((b) => b.name === name);
const agta = center('Agta');
const bacolod = center('Bacolod');

describe('barangayLocator', () => {
  it('finds the barangay whose center is closest', () => {
    expect(nearestBarangay(agta.lat, agta.lng, 'Leon').name).toBe('Agta');
  });

  it('says a pin at the barangay center is inside', () => {
    expect(checkPinInBarangay({ lat: agta.lat, lng: agta.lng, municipality: 'Leon', barangay: 'Agta' }).status).toBe('inside');
  });

  it('flags a pin placed in another barangay, and names that barangay', () => {
    const res = checkPinInBarangay({ lat: bacolod.lat, lng: bacolod.lng, municipality: 'Leon', barangay: 'Agta' });
    expect(res.status).toBe('outside');
    expect(res.nearest.name).toBe('Bacolod');
  });

  it('does not guess where there are no center points', () => {
    expect(checkPinInBarangay({ lat: 10.7, lng: 122.5, municipality: 'Alimodian', barangay: 'Anonang' }).status).toBe('unknown');
    expect(checkPinInBarangay({ lat: agta.lat, lng: agta.lng, municipality: 'Leon', barangay: 'Ayubo' }).status).toBe('unknown');
    expect(hasBarangayCenters('Alimodian')).toBe(false);
  });

  it('tells whether a road line passes through the barangay', () => {
    expect(lineCrossesBarangay([[bacolod.lat, bacolod.lng], [agta.lat, agta.lng]], 'Leon', 'Agta')).toBe(true);
    expect(lineCrossesBarangay([[bacolod.lat, bacolod.lng]], 'Leon', 'Agta')).toBe(false);
  });
});

describe('official boundaries', () => {
  it('detects points inside a polygon, respecting holes', async () => {
    const { pointInGeometry } = await import('../barangayLocator');
    const square = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
    expect(pointInGeometry(2, 2, square)).toBe(true);   // lat 2, lng 2
    expect(pointInGeometry(5, 5, square)).toBe(false);  // in the hole
    expect(pointInGeometry(12, 2, square)).toBe(false);
  });

  it('uses the real Leon boundaries once loaded', async () => {
    const fs = await import('node:fs');
    const mod = await import('../barangayLocator');
    const data = JSON.parse(fs.readFileSync(new URL('../../../public/data/barangay-boundaries/leon.json', import.meta.url), 'utf8'));
    mod.setBarangayBoundaries('Leon', data);
    expect(data.barangays).toHaveLength(85);

    const agtaCenter = LEON_BARANGAYS.find((b) => b.name === 'Agta');
    const at = mod.barangayAt(agtaCenter.lat, agtaCenter.lng, 'Leon');
    expect(at).toBeTruthy();
    const res = mod.checkPinInBarangay({ lat: agtaCenter.lat, lng: agtaCenter.lng, municipality: 'Leon', barangay: at });
    expect(res).toMatchObject({ status: 'inside', exact: true });

    const other = data.barangays.find((b) => b.name !== at).name;
    const out = mod.checkPinInBarangay({ lat: agtaCenter.lat, lng: agtaCenter.lng, municipality: 'Leon', barangay: other });
    expect(out.status).toBe('outside');
    expect(out.nearest.name).toBe(at);
  });
});

describe('boundary tolerance', () => {
  it('measures distance to an outline', async () => {
    const { distanceToGeometryMeters } = await import('../barangayLocator');
    const sq = { type: 'Polygon', coordinates: [[[122, 10], [122.01, 10], [122.01, 10.01], [122, 10.01], [122, 10]]] };
    // 0.001 deg of latitude south of the bottom edge is about 110 m.
    expect(distanceToGeometryMeters(9.999, 122.005, sq)).toBeGreaterThan(100);
    expect(distanceToGeometryMeters(9.999, 122.005, sq)).toBeLessThan(120);
  });
});
