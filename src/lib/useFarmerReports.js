import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseFarmer as supabase } from './supabase';

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
      const { data, error } = await supabase
        .from('public_reports_citizen_view')
        .select('*')
        .eq('is_current_user_report', true)
        .order('created_at', { ascending: false });
      if (!error) setReports(data || []);
    } catch {
      // Keep whatever we already had; the sidebar badge and the list degrade to stale, not blank.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const channel = supabase
      .channel(channelId.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'public_reports' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [enabled, load]);

  return { reports, loading, reload: load };
}
