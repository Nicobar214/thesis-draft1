import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/**
 * ProtectedRoute - Guards routes based on authentication and role
 * @param {string} requiredRole - 'admin' or 'user' (optional, if not set any authenticated user can access)
 */
export default function ProtectedRoute({ children, requiredRole }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();

        if (!currentUser) {
          setLoading(false);
          return;
        }

        setUser(currentUser);

        // Fetch role from profiles table, fall back to user_metadata
        try {
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', currentUser.id)
            .maybeSingle();

          if (profileError) {
            console.warn('Profile query error, using metadata fallback:', profileError);
            setRole(currentUser.user_metadata?.role || 'user');
          } else if (profile) {
            setRole(profile.role || 'user');
          } else {
            // No profile row – use metadata role
            setRole(currentUser.user_metadata?.role || 'user');
          }
        } catch {
          setRole(currentUser.user_metadata?.role || 'user');
        }
      } catch (err) {
        console.error('Auth check error:', err);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-700 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Not logged in → redirect to sign in
  if (!user) {
    return <Navigate to="/signin" replace />;
  }

  // Role check: if a specific role is required and user doesn't have it
  if (requiredRole && role !== requiredRole) {
    // Admin trying to access other pages → send to dashboard
    if (role === 'admin') {
      return <Navigate to="/dashboard" replace />;
    }
    // Field engineer trying to access other pages → send to field engineer dashboard
    if (role === 'field_engineer') {
      return <Navigate to="/field-engineer" replace />;
    }
    // Contractor trying to access other pages → send to contractor dashboard
    if (role === 'contractor') {
      return <Navigate to="/contractor" replace />;
    }
    // User trying to access admin/engineer pages → send to user dashboard
    return <Navigate to="/user" replace />;
  }

  return children;
}
