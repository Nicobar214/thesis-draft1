/* CopyReference.jsx — a report reference that copies itself when clicked,
 * with a short "Copied" confirmation. Used wherever a citizen is told to
 * quote their reference. */
import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / non-secure pages: fall back to a hidden textarea.
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      el.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export default function CopyReference({ value, className = '' }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => { if (await copyText(value)) setCopied(true); }}
      title={copied ? 'Copied' : 'Copy reference'}
      aria-label={copied ? `Reference ${value} copied` : `Copy reference ${value}`}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono font-semibold transition-colors ${
        copied ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
      } ${className}`}
    >
      {value}
      {copied ? <CheckIcon className="size-3.5" aria-hidden="true" /> : <CopyIcon className="size-3.5 text-slate-400" aria-hidden="true" />}
      <span className="sr-only" aria-live="polite">{copied ? 'Copied' : ''}</span>
    </button>
  );
}
