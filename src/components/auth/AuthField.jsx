import { useId, useState } from 'react';

/* AuthField — one labelled, accessible input for the auth forms.
 *
 * Exists because email / password / confirm-password were three near-identical
 * blocks of markup, and all of the accessibility wiring (label association,
 * error linkage, the password toggle's accessible name) has to be right in
 * every one of them. Getting it right once here beats getting it right three
 * times by hand.
 *
 * Visual styling is copied from the previous inline inputs so the refactor
 * changes behaviour, not appearance.
 */
export default function AuthField({
  label,
  type = 'text',
  value,
  onChange,
  error,
  hint,
  disabled,
  autoComplete,
  name,
  placeholder,
  inputMode,
  required = true,
  revealable = false,
}) {
  const reactId = useId();
  const inputId = `auth-${name || reactId}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const [revealed, setRevealed] = useState(false);

  const isPassword = revealable && type === 'password';
  const resolvedType = isPassword && revealed ? 'text' : type;

  // Only reference description ids that are actually rendered, otherwise a
  // screen reader announces a dangling reference.
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(' ') || undefined;

  const borderCls = error
    ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
    : 'border-slate-200 focus:border-emerald-500 focus:ring-emerald-100';

  return (
    <div>
      <label
        htmlFor={inputId}
        className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5"
      >
        {label}
      </label>

      <div className="relative">
        <input
          id={inputId}
          name={name}
          type={resolvedType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          autoComplete={autoComplete}
          inputMode={inputMode}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          className={`w-full h-12 pl-4 ${isPassword ? 'pr-12' : 'pr-4'} border-2 ${borderCls} rounded-xl focus:outline-none focus:ring-2 transition text-sm text-slate-900 bg-white disabled:bg-slate-50 disabled:text-slate-400`}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            // Icon-only control: it needs a name for screen readers, and
            // aria-pressed so its on/off state is announced.
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 grid place-items-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-colors"
          >
            {revealed ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.076m3.19-2.905A9.96 9.96 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21m-16-16l16 16M12 14a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Error carries an icon as well as red text, so the message does not
          depend on colour alone. */}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-red-600">
          <svg className="w-3.5 h-3.5 mt-px shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path fillRule="evenodd" d="M18 10A8 8 0 112 10a8 8 0 0116 0zm-8-4a1 1 0 00-1 1v3a1 1 0 002 0V7a1 1 0 00-1-1zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <span>{error}</span>
        </p>
      )}

      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-slate-500">{hint}</p>
      )}
    </div>
  );
}
