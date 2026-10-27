/* Market operating days and hours: picked with day chips and time pickers in
 * the market form (MarketManagement.jsx), saved as short text in the existing
 * columns (market_locations.operating_days / operating_hours), e.g.
 *   days:  "Daily", "Mon-Sat", "Mon, Wed, Fri"
 *   hours: "5:00 AM - 6:00 PM", "Open 24 hours"
 * so older markets typed by hand still read back when they follow that form. */

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const DAY_PRESETS = [
  { label: 'Every day', days: DAYS },
  { label: 'Mon–Sat', days: DAYS.slice(0, 6) },
  { label: 'Weekdays', days: DAYS.slice(0, 5) },
];

export const HOUR_PRESETS = [
  { label: 'Early market · 4 AM–12 NN', open: '04:00', close: '12:00' },
  { label: 'Daytime · 6 AM–6 PM', open: '06:00', close: '18:00' },
  { label: 'Open 24 hours', allDay: true },
];

export const ALL_DAY = 'Open 24 hours';

/** ['Mon', 'Tue', ...] in week order -> "Daily" | "Mon-Sat" | "Mon, Wed, Fri" | "". */
export function formatDays(selected) {
  const on = DAYS.filter((d) => selected.includes(d));
  if (on.length === 0) return '';
  if (on.length === 7) return 'Daily';
  const runs = [];
  on.forEach((d) => {
    const i = DAYS.indexOf(d);
    const last = runs[runs.length - 1];
    if (last && DAYS.indexOf(last[last.length - 1]) === i - 1) last.push(d);
    else runs.push([d]);
  });
  return runs.map((r) => (r.length >= 3 ? `${r[0]}-${r[r.length - 1]}` : r.join(', '))).join(', ');
}

const DAY_WORDS = {
  mon: 'Mon', monday: 'Mon', tue: 'Tue', tues: 'Tue', tuesday: 'Tue', wed: 'Wed', wednesday: 'Wed',
  thu: 'Thu', thur: 'Thu', thurs: 'Thu', thursday: 'Thu', fri: 'Fri', friday: 'Fri',
  sat: 'Sat', saturday: 'Sat', sun: 'Sun', sunday: 'Sun',
};

/** Saved text -> ['Mon', ...], or null when it is not in a form we can read. */
export function parseDays(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return [];
  if (/^(daily|every\s*day|everyday|mon(day)?\s*(-|–|to)\s*sun(day)?)$/.test(t)) return [...DAYS];
  const out = new Set();
  for (const part of t.split(/\s*(?:,|&|\band\b)\s*/).filter(Boolean)) {
    const range = part.split(/\s*(?:-|–|to)\s*/);
    const a = DAY_WORDS[range[0]?.replace(/\.$/, '')];
    if (!a) return null;
    if (range.length === 1) { out.add(a); continue; }
    const b = DAY_WORDS[range[1]?.replace(/\.$/, '')];
    if (!b || range.length > 2) return null;
    for (let i = DAYS.indexOf(a); ; i = (i + 1) % 7) {
      out.add(DAYS[i]);
      if (DAYS[i] === b) break;
    }
  }
  return DAYS.filter((d) => out.has(d));
}

/** "05:00" -> "5:00 AM", "12:00" -> "12:00 NN", "00:00" -> "12:00 MN". */
export function formatTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return '';
  const h = Number(m[1]);
  if (h === 12 && m[2] === '00') return '12:00 NN';
  if (h === 0 && m[2] === '00') return '12:00 MN';
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** { open: "05:00", close: "18:00", allDay } -> "5:00 AM - 6:00 PM" | "Open 24 hours" | "". */
export function formatHours({ open, close, allDay }) {
  if (allDay) return ALL_DAY;
  const a = formatTime(open);
  const b = formatTime(close);
  return a && b ? `${a} - ${b}` : a || b ? `${a || '?'} - ${b || '?'}` : '';
}

function parseTime(text) {
  const t = String(text || '').trim().toUpperCase().replace(/\./g, '');
  if (/^12(:00)?\s*(NN|NOON)$/.test(t)) return '12:00';
  if (/^12(:00)?\s*(MN|MIDNIGHT)$/.test(t)) return '00:00';
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] || '00';
  if (h > 23 || Number(min) > 59) return null;
  if (m[3] === 'PM' && h < 12) h += 12;
  if (m[3] === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

/** Saved text -> { open, close, allDay }, or null when it is not in a form we can read. */
export function parseHours(text) {
  const t = String(text || '').trim();
  if (!t) return { open: '', close: '', allDay: false };
  if (/24\s*(hours|hrs|h)/i.test(t)) return { open: '', close: '', allDay: true };
  const parts = t.split(/\s*(?:-|–|to)\s*/i);
  if (parts.length !== 2) return null;
  const open = parseTime(parts[0]);
  const close = parseTime(parts[1]);
  return open && close ? { open, close, allDay: false } : null;
}
