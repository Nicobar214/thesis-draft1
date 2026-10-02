export function formatPercentage(value, placeholder = '\u2014') {
  if (value === null || value === undefined || value === '') return placeholder;

  if (typeof value !== 'number' && typeof value !== 'string') return placeholder;
  const normalizedValue = typeof value === 'string' ? value.trim() : value;
  if (normalizedValue === '') return placeholder;

  const numericValue = Number(normalizedValue);
  return Number.isFinite(numericValue) ? `${numericValue.toFixed(2)}%` : placeholder;
}
