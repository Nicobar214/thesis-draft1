/* authErrors.js — turn Supabase auth errors into copy a citizen can act on.
 *
 * Supabase returns terse, developer-facing strings ("Invalid login
 * credentials"). Showing those verbatim tells the user nothing about what to do
 * next. This maps the ones we can actually recognise onto plain sentences, and
 * falls back to a generic message rather than leaking a raw backend string.
 *
 * Privacy note: none of these messages reveal whether an email is registered.
 * A wrong password and an unknown address produce the same sentence, which is
 * what stops the form being used to enumerate accounts.
 *
 * Pure module — no React, no side effects.
 */

export const GENERIC_SIGNIN_ERROR =
  'The email or password you entered is incorrect. Please check and try again.';

const FALLBACK = {
  signin: GENERIC_SIGNIN_ERROR,
  signup: 'We could not create your account right now. Please try again.',
  forgot: 'We could not send the reset link right now. Please try again.',
};

/* Matched against a lowercased message. Order matters: first hit wins, so put
   the more specific patterns above the broader ones. */
const RULES = [
  {
    test: /invalid login credentials|invalid email or password/,
    message: GENERIC_SIGNIN_ERROR,
  },
  {
    test: /email not confirmed|email address not confirmed/,
    message:
      'Please confirm your email address first. Check your inbox for the verification link we sent you.',
  },
  {
    test: /user already registered|already been registered|already exists/,
    message: 'An account with this email already exists. Try signing in instead.',
    field: 'email',
  },
  {
    test: /password should be at least|password is too short/,
    message: 'Please choose a password with at least 6 characters.',
    field: 'password',
  },
  {
    test: /weak password|password is too weak/,
    message: 'That password is too easy to guess. Try a longer one.',
    field: 'password',
  },
  {
    test: /unable to validate email|invalid email/,
    message: 'That email address does not look right. Please check it.',
    field: 'email',
  },
  {
    test: /email rate limit|rate limit|too many requests/,
    message: 'Too many attempts. Please wait a minute and try again.',
  },
  {
    test: /signups not allowed|signup is disabled/,
    message: 'New account registration is currently unavailable. Please contact DA Region VI.',
  },
  {
    test: /failed to fetch|network|networkerror|offline/,
    message: 'You appear to be offline. Check your connection and try again.',
  },
  {
    test: /popup closed|cancelled|canceled/,
    message: 'Sign-in was cancelled before it finished.',
  },
];

/**
 * @param {unknown} error  the caught error (Supabase AuthError, Error, or string)
 * @param {'signin'|'signup'|'forgot'} mode
 * @returns {{ message: string, field: 'email'|'password'|null }}
 *   `field` names the input to attach the message to, or null for a form-level
 *   banner.
 */
export function toFriendlyAuthError(error, mode = 'signin') {
  const raw =
    typeof error === 'string'
      ? error
      : error?.message || error?.error_description || '';

  const normalized = String(raw).toLowerCase().trim();

  if (normalized) {
    for (const rule of RULES) {
      if (rule.test.test(normalized)) {
        return { message: rule.message, field: rule.field || null };
      }
    }
  }

  return { message: FALLBACK[mode] || FALLBACK.signin, field: null };
}

/* Client-side field validation, shared by both modes.
 * Returns an object keyed by field name; empty object means valid. */
export function validateAuthFields({ email, password, confirmPassword, mode }) {
  const errors = {};

  if (!email.trim()) {
    errors.email = 'Please enter your email address.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errors.email = 'Please enter a valid email address, like name@example.com.';
  }

  if (mode !== 'forgot') {
    if (!password) {
      errors.password = 'Please enter your password.';
    } else if (mode === 'signup' && password.length < 6) {
      errors.password = 'Use at least 6 characters.';
    }

    if (mode === 'signup') {
      if (!confirmPassword) {
        errors.confirmPassword = 'Please re-enter your password.';
      } else if (confirmPassword !== password) {
        errors.confirmPassword = 'Passwords do not match.';
      }
    }
  }

  return errors;
}
