/* What the contractor sent with a progress update, for the engineer's and the
 * DA's review: the geotagged site photo and the Statement of Work Accomplished
 * (private bucket "progress-documents", opened with a short-lived link;
 * supabase_progress_swa.sql). Older updates sent before the SWA was required
 * say so instead.
 *
 *   <SubmissionEvidence client={supabase} update={row} /> */
import { useEffect, useState } from 'react';
import { FileTextIcon, ExternalLinkIcon } from 'lucide-react';
import ZoomablePhoto from '../ui/ZoomablePhoto';

export default function SubmissionEvidence({ client, update, className = '' }) {
  const [swaUrl, setSwaUrl] = useState(null);
  const swaPath = update?.swa_path || null;

  useEffect(() => {
    if (!client || !swaPath) return undefined;
    let alive = true;
    client.storage.from('progress-documents').createSignedUrl(swaPath, 3600)
      .then(({ data }) => { if (alive) setSwaUrl(data?.signedUrl || null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [client, swaPath]);

  return (
    <section className={`grid gap-3 sm:grid-cols-2 ${className}`} aria-label="Contractor's evidence">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Contractor&rsquo;s site photo</p>
        {update?.photo_url ? (
          <ZoomablePhoto
            src={update.photo_url}
            alt="Contractor's geotagged site photo"
            label="Contractor's site photo"
            wrapperClassName="w-full rounded-lg"
            className="aspect-[4/3] w-full rounded-lg border border-slate-200 object-cover"
          />
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">No photo was sent.</p>
        )}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Statement of Work Accomplished</p>
        {swaPath ? (
          <a
            href={swaUrl || undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!swaUrl}
            className={`flex items-center gap-3 rounded-lg border border-slate-200 p-3 ${swaUrl ? 'hover:border-teal-300 hover:bg-teal-50/40' : 'pointer-events-none opacity-60'}`}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-700">
              <FileTextIcon className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-800" title={update.swa_file_name || 'SWA'}>{update.swa_file_name || 'Statement of Work Accomplished'}</span>
              <span className="text-xs text-slate-500">{swaUrl ? 'Open in a new tab' : 'Preparing link…'}</span>
            </span>
            <ExternalLinkIcon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
          </a>
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">Sent before the SWA was required.</p>
        )}
      </div>
    </section>
  );
}

/** A small "SWA" link for tables: makes the private link only when clicked. */
export function SwaLink({ client, update, className = '' }) {
  const [busy, setBusy] = useState(false);
  if (!update?.swa_path) return null;
  const open = async () => {
    // Opened first, then pointed at the file, so pop-up blockers allow it.
    // ('noopener' would return no handle to the tab, so the opener is cut by hand.)
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    setBusy(true);
    const { data } = await client.storage.from('progress-documents').createSignedUrl(update.swa_path, 3600);
    setBusy(false);
    if (data?.signedUrl && tab) tab.location.href = data.signedUrl;
    else tab?.close();
  };
  return (
    <button type="button" onClick={open} disabled={busy} title={update.swa_file_name || 'Statement of Work Accomplished'} className={className}>
      <FileTextIcon className="size-3.5" aria-hidden="true" /> {busy ? 'Opening…' : 'SWA'}
    </button>
  );
}
