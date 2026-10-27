/* Showing supporting evidence that was sent (lib/evidence.js "Stored" shape) from
 * a private bucket: thumbnails open full size in a new tab; camera photos show
 * where and when they were taken and link to their /verify page.
 *
 *   <EvidenceGallery client={supabase} bucket="delay-evidence" items={rows} /> */
import { useEffect, useState } from 'react';
import { ExternalLinkIcon, FileTextIcon, MapPinIcon, ShieldCheckIcon } from 'lucide-react';

export default function EvidenceGallery({ client, bucket, items = [], title = 'Supporting evidence' }) {
  const [urls, setUrls] = useState({});
  const key = items.map((i) => i.storage_path).join('|');

  useEffect(() => {
    if (!items.length || !client) return undefined;
    let alive = true;
    client.storage.from(bucket).createSignedUrls(items.map((i) => i.storage_path), 3600)
      .then(({ data }) => {
        if (!alive || !data) return;
        setUrls(Object.fromEntries(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl])));
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, bucket, key]);

  if (!items.length) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title} · {items.length}</p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((it) => {
          const url = urls[it.storage_path];
          const isImage = String(it.mime_type || '').startsWith('image/');
          return (
            <li key={it.storage_path} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <a href={url || undefined} target="_blank" rel="noopener noreferrer" className="block bg-slate-50" aria-label={`Open ${it.file_name || 'evidence'}`}>
                {isImage && url ? (
                  <img src={url} alt={it.file_name || 'Evidence photo'} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                ) : (
                  <span className="grid aspect-[4/3] w-full place-items-center text-slate-400">
                    {isImage ? <span className="size-6 animate-pulse rounded bg-slate-200" /> : <FileTextIcon className="size-8" aria-hidden="true" />}
                  </span>
                )}
              </a>
              <div className="space-y-0.5 px-2 py-1.5 text-[11px] text-slate-600">
                {it.kind === 'photo' ? (
                  <>
                    <p className="flex items-center gap-1"><MapPinIcon className="size-3 shrink-0 text-teal-600" aria-hidden="true" />
                      {it.latitude != null ? `${Number(it.latitude).toFixed(5)}, ${Number(it.longitude).toFixed(5)}` : 'Geotagged'}
                      {it.accuracy_m != null ? ` ±${Math.round(it.accuracy_m)} m` : ''}
                    </p>
                    {it.captured_at && <p className="text-slate-400">{new Date(it.captured_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>}
                    {it.attestation_code && (
                      <a href={`/verify/${it.attestation_code}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:underline">
                        <ShieldCheckIcon className="size-3" aria-hidden="true" /> Verify
                      </a>
                    )}
                  </>
                ) : (
                  <p className="flex items-center gap-1 truncate" title={it.file_name}>
                    <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" /><span className="truncate">{it.file_name || 'File'}</span>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
