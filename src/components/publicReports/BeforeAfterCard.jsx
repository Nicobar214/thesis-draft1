/* The reporter's photo next to the repair's photo, for citizens (Community
 * Feedback). With a field finding, the engineer's on-site photo sits between
 * them. See reportAccountability.jsx. */
import { BadgeCheckIcon, ImageIcon } from 'lucide-react';
import ZoomablePhoto from '../ui/ZoomablePhoto';
import { repairerName } from './reportAccountability';

const fmtDay = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
};

const BADGE = { before: 'bg-slate-900/70', check: 'bg-sky-700/90', after: 'bg-emerald-600/90' };

/** The reporter's photo, the engineer's (if any) and the repair's, each with who took it and when. */
export default function BeforeAfterCard({ report, repair = null, finding = null, isMine = false }) {
  if (!report) return null;
  const repairer = repairerName(report, repair);
  const shots = [
    { key: 'before', label: 'Before', src: report.photo_url || null, by: isMine ? 'Your photo' : 'Reporter’s photo', when: fmtDay(report.created_at) },
    finding?.field_photo_url && { key: 'check', label: 'Site check', src: finding.field_photo_url, by: finding.inspected_by_name || 'DA field engineer', when: fmtDay(finding.submitted_at) },
    { key: 'after', label: 'After', src: repair?.work_photo_url || repair?.verification_photo_url || null, by: repairer || 'Repair photo', when: fmtDay(repair?.work_submitted_at || repair?.verified_at) },
  ].filter(Boolean);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-label="Before and after">
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-base font-bold text-slate-900">Before and after</p>
        {repair?.verified_at && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            <BadgeCheckIcon className="size-3.5" aria-hidden="true" /> Checked on site
          </span>
        )}
      </div>
      <div className={`grid gap-3 sm:gap-4 ${shots.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`}>
        {shots.map((s) => (
          <figure key={s.key} className="min-w-0">
            <div className="relative">
              {s.src ? (
                <ZoomablePhoto src={s.src} alt={`${s.label}: ${s.by}`} wrapperClassName="w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100" className="aspect-[4/3] w-full object-cover" />
              ) : (
                <div className="grid aspect-[4/3] w-full place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center text-[11px] text-slate-400">
                  <span className="flex flex-col items-center gap-1"><ImageIcon className="size-5" aria-hidden="true" />{s.key === 'after' ? 'No repair photo yet' : 'No photo'}</span>
                </div>
              )}
              <span className={`pointer-events-none absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ${BADGE[s.key]}`}>
                {s.label}
              </span>
            </div>
            <figcaption className="mt-2 text-xs leading-snug">
              <span className="block truncate font-semibold text-slate-800" title={s.by}>{s.by}</span>
              {s.src && s.when && <span className="text-slate-500">{s.when}</span>}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
