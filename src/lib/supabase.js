import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables. Check .env.local file.')
}

/**
 * Default client — used by the citizen portal (AuthPage, user pages, ProtectedRoute).
 * Stores its session under the default Supabase localStorage key.
 */
export const supabase = createClient(supabaseUrl, supabaseKey)

/**
 * Per-portal clients with isolated localStorage keys.
 *
 * Each portal (admin, LGU, field engineer, contractor, farmer) uses its own
 * client so that signing in on one portal tab never overwrites the session of
 * another portal open in a different tab.
 *
 * Naming convention for storageKey: 'kt-<role>-session'
 *   kt = KalsaTrack (avoids colliding with the default 'sb-*' key)
 */
export const supabaseAdminPortal = createClient(supabaseUrl, supabaseKey, {
  auth: { storageKey: 'kt-admin-session' },
})

export const supabaseLgu = createClient(supabaseUrl, supabaseKey, {
  auth: { storageKey: 'kt-lgu-session' },
})

export const supabaseFieldEngineer = createClient(supabaseUrl, supabaseKey, {
  auth: { storageKey: 'kt-field-engineer-session' },
})

export const supabaseContractor = createClient(supabaseUrl, supabaseKey, {
  auth: { storageKey: 'kt-contractor-session' },
})

export const supabaseFarmer = createClient(supabaseUrl, supabaseKey, {
  auth: { storageKey: 'kt-farmer-session' },
})

/**
 * Separate admin helper client used only when an admin creates a new user
 * account — ensures signUp() doesn't replace the admin's active session.
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storageKey: 'sb-admin-signup',
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})

/**
 * Helper to get the correct Supabase client instance for a given role/portal.
 */
export function getSupabaseForRole(role) {
  const normalized = String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'admin') return supabaseAdminPortal;
  if (normalized === 'lgu') return supabaseLgu;
  if (normalized === 'field_engineer') return supabaseFieldEngineer;
  if (normalized === 'contractor') return supabaseContractor;
  if (normalized === 'farmer') return supabaseFarmer;
  return supabase;
}