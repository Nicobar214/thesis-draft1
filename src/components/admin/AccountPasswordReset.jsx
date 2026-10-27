/* Admin Settings: "Account passwords". For users who cannot get a reset email
 * (no real inbox), the admin gives them a one-time temporary password; they must
 * set their own on their next sign-in (supabase_admin_password_reset.sql,
 * components/auth/ForcePasswordChange.jsx). Admin accounts are reset in Supabase.
 *
 *   <AccountPasswordReset client={supabase} /> */
import { useCallback, useEffect, useState } from 'react';
import { CheckIcon, CopyIcon, KeyRoundIcon, SearchIcon } from 'lucide-react';
import { confirm as confirmDialog } from '../../lib/confirm';
import { notify } from '../../lib/toast';

const ROLE_LABELS = { user: 'Citizen', farmer: 'Farmer', field_engineer: 'Field engineer', contractor: 'Contractor', lgu: 'LGU', admin: 'Admin' };
const roleLabel = (role) => ROLE_LABELS[String(role || '').toLowerCase().replace(/[\s-]+/g, '_')] || role || '—';

function fmtWhen(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AccountPasswordReset({ client }) {
  const [search, setSearch] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [issued, setIssued] = useState(null);   // { account, password } — shown once
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (term) => {
    const { data, error } = await client.rpc('admin_list_accounts', { p_search: term || null });
    if (error) {
      setLoadError(/admin_list_accounts|function/i.test(error.message || '')
        ? 'Run supabase_admin_password_reset.sql in Supabase first.'
        : 'Could not load the accounts.');
      setAccounts([]);
      return;
    }
    setLoadError('');
    setAccounts(data || []);
  }, [client]);

  useEffect(() => {
    const t = setTimeout(() => load(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search, load]);

  const reset = async (account) => {
    const who = account.full_name || account.email;
    if (!(await confirmDialog({
      title: `Reset the password of ${who}?`,
      message: 'Their current password stops working and they are signed out everywhere. You get a temporary password to give them; they must choose their own when they next sign in.',
      confirmLabel: 'Reset password',
    }))) return;
    setBusyId(account.id);
    try {
      const { data, error } = await client.rpc('admin_reset_password', { p_user: account.id });
      if (error) throw error;
      setIssued({ account, password: data });
      setCopied(false);
      load(search.trim());
    } catch (err) {
      notify(err?.message || 'Could not reset the password.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm sm:p-8" aria-label="Account passwords">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
          <KeyRoundIcon className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-lg font-bold text-slate-900">Account passwords</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            For users who forgot their password and cannot receive a reset email. Give them the temporary password in person
            or by text; they must set their own when they sign in.
          </p>
        </div>
      </div>

      {issued && (
        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4" role="status">
          <p className="text-sm text-emerald-900">
            Temporary password for <span className="font-semibold">{issued.account.full_name || issued.account.email}</span>
            {' '}({issued.account.email}). It is shown only now:
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-white px-3 py-1.5 font-mono text-base font-bold tracking-widest text-slate-900 ring-1 ring-emerald-200">{issued.password}</code>
            <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">
              {copied ? <CheckIcon className="size-3.5" aria-hidden="true" /> : <CopyIcon className="size-3.5" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={() => setIssued(null)} className="ml-auto text-xs font-medium text-emerald-800 hover:underline">Done</button>
          </div>
        </div>
      )}

      <label className="relative mt-5 block">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search accounts"
          className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
        />
      </label>

      {loadError && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{loadError}</p>}

      <ul className="mt-3 max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
        {accounts.map((a) => {
          const isAdmin = String(a.role || '').toLowerCase() === 'admin';
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{a.full_name || a.email}</p>
                <p className="truncate text-xs text-slate-500">
                  {a.email} · {roleLabel(a.role)}{a.municipality ? ` · ${a.municipality}` : ''}
                </p>
              </div>
              {a.reset_pending && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  Waiting for new password{a.last_reset_at ? ` · reset ${fmtWhen(a.last_reset_at)}` : ''}
                </span>
              )}
              {isAdmin ? (
                <span className="text-xs text-slate-400">Reset in Supabase</span>
              ) : (
                <button
                  type="button"
                  onClick={() => reset(a)}
                  disabled={busyId === a.id}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {busyId === a.id ? 'Resetting…' : 'Reset password'}
                </button>
              )}
            </li>
          );
        })}
        {!accounts.length && !loadError && <li className="px-4 py-6 text-center text-sm text-slate-500">No accounts found.</li>}
      </ul>
    </section>
  );
}
