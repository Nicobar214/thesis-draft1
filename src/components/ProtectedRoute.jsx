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

        // Fetch role from profiles table
        try {
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', currentUser.id)
            .single();

          if (profileError) {
            console.log('Profiles table may not exist yet, defaulting to user role');
            setRole('user');
          } else {
            setRole(profile?.role || 'user');
          }
        } catch {
          setRole('user');
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
    // Admin trying to access user pages → send to dashboard
    if (role === 'admin') {
      return <Navigate to="/dashboard" replace />;
    }
    // User trying to access admin pages → send to user dashboard
    return <Navigate to="/user" replace />;
  }

  return children;
}
