import { InfoIcon } from 'lucide-react';

/**
 * A friendly note above a step's main button, listing what is still needed before
 * it can be pressed. Each item is a button that jumps to that field. Hidden once
 * nothing is missing.
 *
 * missing: [{ key, label, targetId? }]
 */
export default function RequiredReminder({ missing, action = 'submit your report' }) {
  if (!missing?.length) return null;

  const jumpTo = (targetId) => {
    const el = targetId ? document.getElementById(targetId) : null;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
  };

  return (
    <div role="status" aria-live="polite" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
      <InfoIcon className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold">Almost there! Please finish {missing.length === 1 ? 'this' : 'these'} first before you can {action}:</p>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {missing.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => jumpTo(item.targetId)}
                className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                <span aria-hidden="true">•</span> {item.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
