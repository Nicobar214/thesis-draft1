/* FieldEngineerAuth.jsx – Login page for field engineers */
import { useState } from "react";
import { supabaseFieldEngineer as supabase } from "../lib/supabase";
import { useNavigate, Link } from "react-router-dom";
import Logo from "../components/Logo";
import AuthBackground from "../components/AuthBackground";

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export default function FieldEngineerAuth() {
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
        // No profile row found or query failed – use auth metadata as fallback
        userRole = normalizeRole(data.user.user_metadata?.role || null);
        console.log("Using user_metadata role:", userRole);

        // Try to create the missing profile row in the background
        if (userRole === "field_engineer") {
          const { error: rpcErr } = await supabase.rpc("create_field_engineer_profile", {
            user_id: data.user.id,
            user_email: email,
            user_name: data.user.user_metadata?.full_name || "",
            user_phone: "",
          });
          if (rpcErr) {
            console.warn("RPC profile create failed:", rpcErr);
            // Try direct insert as fallback
            const { error: insertErr } = await supabase.from("profiles").upsert({
              id: data.user.id,
              email: email,
              full_name: data.user.user_metadata?.full_name || "",
              phone: "",
              role: "field_engineer",
            }, { onConflict: "id" });
            if (insertErr) console.warn("Profile upsert also failed:", insertErr);
          }
        }
      }

      if (userRole !== "field_engineer") {
        await supabase.auth.signOut();
        setError("Access denied. This login is for field engineers only.");
        setLoading(false);
        return;
      }

      navigate("/field-engineer");
    } catch (err) {
      setError(err.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col justify-between bg-slate-950 px-4 py-8 sm:py-12 overflow-hidden">
      <AuthBackground accent="cyan" />

      <div className="relative flex-1 flex items-center justify-center">
        <div className="max-w-md w-full">
          <div className="bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl p-6 sm:p-8 border border-cyan-500/20">
            {/* Header */}
            <div className="text-center mb-6 sm:mb-8">
              <Logo className="h-9 mx-auto mb-5" />
              <div className="inline-flex items-center justify-center w-16 h-16 bg-cyan-100/90 rounded-2xl mb-3 shadow-inner">
                <svg className="w-8 h-8 text-cyan-700" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
                </svg>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Field Engineer</h1>
              <p className="text-cyan-700 text-xs sm:text-sm mt-1 font-semibold uppercase tracking-wider">KalsaTrack Field Inspection Portal</p>
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
                  placeholder="engineer@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-12 px-4 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100 transition text-sm text-slate-900 bg-white"
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
                    className="w-full h-12 pl-4 pr-10 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100 transition text-sm text-slate-900 bg-white"
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
                className="w-full h-12 bg-gradient-to-r from-cyan-600 to-sky-600 text-white rounded-xl font-bold hover:from-cyan-700 hover:to-sky-700 active:scale-[0.99] transition-all shadow-lg shadow-cyan-500/25 disabled:opacity-50 text-sm flex items-center justify-center"
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
                  "Sign In to Field Portal"
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <Link to="/" className="text-xs sm:text-sm text-slate-500 hover:text-cyan-600 transition font-semibold inline-flex items-center gap-1">
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
