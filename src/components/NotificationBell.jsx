import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { supabase as defaultClient } from '../lib/supabase';

/* Notification types written across the app. Anything unmapped falls back to
 * neutral, so a new type added later shows up plainly rather than breaking. */
const TYPE_META = {
  // Citizen reporting
  public_report_assignment:        { label: 'Assignment',   accent: 'bg-blue-500' },
  public_report_status:            { label: 'Status',       accent: 'bg-slate-400' },
  public_report_field_update:      { label: 'Inspection',   accent: 'bg-indigo-500' },
  public_report_field_finding:     { label: 'Findings',     accent: 'bg-violet-500' },
  public_report_finding_validated: { label: 'Validated',    accent: 'bg-emerald-500' },
  public_report_finding_rejected:  { label: 'Re-inspect',   accent: 'bg-amber-500' },
  field_engineer_assignment:       { label: 'Assignment',   accent: 'bg-blue-500' },
  public_report_repair_planned:         { label: 'Repair',   accent: 'bg-blue-500' },
  public_report_repair_ready_to_verify: { label: 'Verify',   accent: 'bg-amber-500' },
  public_report_repair_verified:        { label: 'Repaired', accent: 'bg-emerald-500' },
  // LGU
  lgu_threshold_alert:             { label: 'Alert',        accent: 'bg-red-500' },
  lgu_resolution_summary:          { label: 'Resolution',   accent: 'bg-emerald-500' },
  lgu_escalation:                  { label: 'Escalation',   accent: 'bg-orange-500' },
  lgu_proposal_submitted:          { label: 'Proposal',     accent: 'bg-blue-500' },
  lgu_proposal_validated:          { label: 'Validated',    accent: 'bg-indigo-500' },
  lgu_proposal_approved:           { label: 'Approved',     accent: 'bg-emerald-500' },
  lgu_proposal_rejected:           { label: 'Rejected',     accent: 'bg-red-500' },
  lgu_proposal_published:          { label: 'Published',    accent: 'bg-emerald-500' },
};

function metaFor(type) {
  return TYPE_META[type] || { label: 'Update', accent: 'bg-slate-400' };
}

function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Notification inbox.
 *
 * The notifications table and its RLS have existed since the workflow hardening
 * migration — notifications_select_own, _update_own_read_state, _delete_own —
 * but nothing in the app ever read them, so every row written was invisible.
 * Most consequential case: an admin rejecting an inspection writes
 * "re-inspection needed" to the engineer, who was never shown it.
 *
 * Each portal passes its own Supabase client, since sessions are isolated per
 * portal by storageKey.
 */
export default function NotificationBell({
  client = defaultClient,
  onSelect,
  align = 'right',
  tone = 'light',
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState(null);
  const wrapRef = useRef(null);

  const unread = useMemo(() => items.filter((n) => !n.is_read).length, [items]);

  const load = useCallback(async (uid) => {
    if (!uid) return;
    setLoading(true);
    try {
      const { data, error } = await client
        .from('notifications')
        .select('id, type, title, message, report_id, is_read, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      setItems(data || []);
    } catch (err) {
      // A missing table or a revoked policy must not take the header down.
      console.warn('[notifications] could not load:', err?.message || err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    let alive = true;
    client.auth.getUser().then(({ data }) => {
      if (!alive) return;
      const uid = data?.user?.id || null;
      setUserId(uid);
      if (uid) load(uid);
    });
    return () => { alive = false; };
  }, [client, load]);

  /* Realtime genuinely works on this table, unlike public_reports: the
   * notifications_select_own policy lets a subscriber receive their own rows.
   * Requires `notifications` to be in the supabase_realtime publication. */
  useEffect(() => {
    if (!userId) return undefined;
    const channel = client
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          setItems((prev) => (prev.some((n) => n.id === payload.new.id) ? prev : [payload.new, ...prev].slice(0, 30)));
        }
      )
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [client, userId]);

  // Refresh on focus so a missed realtime event still surfaces.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'visible' && userId) load(userId);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [userId, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const markRead = useCallback(async (ids) => {
    if (!ids.length) return;
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, is_read: true } : n)));
    try {
      await client.from('notifications').update({ is_read: true }).in('id', ids);
    } catch (err) {
      console.warn('[notifications] could not mark read:', err?.message || err);
    }
  }, [client]);

  const handleSelect = (n) => {
    if (!n.is_read) markRead([n.id]);
    if (typeof onSelect === 'function' && n.report_id) onSelect(n);
    setOpen(false);
  };

  const buttonTone = tone === 'dark'
    ? 'text-slate-300 hover:text-white hover:bg-white/10'
    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100';

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className={`relative inline-flex items-center justify-center rounded-lg p-2 transition-colors ${buttonTone}`}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold leading-[18px] text-center tabular-nums">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-2 w-80 sm:w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markRead(items.filter((n) => !n.is_read).map((n) => n.id))}
                className="text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && items.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-400">Loading...</p>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-slate-600">You&rsquo;re all caught up</p>
                <p className="mt-1 text-xs text-slate-400">Updates about your reports appear here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((n) => {
                  const meta = metaFor(n.type);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(n)}
                        className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                          n.is_read ? '' : 'bg-slate-50/60'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.is_read ? 'bg-slate-200' : meta.accent}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={`truncate text-xs ${n.is_read ? 'text-slate-500' : 'font-semibold text-slate-900'}`}>
                              {n.title || meta.label}
                            </span>
                            <span className="shrink-0 text-[11px] text-slate-400">{relativeTime(n.created_at)}</span>
                          </span>
                          {n.message && (
                            <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-slate-600">
                              {n.message}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
