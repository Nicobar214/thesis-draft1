/* FieldEngineerAuth.jsx – Login page for field engineers */
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate, Link } from "react-router-dom";

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
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-teal-100 rounded-2xl mb-4">
              <svg className="w-8 h-8 text-teal-700" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Field Engineer</h1>
            <p className="text-slate-500 text-sm mt-1">KalsaTrack — Field Inspection Portal</p>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-4 py-3 rounded-lg text-sm mb-6">
              <p className="font-semibold">Access Denied</p>
              <p>{error}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Email</label>
              <input
                type="email"
                placeholder="engineer@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition text-sm"
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
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition text-sm"
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-teal-600 to-teal-500 text-white py-3 rounded-xl font-semibold hover:from-teal-700 hover:to-teal-600 transition-all shadow-lg shadow-teal-500/25 disabled:opacity-50 text-sm"
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
            <Link to="/" className="text-sm text-slate-500 hover:text-teal-600 transition font-medium">
              ← Back to Home
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          Contact your administrator if you need access credentials.
        </p>
      </div>
    </div>
  );
}
