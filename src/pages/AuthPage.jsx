/* AuthPage.jsx */
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate, Link } from "react-router-dom";

export default function AuthPage({ mode = "signin" }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleGoogleSignIn = async () => {
    setError("");
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/user`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setError(err.message || "Google sign-in failed. Please try again.");
      setLoading(false);
    }
  };

  const validateForm = () => {
    if (!email || !password) {
      setError("Email and password are required");
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email");
      return false;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return false;
    }
    return true;
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!validateForm()) return;

    setLoading(true);

    try {
      let response;
      if (mode === "signin") {
        response = await supabase.auth.signInWithPassword({ email, password });
      } else {
        response = await supabase.auth.signUp({ email, password });
      }

      if (response.error) throw response.error;

      const user = response.data?.user;

      if (mode === "signup" && user) {
        // Create profile with default 'user' role on signup
        await supabase.from('profiles').upsert({
          id: user.id,
          email: user.email,
          role: 'user',
          created_at: new Date().toISOString()
        });
      }
      
      setSuccess(`${mode === "signin" ? "Signed in" : "Account created"} successfully!`);
      setEmail("");
      setPassword("");
      
      // User side always goes to user dashboard
      setTimeout(() => navigate("/user"), 1500);
    } catch (err) {
      setError(err.message || "An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-emerald-700 text-white py-4 shadow-md">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold flex items-center gap-2 hover:text-emerald-100 transition">
            <span className="text-3xl">🛣️</span>
            <span>FMR Portal</span>
          </Link>
          {mode === "signin" ? (
            <p className="text-emerald-100">Don't have an account? <button onClick={() => navigate("/signup")} className="font-semibold hover:text-white transition">Sign Up</button></p>
          ) : (
            <p className="text-emerald-100">Already have an account? <button onClick={() => navigate("/signin")} className="font-semibold hover:text-white transition">Sign In</button></p>
          )}
        </div>
      </div>

      {/* Auth Form Container */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-lg shadow-md p-8">
            {/* Logo/Icon */}
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold text-emerald-700 mb-1">
                FMR Portal
              </h1>
              <p className="text-gray-600 text-sm">
                {mode === "signin" ? "Welcome back" : "Join the transparency movement"}
              </p>
            </div>

            {/* Form Title */}
            <h2 className="text-xl font-bold text-gray-900 mb-6 text-center">
              {mode === "signin" ? "Sign In" : "Create Account"}
            </h2>

            {/* Error Alert */}
            {error && (
              <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-4 py-4 rounded-lg text-sm mb-6">
                <p className="font-semibold">Error</p>
                <p>{error}</p>
              </div>
            )}

            {/* Success Alert */}
            {success && (
              <div className="bg-green-50 border-l-4 border-green-500 text-green-700 px-4 py-4 rounded-lg text-sm mb-6">
                <p className="font-semibold">Success!</p>
                <p>{success}</p>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleAuth} className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 transition"
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 transition"
                  disabled={loading}
                />
                {mode === "signup" && (
                  <p className="text-xs text-gray-500 mt-2">Minimum 6 characters for security</p>
                )}
              </div>

              {mode === "signin" && (
                <div className="flex items-center justify-between text-sm">
                  <label className="flex items-center">
                    <input type="checkbox" className="rounded border-gray-300 text-emerald-600" />
                    <span className="ml-2 text-gray-600">Remember me</span>
                  </label>
                  <a href="#" className="text-emerald-600 font-semibold hover:text-emerald-700">Forgot password?</a>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-700 text-white py-2 rounded-lg font-semibold hover:bg-emerald-800 transition disabled:bg-gray-400"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing...
                  </span>
                ) : (
                  mode === "signin" ? "Sign In" : "Create Account"
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="my-6 flex items-center">
              <div className="flex-1 border-t border-gray-300"></div>
              <span className="px-3 text-gray-400 text-sm">or</span>
              <div className="flex-1 border-t border-gray-300"></div>
            </div>

            {/* Google Sign In Button */}
            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-200 text-gray-700 font-semibold py-3 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition disabled:opacity-50"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </button>

            {/* Toggle */}
            <div className="text-center">
              <p className="text-gray-600 text-sm mb-4">
                {mode === "signin" ? "New to FMR Portal?" : "Already have an account?"}{" "}
              </p>
              <button
                onClick={() => navigate(mode === "signin" ? "/signup" : "/signin")}
                className="w-full border-2 border-emerald-700 text-emerald-700 font-semibold py-2 rounded-lg hover:bg-emerald-50 transition"
              >
                {mode === "signin" ? "Create an Account" : "Sign In Instead"}
              </button>
            </div>

            {/* Footer Text */}
            <p className="text-xs text-gray-600 text-center mt-6">
              By {mode === "signin" ? "signing in" : "creating an account"}, you agree to our{" "}
              <a href="#" className="text-emerald-700 hover:underline">Terms</a> and{" "}
              <a href="#" className="text-emerald-700 hover:underline">Privacy Policy</a>
            </p>
          </div>

          {/* Info Box */}
          <div className="mt-8 bg-emerald-50 border border-emerald-200 rounded-lg p-6">
            <h3 className="font-bold text-emerald-900 mb-3">Why Join FMR Portal?</h3>
            <ul className="space-y-2 text-sm text-emerald-800">
              <li className="flex items-start gap-2">
                <span className="text-lg">✓</span>
                <span>Track infrastructure projects in real-time</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-lg">✓</span>
                <span>Access accurate, verified road data</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-lg">✓</span>
                <span>Report issues and contribute feedback</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
