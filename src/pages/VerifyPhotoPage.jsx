/* VerifyPhotoPage.jsx — /verify/:code, opened by scanning the QR stamped on a
 * KalsaTrack geotagged photo (lib/photoAttestation.js), or /verify to type a code.
 *
 * Shows the server's record for the code: what the photo is, where and when it
 * was taken, when the server received it, and (for public report photos) the
 * original stored photo. No names or account ids are shown.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftIcon, BadgeCheckIcon, CircleAlertIcon, MapPinIcon, ClockIcon, ShieldAlertIcon, Loader2Icon,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import Logo from '../components/Logo';
import { ATTESTATION_KINDS, formatCaptureTime } from '../lib/photoAttestation';

const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-900 sm:text-right">{children}</dd>
    </div>
  );
}

/** Compares the phone's capture time with the server's receipt time. */
function timeCheck(capturedAt, registeredAt) {
  if (!capturedAt || !registeredAt) return null;
  const gapMin = (new Date(registeredAt) - new Date(capturedAt)) / 60000;
  if (gapMin < -5) {
    return { tone: 'bad', text: 'The phone’s clock was ahead of the server when this photo was taken. The capture time may have been altered.' };
  }
  if (gapMin > 24 * 60) {
    const days = Math.round(gapMin / (24 * 60));
    return { tone: 'warn', text: `Received by the server about ${days} day${days === 1 ? '' : 's'} after it was taken (for example, saved offline and uploaded later).` };
  }
  return { tone: 'ok', text: 'Capture time agrees with the server’s receipt time.' };
}

export default function VerifyPhotoPage() {
  const { code: rawCode } = useParams();
  const navigate = useNavigate();
  const code = String(rawCode || '').trim().toUpperCase();
  const [input, setInput] = useState(code);
  const [state, setState] = useState({ loading: Boolean(code), record: null, error: '' });

  useEffect(() => {
    document.title = 'Verify a photo · KalsaTrack';
    if (!code) return undefined;
    let alive = true;
    (async () => {
      if (!CODE_RE.test(code)) {
        if (alive) setState({ loading: false, record: null, error: 'invalid' });
        return;
      }
      const { data, error } = await supabase.rpc('verify_photo_attestation', { p_code: code });
      if (!alive) return;
      if (error) setState({ loading: false, record: null, error: 'failed' });
      else setState({ loading: false, record: data?.[0] || null, error: data?.[0] ? '' : 'notfound' });
    })();
    return () => { alive = false; };
  }, [code]);

  const record = state.record;
  const photoUrl = record?.storage_bucket && record?.storage_path
    ? supabase.storage.from(record.storage_bucket).getPublicUrl(record.storage_path).data?.publicUrl
    : null;
  const check = record ? timeCheck(record.captured_at, record.registered_at) : null;
  const hasGps = Number.isFinite(record?.latitude) && Number.isFinite(record?.longitude);

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" aria-label="KalsaTrack home"><Logo className="h-7 sm:h-8" /></Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
            <ArrowLeftIcon className="size-4" aria-hidden="true" />
            Home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Verify a geotagged photo</h1>
          <p className="mt-1 text-sm text-slate-500">Scan the QR on a KalsaTrack photo, or type its 12-character code.</p>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); const c = input.trim().toUpperCase(); if (c) navigate(`/verify/${c}`); }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder="e.g. 7K2M9QX4T8BN"
            maxLength={12}
            aria-label="Verification code"
            className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 font-mono text-sm tracking-widest text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
          />
          <button type="submit" className="h-11 rounded-xl bg-teal-600 px-5 text-sm font-semibold text-white hover:bg-teal-700">Verify</button>
        </form>

        {state.loading && (
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
            <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Checking the record…
          </div>
        )}

        {!state.loading && code && !record && (
          <section className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5">
            <ShieldAlertIcon className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden="true" />
            <div>
              <p className="font-semibold text-red-900">
                {state.error === 'failed' ? 'Could not check right now' : 'No KalsaTrack record for this code'}
              </p>
              <p className="mt-1 text-sm text-red-800">
                {state.error === 'failed'
                  ? 'Check your connection and try again.'
                  : 'A genuine KalsaTrack photo has a registered code. If this code came from a photo, the photo may not be authentic, or it was captured offline and has not been uploaded yet.'}
              </p>
            </div>
          </section>
        )}

        {record && (
            <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-xs">
              <div className="flex items-start gap-3 border-b border-emerald-100 bg-emerald-50 p-5">
                <BadgeCheckIcon className="mt-0.5 size-6 shrink-0 text-emerald-600" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-emerald-900">Registered KalsaTrack photo</p>
                  <p className="mt-0.5 text-sm text-emerald-800">
                    This code was issued by KalsaTrack and recorded on its server. Compare the photo you have with the details below.
                  </p>
                </div>
              </div>

              {photoUrl && (
                <a href={photoUrl} target="_blank" rel="noreferrer" className="block border-b border-slate-100 bg-slate-900">
                  <img src={photoUrl} alt="Original registered photo" className="mx-auto max-h-[28rem] w-full object-contain" />
                </a>
              )}

              <dl className="divide-y divide-slate-100">
                <Row label="Code"><span className="font-mono tracking-widest">{record.code}</span></Row>
                <Row label="Type">{ATTESTATION_KINDS[record.kind] || record.kind}</Row>
                {record.label && <Row label="What the photo shows">{record.label}</Row>}
                <Row label={<span className="inline-flex items-center gap-1.5"><ClockIcon className="size-3.5" />Taken (phone time)</span>}>
                  {record.captured_at ? formatCaptureTime(record.captured_at) : '—'}
                </Row>
                <Row label="Received by server">{formatCaptureTime(record.registered_at)}</Row>
                <Row label={<span className="inline-flex items-center gap-1.5"><MapPinIcon className="size-3.5" />Location</span>}>
                  {hasGps ? (
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${record.latitude}&mlon=${record.longitude}#map=17/${record.latitude}/${record.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-teal-700 hover:underline"
                    >
                      {record.latitude.toFixed(6)}, {record.longitude.toFixed(6)}
                      {Number.isFinite(record.accuracy_m) ? ` (±${Math.round(record.accuracy_m)} m)` : ''}
                    </a>
                  ) : 'Not recorded'}
                </Row>
                <Row label="Fingerprint (SHA-256)">
                  <span className="break-all font-mono text-xs text-slate-600">{record.sha256}</span>
                </Row>
              </dl>

              {check && (
                <p className={`flex items-start gap-2 border-t px-5 py-3 text-sm ${
                  check.tone === 'ok' ? 'border-slate-100 text-slate-600'
                    : check.tone === 'warn' ? 'border-amber-100 bg-amber-50 text-amber-900'
                      : 'border-red-100 bg-red-50 text-red-800'
                }`}
                >
                  {check.tone === 'ok'
                    ? <BadgeCheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    : <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
                  {check.text}
                </p>
              )}
              {!photoUrl && (
                <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                  The original photo is kept privately and can be viewed by authorized DA staff in KalsaTrack.
                </p>
              )}
            </section>
        )}

        <p className="text-center text-xs text-slate-400">
          KalsaTrack stamps every geotagged photo with its time, location and a verification code, following the
          DA PRDP geotagging practice, so edited copies can be detected.
        </p>
      </main>
    </div>
  );
}
