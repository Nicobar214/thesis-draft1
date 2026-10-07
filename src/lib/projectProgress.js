/**
 * Turns the published progress updates of one project into timeline entries:
 * newest first, each with the change since the update before it.
 * Input rows come from public.public_project_progress.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const clampPct = (value) => Math.min(100, Math.max(0, Number(value)));

// 'YYYY-MM-DD' -> parts, without timezone shifting a date-only value.
function parseDateOnly(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) } : null;
}

/** "Sep 2026" for a whole month, "Sep 1 - Oct 15, 2026" for a range, else the approval date. */
export function formatProgressPeriod(start, end, fallbackIso) {
  const a = parseDateOnly(start);
  const b = parseDateOnly(end);
  if (a && b) {
    if (a.year === b.year && a.month === b.month) return `${MONTHS[a.month]} ${a.year}`;
    const from = `${MONTHS[a.month]} ${a.day}`;
    const to = `${MONTHS[b.month]} ${b.day}, ${b.year}`;
    return a.year === b.year ? `${from} – ${to}` : `${from}, ${a.year} – ${to}`;
  }
  const d = fallbackIso ? new Date(fallbackIso) : null;
  if (d && !Number.isNaN(d.getTime())) {
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
  return 'Date not recorded';
}

/** "+12.4 pts", "-3.0 pts", or null when there is nothing to compare with. */
export function formatProgressDelta(delta) {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return 'no change';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)} pts`;
}

export function buildProgressEntries(rows) {
  // A missing figure is "unknown", not 0%: Number(null) is 0, so check for it explicitly.
  const hasFigure = (r) => r?.accomplishment !== null && r?.accomplishment !== undefined
    && String(r.accomplishment).trim() !== '' && Number.isFinite(Number(r.accomplishment));
  const valid = (rows || []).filter(hasFigure);
  const newestFirst = [...valid].sort((x, y) => new Date(y.approved_at).getTime() - new Date(x.approved_at).getTime());

  return newestFirst.map((row, index) => {
    const pct = clampPct(row.accomplishment);
    const older = newestFirst[index + 1];
    return {
      id: row.id,
      pct,
      delta: older ? pct - clampPct(older.accomplishment) : null,
      isCertified: Boolean(row.is_certified),
      photoUrl: row.photo_url || null,
      periodLabel: formatProgressPeriod(row.period_start, row.period_end, row.approved_at),
      approvedAt: row.approved_at,
    };
  });
}
