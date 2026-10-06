import { ChevronLeftIcon } from 'lucide-react';

/**
 * Round collapse/expand button that sits on the sidebar's right edge, vertically
 * centered. Render it as the last child of a positioned (fixed/absolute) <aside>.
 * The chevron turns instead of swapping, so the open and close feel continuous.
 */
export default function SidebarEdgeToggle({ collapsed, onToggle, zClass = 'z-50' }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
      className={`hidden lg:flex absolute top-1/2 -translate-y-1/2 -right-3 h-6 w-6 ${zClass} items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-400 hover:text-white hover:border-slate-500 shadow-lg cursor-pointer transition-colors`}
    >
      <ChevronLeftIcon
        className={`size-3.5 transition-transform duration-300 ease-in-out ${collapsed ? 'rotate-180' : ''}`}
        strokeWidth={2.5}
        aria-hidden="true"
      />
    </button>
  );
}
