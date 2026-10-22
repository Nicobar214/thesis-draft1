/* A captured KalsaTrack-camera photo: the picture (tap to enlarge), whether
 * it counts as on-site evidence, and its GPS position and time. */
import { MapPinIcon, XIcon } from 'lucide-react';
import ZoomablePhoto from '../ui/ZoomablePhoto';

export default function GeotagPhotoPreview({ photo, place = 'the road', onRemove, removeLabel = 'Remove photo', className = 'max-w-md' }) {
  const a = photo?.attestation;
  const check = photo?.check;
  if (!photo) return null;
  return (
    <div className={className}>
      <div className="relative">
        <ZoomablePhoto
          src={photo.preview}
          alt="Site photo"
          label="Site photo"
          wrapperClassName="w-full rounded-xl"
          className="w-full aspect-video object-cover rounded-xl border border-slate-200"
        />
        {onRemove && (
          <button type="button" onClick={onRemove} aria-label={removeLabel} title={removeLabel} className="absolute right-2 top-2 rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 shadow hover:text-rose-600">
            <XIcon className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {check && (
        <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${check.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
          <p className="font-semibold">
            {check.ok
              ? (check.distanceM != null ? `On site: ${Math.round(check.distanceM)} m from ${place}` : `Geotagged (${place} has no mapped location to compare with)`)
              : 'Not accepted as on-site evidence. Retake it on site.'}
          </p>
          {!check.ok && <p className="mt-0.5">{check.problem}</p>}
          {a && (
            <p className="mt-0.5 flex items-center gap-1 opacity-80">
              <MapPinIcon className="size-3 shrink-0" aria-hidden="true" />
              {a.latitude?.toFixed(6)}, {a.longitude?.toFixed(6)}
              {a.accuracy != null && ` · ±${Math.round(a.accuracy)} m`}
              {' · '}{new Date(a.capturedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
