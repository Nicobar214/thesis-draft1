import { Suspense, useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { getSupabaseForRole } from '../lib/supabase';
import { isConnectionError, getCurrentUser, rememberRole, rememberedRole } from '../lib/offlineCache';
import Logo from './Logo';
import { PortalPageSkeleton } from './PageSkeletons';
import {
  LguPageSkeleton,
  FieldEngineerPageSkeleton,
  AdminPageSkeleton,
} from './PortalSkeletons';

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
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

// Multi-page portals get a skeleton shaped like the page being opened
// (PageSkeletons.jsx); single-page portals keep one skeleton each.
const ROLE_SKELETONS = {
  user: () => <PortalPageSkeleton portal="user" />,
  lgu: LguPageSkeleton,
  field_engineer: FieldEngineerPageSkeleton,
  contractor: () => <PortalPageSkeleton portal="contractor" />,
  farmer: () => <PortalPageSkeleton portal="farmer" />,
  admin: AdminPageSkeleton,
};

/** The portal's own skeleton, shown while auth is checked and while its page chunk downloads. */
function roleLoadingFallback(requiredRole) {
  const Skeleton = ROLE_SKELETONS[normalizeRole(requiredRole)];
  if (Skeleton) return <Skeleton />;
  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <Logo className="h-10 mx-auto mb-6" />
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-700 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading...</p>
      </div>
    </div>
  );
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
        // With no connection, the session saved on this device is used (offline use in the field).
        const { user: currentUser, offline } = await getCurrentUser(client);

        if (!currentUser) {
          setLoading(false);
          return;
        }

        setUser(currentUser);

        if (offline) {
          const cached = rememberedRole(currentUser.id);
          setRole(cached ? normalizeRole(cached) : normalizeRole(requiredRole));
          return;
        }

        // Database profile roles are authoritative for protected routes.
        try {
          const { data: profile, error: profileError } = await client
            .from('profiles')
            .select('role')
            .eq('id', currentUser.id)
            .maybeSingle();

          if (profileError) {
            console.warn('Profile query error:', profileError);
            // A dropped connection is not a demotion: keep the last confirmed role.
            setRole(isConnectionError(profileError) ? normalizeRole(rememberedRole(currentUser.id) || 'user') : 'user');
          } else if (profile) {
            const confirmed = normalizeRole(profile.role) || 'user';
            rememberRole(currentUser.id, confirmed);
            setRole(confirmed);
          } else {
            setRole('user');
          }
        } catch (err) {
          setRole(isConnectionError(err) ? normalizeRole(rememberedRole(currentUser.id) || 'user') : 'user');
        }
      } catch (err) {
        console.error('Auth check error:', err);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [requiredRole]);

  const loadingFallback = roleLoadingFallback(requiredRole);
  if (loading) return loadingFallback;

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

  return <Suspense fallback={loadingFallback}>{children}</Suspense>;
}

