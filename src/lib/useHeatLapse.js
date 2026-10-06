import { useCallback, useEffect, useMemo, useState } from 'react';
import { cellPeak, HEAT_RADIUS_M, HEAT_BLUR_RATIO } from './heatCells';

const DAY = 86400000;

export const LAPSE_WINDOWS = [
  { id: 'all', label: 'Cumulative', title: 'Everything reported up to this date. Areas only get hotter.', days: Infinity },
  { id: '30', label: '30 days', title: 'Reports from the 30 days before this date. Areas heat up and cool down.', days: 30 },
  { id: '90', label: '90 days', title: 'Reports from the 90 days before this date. Areas heat up and cool down.', days: 90 },
  { id: '365', label: '1 year', title: 'Reports from the year before this date.', days: 365 },
];
export const LAPSE_SPEEDS = [1, 2, 4];

const startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** [lat, lng, count] per location for reports filed in (date - windowMs, date]. */
function framePoints(dated, date, windowMs) {
  const end = date + DAY; // include the whole selected day
  const start = end - windowMs;
  const byLocation = new Map();
  for (const p of dated) {
    if (p.t >= end || p.t < start) continue;
    const key = `${p.lat.toFixed(4)}:${p.lng.toFixed(4)}`;
    const hit = byLocation.get(key);
    if (hit) hit[2] += 1;
    else byLocation.set(key, [p.lat, p.lng, 1]);
  }
  return [...byLocation.values()];
}

/**
 * Time-lapse over the public reports: pick or play a date and see where reports
 * were concentrated then. Includes resolved reports on purpose; this is history,
 * not the live "what is broken now" view.
 *
 * raw: [{ lat, lng, createdAt }]
 */
export function useHeatLapse(raw) {
  const [mode, setMode] = useState('recent'); // 'recent' | 'timelapse'
  const [windowId, setWindowId] = useState('90');
  const [selected, setSelected] = useState(null); // ms; null = latest
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [today] = useState(() => startOfDay(Date.now())); // fixed at mount; keeps render pure

  const dated = useMemo(
    () => (raw || [])
      .map((p) => ({ lat: p.lat, lng: p.lng, t: Date.parse(p.createdAt) }))
      .filter((p) => Number.isFinite(p.t)),
    [raw],
  );

  const bounds = useMemo(() => {
    if (dated.length === 0) return null;
    const min = startOfDay(Math.min(...dated.map((p) => p.t)));
    return { min, max: Math.max(today, min) };
  }, [dated, today]);

  const windowMs = (LAPSE_WINDOWS.find((w) => w.id === windowId) || LAPSE_WINDOWS[2]).days * DAY;
  const date = bounds ? Math.min(bounds.max, Math.max(bounds.min, selected ?? bounds.max)) : null;

  // One ceiling for the whole range, so frames are comparable with each other.
  const peak = useMemo(() => {
    if (!bounds) return 1;
    const span = bounds.max - bounds.min;
    const step = Math.max(DAY, Math.ceil(span / 300 / DAY) * DAY);
    let best = 1;
    for (let d = bounds.min; d <= bounds.max + step - 1; d += step) {
      best = Math.max(best, cellPeak(framePoints(dated, Math.min(d, bounds.max), windowMs), HEAT_RADIUS_M, HEAT_BLUR_RATIO));
    }
    return best;
  }, [bounds, dated, windowMs]);

  const points = useMemo(() => (date === null ? [] : framePoints(dated, date, windowMs)), [dated, date, windowMs]);
  const count = useMemo(() => points.reduce((sum, p) => sum + p[2], 0), [points]);

  // Reports filed per bucket, for the strip above the slider. Months for a long
  // history, weeks for a short one.
  const buckets = useMemo(() => {
    if (!bounds) return [];
    const spanDays = (bounds.max - bounds.min) / DAY;
    const bucketMs = (spanDays > 150 ? 30.4375 : 7) * DAY;
    const n = Math.max(1, Math.ceil((bounds.max - bounds.min + DAY) / bucketMs));
    const out = Array.from({ length: n }, (_, i) => ({ start: bounds.min + i * bucketMs, count: 0 }));
    for (const p of dated) {
      const i = Math.min(n - 1, Math.max(0, Math.floor((p.t - bounds.min) / bucketMs)));
      out[i].count += 1;
    }
    return out;
  }, [bounds, dated]);

  // Playing means asked to play AND not yet at the end, so reaching the end stops
  // the animation without a state update inside an effect.
  const isPlaying = playing && bounds !== null && date < bounds.max;

  // Playback: roughly 200 steps end to end at 1x, however long the history is.
  useEffect(() => {
    if (!isPlaying) return undefined;
    const advance = Math.max(DAY, Math.ceil((bounds.max - bounds.min) / 200 / DAY) * DAY) * speed;
    const timer = setInterval(() => {
      setSelected((prev) => Math.min(bounds.max, (prev ?? bounds.max) + advance));
    }, 220);
    return () => clearInterval(timer);
  }, [isPlaying, bounds, speed]);

  const togglePlay = useCallback(() => {
    if (!bounds) return;
    if (isPlaying) {
      setPlaying(false);
      return;
    }
    if ((selected ?? bounds.max) >= bounds.max) setSelected(bounds.min); // replay from the start
    setPlaying(true);
  }, [bounds, isPlaying, selected]);

  const seek = useCallback((ms) => {
    setPlaying(false);
    setSelected(Number(ms));
  }, []);

  // Leaving time-lapse stops the animation.
  const changeMode = useCallback((next) => {
    if (next !== 'timelapse') setPlaying(false);
    setMode(next);
  }, []);

  return {
    mode, setMode: changeMode,
    windowId, setWindowId,
    speed, setSpeed,
    playing: isPlaying, togglePlay,
    bounds, date, seek,
    points, peak, count, buckets,
    hasData: Boolean(bounds),
  };
}
