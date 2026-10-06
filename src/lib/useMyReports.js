import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

// Colors for the citizen status keys in publicReportStatus.CITIZEN_STATUS, as hex
// because map markers are drawn outside Tailwind.
export const CITIZEN_STATUS_HEX = {
  submitted: '#f59e0b',
  under_review: '#0ea5e9',
  inspection_scheduled: '#6366f1',
  under_verification: '#8b5cf6',
  resolved: '#059669',
  closed: '#64748b',
};

/**
 * The signed-in citizen's own reports, from the citizen-safe view (staff-only
 * columns already stripped). Stays live via realtime. `enabled: false` skips the
 * fetch and the subscription, e.g. on the public landing page.
 */
export function useMyReports({ enabled = true } = {}) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const channelId = useRef(`my-reports-${Math.random().toString(36).slice(2)}`);

  const load = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setReports([]);
        return;
      }
      const { data, error } = await supabase
        .from('public_reports_citizen_view')
        .select('*')
        .eq('is_current_user_report', true)
        .order('created_at', { ascending: false });
      if (!error) setReports(data || []);
    } catch {
      // Keep whatever we already had; the map and sidebar degrade to empty.
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
