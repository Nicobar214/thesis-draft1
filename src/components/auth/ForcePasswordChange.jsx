/* Shown instead of the portal when the DA admin reset this account's password
 * (supabase_admin_password_reset.sql): the user signed in with the temporary
 * password and must choose their own before going on. ProtectedRoute shows it.
 *
 *   <ForcePasswordChange client={client} onDone={() => setMustChange(false)} /> */
import { useState } from 'react';
import { KeyRoundIcon, Loader2Icon } from 'lucide-react';
import Logo from '../Logo';
import { buttonClass } from '../ui/Button';

const MIN_LENGTH = 6;   // same as sign-up (lib/authErrors.js)

export default function ForcePasswordChange({ client, onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < MIN_LENGTH) { setError(`Use at least ${MIN_LENGTH} characters.`); return; }
    if (/^KT-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(password)) { setError('Choose your own password, not the temporary one.'); return; }
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setSaving(true);
    try {
      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) throw updateError;
      const { error: doneError } = await client.rpc('password_change_done');
      if (doneError) throw doneError;
      onDone?.();
    } catch (err) {
      const msg = String(err?.message || '');
      setError(/same|different from the old/i.test(msg)
        ? 'Choose a password different from the temporary one.'
        : /weak|short/i.test(msg) ? 'That password is too easy to guess. Try a longer one.'
          : 'Could not save your new password. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    await client.auth.signOut();
    window.location.assign('/');
  };

  const inputCls = 'mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10';
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <Logo className="h-8" />
        <div className="mt-6 flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
            <KeyRoundIcon className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Set a new password</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              The DA administrator reset your password. Choose your own now; the temporary one stops working.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          <label className="block text-sm font-medium text-slate-700">
            New password
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Confirm new password
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} />
          </label>
          <p className="text-xs text-slate-500">At least {MIN_LENGTH} characters.</p>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={saving} className={buttonClass('primary', 'md', 'w-full')}>
            {saving ? <><Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Saving…</> : 'Save new password'}
          </button>
        </form>
        <button type="button" onClick={signOut} className="mt-4 w-full text-center text-sm font-medium text-slate-500 hover:text-slate-800">
          Sign out
        </button>
      </div>
    </div>
  );
}
