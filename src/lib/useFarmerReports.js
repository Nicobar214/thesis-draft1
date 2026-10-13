import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseFarmer as supabase } from './supabase';
import { cachedQuery } from './offlineCache';

/**
 * The signed-in farmer's own road reports, from the citizen-safe view, live
 * via realtime. Mirrors useMyReports.js (the citizen portal's version of the
 * same hook) on the farmer-scoped Supabase client.
 */
export function useFarmerReports({ enabled = true } = {}) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const channelId = useRef(`farmer-reports-${Math.random().toString(36).slice(2)}`);

  const load = useCallback(async () => {
    try {
      // Saved per account on the device, so My Reports still lists them offline.
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id || 'anon';
      const { data } = await cachedQuery(`farmer:${uid}:reports`, () => supabase
        .from('public_reports_citizen_view')
        .select('*')
        .eq('is_current_user_report', true)
        .order('created_at', { ascending: false }));
      setReports(data || []);
    } catch {
      // Keep whatever we already had; the sidebar badge and the list degrade to stale, not blank.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    window.addEventListener('online', load);
    const channel = supabase
      .channel(channelId.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'public_reports' }, load)
      .subscribe();
    return () => {
      window.removeEventListener('online', load);
      supabase.removeChannel(channel);
    };
  }, [enabled, load]);

  return { reports, loading, reload: load };
}
