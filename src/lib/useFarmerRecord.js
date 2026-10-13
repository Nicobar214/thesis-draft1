import { useCallback, useEffect, useState } from 'react';
import { supabaseFarmer as supabase } from './supabase';
import { cachedQuery, isConnectionError } from './offlineCache';

/**
 * The signed-in farmer's auth user, profile, and linked farmer_beneficiaries
 * record, in one hook so the layout and every farmer page can ask for it
 * without re-deriving the lookup chain.
 *
 * Works offline: the user comes from the session saved on the device when the
 * server can't be reached, and the profile/record from the last saved copy
 * (lib/offlineCache.js). `offline` is true while showing saved data.
 *
 * Does not redirect on no-session -- every farmer route is already guarded
 * by <ProtectedRoute requiredRole="farmer">; this hook only supplies data
 * once that guarantee holds.
 */
export function useFarmerRecord() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [farmerRecord, setFarmerRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      let currentUser = null;
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error && isConnectionError(error)) throw error;
        currentUser = data?.user || null;
      } catch (err) {
        if (!isConnectionError(err)) throw err;
        const { data: { session } } = await supabase.auth.getSession();
        currentUser = session?.user || null;
      }
      if (!currentUser) {
        setUser(null);
        setProfile(null);
        setFarmerRecord(null);
        return;
      }
      setUser(currentUser);

      const [profileRes, farmerRes] = await Promise.allSettled([
        cachedQuery(`farmer:${currentUser.id}:profile`, () => supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle()),
        cachedQuery(`farmer:${currentUser.id}:record`, () => supabase.from('farmer_beneficiaries').select('*').eq('user_id', currentUser.id).maybeSingle()),
      ]);
      if (profileRes.status === 'fulfilled') setProfile(profileRes.value.data || null);
      if (farmerRes.status === 'fulfilled') {
        setFarmerRecord(farmerRes.value.data || null);
        setOffline(Boolean(farmerRes.value.fromCache));
      } else {
        console.error('Error fetching farmer beneficiary profile:', farmerRes.reason);
        setOffline(isConnectionError(farmerRes.reason));
      }
    } catch (err) {
      console.error('Farmer record load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refresh as soon as the connection comes back.
  useEffect(() => {
    window.addEventListener('online', load);
    return () => window.removeEventListener('online', load);
  }, [load]);

  return { user, profile, farmerRecord, loading, offline, reload: load };
}
