/* PageTour.jsx — spotlight walkthrough that points at real parts of a page.
 *
 * Each step names a CSS selector (usually [data-tour="..."]). The page is
 * dimmed, that element is cut out and outlined, and a small card explains it.
 * A step with no target shows the card centered, for an intro or closing note.
 *
 * Mount it only while the tour is running (see lib/usePageTour): the list of
 * steps to show is worked out once on mount, from what is on screen then.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const PAD = 8;
const GAP = 12;
const EDGE = 16;
const CARD_W = 340;
const MIN_ROOM = 190;

// Some elements exist twice (the sidebar renders a mobile and a desktop copy),
// and some are hidden at this screen size. Use the first one actually shown.
function findVisible(selector) {
  if (!selector) return null;
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth) return el;
  }
  return null;
}

function cardPosition(rect, width) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = rect
    ? Math.min(Math.max(rect.left + rect.width / 2 - width / 2, EDGE), vw - width - EDGE)
    : (vw - width) / 2;

  if (!rect) return { left, top: '50%', transform: 'translateY(-50%)' };

  const below = vh - rect.bottom - PAD - GAP;
  const above = rect.top - PAD - GAP;
  // Targets taller than the screen (the map, long sections) leave no room
  // either side, so the card sits at the bottom of the screen instead.
  if (Math.max(below, above) < MIN_ROOM) return { left, bottom: EDGE };
  if (below >= above) return { left, top: rect.bottom + PAD + GAP };
  return { left, bottom: vh - rect.top + PAD + GAP };
}

export default function PageTour({ steps, onClose }) {
  // Drop steps whose element is not on screen (no reports yet, mobile layout).
  const [shown] = useState(() => steps.filter((s) => !s.target || findVisible(s.target)));
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const step = shown[index];

  useEffect(() => {
    const el = step?.target ? findVisible(step.target) : null;
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });

    // Re-measure while the page scrolls (including that smooth scroll) or resizes.
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setRect(el ? el.getBoundingClientRect() : null));
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [step]);

  const isLast = index === shown.length - 1;
  const next = () => (isLast ? onClose() : setIndex((i) => i + 1));
  const back = () => setIndex((i) => Math.max(0, i - 1));

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!step) return null;

  const width = Math.min(CARD_W, window.innerWidth - EDGE * 2);
  const spot = step.target ? rect : null;

  return createPortal(
    <div className="fixed inset-0 z-[10000]" aria-live="polite">
      {/* Blocks clicks on the page while the tour runs. */}
      <div className="absolute inset-0" />

      {spot ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-xl ring-2 ring-emerald-400 transition-all duration-200 ease-out"
          style={{
            top: spot.top - PAD,
            left: spot.left - PAD,
            width: spot.width + PAD * 2,
            height: spot.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.6)',
          }}
        />
      ) : (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-slate-900/60" />
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="page-tour-title"
        className="absolute rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-900/10"
        style={{ width, ...cardPosition(spot, width) }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
          Step {index + 1} of {shown.length}
        </p>
        <h3 id="page-tour-title" className="mt-1 text-base font-bold text-slate-900">{step.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{step.body}</p>

        <div className="mt-4 flex items-center gap-1" aria-hidden="true">
          {shown.map((s, i) => (
            <span
              key={s.title}
              className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-emerald-600' : 'w-1.5 bg-slate-200'}`}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-slate-400 hover:text-slate-600"
          >
            {isLast ? 'Close' : 'Skip tour'}
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                type="button"
                onClick={back}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Back
              </button>
            )}
            <button
              key={index}
              type="button"
              onClick={next}
              autoFocus
              className="rounded-lg bg-emerald-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
