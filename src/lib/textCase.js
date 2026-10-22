/* Lowercase a label for use mid-sentence ("All municipalities", "Detailed DA
 * FMR project record") without breaking acronyms: words written in capitals
 * (DA, FMR, LGU, RAED, GPS, KM) stay as they are. */
const ACRONYM = /^[^a-z]*[A-Z]{2,}[^a-z]*$/;

export function lowerKeepAcronyms(text) {
  return String(text ?? '')
    .split(/(\s+)/)
    .map((word) => (ACRONYM.test(word) ? word : word.toLowerCase()))
    .join('');
}
