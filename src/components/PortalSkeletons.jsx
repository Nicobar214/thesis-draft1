/**
 * PortalSkeletons - Placeholder shells shown by ProtectedRoute while the auth
 * check runs, one per portal. Each one copies the structure of that portal's
 * real landing screen (sidebar widths, header, card grids, spacing) so the page
 * replaces it without shifting. All share the logo + spinner overlay.
 *
 * If a portal's layout changes, update its skeleton here to match.
 */
import Logo from './Logo';

const styles = `
@keyframes sk-shimmer { 100% { transform: translateX(100%); } }
.sk { position: relative; overflow: hidden; background-color: #e4e4e7; }
.sk::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.65), transparent);
  animation: sk-shimmer 1.4s ease-in-out infinite;
}
.sk-dark { background-color: #334155; }
.sk-dark::after { background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent); }
.sk-teal { background-color: rgba(20,184,166,0.55); }
.sk-green { background-color: rgba(167,243,208,0.35); }
@keyframes sk-bar { 0% { left: -40%; } 100% { left: 100%; } }
@media (prefers-reduced-motion: reduce) {
  .sk::after, .sk-bar-fill { animation: none !important; }
}
`;

const bar = 'sk rounded';

function Shell({ children }) {
  return (
    <div
      className="min-h-dvh bg-slate-50 font-sans"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <style>{styles}</style>

      <div className="fixed top-0 inset-x-0 h-0.5 bg-emerald-100 z-50 overflow-hidden">
        <div
          className="sk-bar-fill absolute top-0 h-full w-2/5 bg-emerald-600 rounded-full"
          style={{ animation: 'sk-bar 1.2s ease-in-out infinite' }}
        />
      </div>

      <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
        <div className="text-center px-12 py-8 rounded-2xl bg-white/90 backdrop-blur shadow-lg border border-slate-200">
          <Logo className="h-10 mx-auto mb-6" />
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-700 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>

      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LGU                                                                 */
/* ------------------------------------------------------------------ */

export function LguPageSkeleton() {
  return (
    <Shell>
      {/* Sidebar: w-80, logo + scope box, two-line nav items, profile + buttons */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-80 flex-col border-r border-slate-800 bg-slate-900 shadow-2xl">
        <div className="border-b border-slate-700/60 px-4 py-4 shrink-0">
          <div className="sk sk-dark h-8 w-36 rounded" />
          <div className="sk sk-dark h-2.5 w-28 rounded mt-2" />
          <div className="mt-3 rounded-xl border border-slate-700 bg-slate-800/70 px-3 py-2 space-y-1.5">
            <div className="sk sk-dark h-2.5 w-10 rounded" />
            <div className="sk sk-dark h-3.5 w-32 rounded" />
          </div>
        </div>
        <nav className="flex-1 px-2 py-3">
          <div className="sk sk-dark h-2.5 w-20 rounded mx-3 mb-3" />
          <div className="space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={`flex items-center gap-3.5 rounded-xl px-3.5 py-2 ${i === 0 ? 'bg-teal-500/60' : ''}`}
              >
                <div className="sk sk-dark size-8 rounded-lg shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="sk sk-dark h-3 w-24 rounded" />
                  <div className="sk sk-dark h-2.5 w-36 rounded" />
                </div>
              </div>
            ))}
          </div>
        </nav>
        <div className="border-t border-slate-700/60 p-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="sk sk-dark size-10 rounded-xl shrink-0" />
            <div className="space-y-1.5">
              <div className="sk sk-dark h-3 w-28 rounded" />
              <div className="sk sk-dark h-2.5 w-16 rounded" />
            </div>
          </div>
          <div className="mt-3.5 space-y-2">
            <div className="sk sk-dark h-9 rounded-xl" />
            <div className="sk sk-dark h-9 rounded-xl" />
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col lg:ml-80">
        {/* Header: eyebrow, title, description + bell */}
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 lg:px-6">
            <div className="space-y-2">
              <div className={`h-3 w-40 ${bar}`} />
              <div className={`h-5 w-32 ${bar}`} />
              <div className={`h-3.5 w-56 ${bar}`} />
            </div>
            <div className="flex items-center gap-2">
              <div className="sk size-9 rounded-full" />
              <div className={`hidden sm:block h-6 w-20 rounded-full ${bar}`} />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full flex-1 px-4 py-5 lg:px-6 max-w-[1800px]">
          {/* 3 summary cards */}
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white border border-slate-200/60 rounded-xl p-4 shadow-sm">
                <div className="flex items-start justify-between mb-2.5">
                  <div className="sk size-10 rounded-xl" />
                  <div className={`h-5 w-16 ${bar}`} />
                </div>
                <div className={`h-7 w-14 ${bar}`} />
                <div className={`h-3.5 w-32 ${bar} mt-2`} />
              </div>
            ))}
          </section>

          {/* Route map panel */}
          <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
              <div className="space-y-2">
                <div className={`h-4 w-28 ${bar}`} />
                <div className={`h-3 w-52 ${bar}`} />
              </div>
              <div className={`h-6 w-20 rounded-full ${bar}`} />
            </div>
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col xl:flex-row gap-3">
              <div className="flex flex-1 gap-2">
                <div className="sk h-9 flex-1 rounded-xl" />
                <div className="sk h-9 w-20 rounded-xl" />
              </div>
              <div className="flex flex-wrap gap-2.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="sk h-9 w-28 rounded-xl" />
                ))}
              </div>
            </div>
            <div className="sk h-[420px] w-full" />
          </div>
        </main>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Field engineer                                                      */
/* ------------------------------------------------------------------ */

export function FieldEngineerPageSkeleton() {
  return (
    <Shell>
      {/* Sidebar: w-64, h-16 logo header, icon + label nav, user card footer */}
      <aside className="hidden lg:flex flex-col fixed top-0 bottom-0 left-0 w-64 bg-slate-900 border-r border-slate-800 shadow-2xl">
        <div className="h-16 px-4 flex items-center justify-between border-b border-slate-700/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="sk sk-dark h-7 w-28 rounded" />
            <div className="sk sk-dark h-5 w-12 rounded-md" />
          </div>
          <div className="sk sk-dark size-7 rounded-lg" />
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${i === 0 ? 'bg-teal-500/60' : ''}`}
            >
              <div className="sk sk-dark size-5 rounded shrink-0" />
              <div className="sk sk-dark h-3.5 flex-1 rounded" />
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-700/60">
          <div className="flex items-center gap-2.5 p-2 rounded-xl bg-slate-800/70 border border-slate-700">
            <div className="sk sk-dark size-8 rounded-lg shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="sk sk-dark h-3 w-24 rounded" />
              <div className="sk sk-dark h-2.5 w-16 rounded" />
            </div>
          </div>
        </div>
      </aside>

      <div className="flex flex-col min-h-dvh lg:pl-64">
        {/* Header: section title left, bell + name + avatar right */}
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
            <div className={`h-4 w-28 ${bar}`} />
            <div className="flex items-center gap-3">
              <div className="sk size-9 rounded-full" />
              <div className="hidden sm:block space-y-1.5">
                <div className={`h-3 w-28 ml-auto ${bar}`} />
                <div className={`h-2.5 w-36 ml-auto ${bar}`} />
              </div>
              <div className="sk size-8 rounded-lg" />
            </div>
          </div>
        </header>

        <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-6 space-y-5">
          {/* Workload header */}
          <div className="rounded-2xl bg-white border border-slate-200 p-5 sm:p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="space-y-3 flex-1">
              <div className={`h-6 w-44 ${bar}`} />
              <div className={`h-8 w-72 max-w-full ${bar}`} />
              <div className={`h-3.5 w-full max-w-2xl ${bar}`} />
              <div className={`h-3.5 w-2/3 max-w-xl ${bar}`} />
            </div>
            <div className="flex items-center gap-3">
              <div className="sk h-10 w-40 rounded-lg" />
              <div className="sk h-10 w-36 rounded-lg" />
            </div>
          </div>

          {/* 5 KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className={`bg-white rounded-xl border border-slate-200 p-4 shadow-sm ${i === 4 ? 'col-span-2 sm:col-span-1' : ''}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className={`h-3 w-20 ${bar}`} />
                  <div className="sk size-4 rounded" />
                </div>
                <div className={`h-8 w-12 ${bar}`} />
                <div className={`h-3 w-24 ${bar} mt-2`} />
              </div>
            ))}
          </div>

          {/* Recent assigned reports */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="space-y-2">
                <div className={`h-4 w-56 ${bar}`} />
                <div className={`h-3 w-64 ${bar}`} />
              </div>
              <div className="sk h-9 w-32 rounded-lg" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="sk size-9 rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className={`h-3.5 w-1/3 ${bar}`} />
                  <div className={`h-3 w-1/2 ${bar}`} />
                </div>
                <div className={`hidden sm:block h-6 w-20 rounded-full ${bar}`} />
                <div className={`h-6 w-16 rounded-full ${bar}`} />
              </div>
            ))}
          </div>
        </main>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Contractor                                                          */
/* ------------------------------------------------------------------ */

export function ContractorPageSkeleton() {
  return (
    <Shell>
      {/* Top-nav layout: logo, 3 tabs, badge + name + sign out */}
      <header className="bg-white/80 border-b border-slate-200/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className={`h-8 w-32 ${bar}`} />
            <div className="hidden md:flex items-center gap-1">
              <div className="h-9 w-28 rounded-xl bg-teal-100" />
              <div className={`h-9 w-28 rounded-xl ${bar}`} />
              <div className={`h-9 w-24 rounded-xl ${bar}`} />
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2">
                <div className={`h-6 w-20 rounded-full ${bar}`} />
                <div className={`h-4 w-28 ${bar}`} />
              </div>
              <div className={`h-8 w-20 rounded-xl ${bar}`} />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Title + last synced + refresh */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-2">
              <div className={`h-7 w-56 ${bar}`} />
              <div className={`h-3.5 w-80 max-w-full ${bar}`} />
            </div>
            <div className="flex items-center gap-3">
              <div className="space-y-1.5">
                <div className={`h-3 w-20 ml-auto ${bar}`} />
                <div className={`h-3.5 w-36 ${bar}`} />
              </div>
              <div className="sk h-10 w-28 rounded-xl" />
            </div>
          </div>

          {/* 3 KPI cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm">
                <div className="sk size-12 rounded-xl mb-4" />
                <div className={`h-9 w-14 ${bar} mb-2`} />
                <div className={`h-4 w-3/4 ${bar}`} />
              </div>
            ))}
          </div>

          {/* Quick-action card */}
          <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-5">
            <div className="space-y-2">
              <div className={`h-5 w-72 max-w-full ${bar}`} />
              <div className={`h-3.5 w-80 max-w-full ${bar}`} />
            </div>
            <div className="sk h-12 w-52 rounded-xl" />
          </div>

          {/* Recent submissions */}
          <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-7 py-5 border-b border-slate-200/60 flex items-center justify-between">
              <div className={`h-5 w-40 ${bar}`} />
              <div className={`h-4 w-36 ${bar}`} />
            </div>
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-7 py-4 flex items-center justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className={`h-4 w-1/2 ${bar}`} />
                    <div className={`h-3 w-1/3 ${bar}`} />
                  </div>
                  <div className={`h-6 w-16 rounded-full ${bar}`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Farmer                                                              */
/* ------------------------------------------------------------------ */

export function FarmerPageSkeleton() {
  return (
    <Shell>
      {/* Green header: logo + portal label left, name/RSBSA + sign out right */}
      <header className="bg-gradient-to-r from-emerald-900 via-emerald-800 to-teal-900 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
          <div className="space-y-1.5">
            <div className="sk sk-dark sk-green h-7 w-32 rounded" />
            <div className="sk sk-dark sk-green h-3 w-40 rounded" />
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block space-y-1.5">
              <div className="sk sk-dark sk-green h-3.5 w-28 ml-auto rounded" />
              <div className="sk sk-dark sk-green h-3 w-24 ml-auto rounded" />
            </div>
            <div className="sk sk-dark sk-green h-9 w-24 rounded-xl" />
          </div>
        </div>
      </header>

      <main className="max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col lg:flex-row gap-5">
        {/* Left column: profile card + logistics summary */}
        <aside className="w-full lg:w-80 shrink-0 space-y-4 sm:space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-5">
            <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
              <div className="sk size-12 rounded-2xl shrink-0" />
              <div className="flex-1 space-y-2">
                <div className={`h-4 w-3/4 ${bar}`} />
                <div className={`h-3 w-1/2 ${bar}`} />
              </div>
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className={`h-3 w-24 ${bar}`} />
                <div className={`h-3.5 w-20 ${bar}`} />
              </div>
            ))}
          </div>
          <div className="bg-gradient-to-br from-emerald-800 to-teal-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="sk sk-dark sk-green h-3 w-32 rounded" />
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="sk sk-dark sk-green h-3 w-40 rounded" />
                <div className="sk sk-dark sk-green h-7 w-24 rounded" />
                <div className="sk sk-dark sk-green h-2.5 w-28 rounded" />
              </div>
            ))}
          </div>
        </aside>

        {/* Right column: tab bar + map card */}
        <section className="flex-1 flex flex-col gap-5 min-w-0">
          <div className="hidden sm:flex gap-1 bg-white p-1.5 rounded-2xl border border-slate-200">
            <div className="h-9 w-36 rounded-xl bg-emerald-700/70" />
            <div className={`h-9 w-32 rounded-xl ${bar}`} />
            <div className={`h-9 w-36 rounded-xl ${bar}`} />
            <div className={`h-9 w-40 rounded-xl ${bar}`} />
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-4">
            <div className="space-y-2">
              <div className={`h-5 w-56 ${bar}`} />
              <div className={`h-3 w-full max-w-xl ${bar}`} />
            </div>
            <div className="sk h-[320px] sm:h-[420px] rounded-2xl" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-100">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={`h-4 w-3/4 ${bar}`} />
              ))}
            </div>
          </div>
        </section>
      </main>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* (lands on the "All Projects" tab: filters, mini map, stat chips,    */
/*  filter card, project list)                                         */
/* ------------------------------------------------------------------ */

function AdminChip({ extraLine = false }) {
  return (
    <div className="bg-white border border-slate-200/60 rounded-2xl p-5">
      <div className="sk size-10 rounded-xl mb-3" />
      <div className={`h-8 w-14 ${bar}`} />
      <div className={`h-4 w-28 ${bar} mt-1.5`} />
      {extraLine && <div className={`h-3.5 w-24 ${bar} mt-1.5`} />}
    </div>
  );
}

export function AdminPageSkeleton() {
  return (
    <Shell>
      {/* Sidebar: w-72, logo + version, main menu (10), divider, system, profile + sign out */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-72 flex-col bg-gradient-to-b from-slate-950 to-slate-900 border-r border-slate-800/60 shadow-xl">
        <div className="px-5 py-6 border-b border-slate-800/60 flex items-center justify-between">
          <div className="space-y-2">
            <div className="sk sk-dark h-8 w-36 rounded" />
            <div className="sk sk-dark h-2.5 w-24 rounded" />
          </div>
          <div className="sk sk-dark size-[30px] rounded-lg" />
        </div>
        <nav className="flex-1 px-3 py-6 overflow-hidden">
          <div className="sk sk-dark h-2.5 w-20 rounded mx-4 mb-3" />
          <div className="space-y-1.5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className={`flex items-center gap-4 px-4 py-3 rounded-xl ${i === 0 ? 'bg-teal-500/60' : ''}`}
              >
                <div className="sk sk-dark size-5 rounded shrink-0" />
                <div className="sk sk-dark h-3.5 flex-1 rounded" />
              </div>
            ))}
            <div className="my-5 border-t border-slate-800/60 mx-2" />
            <div className="sk sk-dark h-2.5 w-14 rounded mx-4 mb-3" />
            <div className="flex items-center gap-4 px-4 py-3">
              <div className="sk sk-dark size-5 rounded shrink-0" />
              <div className="sk sk-dark h-3.5 w-20 rounded" />
            </div>
          </div>
        </nav>
        <div className="p-5 border-t border-slate-800/60 bg-slate-900/60">
          <div className="flex items-center gap-3 px-1.5 py-2">
            <div className="sk sk-dark size-10 rounded-xl shrink-0" />
            <div className="space-y-1.5">
              <div className="sk sk-dark h-3.5 w-28 rounded" />
              <div className="sk sk-dark h-2.5 w-36 rounded" />
            </div>
          </div>
          <div className="sk sk-dark h-10 rounded-xl mt-3" />
        </div>
      </aside>

      <div className="min-h-dvh lg:ml-72">
        {/* Header: "FMR Projects" title + description, bell, New Project button */}
        <header className="bg-gradient-to-br from-slate-50 to-slate-100 border-b border-slate-200/50">
          <div className="px-6 sm:px-10 py-4 sm:py-5 flex justify-between items-center gap-4">
            <div className="space-y-2.5">
              <div className={`h-8 w-44 ${bar}`} />
              <div className={`h-3.5 w-72 max-w-full ${bar}`} />
            </div>
            <div className="flex items-center gap-3">
              <div className="sk size-9 rounded-full" />
              <div className="sk h-12 w-40 rounded-xl" />
            </div>
          </div>
        </header>

        <div className="p-6 sm:p-10">
          <div className="space-y-4">
            {/* Map filters: search, year, municipality, overdue, status pills */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="sk h-10 flex-1 rounded-xl" />
              <div className="sk h-10 w-32 rounded-xl" />
              <div className="sk h-10 w-44 rounded-xl" />
              <div className="sk h-10 w-40 rounded-xl" />
              <div className="hidden xl:flex gap-1.5">
                {[96, 96, 96, 56].map((w, i) => (
                  <div key={i} className="sk h-10 rounded-xl" style={{ width: `${w}px` }} />
                ))}
              </div>
            </div>

            {/* "N projects mapped" + status counts */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className={`h-4 w-64 ${bar}`} />
              <div className={`h-4 w-24 ${bar}`} />
              <div className={`h-4 w-24 ${bar}`} />
              <div className={`h-4 w-24 ${bar}`} />
            </div>

            {/* 350px mini map: search overlay top-left, legend bottom-left */}
            <div
              className="relative bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden"
              style={{ height: '350px' }}
            >
              <div className="sk absolute inset-0" />
              <div className="absolute top-2 left-12 flex gap-1 bg-white p-1 rounded-lg shadow-md border border-slate-200/80 w-[280px] max-w-full">
                <div className="flex-1 h-6 rounded bg-slate-100" />
                <div className="h-6 w-9 rounded bg-teal-600/70" />
              </div>
              <div className="absolute bottom-4 left-4 bg-white/95 border border-slate-200 rounded-xl shadow-sm p-3 min-w-[245px] space-y-2">
                <div className={`h-3.5 w-20 ${bar}`} />
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-6 h-1.5 rounded bg-zinc-300" />
                    <div className={`h-3 w-16 ${bar}`} />
                  </div>
                ))}
                <div className="pt-2 border-t border-slate-200 space-y-1.5">
                  {[0, 1].map((i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="size-3.5 rounded-full bg-zinc-300" />
                      <div className={`h-3 w-32 ${bar}`} />
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t border-slate-200 space-y-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className={`h-3 w-36 ${bar}`} />
                  ))}
                </div>
              </div>
            </div>

            {/* Stat chips: 4 + 2 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => <AdminChip key={i} />)}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <AdminChip extraLine />
              <div className="bg-white border border-slate-200/60 rounded-2xl p-5">
                <div className="sk size-10 rounded-xl mb-3" />
                <div className={`h-4 w-44 ${bar} mb-3`} />
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className={`h-4 w-2/3 ${bar}`} />
                        <div className={`h-3.5 w-8 ${bar}`} />
                      </div>
                      <div className="sk h-2 w-full rounded-full" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Filter card */}
            <div className="bg-white border border-slate-200/70 rounded-3xl shadow-sm p-4 sm:p-5 lg:p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-3 lg:gap-4 items-end">
                <div className="sk h-12 rounded-2xl md:col-span-2 xl:col-span-4" />
                <div className="sk h-12 rounded-2xl xl:col-span-2" />
                <div className="sk h-12 rounded-2xl xl:col-span-2" />
                <div className="sk h-12 rounded-2xl xl:col-span-2" />
                <div className="sk h-12 rounded-2xl xl:col-span-2" />
              </div>
              <div className="mt-5 flex items-center justify-between gap-3">
                <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-100/80 p-1 gap-1">
                  <div className="h-10 w-28 rounded-xl bg-white" />
                  <div className="h-10 w-28 rounded-xl bg-slate-200/70" />
                  <div className="h-10 w-28 rounded-xl bg-slate-200/70" />
                </div>
                <div className="sk h-12 w-32 rounded-2xl" />
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                <div className={`h-4 w-44 ${bar}`} />
                <div className="sk h-9 w-36 rounded-2xl" />
              </div>
            </div>

            {/* Project list */}
            <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden divide-y divide-slate-100">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-6 py-4 flex items-center gap-6">
                  <div className="flex-1 space-y-2">
                    <div className={`h-4 w-1/2 ${bar}`} />
                    <div className={`h-3 w-1/3 ${bar}`} />
                  </div>
                  <div className={`hidden md:block h-4 w-24 ${bar}`} />
                  <div className={`h-6 w-20 rounded-full ${bar}`} />
                  <div className={`hidden sm:block h-2 w-28 rounded-full ${bar}`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
