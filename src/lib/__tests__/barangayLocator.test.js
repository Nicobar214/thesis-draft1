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
