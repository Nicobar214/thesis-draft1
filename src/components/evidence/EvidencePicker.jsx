/* Adding supporting evidence to a form (lib/evidence.js), in two parts so the
 * buttons can sit in a card's top corner and the items further down:
 *
 *   <EvidenceActions items={items} onChange={setItems} kind="delay_evidence" label="…" />
 *   <EvidenceGrid items={items} onChange={setItems} />
 *
 * "Take photo" opens the KalsaTrack camera (live camera, GPS + time + QR stamped);
 * "Attach file" takes photos or PDFs from the device. Nothing is uploaded here. */
import { useRef } from 'react';
import { FileTextIcon, MapPinIcon, PaperclipIcon, XIcon } from 'lucide-react';
import GeotagCamera from '../camera/GeotagCamera';
import { notify } from '../../lib/toast';
import { EVIDENCE_ACCEPT, EVIDENCE_MAX_ITEMS, fileProblem, fileToEvidence, photoToEvidence } from '../../lib/evidence';

export function EvidenceActions({ items, onChange, kind, label, place = 'the site', disabled = false }) {
  const inputRef = useRef(null);
  const full = items.length >= EVIDENCE_MAX_ITEMS;

  const addFiles = (fileList) => {
    const picked = [...(fileList || [])];
    const room = EVIDENCE_MAX_ITEMS - items.length;
    const ok = [];
    picked.forEach((f) => {
      const problem = fileProblem(f);
      if (problem) notify(problem, 'error');
      else if (ok.length < room) ok.push(fileToEvidence(f));
    });
    if (picked.length > room) notify(`You can attach up to ${EVIDENCE_MAX_ITEMS} items.`, 'error');
    if (ok.length) onChange([...items, ...ok]);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <GeotagCamera
        compact
        kind={kind}
        label={label}
        place={place}
        disabled={disabled || full}
        onCaptured={(photo) => {
          if (!photo.check.ok) { notify(photo.check.problem, 'error'); return; }
          onChange([...items, photoToEvidence(photo)]);
          notify('Photo added. It is sent with your reply.', 'success');
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || full}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
      >
        <PaperclipIcon className="size-4" aria-hidden="true" /> Attach file
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={EVIDENCE_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}

export function EvidenceGrid({ items, onChange, emptyText = 'No supporting evidence yet. Use Take photo or Attach file above.' }) {
  if (!items.length) return <p className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-400">{emptyText}</p>;
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((it) => (
        <li key={it.id} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          {it.preview ? (
            <img src={it.preview} alt={it.name} className="aspect-[4/3] w-full object-cover" />
          ) : (
            <div className="grid aspect-[4/3] w-full place-items-center text-slate-400">
              <FileTextIcon className="size-8" aria-hidden="true" />
            </div>
          )}
          <div className="flex items-center gap-1 px-2 py-1.5 text-[11px] text-slate-600">
            {it.kind === 'photo'
              ? <><MapPinIcon className="size-3 shrink-0 text-teal-600" aria-hidden="true" /><span className="truncate">Geotagged{it.attestation?.accuracy != null ? ` ±${Math.round(it.attestation.accuracy)} m` : ''}</span></>
              : <span className="truncate" title={it.name}>{it.name}</span>}
          </div>
          {onChange && (
            <button
              type="button"
              onClick={() => onChange(items.filter((x) => x.id !== it.id))}
              aria-label={`Remove ${it.name}`}
              className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-slate-900/70 text-white hover:bg-slate-900"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
