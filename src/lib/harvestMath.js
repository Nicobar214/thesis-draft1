/* harvestMath.js — pure helpers for the Farmer "My Harvest" module.
 *
 * Kept separate from FarmerHarvest.jsx (same convention as projectStatus.js)
 * because these are plain math/formatting, not UI or data-fetching.
 */

/** kg per hectare, or null when there's nothing sensible to divide by. */
export function yieldPerHectare(quantityKg, areaHa) {
  const qty = Number(quantityKg);
  const area = Number(areaHa);
  if (!Number.isFinite(qty) || !Number.isFinite(area) || area <= 0) return null;
  return qty / area;
}

export function formatYield(kgPerHa) {
  if (kgPerHa === null || kgPerHa === undefined || !Number.isFinite(kgPerHa)) {
    return 'Area not recorded';
  }
  return `${Math.round(kgPerHa).toLocaleString()} kg/ha`;
}

/**
 * Compares the two most recent entries of one crop.
 * @param {Array} sortedLogsForCrop - same crop, ascending by harvest_date
 * @returns {{previous: object, current: object, percentChange: number} | null}
 *   null when there's fewer than two entries, or the previous quantity is
 *   zero/invalid -- callers should show "This is your first recorded
 *   harvest" rather than inventing a percentage from nothing.
 */
export function compareToPrevious(sortedLogsForCrop) {
  if (!Array.isArray(sortedLogsForCrop) || sortedLogsForCrop.length < 2) return null;
  const current = sortedLogsForCrop[sortedLogsForCrop.length - 1];
  const previous = sortedLogsForCrop[sortedLogsForCrop.length - 2];
  const prevQty = Number(previous.quantity_kg);
  const curQty = Number(current.quantity_kg);
  if (!Number.isFinite(prevQty) || prevQty <= 0 || !Number.isFinite(curQty)) return null;
  return { previous, current, percentChange: ((curQty - prevQty) / prevQty) * 100 };
}
