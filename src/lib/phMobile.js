/* Philippine mobile numbers for contact fields: 12 digits in the international
 * form, +63 9XX XXX XXXX. The form shows "+63" and the person types the other
 * 10 digits; "09..." (the local form) and "+63..." are accepted and converted.
 * Saved as "+639XXXXXXXXX". */

export const PH_MOBILE_DIGITS = 10; // after +63

/** Anything typed or pasted -> the up-to-10 digits after +63. */
export function mobileLocalPart(text) {
  let d = String(text || '').replace(/\D/g, '');
  if (d.startsWith('63')) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, PH_MOBILE_DIGITS);
}

/** The 10 digits -> "+639XXXXXXXXX", or '' when not complete. */
export function toE164Mobile(local) {
  return /^9\d{9}$/.test(local) ? `+63${local}` : '';
}

/** "9123456789" -> "912 345 6789" (for showing). */
export function groupMobile(local) {
  return [local.slice(0, 3), local.slice(3, 6), local.slice(6)].filter(Boolean).join(' ');
}

/**
 * A friendly note about the digits so far:
 * { tone: 'ok' | 'hint' | 'error', text } or null when empty (the field is optional).
 */
export function mobileHint(local) {
  if (!local) return null;
  if (local[0] !== '9') return { tone: 'error', text: 'Mobile numbers start with 9 after +63, like +63 912 345 6789.' };
  const left = PH_MOBILE_DIGITS - local.length;
  if (left > 0) return { tone: 'hint', text: `Almost there: ${left} more digit${left === 1 ? '' : 's'} to go.` };
  return { tone: 'ok', text: 'Looks good.' };
}
