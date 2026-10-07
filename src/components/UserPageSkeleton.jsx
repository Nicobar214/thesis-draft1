/**
 * UserPageSkeleton - Placeholder shell shown while the user portal checks auth.
 * Mirrors UserLayout (sidebar, header, content width) so the real page
 * replaces it without the layout shifting. Blocks have a light shimmer sweep
 * and a small "Loading" pill so it reads as actively working.
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
.sk-soft { background-color: #f4f4f5; }
@keyframes sk-bar { 0% { left: -40%; } 100% { left: 100%; } }
@media (prefers-reduced-motion: reduce) {
  .sk::after, .sk-bar-fill { animation: none !important; }
}
`;

const bar = 'sk rounded';

export default function UserPageSkeleton() {
  return (
    <div
      className="min-h-dvh bg-slate-50 font-sans"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <style>{styles}</style>

      {/* Top progress bar */}
      <div className="fixed top-0 inset-x-0 h-0.5 bg-emerald-100 z-50 overflow-hidden">
        <div
          className="sk-bar-fill absolute top-0 h-full w-2/5 bg-emerald-600 rounded-full"
          style={{ animation: 'sk-bar 1.2s ease-in-out infinite' }}
        />
      </div>

      {/* Loading indicator, centered on the screen */}
      <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
        <div className="text-center px-12 py-8 rounded-2xl bg-white/90 backdrop-blur shadow-lg border border-slate-200">
          <Logo className="h-10 mx-auto mb-6" />
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-700 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>

      {/* Sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col bg-white border-r border-slate-200 p-4 gap-3">
        <div className={`h-9 w-32 ${bar} mb-4`} />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-2">
            <div className={`size-5 ${bar}`} />
            <div className={`h-4 flex-1 ${bar}`} />
          </div>
        ))}
      </aside>

      <main className="lg:ml-64 min-h-dvh">
        {/* Header */}
        <header className="bg-white border-b border-slate-200">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`h-5 w-32 ${bar}`} />
            </div>
            <div className="flex items-center gap-3">
              <div className={`hidden sm:block h-8 w-36 ${bar}`} />
              <div className="sk size-8 rounded-lg" />
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 pt-16 lg:pt-6 space-y-6">
          {/* Welcome banner */}
          <div className="sk h-32 rounded-2xl" />

          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-6 border border-slate-200/60">
                <div className="sk size-10 rounded-xl mb-4" />
                <div className={`h-8 w-12 ${bar} mb-2`} />
                <div className={`h-4 w-20 ${bar}`} />
              </div>
            ))}
          </div>

          {/* Cards */}
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <div className={`h-5 w-48 ${bar}`} />
              <div className="flex gap-4 overflow-hidden">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="sk sk-soft w-72 shrink-0 h-28 rounded-xl" />
                ))}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <div className={`h-5 w-40 ${bar}`} />
              <div className="size-36 rounded-full border-[18px] border-zinc-200 mx-auto" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
