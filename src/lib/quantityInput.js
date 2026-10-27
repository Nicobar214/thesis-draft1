/* Work Plan quantities (contractor's progress form and the engineer's quantity
 * review): at most two decimal places, e.g. 12.75 m³. The database accepts up to
 * four; two is what is measured on site and keeps the numbers readable. */
export const QUANTITY_DECIMALS = 2;

/** More decimals than allowed? */
export const hasUnsupportedPrecision = (value) => {
  const scale = 10 ** QUANTITY_DECIMALS;
  return Math.abs(Number(value) * scale - Math.round(Number(value) * scale)) > 1e-8;
};

/** For an input's onChange: drops digits past the allowed decimals as they are typed. */
export function limitDecimals(raw) {
  const value = String(raw ?? '');
  const dot = value.indexOf('.');
  return dot === -1 ? value : value.slice(0, dot + 1 + QUANTITY_DECIMALS);
}

export const QUANTITY_STEP = String(1 / 10 ** QUANTITY_DECIMALS);

export const formatQuantity = (value) => Number(value || 0).toLocaleString('en-PH', {
  maximumFractionDigits: QUANTITY_DECIMALS,
});
