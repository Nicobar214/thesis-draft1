/* LguAuth.jsx - Login page for LGU accounts */
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate, Link } from "react-router-dom";

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

export default function LguAuth() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

      let userRole = null;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle();

      if (profileError) {
        console.warn("Profile lookup error (will use metadata fallback):", profileError);
      }

      userRole = resolveEffectiveRole(profile?.role, data.user.user_metadata?.role);

      if (userRole !== "lgu") {
        await supabase.auth.signOut();
        setError("Access denied. This login is for LGU accounts only.");
        setLoading(false);
        return;
      }

      navigate("/lgu");
    } catch (err) {
      setError(err.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-100 rounded-2xl mb-4">
              <svg className="w-8 h-8 text-indigo-700" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M4.5 21V7.5l7.5-4.5 7.5 4.5V21M9 9.75h6M9 13.5h6M9 17.25h6" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">LGU Portal</h1>
            <p className="text-slate-500 text-sm mt-1">KalsaTrack — Local Oversight Access</p>
          </div>

          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-4 py-3 rounded-lg text-sm mb-6">
              <p className="font-semibold">Access Denied</p>
              <p>{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Email</label>
              <input
                type="email"
                placeholder="lgu@example.gov.ph"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition text-sm"
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition text-sm"
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-indigo-600 to-indigo-500 text-white py-3 rounded-xl font-semibold hover:from-indigo-700 hover:to-indigo-600 transition-all shadow-lg shadow-indigo-500/25 disabled:opacity-50 text-sm"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Signing in...
                </span>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link to="/" className="text-sm text-slate-500 hover:text-indigo-600 transition font-medium">
              ← Back to Home
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          Contact your administrator if you need LGU credentials.
        </p>
      </div>
    </div>
  );
}
