/*
 * harvestPlausibility.js — is a harvest entry believable for its crop and farm size?
 *
 * One table of typical yields (tonnes per hectare per harvest) used by:
 *   - farmer registration, to estimate a farm's yield;
 *   - the harvest form, to warn before saving an unusually high entry;
 *   - LGU analytics, which leaves flagged entries out until the LGU confirms them.
 * The database applies the same rule (supabase_harvest_review.sql) so it can't be
 * bypassed — keep the two tables in sync.
 *
 * Figures are approximate Philippine averages, deliberately on the generous side.
 * An entry is "unusual" only above UNUSUAL_FACTOR x typical (about record-yield level).
 */

export const UNUSUAL_FACTOR = 2.5;
export const DEFAULT_YIELD_T_PER_HA = 9;

export const TYPICAL_YIELD_T_PER_HA = {
  Rice: 4.2,
  Corn: 3.6,
  Sugarcane: 65,
  Coconut: 8,
  Vegetables: 12,
  Banana: 20,
  'Bellpepper (Green/Red)': 10,
  Cacao: 1,
  Carrot: 15,
  'Dragon Fruit': 10,
  'Long Chili': 8,
  Mango: 8,
  'Mongo - dry': 0.8,
  'Mung Bean': 0.8,
  'Other fruit-bearing trees and vines': 10,
  'Other fruit-bearing vegetables': 12,
  'Other industrial crops': 5,
  'Other leafy vegetables': 10,
  'Other leguminous plants': 1.5,
  Papaya: 25,
  Peanuts: 1.5,
  'Pepper - small green': 8,
  'Pepper - sweet': 10,
  'Radish (labanos)': 15,
  'Squash (kalabasa)': 12,
  'Tomato (kamatis)': 15,
};

/** Typical yield for a crop, in tonnes per hectare. */
export function typicalYieldTPerHa(crop) {
  return TYPICAL_YIELD_T_PER_HA[String(crop || '').trim()] ?? DEFAULT_YIELD_T_PER_HA;
}

/**
 * { unusual, expectedMaxKg, kgPerHa, areaHa } for one harvest.
 * areaHa: the harvest's own area; fallbackAreaHa: the farm's registered area.
 * With no usable area nothing can be judged, so unusual is false.
 */
export function checkHarvest({ crop, quantityKg, areaHa, fallbackAreaHa } = {}) {
  const kg = Number(quantityKg);
  const area = Number(areaHa) > 0 ? Number(areaHa) : Number(fallbackAreaHa) > 0 ? Number(fallbackAreaHa) : null;
  if (!Number.isFinite(kg) || kg <= 0 || !area) {
    return { unusual: false, expectedMaxKg: null, kgPerHa: null, areaHa: area };
  }
  const expectedMaxKg = Math.round(typicalYieldTPerHa(crop) * 1000 * area * UNUSUAL_FACTOR);
  return { unusual: kg > expectedMaxKg, expectedMaxKg, kgPerHa: kg / area, areaHa: area };
}
