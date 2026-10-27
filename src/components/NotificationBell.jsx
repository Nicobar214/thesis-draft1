import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { supabase as defaultClient } from '../lib/supabase';
import { buttonClass } from './ui/Button';
import { confirm as confirmDialog } from '../lib/confirm';

/* Deleting: swipe a row left (or its trash button), with 4 s to undo; "Clear
 * read" removes every read one. Only notifications that were opened (read) can
 * be deleted, so nothing is lost unseen; the database enforces the same rule
 * (supabase_notifications_delete_read_only.sql). The sidebar badges count the
 * actual work (reviews, replies, repairs), not notifications, so deleting never
 * changes them. */
const SWIPE_DELETE_PX = 80; // swipe this far left to delete
const UNDO_MS = 4000;

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
  public_report_repair_assigned:        { label: 'New job',  accent: 'bg-red-500' },
  public_report_repair_reopened:        { label: 'Reopened', accent: 'bg-orange-500' },
  public_report_work_assigned:          { label: 'Assigned', accent: 'bg-orange-500' },
  public_report_work_accepted:          { label: 'Accepted', accent: 'bg-sky-500' },
  public_report_work_started:           { label: 'In progress', accent: 'bg-orange-500' },
  public_report_work_done:              { label: 'Work done', accent: 'bg-emerald-500' },
  public_report_work_returned:          { label: 'Returned', accent: 'bg-red-500' },
  public_report_reopened:               { label: 'Reopened', accent: 'bg-orange-500' },
  repair_overdue:                       { label: 'Overdue',  accent: 'bg-red-500' },
  public_report_citizen_confirmed:      { label: 'Confirmed', accent: 'bg-emerald-500' },
  public_report_citizen_disputed:       { label: 'Disputed',  accent: 'bg-red-500' },
  public_report_support_milestone:      { label: 'Support',   accent: 'bg-violet-500' },
  // Projects a citizen follows
  project_started:                      { label: 'Started',   accent: 'bg-blue-500' },
  project_milestone:                    { label: 'Progress',  accent: 'bg-amber-500' },
  project_completed:                    { label: 'Completed', accent: 'bg-emerald-500' },
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
  // Overdue process (supabase_overdue_v2.sql)
  delay_explanation_requested:        { label: 'Commit date',   accent: 'bg-red-500' },
  delay_revision_requested:           { label: 'Commit again',  accent: 'bg-amber-500' },
  delay_nature_rejected:              { label: 'Claim rejected', accent: 'bg-red-600' },
  delay_verification_requested:       { label: 'Site check',    accent: 'bg-sky-500' },
  project_reassigned_to_you:          { label: 'Reassigned',    accent: 'bg-blue-500' },
  project_reassigned:                 { label: 'Reassigned',    accent: 'bg-slate-500' },
  delay_final_notice:                 { label: 'Final notice',  accent: 'bg-red-600' },
  delay_reply_due:                    { label: 'Reply due',     accent: 'bg-amber-500' },
  delay_case_closed:                  { label: 'Decision',      accent: 'bg-slate-500' },
  delay_resumed:                      { label: 'Resumed',       accent: 'bg-emerald-500' },
  delay_suspension_extended:          { label: 'Suspended',     accent: 'bg-violet-500' },
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
  const [pending, setPending] = useState({}); // id -> true while "Deleted · Undo" shows
  const [selecting, setSelecting] = useState(false); // "Select" mode: tick rows, then delete them
  const [picked, setPicked] = useState(() => new Set());
  const timersRef = useRef({});

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

  // Really delete (after the undo window). Only read rows: the database refuses the rest anyway.
  const commitDelete = useCallback(async (ids) => {
    if (!ids.length) return;
    ids.forEach((id) => { clearTimeout(timersRef.current[id]); delete timersRef.current[id]; });
    setItems((prev) => prev.filter((n) => !ids.includes(n.id)));
    setPending((prev) => { const next = { ...prev }; ids.forEach((id) => delete next[id]); return next; });
    try {
      await client.from('notifications').delete().in('id', ids).eq('is_read', true);
    } catch (err) {
      console.warn('[notifications] could not delete:', err?.message || err);
    }
  }, [client]);

  const deleteOne = (n) => {
    if (!n.is_read || pending[n.id]) return;
    setPending((prev) => ({ ...prev, [n.id]: true }));
    timersRef.current[n.id] = setTimeout(() => commitDelete([n.id]), UNDO_MS);
  };

  const undoDelete = (id) => {
    clearTimeout(timersRef.current[id]);
    delete timersRef.current[id];
    setPending((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  // Closing the list (or leaving the page) finishes any delete still waiting for undo.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    if (open) return undefined;
    const ids = Object.keys(pendingRef.current);
    if (ids.length) commitDelete(ids);
    setSelecting(false);
    setPicked(new Set());
    return undefined;
  }, [open, commitDelete]);
  useEffect(() => () => {
    Object.values(timersRef.current).forEach(clearTimeout);
  }, []);

  const readCount = items.filter((n) => n.is_read && !pending[n.id]).length;
  const clearRead = async () => {
    const ids = items.filter((n) => n.is_read).map((n) => n.id);
    if (!ids.length) return;
    const unreadLeft = items.length - ids.length;
    if (!(await confirmDialog({
      title: `Delete ${ids.length} read notification${ids.length === 1 ? '' : 's'}?`,
      message: unreadLeft
        ? `The ${unreadLeft} you have not opened yet stay. Your menu counts do not change: they follow the work itself.`
        : 'Your menu counts do not change: they follow the work itself.',
      confirmLabel: 'Delete read',
      cancelLabel: 'Keep them',
      tone: 'danger',
    }))) return;
    commitDelete(ids);
  };

  const togglePick = (n) => {
    if (!n.is_read) return;
    setPicked((prev) => { const next = new Set(prev); if (next.has(n.id)) next.delete(n.id); else next.add(n.id); return next; });
  };
  const readIds = items.filter((n) => n.is_read && !pending[n.id]).map((n) => n.id);
  const allReadPicked = readIds.length > 0 && readIds.every((id) => picked.has(id));
  const stopSelecting = () => { setSelecting(false); setPicked(new Set()); };
  const deletePicked = async () => {
    const ids = [...picked].filter((id) => items.some((n) => n.id === id && n.is_read));
    if (!ids.length) return;
    if (!(await confirmDialog({
      title: `Delete ${ids.length} notification${ids.length === 1 ? '' : 's'}?`,
      message: 'Only the ones you ticked are deleted. Your menu counts do not change: they follow the work itself.',
      confirmLabel: 'Delete selected',
      cancelLabel: 'Keep them',
      tone: 'danger',
    }))) return;
    commitDelete(ids);
    stopSelecting();
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
            {!selected && selecting && (
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPicked(allReadPicked ? new Set() : new Set(readIds))}
                  className="text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  {allReadPicked ? 'Unselect all' : 'Select all read'}
                </button>
                <button type="button" onClick={stopSelecting} className="text-xs font-medium text-slate-500 hover:text-slate-900">Cancel</button>
              </span>
            )}
            {!selected && !selecting && (unread > 0 || readCount > 0) && (
              <span className="flex items-center gap-3">
                {unread > 0 && (
                  <button
                    type="button"
                    onClick={() => markRead(items.filter((n) => !n.is_read).map((n) => n.id))}
                    className="text-xs font-medium text-slate-500 hover:text-slate-900"
                  >
                    Mark all read
                  </button>
                )}
                {readCount > 0 && (
                  <button type="button" onClick={() => setSelecting(true)} className="text-xs font-medium text-slate-500 hover:text-slate-900">
                    Select
                  </button>
                )}
                {readCount > 0 && (
                  <button type="button" onClick={clearRead} className="text-xs font-medium text-red-600 hover:text-red-700">
                    Clear read
                  </button>
                )}
              </span>
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
                  if (pending[n.id]) {
                    return (
                      <li key={n.id} className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                        <span>Deleted</span>
                        <button type="button" onClick={() => undoDelete(n.id)} className="font-semibold text-teal-700 hover:underline">Undo</button>
                      </li>
                    );
                  }
                  if (selecting) {
                    const on = picked.has(n.id);
                    return (
                      <li key={n.id}>
                        <label className={`flex w-full gap-3 px-4 py-3 text-left ${n.is_read ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed bg-slate-50 opacity-70'} ${on ? 'bg-red-50/60' : ''}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!n.is_read}
                            onChange={() => togglePick(n)}
                            aria-label={n.is_read ? `Select "${n.title || meta.label}"` : `"${n.title || meta.label}" is not opened yet`}
                            className="mt-0.5 size-4 shrink-0 rounded border-slate-300 accent-red-600"
                          />
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-[13px] ${n.is_read ? 'font-medium text-slate-700' : 'font-semibold text-slate-900'}`}>{n.title || meta.label}</span>
                            <span className="mt-0.5 block text-xs text-slate-500">{n.is_read ? relativeTime(n.created_at) : 'Open it first to delete'}</span>
                          </span>
                        </label>
                      </li>
                    );
                  }
                  return (
                    <SwipeRow key={n.id} canDelete={n.is_read} onDelete={() => deleteOne(n)}>
                      <button
                        type="button"
                        onClick={() => handleSelect(n)}
                        className={`flex w-full gap-3 py-3 pl-4 pr-10 text-left transition-colors hover:bg-slate-50 ${
                          n.is_read ? 'bg-white' : 'bg-slate-50'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.is_read ? 'bg-slate-200' : meta.accent}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={`truncate text-[13px] ${n.is_read ? 'font-medium text-slate-600' : 'font-semibold text-slate-900'}`}>
                              {n.title || meta.label}
                            </span>
                            <span className="shrink-0 text-[11px] text-slate-400">{relativeTime(n.created_at)}</span>
                          </span>
                          {n.message && (
                            <span className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-slate-500">
                              {n.message}
                            </span>
                          )}
                        </span>
                      </button>
                    </SwipeRow>
                  );
                })}
              </ul>
            )}
            {selecting && (
              <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2.5">
                <span className="text-xs text-slate-500">{picked.size} selected</span>
                <button
                  type="button"
                  onClick={deletePicked}
                  disabled={picked.size === 0}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Delete selected{picked.size ? ` (${picked.size})` : ''}
                </button>
              </div>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
}

/* One notification row that can be swiped left to delete (touch or mouse). A
 * row that was not opened yet only nudges and says so. Its trash button does the
 * same for keyboard and mouse users. */
function SwipeRow({ canDelete, onDelete, children }) {
  const [dx, setDx] = useState(0);
  const start = useRef(null);   // { x, y } where the press began
  const swiping = useRef(false);

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY };
    swiping.current = false;
  };
  const onPointerMove = (e) => {
    if (!start.current) return;
    const mx = e.clientX - start.current.x;
    const my = e.clientY - start.current.y;
    if (!swiping.current && Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
      swiping.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (!swiping.current) return;
    const left = Math.min(0, mx);
    setDx(canDelete ? left : Math.max(left, -36)); // unread: a small nudge only
  };
  const onPointerUp = () => {
    if (swiping.current && canDelete && dx <= -SWIPE_DELETE_PX) onDelete();
    start.current = null;
    setDx(0);
  };
  // A swipe is not a click: do not open the notification after one.
  const onClickCapture = (e) => {
    if (swiping.current) { e.preventDefault(); e.stopPropagation(); swiping.current = false; }
  };

  const armed = canDelete && dx <= -SWIPE_DELETE_PX;
  return (
    <li className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className={`absolute inset-0 flex items-center justify-end px-4 text-xs font-semibold ${
          canDelete ? (armed ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700') : 'bg-slate-100 text-slate-500'
        }`}
      >
        {canDelete ? (armed ? 'Release to delete' : 'Delete') : 'Open it first to delete'}
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, touchAction: 'pan-y' }}
        className={`relative ${dx ? '' : 'transition-transform duration-200'}`}
      >
        {children}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (canDelete) onDelete(); }}
          disabled={!canDelete}
          title={canDelete ? 'Delete' : 'Open it first to delete'}
          aria-label={canDelete ? 'Delete notification' : 'Open this notification before deleting it'}
          className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-300"
        >
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
        </button>
      </div>
    </li>
  );
}
