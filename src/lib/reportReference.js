/*
 * reportReference.js — the "quote reference" citizens see on their report
 * (CitizenReportTimeline: "Quote reference 64C1324E"): the first 8 characters
 * of the report id, uppercased. Admins can search by it.
 */

export function reportReference(id) {
  return String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
}

/**
 * If `text` looks like a reference ("64C1324E", "#64c1324e", "64c1"), returns
 * it normalized (lowercase hex, no '#'/hyphens); otherwise null. At least 4
 * characters, so short numbers like street numbers don't trigger it.
 */
export function parseReferenceQuery(text) {
  const t = String(text || '').trim().replace(/^#/, '').replace(/-/g, '');
  return /^[0-9a-f]{4,32}$/i.test(t) ? t.toLowerCase() : null;
}

/** Reports whose id starts with the reference query. */
export function matchReportsByReference(reports, query) {
  const q = parseReferenceQuery(query);
  if (!q) return [];
  return (reports || []).filter((r) => String(r?.id || '').replace(/-/g, '').toLowerCase().startsWith(q));
}
