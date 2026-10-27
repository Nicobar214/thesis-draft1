/* The reporter's photo next to the repair's photo, for citizens (Community
 * Feedback and My Reports). See reportAccountability.jsx. */
import { BadgeCheckIcon, ImageIcon } from 'lucide-react';
import ZoomablePhoto from '../ui/ZoomablePhoto';
import { repairerName } from './reportAccountability';

const fmtDay = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
};

/** The reporter's photo next to the repair's, each with who took it and when. */
export default function BeforeAfterCard({ report, repair = null, isMine = false }) {
  if (!report) return null;
  const repairer = repairerName(report, repair);
  const shots = [
    { key: 'before', label: 'Before', src: report.photo_url || null, by: isMine ? 'Your photo' : 'Reporter’s photo', when: fmtDay(report.created_at) },
    { key: 'after', label: 'After', src: repair?.work_photo_url || repair?.verification_photo_url || null, by: repairer || 'Repair photo', when: fmtDay(repair?.work_submitted_at || repair?.verified_at) },
  ];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="Before and after">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">Before and after</p>
        {repair?.verified_at && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            <BadgeCheckIcon className="size-3.5" aria-hidden="true" /> Checked on site
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
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
              <span className={`pointer-events-none absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ${s.key === 'before' ? 'bg-slate-900/70' : 'bg-emerald-600/90'}`}>
                {s.label}
              </span>
            </div>
            <figcaption className="mt-1.5 text-[11px] leading-tight">
              <span className="block truncate font-medium text-slate-700">{s.by}</span>
              {s.src && s.when && <span className="text-slate-400">{s.when}</span>}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
