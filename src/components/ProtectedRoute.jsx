import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { getSupabaseForRole } from '../lib/supabase';
import Logo from './Logo';

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function resolveEffectiveRole(profileRole, metadataRole) {
  const normalizedProfileRole = normalizeRole(profileRole);
  const normalizedMetadataRole = normalizeRole(metadataRole);

  if (normalizedProfileRole && normalizedProfileRole !== 'user') return normalizedProfileRole;
  if (normalizedMetadataRole && normalizedMetadataRole !== 'user') return normalizedMetadataRole;
  return normalizedProfileRole || normalizedMetadataRole || 'user';
}

function getLoginRouteForRequiredRole(requiredRole) {
  const role = normalizeRole(requiredRole);
  if (role === 'admin') return '/admin';
  if (role === 'field_engineer') return '/field-engineer/login';
  if (role === 'contractor') return '/contractor/login';
  if (role === 'lgu') return '/lgu/login';
  if (role === 'farmer') return '/farmer/login';
  return '/signin';
}

/**
 * ProtectedRoute - Guards routes based on authentication and role
 * @param {string} requiredRole - 'admin', 'field_engineer', 'contractor', 'lgu', 'farmer', 'user'
 */
export default function ProtectedRoute({ children, requiredRole }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const client = getSupabaseForRole(requiredRole);
        const { data: { user: currentUser } } = await client.auth.getUser();

        if (!currentUser) {
          setLoading(false);
          return;
        }

        setUser(currentUser);

        // Fetch role from profiles table, fall back to user_metadata
        try {
          const { data: profile, error: profileError } = await client
            .from('profiles')
            .select('role')
            .eq('id', currentUser.id)
            .maybeSingle();

          if (profileError) {
            console.warn('Profile query error, using metadata fallback:', profileError);
            setRole(normalizeRole(currentUser.user_metadata?.role || requiredRole || 'user'));
          } else if (profile) {
            setRole(resolveEffectiveRole(profile.role, currentUser.user_metadata?.role));
          } else {
            // No profile row – use metadata role or requiredRole as fallback
            setRole(normalizeRole(currentUser.user_metadata?.role || requiredRole || 'user'));
          }
        } catch {
          setRole(normalizeRole(currentUser.user_metadata?.role || requiredRole || 'user'));
        }
      } catch (err) {
        console.error('Auth check error:', err);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [requiredRole]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Logo className="h-10 mx-auto mb-6" />
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-700 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Not logged in → redirect to portal-specific sign in
  if (!user) {
    return <Navigate to={getLoginRouteForRequiredRole(requiredRole)} replace />;
  }

  // Role check: if a specific role is required and user doesn't have it
  if (requiredRole && role !== normalizeRole(requiredRole)) {
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
    // LGU trying to access other pages → send to LGU dashboard
    if (role === 'lgu') {
      return <Navigate to="/lgu" replace />;
    }
    // Farmer trying to access other pages → send to farmer dashboard
    if (role === 'farmer') {
      return <Navigate to="/farmer" replace />;
    }
    // User trying to access admin/engineer pages → send to user dashboard
    return <Navigate to="/user" replace />;
  }

  return children;
}

