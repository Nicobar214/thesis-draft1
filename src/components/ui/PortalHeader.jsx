/**
 * PortalHeader — the one page header shared by every portal (modelled on the
 * admin header): page title + one-line description on the left; the page's
 * action buttons, the notification bell and the signed-in account on the right.
 *
 *   <PortalHeader title="My Reports" description="…" actions={<button…/>}
 *     bell={<NotificationBell…/>} account={{ avatar, name, detail, to | onClick }} />
 *
 * `leading` is for a portal that puts its phone menu button inside the header;
 * the others use a floating menu button, so the title leaves room for it.
 *
 * `compactOnPhone` (contractor and LGU): below 640 px a shorter bar and tighter
 * right side, so the title keeps room next to the camera, bell and account.
 * From 640 px up it looks exactly the same as without it.
 */
import { Link } from 'react-router-dom';

export default function PortalHeader({ title, description, leading = null, actions = null, bell = null, account = null, className = '', compactOnPhone = false }) {
  const c = compactOnPhone;
  const accountClass = `flex items-center gap-3 rounded-xl border-l border-slate-200 py-1 ${c ? 'pl-2' : 'pl-3'} pr-1 transition-colors hover:bg-slate-50 sm:pl-4`;
  const accountBody = account && (
    <>
      {account.avatar}
      <span className="hidden min-w-0 text-left md:block">
        {account.name
          ? <span className="block max-w-[11rem] truncate text-sm font-bold text-slate-900">{account.name}</span>
          : <span className="block h-4 w-28 animate-pulse rounded bg-slate-200" aria-hidden="true" />}
        {account.detail && <span className="block max-w-[11rem] truncate text-xs text-slate-500">{account.detail}</span>}
      </span>
    </>
  );

  return (
    <header className={`sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur ${className}`}>
      <div className={`flex items-center justify-between sm:h-24 sm:gap-4 sm:px-6 lg:px-8 ${c ? 'h-16 gap-2 px-3' : 'h-20 gap-4 px-4'}`}>
        <div className={`flex min-w-0 items-center gap-3 ${leading ? '' : c ? 'pl-11 lg:pl-0' : 'pl-12 lg:pl-0'}`}>
          {leading}
          <div className="min-w-0">
            <h1 className={`truncate font-bold tracking-tight text-slate-900 sm:text-2xl ${c ? 'text-lg' : 'text-xl'}`}>{title}</h1>
            {description && <p className="mt-0.5 hidden truncate text-sm text-slate-500 sm:block">{description}</p>}
          </div>
        </div>

        <div className={`flex shrink-0 items-center sm:gap-3 ${c ? 'gap-1' : 'gap-2'}`}>
          {actions}
          {bell}
          {account && (account.to
            ? <Link to={account.to} title="My profile" aria-label="Open your profile" className={accountClass}>{accountBody}</Link>
            : (
              <button type="button" onClick={account.onClick} title="My profile" aria-label="Open your profile" className={accountClass}>
                {accountBody}
              </button>
            ))}
        </div>
      </div>
    </header>
  );
}
