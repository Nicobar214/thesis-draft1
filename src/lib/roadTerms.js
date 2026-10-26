/* One vocabulary for road surfaces, shared by the DA admin, the LGU portal,
 * the maps and the field engineer / contractor tasks.
 *
 * The system builds one kind of road work: CONCRETING. The LGU road survey
 * (Leon_barangay_roads.csv -> src/data/leonRoadInventory.json) records each
 * barangay road's surfaces. Leon has no asphalt, so:
 *   Concrete            = done
 *   Gravel + Earth      = still to concrete
 * Everywhere a screen used to say "unpaved", "gap" or "road network gap" it
 * now says "to concrete" / "concreting need", so the LGU and the DA read the
 * same words for the same numbers. */

export const ROAD_TERMS = {
  concrete: 'Concrete',
  toConcrete: 'To concrete',
  need: 'Concreting need',
  needs: 'Concreting needs',
  lengthCriterion: 'Gap length',
  source: 'Leon LGU road survey',
};

/** One color per surface, the same in every breakdown bar. */
export const SURFACE_COLORS = { Concrete: '#0ea5e9', Asphalt: '#8b5cf6', Gravel: '#f59e0b', Earth: '#a8a29e' };

/** Surfaces that still need concreting. */
export const TO_CONCRETE_SURFACES = new Set(['Gravel', 'Earth']);

const km2 = (n) => `${Number(n).toFixed(2)} km`;

/** "2.07 km (gravel 2.07)" style summary of what is left to concrete. */
export function toConcreteSummary(parts = []) {
  const left = parts.filter((p) => TO_CONCRETE_SURFACES.has(p.type) && p.km > 0);
  const total = left.reduce((s, p) => s + p.km, 0);
  if (!left.length) return null;
  return `${km2(total)} (${left.map((p) => `${p.type.toLowerCase()} ${p.km.toFixed(2)}`).join(', ')})`;
}
