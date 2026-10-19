import { CheckCircle2Icon, CircleDashedIcon, FileTextIcon, UploadIcon } from 'lucide-react';
import { PROPOSAL_REQUIREMENTS, findRequirementDoc, requirementProgress } from '../../lib/proposalRequirements';

/**
 * The DA "Checklist of Required Supporting Documents" for an LGU FMR proposal.
 *
 * Upload mode (LGU form): pass `files` and `onFileChange(key, file)`.
 * View mode (LGU list, DA review): pass `onOpen(path)` to open a saved file.
 * `proposal` supplies what is already saved (both modes).
 */
export default function ProposalDocumentsChecklist({ proposal, files = {}, onFileChange, onOpen, compact = false }) {
  const editable = typeof onFileChange === 'function';
  const saved = requirementProgress(proposal);
  const attached = editable
    ? PROPOSAL_REQUIREMENTS.filter((r) => files[r.key] || findRequirementDoc(proposal, r.key)).length
    : saved.attached;
  const complete = attached === PROPOSAL_REQUIREMENTS.length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3.5 py-2.5">
        <p className="text-xs font-semibold text-slate-800">Checklist of Required Supporting Documents</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${complete ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {attached} of {PROPOSAL_REQUIREMENTS.length} attached
        </span>
      </div>
      <ol className="divide-y divide-slate-100">
        {PROPOSAL_REQUIREMENTS.map((req, i) => {
          const doc = findRequirementDoc(proposal, req.key);
          const picked = files[req.key];
          const has = Boolean(picked || doc);
          return (
            <li key={req.key} className={`flex flex-col gap-2 px-3.5 ${compact ? 'py-2' : 'py-2.5'} sm:flex-row sm:items-center sm:justify-between`}>
              <div className="flex min-w-0 items-start gap-2.5">
                {has
                  ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Attached" />
                  : <CircleDashedIcon className="mt-0.5 size-4 shrink-0 text-slate-300" aria-label="Not attached" />}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800">{i + 1}. {req.label}</p>
                  {!compact && <p className="text-[11px] leading-snug text-slate-500">{req.hint}</p>}
                  {picked && <p className="truncate text-[11px] text-teal-700">Selected: {picked.name}</p>}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 pl-6 sm:pl-0">
                {doc && onOpen && (
                  <button
                    type="button"
                    onClick={() => onOpen(doc.path)}
                    className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200"
                  >
                    <FileTextIcon className="size-3.5" aria-hidden="true" /> View
                  </button>
                )}
                {!doc && !editable && <span className="text-[11px] font-medium text-slate-400">Not attached</span>}
                {editable && (
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-700 hover:bg-teal-100">
                    <UploadIcon className="size-3.5" aria-hidden="true" />
                    {has ? 'Replace' : 'Upload'}
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      className="sr-only"
                      aria-label={`Upload ${req.label}`}
                      onChange={(e) => onFileChange(req.key, e.target.files?.[0] || null)}
                    />
                  </label>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
