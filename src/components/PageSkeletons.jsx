/**
 * PageSkeletons - loading placeholders for the multi-page portals (farmer,
 * citizen, contractor), shaped like the page that is actually opening.
 *
 * ProtectedRoute shows <PortalPageSkeleton portal="farmer" /> while it checks
 * sign-in; FarmerLayout shows <PageBodySkeleton /> while a farmer page's code
 * downloads. Both pick the body by the current route, so Harvest looks like a
 * harvest page and Markets like a market list, instead of every page flashing
 * the same placeholder.
 *
 * The frame copies today's layout (dark sidebar, white sticky header), so the
 * real page replaces it without shifting. If a page's layout changes, update
 * its body here. Single-page portals (admin, LGU, field engineer) keep their
 * own skeletons in PortalSkeletons.jsx.
 */
import { useLocation } from 'react-router-dom';
import { kindForPath, portalPageCount } from '../lib/pageSkeletonKinds';

const styles = `
@keyframes sk-shimmer { 100% { transform: translateX(100%); } }
.sk { position: relative; overflow: hidden; background-color: #e4e4e7; }
.sk::after {
  content: ''; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.65), transparent);
  animation: sk-shimmer 1.4s ease-in-out infinite;
}
.sk-dark { background-color: #1e293b; }
.sk-dark::after { background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent); }
@keyframes sk-bar { 0% { left: -40%; } 100% { left: 100%; } }
@media (prefers-reduced-motion: reduce) { .sk::after, .sk-bar-fill { animation: none !important; } }
`;

const bar = 'sk rounded';
const card = 'rounded-2xl border border-slate-200/60 bg-white shadow-sm';

/* ---------------------------- page bodies ---------------------------- */

function Kpis({ count = 4 }) {
  return (
    <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${count === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`${card} p-4 sm:p-5`}>
          <div className="sk mb-3 size-9 rounded-xl" />
          <div className={`mb-2 h-7 w-16 ${bar}`} />
          <div className={`h-3 w-24 ${bar}`} />
        </div>
      ))}
    </div>
  );
}

function FilterBar() {
  return (
    <div className={`${card} flex flex-col gap-2 p-3 sm:flex-row`}>
      <div className="sk h-10 flex-1 rounded-xl" />
      <div className="sk h-10 w-full rounded-xl sm:w-40" />
      <div className="sk h-10 w-full rounded-xl sm:w-40" />
    </div>
  );
}

function Rows({ count = 5, chip = true }) {
  return (
    <div className={`${card} divide-y divide-slate-100 overflow-hidden`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="sk size-10 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <div className={`h-4 w-1/2 ${bar}`} />
            <div className={`h-3 w-1/3 ${bar}`} />
          </div>
          {chip && <div className="sk h-6 w-20 rounded-full" />}
        </div>
      ))}
    </div>
  );
}

const BODIES = {
  // Farm overview: details column + big map.
  map: () => (
    <div className="flex flex-col gap-5 lg:flex-row">
      <div className="w-full shrink-0 space-y-4 lg:w-80">
        <div className={`${card} space-y-4 p-5`}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex justify-between"><div className={`h-3 w-24 ${bar}`} /><div className={`h-3.5 w-20 ${bar}`} /></div>
          ))}
        </div>
        <div className={`${card} space-y-3 p-5`}>
          <div className={`h-3 w-32 ${bar}`} />
          <div className={`h-7 w-24 ${bar}`} />
          <div className={`h-7 w-24 ${bar}`} />
        </div>
      </div>
      <div className={`${card} flex-1 space-y-3 p-4 sm:p-5`}>
        <div className={`h-5 w-56 ${bar}`} />
        <div className={`h-3 w-full max-w-md ${bar}`} />
        <div className="sk h-[320px] rounded-xl sm:h-[440px]" />
      </div>
    </div>
  ),
  // Harvest: KPI cards, the entry form, then the records.
  kpiForm: () => (
    <div className="space-y-5">
      <Kpis count={4} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className={`${card} space-y-3 p-5`}>
          <div className={`h-5 w-40 ${bar}`} />
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="sk h-10 rounded-lg" />)}
          <div className="sk h-11 rounded-xl" />
        </div>
        <div className="space-y-4">
          <div className={`${card} p-5`}><div className="sk h-48 rounded-xl" /></div>
          <Rows count={4} />
        </div>
      </div>
    </div>
  ),
  // A list of the person's own items (reports, feedback).
  list: () => (
    <div className="space-y-5">
      <div className="space-y-2"><div className={`h-6 w-64 ${bar}`} /><div className={`h-3.5 w-80 max-w-full ${bar}`} /></div>
      <Rows count={6} />
    </div>
  ),
  // Projects: KPI cards, filters, then a grid of project cards.
  cards: () => (
    <div className="space-y-5">
      <Kpis count={4} />
      <FilterBar />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`${card} space-y-3 p-5`}>
            <div className="flex justify-between gap-3"><div className={`h-4 w-2/3 ${bar}`} /><div className="sk h-5 w-16 rounded-full" /></div>
            <div className={`h-3 w-1/2 ${bar}`} />
            <div className="sk h-2 rounded-full" />
            <div className="flex justify-between"><div className={`h-3 w-16 ${bar}`} /><div className={`h-3 w-20 ${bar}`} /></div>
          </div>
        ))}
      </div>
    </div>
  ),
  // Markets: heading, then a table.
  table: () => (
    <div className="space-y-5">
      <div className="space-y-2"><div className={`h-6 w-72 ${bar}`} /><div className={`h-3.5 w-96 max-w-full ${bar}`} /></div>
      <div className={`${card} overflow-hidden`}>
        <div className="flex gap-6 border-b border-slate-100 bg-slate-50 px-5 py-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className={`h-3 w-20 ${bar}`} />)}
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-6 border-b border-slate-50 px-5 py-4">
            <div className={`h-4 w-40 ${bar}`} />
            {Array.from({ length: 4 }).map((__, j) => <div key={j} className={`h-4 w-20 ${bar}`} />)}
          </div>
        ))}
      </div>
    </div>
  ),
  // Profile: banner + avatar, then two cards.
  profile: () => (
    <div className="space-y-6">
      <div className={`${card} overflow-hidden`}>
        <div className="h-24 bg-gradient-to-r from-emerald-700/40 via-teal-600/40 to-teal-500/40 sm:h-28" />
        <div className="flex flex-col items-center gap-4 px-5 pb-5 sm:flex-row sm:items-start sm:px-8">
          <div className="sk -mt-14 size-28 shrink-0 rounded-full ring-4 ring-white" />
          <div className="w-full max-w-xs space-y-2 sm:pt-4"><div className={`h-6 w-48 ${bar}`} /><div className={`h-4 w-36 ${bar}`} /></div>
        </div>
        <div className="grid grid-cols-3 border-t border-slate-100 bg-slate-50/60">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2 py-4"><div className="sk size-10 rounded-xl" /><div className={`h-5 w-10 ${bar}`} /></div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className={`${card} space-y-4 p-6`}>
            <div className={`h-5 w-40 ${bar}`} />
            {Array.from({ length: 3 }).map((__, j) => <div key={j} className="sk h-12 rounded-xl" />)}
          </div>
        ))}
      </div>
    </div>
  ),
  // Dashboards: KPI cards, then two side-by-side panels.
  dashboard: () => (
    <div className="space-y-5">
      <Kpis count={4} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className={`${card} p-5`}><div className={`mb-4 h-5 w-48 ${bar}`} /><div className="sk h-64 rounded-xl" /></div>
        <Rows count={5} />
      </div>
    </div>
  ),
  // Full map pages.
  fullMap: () => <div className="sk h-[calc(100dvh-10rem)] min-h-[420px] rounded-2xl" />,
};

/** Just the page area, for a page loading inside an already-shown layout. */
export function PageBodySkeleton({ portal = 'farmer' }) {
  const { pathname } = useLocation();
  const Body = BODIES[kindForPath(portal, pathname)];
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <style>{styles}</style>
      <Body />
    </div>
  );
}

/* ------------------------------- frame ------------------------------- */

/** Sidebar + header + the body for the current page (shown during sign-in check). */
export function PortalPageSkeleton({ portal = 'farmer' }) {
  const { pathname } = useLocation();
  const Body = BODIES[kindForPath(portal, pathname)];
  const navCount = portalPageCount(portal);
  const headerH = portal === 'farmer' ? 'h-20 sm:h-24' : 'h-18 sm:h-20';

  return (
    <div className="min-h-dvh bg-slate-50 font-sans" role="status" aria-busy="true" aria-label="Loading">
      <style>{styles}</style>
      <div className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-emerald-100">
        <div className="sk-bar-fill absolute top-0 h-full w-2/5 rounded-full bg-emerald-600" style={{ animation: 'sk-bar 1.2s ease-in-out infinite' }} />
      </div>

      {/* Dark sidebar, as in FarmerSidebar / UserSidebar / ContractorSidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-800 bg-slate-900 lg:flex">
        <div className={`flex items-center justify-center border-b border-slate-800 ${headerH}`}>
          <div className="sk sk-dark h-9 w-32 rounded-lg" />
        </div>
        <div className="flex-1 space-y-2 px-3 py-4">
          {Array.from({ length: navCount }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
              <div className="sk sk-dark size-5 rounded" />
              <div className="sk sk-dark h-3.5 w-28 rounded" />
            </div>
          ))}
        </div>
        <div className="border-t border-slate-800 px-3 py-4"><div className="sk sk-dark h-10 rounded-xl" /></div>
      </aside>

      <div className="lg:ml-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95">
          <div className={`flex items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 ${headerH}`}>
            <div className="space-y-2 pl-12 lg:pl-0">
              <div className={`h-6 w-40 ${bar}`} />
              <div className={`hidden h-3 w-64 sm:block ${bar}`} />
            </div>
            <div className="flex items-center gap-3">
              {portal === 'farmer' && <div className="sk h-10 w-28 rounded-xl sm:w-44" />}
              <div className="sk size-10 rounded-xl" />
              <div className="sk size-10 rounded-xl" />
            </div>
          </div>
        </header>
        <main className="px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
          <Body />
        </main>
      </div>
    </div>
  );
}
