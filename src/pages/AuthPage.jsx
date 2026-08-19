/* AuthPage.jsx — citizen sign in / sign up.
 *
 * One page, three states (signin | signup | forgot) inside a split-screen
 * shell. Switching between sign in and sign up slides the two panels past each
 * other instead of navigating away, so nothing typed is lost — but the URL is
 * still kept in sync, so /signin and /signup remain real, linkable routes.
 *
 * The Supabase calls, the profiles upsert and the role-based redirect are
 * unchanged from the previous version; only the presentation, validation and
 * error handling were reworked.
 */
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate, Link } from "react-router-dom";
import Logo from "../components/Logo";
import AuthBackground from "../components/AuthBackground";
import AuthField from "../components/auth/AuthField";
import { toFriendlyAuthError, validateAuthFields } from "../lib/authErrors";

const REMEMBER_KEY = "kalsatrack:remembered-email";

/* localStorage throws in private browsing / blocked-cookie modes. Remembering
   an email is a convenience, never a reason to break sign-in. */
const safeStorage = {
  get(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
  },
  remove(key) {
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function resolveEffectiveRole(profileRole, metadataRole) {
  const normalizedProfileRole = normalizeRole(profileRole);
  const normalizedMetadataRole = normalizeRole(metadataRole);

  if (normalizedProfileRole && normalizedProfileRole !== "user") return normalizedProfileRole;
  if (normalizedMetadataRole && normalizedMetadataRole !== "user") return normalizedMetadataRole;
  return normalizedProfileRole || normalizedMetadataRole || "user";
}

/* Signed-in landing page per role. Kept identical to the previous behaviour so
   an admin signing in here still reaches the DA dashboard. */
function routeForRole(role) {
  if (role === "admin") return "/dashboard";
  if (role === "field_engineer") return "/field-engineer";
  if (role === "contractor") return "/contractor";
  if (role === "lgu") return "/lgu";
  return "/user";
}

const BENEFITS = [
  "Track infrastructure projects in real-time",
  "Access accurate, verified road data",
  "Report issues and contribute feedback",
];

export default function AuthPage({ mode = "signin" }) {
  const navigate = useNavigate();

  /* `mode` (from the route) seeds this, but internal state drives rendering so
     the panels can animate without waiting on a navigation. */
  const [activeMode, setActiveMode] = useState(mode);
  const routeModeRef = useRef(mode);

  const [email, setEmail] = useState(() => safeStorage.get(REMEMBER_KEY) || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(() => Boolean(safeStorage.get(REMEMBER_KEY)));

  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  /* Held true from a successful submit until the redirect fires, so the submit
     button cannot be pressed a second time during the delay. */
  const [redirecting, setRedirecting] = useState(false);

  const isSignup = activeMode === "signup";
  const isForgot = activeMode === "forgot";
  const busy = loading || redirecting;

  /* Re-sync when the route changes from outside the page (back button, a pasted
     link). Guarded by the ref so it never fights the in-page toggle below. */
  useEffect(() => {
    if (mode !== routeModeRef.current) {
      routeModeRef.current = mode;
      setActiveMode(mode);
    }
  }, [mode]);

  const clearMessages = () => {
    setFieldErrors({});
    setFormError("");
    setSuccess("");
  };

  const switchMode = (next) => {
    if (next === activeMode) return;
    clearMessages();
    setConfirmPassword("");
    setActiveMode(next);

    // 'forgot' is a variation of signing in, not its own route.
    if (next === "signin" || next === "signup") {
      routeModeRef.current = next;
      navigate(next === "signin" ? "/signin" : "/signup", { replace: true });
    }
  };

  const handleGoogleSignIn = async () => {
    clearMessages();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/user` },
      });
      if (error) throw error;
      // On success the browser leaves for Google, so loading stays true.
    } catch (err) {
      setFormError(toFriendlyAuthError(err, "signin").message);
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    clearMessages();

    const errors = validateAuthFields({ email, password, mode: "forgot" });
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }

    setLoading(true);
    try {
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/signin`,
      });
    } catch (err) {
      // Deliberately swallowed: see the neutral message below.
      console.error("Password reset request failed:", err);
    } finally {
      setLoading(false);
    }

    /* Always the same confirmation whether or not the address is registered —
       otherwise this form becomes a way to discover who has an account. */
    setSuccess(
      "If an account exists for that email, we've sent a password reset link. Please check your inbox."
    );
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    clearMessages();

    const errors = validateAuthFields({ email, password, confirmPassword, mode: activeMode });
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }

    setLoading(true);

    try {
      const trimmedEmail = email.trim();
      let response;

      if (activeMode === "signin") {
        response = await supabase.auth.signInWithPassword({ email: trimmedEmail, password });
      } else {
        /* Public signup always creates a citizen account. The role used to come
           from a ?role= query parameter, which meant /signup?role=admin minted
           an administrator. Staff accounts are created by an admin in Settings
           or through each portal's own login instead. */
        response = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: { data: { role: "user" } },
        });
      }

      if (response.error) throw response.error;

      const user = response.data?.user;

      if (activeMode === "signup" && user) {
        await supabase.from("profiles").upsert({
          id: user.id,
          email: user.email,
          role: "user",
          created_at: new Date().toISOString(),
        });
      }

      if (rememberMe) safeStorage.set(REMEMBER_KEY, trimmedEmail);
      else safeStorage.remove(REMEMBER_KEY);

      let targetRoute = "/user";
      if (activeMode === "signin" && user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();

        targetRoute = routeForRole(
          resolveEffectiveRole(profile?.role, user.user_metadata?.role)
        );
      }

      setSuccess(
        activeMode === "signin" ? "Signed in successfully." : "Account created successfully."
      );
      setPassword("");
      setConfirmPassword("");

      /* Stay disabled across the delay — previously `finally` re-enabled the
         button here, which allowed a second submit while the redirect waited. */
      setRedirecting(true);
      setLoading(false);
      setTimeout(() => navigate(targetRoute), 1500);
    } catch (err) {
      const friendly = toFriendlyAuthError(err, activeMode);
      if (friendly.field) setFieldErrors({ [friendly.field]: friendly.message });
      else setFormError(friendly.message);
      setLoading(false);
    }
  };

  const heading = isForgot ? "Reset your password" : isSignup ? "Create your account" : "Welcome back";
  const subheading = isForgot
    ? "Enter your email and we'll send you a reset link."
    : isSignup
      ? "Join the transparency movement in Region VI."
      : "Sign in to track farm-to-market road projects.";

  const submitLabel = isForgot ? "Send reset link" : isSignup ? "Create Account" : "Sign In";
  const busyLabel = isForgot ? "Sending…" : isSignup ? "Creating account…" : "Signing in…";

  return (
    <div
      className="relative min-h-[100dvh] bg-emerald-950 flex items-center justify-center overflow-hidden"
      style={{
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        paddingLeft: "max(1rem, env(safe-area-inset-left))",
        paddingRight: "max(1rem, env(safe-area-inset-right))",
      }}
    >
      {/* The panel slide uses a plain `transform` rather than Tailwind's
          translate utilities. Tailwind v4 implements translate-x-* through a
          `--tw-translate-x` custom property registered with syntax:"*", which
          does not transition reliably — the class swaps but the panel stays
          put. A direct transform on transform-only properties is both
          deterministic and GPU-friendly. */}
      <style>{`
        @keyframes kt-auth-fade {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: none; }
        }
        .kt-auth-fade { animation: kt-auth-fade 340ms cubic-bezier(0.4, 0, 0.2, 1) both; }
        .kt-panel { transition: transform 420ms cubic-bezier(0.4, 0, 0.2, 1); will-change: transform; }
        @media (min-width: 64rem) {
          .kt-panel-form.kt-is-signup  { transform: translateX(100%); }
          .kt-panel-brand.kt-is-signup { transform: translateX(-100%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .kt-auth-fade { animation: none; }
          .kt-panel { transition: none; }
        }
      `}</style>

      <AuthBackground accent="emerald" />

      <div className="relative w-full max-w-5xl">
        {/* flex-col-reverse puts the brand strip above the form on mobile while
            keeping the form first in the DOM, so it stays first in tab order. */}
        <div className="relative flex flex-col-reverse lg:grid lg:grid-cols-2 rounded-3xl overflow-hidden shadow-2xl bg-white lg:min-h-[620px]">

          {/* ── Form panel ── */}
          <div
            className={`kt-panel kt-panel-form ${isSignup ? "kt-is-signup" : ""} relative z-10 bg-white flex items-center justify-center p-6 sm:p-10`}
          >
            <div key={activeMode} className="kt-auth-fade w-full max-w-sm">
              <div className="lg:hidden mb-5">
                <Logo className="h-8" />
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                {heading}
              </h1>
              <p className="text-sm text-slate-500 mt-1.5">{subheading}</p>

              {formError && (
                <div
                  role="alert"
                  className="mt-5 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm"
                >
                  <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M18 10A8 8 0 112 10a8 8 0 0116 0zm-8-4a1 1 0 00-1 1v3a1 1 0 002 0V7a1 1 0 00-1-1zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                  <span>{formError}</span>
                </div>
              )}

              {success && (
                <div
                  role="status"
                  className="mt-5 flex items-start gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-sm"
                >
                  <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>{success}</span>
                </div>
              )}

              <form onSubmit={isForgot ? handleForgotPassword : handleAuth} className="mt-6 space-y-4" noValidate>
                <AuthField
                  label="Email address"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={setEmail}
                  error={fieldErrors.email}
                  disabled={busy}
                />

                {!isForgot && (
                  <AuthField
                    label="Password"
                    name="password"
                    type="password"
                    revealable
                    autoComplete={isSignup ? "new-password" : "current-password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={setPassword}
                    error={fieldErrors.password}
                    hint={isSignup ? "At least 6 characters." : undefined}
                    disabled={busy}
                  />
                )}

                {isSignup && (
                  <AuthField
                    label="Confirm password"
                    name="confirmPassword"
                    type="password"
                    revealable
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    error={fieldErrors.confirmPassword}
                    disabled={busy}
                  />
                )}

                {activeMode === "signin" && (
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        name="rememberMe"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        disabled={busy}
                        className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-2 focus:ring-emerald-500/30"
                      />
                      <span className="text-xs sm:text-sm text-slate-600">Remember my email</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      disabled={busy}
                      className="text-xs sm:text-sm font-semibold text-emerald-700 hover:text-emerald-800 hover:underline focus:outline-none focus:ring-2 focus:ring-emerald-500/30 rounded px-1 py-0.5 disabled:opacity-50"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-12 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl font-bold hover:from-emerald-700 hover:to-teal-700 active:scale-[0.99] transition-all shadow-lg shadow-emerald-500/25 disabled:opacity-60 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-2"
                >
                  {busy ? (
                    <>
                      <svg className="w-4 h-4 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {busyLabel}
                    </>
                  ) : (
                    submitLabel
                  )}
                </button>
              </form>

              {isForgot ? (
                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className="mt-5 w-full text-sm font-semibold text-slate-600 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 rounded-lg py-2"
                >
                  ← Back to sign in
                </button>
              ) : (
                <>
                  <div className="my-5 flex items-center">
                    <div className="flex-1 border-t border-slate-200" />
                    <span className="px-3 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">or</span>
                    <div className="flex-1 border-t border-slate-200" />
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={busy}
                    className="w-full h-12 flex items-center justify-center gap-3 bg-white border-2 border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 hover:border-slate-300 transition disabled:opacity-50 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Continue with Google
                  </button>

                  <p className="text-center text-sm text-slate-500 mt-5">
                    {isSignup ? "Already have an account?" : "New to KalsaTrack?"}{" "}
                    <button
                      type="button"
                      onClick={() => switchMode(isSignup ? "signin" : "signup")}
                      className="font-bold text-emerald-700 hover:text-emerald-800 hover:underline focus:outline-none focus:ring-2 focus:ring-emerald-500/30 rounded px-1"
                    >
                      {isSignup ? "Sign in" : "Create one"}
                    </button>
                  </p>

                  <p className="text-[11px] text-slate-400 text-center mt-4 leading-relaxed">
                    By continuing, you agree to our{" "}
                    <Link to="/reports" className="text-slate-500 hover:text-emerald-700 hover:underline">Terms</Link>{" "}
                    and{" "}
                    <Link to="/reports" className="text-slate-500 hover:text-emerald-700 hover:underline">Privacy Policy</Link>
                  </p>
                </>
              )}
            </div>
          </div>

          {/* ── Brand panel ── */}
          <div
            className={`kt-panel kt-panel-brand ${isSignup ? "kt-is-signup" : ""} relative overflow-hidden bg-emerald-950 px-6 py-8 lg:p-10 flex flex-col justify-center`}
          >
            <AuthBackground accent="emerald" />

            <div className="relative">
              <Link to="/" className="hidden lg:inline-block mb-8 hover:opacity-85 transition-opacity">
                <Logo tone="light" className="h-9" />
              </Link>

              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
                DA Region VI
              </p>
              <h2 className="text-xl lg:text-3xl font-extrabold text-white mt-2 leading-tight">
                Farm-to-Market Road Transparency
              </h2>

              <ul className="hidden lg:block mt-8 space-y-3">
                {BENEFITS.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-3 text-sm text-emerald-50/90">
                    <svg className="w-5 h-5 shrink-0 text-emerald-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>

              <Link
                to="/"
                className="hidden lg:inline-flex items-center gap-1.5 mt-10 text-xs font-semibold text-emerald-200 hover:text-white transition-colors"
              >
                ← Back to home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
