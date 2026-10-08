import { useCallback, useEffect, useState } from 'react';
import { supabaseFarmer as supabase } from './supabase';

/**
 * The signed-in farmer's auth user, profile, and linked farmer_beneficiaries
 * record, in one hook so the layout and every farmer page can ask for it
 * without re-deriving the lookup chain.
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

  const load = useCallback(async () => {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        setUser(null);
        setProfile(null);
        setFarmerRecord(null);
        return;
      }
      setUser(currentUser);

      const [{ data: userProfile }, { data: farmer, error: farmerErr }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle(),
        supabase.from('farmer_beneficiaries').select('*').eq('user_id', currentUser.id).maybeSingle(),
      ]);
      setProfile(userProfile || null);
      if (farmerErr) console.error('Error fetching farmer beneficiary profile:', farmerErr);
      setFarmerRecord(farmer || null);
    } catch (err) {
      console.error('Farmer record load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { user, profile, farmerRecord, loading, reload: load };
}
