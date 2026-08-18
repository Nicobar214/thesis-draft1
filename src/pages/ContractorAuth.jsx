/* ContractorAuth.jsx – Login page for contractors */
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate, Link } from "react-router-dom";
import Logo from "../components/Logo";

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export default function ContractorAuth() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async (e) => {
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

      // Determine the user's role – try profiles table first, fall back to user_metadata
      let userRole = null;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle();

      if (profileError) {
        console.warn("Profile lookup error (will use metadata fallback):", profileError);
      }

      if (profile) {
        userRole = normalizeRole(profile.role);
      } else {
        userRole = normalizeRole(data.user.user_metadata?.role || null);

        // Try to create the missing profile row in the background
        if (userRole === "contractor") {
          const { error: upsertErr } = await supabase.from("profiles").upsert({
            id: data.user.id,
            email: email,
            full_name: data.user.user_metadata?.full_name || "",
            phone: "",
            role: "contractor",
          }, { onConflict: "id" });
          if (upsertErr) console.warn("Profile upsert failed:", upsertErr);
        }
      }

      if (userRole !== "contractor") {
        await supabase.auth.signOut();
        setError("Access denied. This login is for contractors only.");
        setLoading(false);
        return;
      }

      navigate("/contractor");
    } catch (err) {
      setError(err.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col justify-between bg-gradient-to-br from-slate-950 via-amber-950 to-slate-900 px-4 py-8 sm:py-12 overflow-hidden">
      {/* Ambient background glow */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-24 -right-16 w-80 h-80 rounded-full bg-amber-500/20 blur-[100px]" />
        <div className="absolute bottom-0 left-0 w-96 h-96 rounded-full bg-orange-500/10 blur-[110px]" />
      </div>

      <div className="relative flex-1 flex items-center justify-center">
        <div className="max-w-md w-full">
          <div className="bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl p-6 sm:p-8 border border-amber-500/20">
            {/* Header */}
            <div className="text-center mb-6 sm:mb-8">
              <Logo className="h-9 mx-auto mb-5" />
              <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100/90 rounded-2xl mb-3 shadow-inner">
                <svg className="w-8 h-8 text-amber-700" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
                </svg>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Contractor Portal</h1>
              <p className="text-amber-700 text-xs sm:text-sm mt-1 font-semibold uppercase tracking-wider">KalsaTrack Project Progress Portal</p>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 rounded-xl text-sm mb-6 animate-pulse">
                <p className="font-semibold">Access Denied</p>
                <p className="text-xs sm:text-sm mt-0.5">{error}</p>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleLogin} className="space-y-4 sm:space-y-5">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">Email</label>
                <input
                  type="email"
                  placeholder="contractor@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-12 px-4 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 transition text-sm text-slate-900 bg-white"
                  disabled={loading}
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-12 pl-4 pr-10 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 transition text-sm text-slate-900 bg-white"
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
                className="w-full h-12 bg-gradient-to-r from-amber-600 to-orange-600 text-white rounded-xl font-bold hover:from-amber-700 hover:to-orange-700 active:scale-[0.99] transition-all shadow-lg shadow-amber-500/25 disabled:opacity-50 text-sm flex items-center justify-center"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Signing in...
                  </span>
                ) : (
                  "Sign In to Contractor Portal"
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <Link to="/" className="text-xs sm:text-sm text-slate-500 hover:text-amber-600 transition font-semibold inline-flex items-center gap-1">
                ← Back to KalsaTrack Home
              </Link>
            </div>
          </div>
        </div>
      </div>

      <p className="relative text-center text-[11px] sm:text-xs text-slate-400 mt-6 leading-relaxed max-w-sm mx-auto">
        Contact your administrator if you need access credentials.
      </p>
    </div>
  );
}
