/* AdminAuthPage.jsx - Clean admin-only login (no landing page, no signup) */
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import AuthBackground from "../components/AuthBackground";

export default function AdminAuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Email and password are required");
      return;
    }

    setLoading(true);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) throw authError;

      // Admin emails — add your admin emails here
      const adminEmails = ['gab@gmail.com'];

      if (!adminEmails.includes(email.toLowerCase())) {
        await supabase.auth.signOut();
        setError("Access denied. This login is for administrators only.");
        setLoading(false);
        return;
      }

      // Admin verified — go to dashboard
      navigate("/dashboard");
    } catch (err) {
      setError(err.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-slate-950 px-4 overflow-hidden">
      <AuthBackground accent="rose" />

      <div className="relative max-w-md w-full mx-4">
        <div className="bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl p-6 sm:p-8 border border-rose-500/20">
          {/* Admin Badge */}
          <div className="text-center mb-6 sm:mb-8">
            <Logo className="h-9 mx-auto mb-5" />
            <div className="inline-flex items-center justify-center w-16 h-16 bg-rose-100/90 rounded-2xl mb-3 shadow-inner">
              <svg className="w-8 h-8 text-rose-700" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Admin Login</h1>
            <p className="text-rose-700 text-xs sm:text-sm mt-1 font-semibold uppercase tracking-wider">KalsaTrack Administrator Access</p>
          </div>

          {/* Error Alert */}
          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 rounded-xl text-sm mb-6 animate-pulse">
              <p className="font-semibold">Access Denied</p>
              <p className="text-xs sm:text-sm mt-0.5">{error}</p>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleAdminLogin} className="space-y-4 sm:space-y-5">
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                Admin Email
              </label>
              <input
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-12 px-4 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100 transition text-sm text-slate-900 bg-white"
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-12 pl-4 pr-10 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100 transition text-sm text-slate-900 bg-white"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none transition-colors"
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.076m3.19-2.905A9.96 9.96 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21m-16-16l16 16M12 14a2 2 0 110-4 2 2 0 010 4z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-gradient-to-r from-rose-700 to-slate-800 text-white rounded-xl font-bold hover:from-rose-800 hover:to-slate-900 active:scale-[0.99] transition-all shadow-lg shadow-rose-500/25 disabled:opacity-50 text-sm flex items-center justify-center"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Verifying...
                </span>
              ) : (
                "Sign In as Admin"
              )}
            </button>
          </form>

          {/* Footer */}
          <p className="text-[11px] sm:text-xs text-slate-400 text-center mt-6 leading-relaxed">
            Authorized personnel only. Unauthorized access is prohibited.
          </p>
        </div>
      </div>
    </div>
  );
}
