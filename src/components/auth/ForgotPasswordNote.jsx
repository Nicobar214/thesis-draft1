/* "Forgot password?" under a portal's sign-in form. Staff and farmer accounts are
 * reset by the DA administrator (a one-time temporary password, see
 * components/admin/AccountPasswordReset.jsx), not by email.
 *
 *   <ForgotPasswordNote who="the DA administrator" /> */
export default function ForgotPasswordNote({ who = 'the DA administrator', className = '' }) {
  return (
    <details className={`group mt-4 text-center text-xs sm:text-sm ${className}`}>
      <summary className="cursor-pointer list-none font-semibold text-slate-500 hover:text-slate-800 [&::-webkit-details-marker]:hidden">
        Forgot password?
      </summary>
      <p className="mx-auto mt-2 max-w-sm rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-slate-600">
        Ask {who} to reset it. You will get a temporary password; sign in with it here and you will be asked to choose your own.
      </p>
    </details>
  );
}
