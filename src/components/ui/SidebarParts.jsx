/**
 * SidebarParts — the one sidebar look shared by every portal (modelled on the
 * LGU sidebar): logo block, group labels, nav items with an icon tile and a
 * one-line description, the signed-in account, and Sign Out.
 *
 * Each portal keeps its own routes, state and badges; only the look is shared,
 * so a change here restyles every portal at once.
 */
import { Link } from 'react-router-dom';
import Logo from '../Logo';

/** Logo + portal name; `children` (e.g. the LGU scope card) shows under it when expanded. */
export function SidebarBrand({ collapsed, portalLabel, children }) {
  return (
    <div className="shrink-0 overflow-hidden border-b border-slate-700/60 px-4 py-4">
      <div className="flex items-center justify-center">
        {collapsed ? (
          <Logo variant="glyph" tone="light" className="size-12" alt="KalsaTrack" />
        ) : (
          <div className="flex flex-col items-center gap-1.5 overflow-hidden text-center">
            <Logo tone="light" className="h-12" />
            <p className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">{portalLabel}</p>
          </div>
        )}
      </div>
      {!collapsed && children}
    </div>
  );
}

/** Small uppercase heading above a group; a divider when collapsed. */
export function SidebarGroupLabel({ label, first = false, collapsed }) {
  if (collapsed) return first ? null : <div className="mx-2 my-2 border-t border-slate-700/60" />;
  return (
    <p className={`px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 ${first ? 'pt-1' : 'pt-4'}`}>{label}</p>
  );
}

/**
 * One nav entry: icon tile, label, description, optional count.
 * Pass `to` for a page link, or `onClick` for an in-page tab.
 */
export function SidebarNavItem({ icon, label, description, active = false, collapsed = false, badge = 0, to, onClick, ...rest }) {
  const className = `relative flex w-full items-center rounded-xl transition-all duration-300 ${
    active ? 'bg-teal-500 font-semibold text-white shadow-lg shadow-teal-500/25' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
  } ${collapsed ? 'justify-center px-3 py-2.5' : 'gap-3.5 px-3.5 py-2.5'}`;

  const body = (
    <>
      <span className={`relative flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors [&_svg]:size-5 ${active ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'}`}>
        {icon}
        {collapsed && badge > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-slate-900 bg-red-500 px-1 text-[9px] font-bold text-white">{badge}</span>
        )}
      </span>
      {!collapsed && (
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-bold leading-tight">{label}</span>
          {description && (
            <span className={`mt-0.5 block truncate text-xs leading-tight ${active ? 'text-teal-50' : 'text-slate-400'}`}>{description}</span>
          )}
        </span>
      )}
      {!collapsed && badge > 0 && (
        <span className={`flex h-5.5 min-w-5.5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${active ? 'bg-white text-teal-600' : 'bg-red-500 text-white'}`}>{badge}</span>
      )}
    </>
  );

  const common = { className, title: collapsed ? label : undefined, 'aria-current': active ? 'page' : undefined, ...rest };
  return to
    ? <Link to={to} onClick={onClick} {...common}>{body}</Link>
    : <button type="button" onClick={onClick} {...common}>{body}</button>;
}

/** The signed-in account at the bottom (avatar, name, account type); opens the profile. */
export function SidebarAccount({ collapsed, avatar, name, subtitle, to, onClick }) {
  const className = 'flex w-full items-center gap-3 rounded-xl text-left transition-colors hover:bg-white/5';
  const body = (
    <>
      {avatar}
      {!collapsed && (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-white">{name}</span>
          <span className="mt-1 block truncate text-xs leading-none text-slate-400">{subtitle}</span>
        </span>
      )}
    </>
  );
  return to
    ? <Link to={to} onClick={onClick} title="My profile" aria-label="Open your profile" className={className}>{body}</Link>
    : <button type="button" onClick={onClick} title="My profile" aria-label="Open your profile" className={className}>{body}</button>;
}

/** Red Sign Out button. */
export function SidebarSignOut({ collapsed, onClick, label = 'Sign Out' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`mt-3.5 flex h-10 w-full items-center justify-center overflow-hidden rounded-xl border border-red-500/20 bg-red-500/10 py-2.5 text-sm font-semibold text-red-200 transition-all duration-300 hover:bg-red-500/20 ${collapsed ? 'gap-0 px-0' : 'gap-2 px-3.5'}`}
    >
      <svg className="size-4.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
      </svg>
      {!collapsed && <span className="whitespace-nowrap">{label}</span>}
    </button>
  );
}

/** Wrapper for the bottom area: status card, account, sign out. */
export function SidebarFooter({ children }) {
  return <div className="shrink-0 overflow-hidden border-t border-slate-700/60 p-4">{children}</div>;
}

/** Scrolling nav area. */
export function SidebarNav({ children, ...rest }) {
  return (
    <nav className="flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden px-2 py-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" {...rest}>
      {children}
    </nav>
  );
}
