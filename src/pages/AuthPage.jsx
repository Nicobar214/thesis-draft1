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
      
      setSuccess(`${mode === "signin" ? "Signed in" : "Account created"} successfully!`);
      setEmail("");
      setPassword("");
      
      setTimeout(() => navigate("/dashboard"), 1500);
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
