import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { supabase as defaultClient } from '../lib/supabase';
import { buttonClass } from './ui/Button';

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
  public_report_citizen_confirmed:      { label: 'Confirmed', accent: 'bg-emerald-500' },
  public_report_citizen_disputed:       { label: 'Disputed',  accent: 'bg-red-500' },
  // LGU
  lgu_threshold_alert:             { label: 'Alert',        accent: 'bg-red-500' },
  lgu_resolution_summary:          { label: 'Resolution',   accent: 'bg-emerald-500' },
  lgu_escalation:                  { label: 'Escalation',   accent: 'bg-orange-500' },
  lgu_proposal_submitted:          { label: 'Proposal',     accent: 'bg-blue-500' },
  lgu_proposal_validated:          { label: 'Validated',    accent: 'bg-indigo-500' },
  lgu_proposal_approved:           { label: 'Approved',     accent: 'bg-emerald-500' },
  lgu_proposal_rejected:           { label: 'Rejected',     accent: 'bg-red-500' },
  lgu_proposal_published:          { label: 'Published',    accent: 'bg-emerald-500' },
  // Contractor progress workflow
  progress_update_submitted:          { label: 'Submission',  accent: 'bg-blue-500' },
  progress_update_certified:          { label: 'Certified',   accent: 'bg-emerald-500' },
  progress_update_awaiting_approval:  { label: 'Approval',    accent: 'bg-amber-500' },
  progress_update_disputed:           { label: 'Disputed',    accent: 'bg-red-500' },
  progress_update_approved:           { label: 'Approved',    accent: 'bg-emerald-500' },
  progress_update_rejected:           { label: 'Returned',    accent: 'bg-red-500' },
  project_assigned:                   { label: 'Assigned',    accent: 'bg-blue-500' },
  site_engineer_assigned:             { label: 'Assigned',    accent: 'bg-blue-500' },
  project_site_engineer_set:          { label: 'Engineer set', accent: 'bg-indigo-500' },
};

// Columns a notification can use to point at what it is about. Each came from a
// separate migration, so any of them may be missing on an older database.
const LINK_COLUMNS = ['report_id', 'progress_update_id', 'project_id', 'proposal_id', 'schedule_task_id'];
const hasLink = (n) => LINK_COLUMNS.some((col) => n[col]);

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
 *
 * Two ways to react to a click:
 *   - onSelect only (legacy): the click immediately calls onSelect(n) when the
 *     row links to something.
 *   - resolveTarget + onSelect (preferred): the click opens a detail card inside
 *     the dropdown. resolveTarget(n) tells the card what to show:
 *       { actionLabel?, details?: [{label, value}], unavailable?: string } | null
 *     The card's button calls onSelect(n). If the target cannot be opened
 *     (e.g. the report was reassigned) the card says so instead of failing
 *     silently.
 */
export default function NotificationBell({
  client = defaultClient,
  onSelect,
  resolveTarget,
  align = 'right',
  tone = 'light',
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState(null);
  const [selected, setSelected] = useState(null);
  const wrapRef = useRef(null);
  const detailRef = useRef(null);

  const unread = useMemo(() => items.filter((n) => !n.is_read).length, [items]);

  const load = useCallback(async (uid) => {
    if (!uid) return;
    setLoading(true);
    try {
      const query = (columns) => client
        .from('notifications')
        .select(columns)
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(30);
      // Ask for every link column; if the database rejects one it has not got,
      // drop just that column and retry rather than losing all the links.
      let links = [...LINK_COLUMNS];
      let data = null;
      let error = null;
      for (let attempt = 0; attempt <= LINK_COLUMNS.length; attempt += 1) {
        ({ data, error } = await query(['id', 'type', 'title', 'message', ...links, 'is_read', 'created_at'].join(', ')));
        if (!error) break;
        const missing = links.find((col) => (error.message || '').includes(col));
        if (!missing) break;
        links = links.filter((col) => col !== missing);
      }
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

  // Always reopen on the list, never on a stale detail card.
  useEffect(() => {
    if (!open) setSelected(null);
  }, [open]);

  // Move focus into the detail card so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (selected) detailRef.current?.focus();
  }, [selected]);

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
    if (typeof resolveTarget === 'function') {
      // Detail mode: show what this is about and let the user choose to go there.
      setSelected({ ...n, is_read: true });
      return;
    }
    if (typeof onSelect === 'function' && hasLink(n)) onSelect(n);
    setOpen(false);
  };

  const openTarget = (n) => {
    setOpen(false);
    if (typeof onSelect === 'function') onSelect(n);
  };

  // Resolved on every render so it reflects data that finished loading after the bell opened.
  const target = selected && typeof resolveTarget === 'function' ? resolveTarget(selected) : null;

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
            {selected ? (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                All notifications
              </button>
            ) : (
              <p className="text-sm font-semibold text-slate-900">Notifications</p>
            )}
            {!selected && unread > 0 && (
              <button
                type="button"
                onClick={() => markRead(items.filter((n) => !n.is_read).map((n) => n.id))}
                className="text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                Mark all read
              </button>
            )}
          </div>

          {selected ? (
            <div ref={detailRef} tabIndex={-1} className="max-h-96 overflow-y-auto px-4 py-4 outline-none">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${metaFor(selected.type).accent}`} />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {metaFor(selected.type).label}
                </span>
                <span className="text-[11px] text-slate-400">
                  &middot; {selected.created_at ? new Date(selected.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                </span>
              </div>

              <h3 className="mt-2 text-sm font-semibold leading-snug text-slate-900">{selected.title || metaFor(selected.type).label}</h3>
              {selected.message && (
                <p className="mt-1.5 whitespace-pre-line break-words text-[13px] leading-relaxed text-slate-600">{selected.message}</p>
              )}

              {target?.details?.length > 0 && (
                <dl className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                  {target.details.map((row) => (
                    <div key={row.label} className="flex gap-3">
                      <dt className="w-20 shrink-0 font-medium text-slate-500">{row.label}</dt>
                      <dd className="min-w-0 flex-1 break-words text-slate-800">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {target?.unavailable && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                  {target.unavailable}
                </p>
              )}

              {target?.actionLabel && !target.unavailable && (
                <button
                  type="button"
                  onClick={() => openTarget(selected)}
                  className={buttonClass('primary', 'md', 'mt-4 w-full')}
                >
                  {target.actionLabel}
                </button>
              )}
            </div>
          ) : (
          <div className="max-h-96 overflow-y-auto">
            {loading && items.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-400">Loading...</p>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-slate-600">You&rsquo;re all caught up</p>
                <p className="mt-1 text-xs text-slate-400">New updates appear here as they happen.</p>
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
          )}
        </div>
      )}
    </div>
  );
}
