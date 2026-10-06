import { PauseIcon, PlayIcon } from 'lucide-react';
import { LAPSE_SPEEDS, LAPSE_WINDOWS } from '../../lib/useHeatLapse';

const fmtMonth = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const fmtDay = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function Segmented({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-[10px]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          title={o.title}
          className={`flex-1 rounded-md px-1.5 py-1 font-semibold transition-colors ${value === o.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Heatmap controls for the admin map panel. "Recent" is the live view (children,
 * the existing 7d / 30d / All control); "Time-lapse" replays the history.
 */
export function HeatModeControls({ lapse, children }) {
  const { mode, setMode, hasData, bounds, date, seek, playing, togglePlay, speed, setSpeed, windowId, setWindowId, buckets, count } = lapse;
  const peakBucket = Math.max(1, ...buckets.map((b) => b.count));
  const span = bounds ? Math.max(1, bounds.max - bounds.min) : 1;
  const position = bounds ? ((date - bounds.min) / span) * 100 : 0;
  const long = bounds ? bounds.max - bounds.min > 150 * 86400000 : false;

  return (
    <div className="space-y-2 pl-6">
      <Segmented
        label="Heatmap mode"
        value={mode}
        onChange={setMode}
        options={[
          { id: 'recent', label: 'Recent', title: 'Where problems are being reported now' },
          { id: 'timelapse', label: 'Time-lapse', title: 'Replay how reports built up and faded over time' },
        ]}
      />

      {mode === 'recent' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-slate-400">Window</span>
          {children}
        </div>
      )}

      {mode === 'timelapse' && !hasData && (
        <p className="text-[11px] text-slate-500">No dated reports to replay yet.</p>
      )}

      {mode === 'timelapse' && hasData && (
        <div className="space-y-2">
          {/* Reports filed over time, with the current date marked */}
          <div className="relative h-10" aria-hidden="true">
            <div className="absolute inset-0 flex items-end gap-px">
              {buckets.map((b) => (
                <div
                  key={b.start}
                  className="flex-1 rounded-t-sm bg-slate-300"
                  style={{ height: `${b.count === 0 ? 3 : Math.max(10, (b.count / peakBucket) * 100)}%`, opacity: b.count === 0 ? 0.4 : 1 }}
                />
              ))}
            </div>
            <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded bg-indigo-600" style={{ left: `${position}%` }} />
          </div>

          <input
            type="range"
            min={bounds.min}
            max={bounds.max}
            step={86400000}
            value={date}
            onChange={(e) => seek(e.target.value)}
            aria-label="Heatmap date"
            className="block w-full accent-indigo-600"
          />
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>{long ? fmtMonth(bounds.min) : fmtDay(bounds.min)}</span>
            <span>{long ? fmtMonth(bounds.max) : fmtDay(bounds.max)}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play time-lapse'}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              {playing ? <PauseIcon className="size-4" aria-hidden="true" /> : <PlayIcon className="size-4" aria-hidden="true" />}
            </button>
            <div role="group" aria-label="Speed" className="flex flex-1 rounded-lg border border-slate-200 bg-white p-0.5 text-[10px]">
              {LAPSE_SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpeed(s)}
                  aria-pressed={speed === s}
                  className={`flex-1 rounded-md px-1.5 py-1 font-semibold ${speed === s ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-medium text-slate-400">Counts reports from</p>
            <Segmented label="Time window" value={windowId} onChange={setWindowId} options={LAPSE_WINDOWS} />
          </div>

          <p className="text-[11px] font-semibold text-slate-700">
            {fmtDay(date)} · {count} report{count === 1 ? '' : 's'} in view
          </p>
          <p className="text-[10px] leading-snug text-slate-400">
            One fixed color scale is used for the whole range, so an area brightens as reports pile up and fades as they age out of the window.
          </p>
        </div>
      )}
    </div>
  );
}

/** Big date readout on the map while the time-lapse is on. */
export function HeatLapseBadge({ lapse, visible }) {
  if (!visible || lapse.mode !== 'timelapse' || !lapse.hasData) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-[500] -translate-x-1/2">
      <div className="rounded-full bg-slate-900/85 px-4 py-1.5 text-center text-white shadow-lg ring-1 ring-white/10 backdrop-blur">
        <p className="text-sm font-semibold leading-tight">{fmtDay(lapse.date)}</p>
        <p className="text-[10px] leading-tight text-slate-300">
          {lapse.count} report{lapse.count === 1 ? '' : 's'} in view
        </p>
      </div>
    </div>
  );
}
