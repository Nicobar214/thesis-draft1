import { describe, it, expect } from 'vitest';
import { checkHarvest, typicalYieldTPerHa, DEFAULT_YIELD_T_PER_HA } from '../harvestPlausibility';

describe('harvestPlausibility', () => {
  it('flags 50,000 kg of rice from 0.5 ha', () => {
    const res = checkHarvest({ crop: 'Rice', quantityKg: 50000, areaHa: 0.5 });
    expect(res.unusual).toBe(true);
    expect(res.expectedMaxKg).toBe(5250); // 4.2 t/ha x 0.5 ha x 2.5
  });

  it('accepts a normal or even a very good harvest', () => {
    expect(checkHarvest({ crop: 'Rice', quantityKg: 2100, areaHa: 0.5 }).unusual).toBe(false);
    expect(checkHarvest({ crop: 'Rice', quantityKg: 5000, areaHa: 0.5 }).unusual).toBe(false);
  });

  it("uses the farm's registered area when the harvest has none", () => {
    expect(checkHarvest({ crop: 'Corn', quantityKg: 20000, fallbackAreaHa: 1 }).unusual).toBe(true);
  });

  it('does not judge without an area', () => {
    expect(checkHarvest({ crop: 'Rice', quantityKg: 999999 }).unusual).toBe(false);
  });

  it('has a default for crops not in the table', () => {
    expect(typicalYieldTPerHa('Durian')).toBe(DEFAULT_YIELD_T_PER_HA);
  });
});
