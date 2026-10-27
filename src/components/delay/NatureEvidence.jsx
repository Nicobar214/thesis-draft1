/* Supporting evidence for an ACT-OF-NATURE claim (supabase_overdue_v2_patch2.sql),
 * in two parts so the DA and the field engineer can tell them apart:
 *   1. Official documents (required, at least one): PAGASA/NDRRMC advisory, LGU
 *      work-suspension notice, barangay certification.
 *   2. Photos of what happened (recommended): KalsaTrack camera or files.
 *
 *   <NatureEvidencePicker documents={d} photos={p} onDocuments={setD} onPhotos={setP} label="…" />
 *   <NatureEvidenceGallery client={client} rows={storedRows} />           (stored, read-only)
 */
import { FileCheck2Icon, ImagesIcon, LockIcon } from 'lucide-react';
import { EvidenceActions, EvidenceGrid } from '../evidence/EvidencePicker';
import EvidenceGallery from '../evidence/EvidenceGallery';
import { splitEvidence } from '../../lib/evidence';

export const NATURE_DOC_HINT = 'PAGASA or NDRRMC advisory, LGU work-suspension notice, or barangay certification (PDF or photo of the document).';

function Part({ icon, title, badge, hint, actions, children }) {
  const Icon = icon;
  return (
    <div className="rounded-xl border border-slate-200 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Icon className="size-4 text-sky-700" aria-hidden="true" /> {title}
            {badge}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
        </div>
        {actions}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function NatureEvidencePicker({ documents, photos, onDocuments, onPhotos, label, disabled = false, documentsRequired = true }) {
  return (
    <div className="space-y-3">
      <Part
        icon={FileCheck2Icon}
        title="Official documents"
        badge={documentsRequired
          ? <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700">Required · at least 1</span>
          : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">Optional</span>}
        hint={NATURE_DOC_HINT}
        actions={<EvidenceActions items={documents} onChange={onDocuments} camera={false} attachLabel="Attach document" category="document" disabled={disabled} kind="delay_evidence" label={label} />}
      >
        <EvidenceGrid items={documents} onChange={disabled ? undefined : onDocuments} emptyText="No document yet. Use Attach document." />
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
          <LockIcon className="size-3 shrink-0" aria-hidden="true" />
          Seen only by the DA and the field engineer. The public sees only that they were checked.
        </p>
      </Part>
      <Part
        icon={ImagesIcon}
        title="Photos of what happened"
        badge={<span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-700">Recommended</span>}
        hint="Flood level, landslide, damaged road or equipment. KalsaTrack camera photos carry the place and time. Shown publicly once the DA approves."
        actions={<EvidenceActions items={photos} onChange={onPhotos} category="photo" disabled={disabled} kind="delay_evidence" label={label} />}
      >
        <EvidenceGrid items={photos} onChange={disabled ? undefined : onPhotos} emptyText="No photo yet. Use Take photo or Attach file." />
      </Part>
    </div>
  );
}

/** Stored evidence of an act-of-nature claim, documents first. */
export function NatureEvidenceGallery({ client, rows, bucket = 'delay-evidence', who = "Contractor's" }) {
  const { documents, photos } = splitEvidence(rows);
  if (!rows?.length) return null;
  return (
    <div className="space-y-3">
      {documents.length > 0 && <EvidenceGallery client={client} bucket={bucket} items={documents} title={`${who} official documents`} />}
      {photos.length > 0 && <EvidenceGallery client={client} bucket={bucket} items={photos} title={`${who} photos of what happened`} />}
    </div>
  );
}
