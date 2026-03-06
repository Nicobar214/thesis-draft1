import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables. Check .env.local file.')
}

export const supabase = createClient(supabaseUrl, supabaseKey)

// Separate client for admin to create new users without replacing the current session.
// Uses a different localStorage key so signUp() won't overwrite the admin's auth token.
export const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storageKey: 'sb-admin-signup',
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  }
})