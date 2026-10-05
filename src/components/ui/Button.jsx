/**
 * Shared button styles.
 *
 * Colour carries meaning, and the same meaning is used everywhere:
 *   primary   - the one main, safe action in a view (brand teal)
 *   secondary - cancel / back / any alternative (neutral outline)
 *   danger    - destructive or irreversible: delete, reject, close case (red)
 *   warning   - caution but recoverable: return for revision (amber)
 *   ghost     - low-emphasis tertiary action
 *
 * Use <Button> for new code. Legacy markup can adopt the same look with
 * className={buttonClass('primary')}.
 */

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const SIZES = {
  md: 'h-10 px-4 text-sm',
  sm: 'h-9 px-3 text-xs',
  xs: 'h-8 px-2.5 text-[11px]',
};

const VARIANTS = {
  primary: 'bg-teal-600 text-white shadow-sm hover:bg-teal-700 active:bg-teal-800 focus-visible:ring-teal-500',
  secondary:
    'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 active:bg-slate-100 focus-visible:ring-slate-400',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800 focus-visible:ring-red-500',
  dangerOutline:
    'border border-red-300 bg-white text-red-700 hover:bg-red-50 active:bg-red-100 focus-visible:ring-red-500',
  warning: 'bg-amber-500 text-slate-950 shadow-sm hover:bg-amber-400 active:bg-amber-600 focus-visible:ring-amber-500',
  ghost: 'text-slate-600 hover:bg-slate-100 active:bg-slate-200 focus-visible:ring-slate-400',
};

export function buttonClass(variant = 'primary', size = 'md', extra = '') {
  return `${BASE} ${SIZES[size] || SIZES.md} ${VARIANTS[variant] || VARIANTS.primary} ${extra}`.trim();
}

export function Spinner({ className = 'size-4' }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  type = 'button',
  className = '',
  children,
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export default Button;
