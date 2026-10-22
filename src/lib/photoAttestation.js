/*
 * photoAttestation.js — tamper-evident geotagged photos, after the DA PRDP
 * geotagging camera (watermark + unique code carrying GPS time/date/location;
 * a scanner confirms it). Every geotagged photo KalsaTrack captures goes
 * through attestPhoto() before upload and registerAttestation() after:
 *
 *   attestPhoto(blob, meta)        stamp a watermark bar (date/time, GPS, label,
 *                                  code) + a QR to /verify/<code>; fingerprint
 *                                  the stamped JPEG with SHA-256
 *   registerAttestation(client, …) record code + fingerprint server-side; the
 *                                  server stores its own time (registered_at)
 *
 * Anyone scanning the QR sees the stored record and original photo on
 * /verify/<code>, so an edited copy (changed watermark, cropped, swapped
 * photo) is caught by comparing against the original.
 *
 * Database: supabase_photo_attestations.sql
 */
import QRCode from 'qrcode';

// Crockford base32: no I, L, O, U, so codes are easy to read aloud and type.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const ATTESTATION_KINDS = {
  citizen_report: 'Citizen road report',
  field_inspection: 'Field engineer inspection',
  repair_verification: 'Repair verification',
  contractor_progress: 'Contractor progress photo',
  progress_certification: 'Engineer progress certification',
  priority_validation: 'Engineer road gap validation',
  priority_inspection: 'Engineer priority site inspection',
};

/** 12 random characters (60 bits): unguessable, and generated offline too. */
export function generateAttestationCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join('');
}

// A QR is scanned by a different phone, so it must point to the public site, not
// to wherever the photo was taken (a laptop's localhost or a LAN address opens
// nothing on the scanning phone). Set VITE_PUBLIC_SITE_URL to the deployed URL.
const LOCAL_HOST_RE = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/;

export function verificationOrigin(env = import.meta.env, loc = typeof window !== 'undefined' ? window.location : null) {
  const configured = String(env?.VITE_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const origin = loc?.origin || '';
  if (loc && LOCAL_HOST_RE.test(loc.hostname || '')) {
    console.warn('[photo] VITE_PUBLIC_SITE_URL is not set, so this QR points to a local address that other phones cannot open.');
  }
  return origin;
}

export function verificationUrl(code) {
  return `${verificationOrigin()}/verify/${code}`;
}

/** Hex SHA-256 of a Blob/File. */
export async function sha256Hex(blob) {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatCaptureTime(date) {
  return new Date(date).toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  }) + ' PHT';
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the photo.')); };
    img.src = url;
  });
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * Draws the photo with a verification bar along the bottom and returns a JPEG.
 * meta: { code, capturedAt, latitude, longitude, accuracy, kind, label }
 */
async function stampPhoto(blob, meta) {
  const img = await loadImage(blob);
  // Keep photos a sensible size: long edge at most 1600 px.
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const bar = Math.max(132, Math.round(Math.min(w, h) * 0.2));
  const pad = Math.round(bar * 0.1);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h + bar;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  // Bar
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, h, w, bar);
  ctx.fillStyle = '#10b981';
  ctx.fillRect(0, h, w, Math.max(3, Math.round(bar * 0.03)));

  // QR (right side, on white so any phone can scan it)
  const qrSize = bar - pad * 2;
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, verificationUrl(meta.code), { width: qrSize, margin: 1, errorCorrectionLevel: 'M' });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(w - pad - qrSize, h + pad, qrSize, qrSize);
  ctx.drawImage(qrCanvas, w - pad - qrSize, h + pad, qrSize, qrSize);

  // Text (left side)
  const textMax = w - qrSize - pad * 3;
  const line = Math.round((bar - pad * 2) / 5);
  const font = (weight, px) => `${weight} ${px}px Inter, system-ui, -apple-system, Segoe UI, sans-serif`;
  const big = Math.max(13, Math.round(line * 0.78));
  const small = Math.max(11, Math.round(line * 0.66));
  const lat = Number(meta.latitude);
  const lng = Number(meta.longitude);
  const gps = Number.isFinite(lat) && Number.isFinite(lng)
    ? `${lat.toFixed(6)}, ${lng.toFixed(6)}${Number.isFinite(Number(meta.accuracy)) ? `  ±${Math.round(Number(meta.accuracy))} m` : ''}`
    : 'Location unavailable';
  const rows = [
    { text: 'KalsaTrack · Geotagged Photo', font: font(700, big), color: '#34d399' },
    { text: formatCaptureTime(meta.capturedAt || Date.now()), font: font(600, small), color: '#ffffff' },
    { text: gps, font: font(500, small), color: '#e2e8f0' },
    { text: meta.label || ATTESTATION_KINDS[meta.kind] || '', font: font(500, small), color: '#cbd5e1' },
    { text: `Verify: ${meta.code} · scan the QR`, font: font(600, small), color: '#94a3b8' },
  ];
  ctx.textBaseline = 'middle';
  rows.forEach((r, i) => {
    ctx.font = r.font;
    ctx.fillStyle = r.color;
    ctx.fillText(fitText(ctx, r.text, textMax), pad, h + pad + line * i + line / 2);
  });

  const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!out) throw new Error('Could not prepare the photo.');
  return out;
}

/**
 * Stamps and fingerprints a photo. Returns everything the caller needs to
 * upload the stamped photo and register it (now, or later when back online).
 */
export async function attestPhoto(blob, { kind, latitude, longitude, accuracy, capturedAt, label } = {}) {
  const code = generateAttestationCode();
  const when = capturedAt ? new Date(capturedAt) : new Date();
  const stamped = await stampPhoto(blob, { code, kind, latitude, longitude, accuracy, capturedAt: when, label });
  const sha256 = await sha256Hex(stamped);
  return {
    blob: stamped,
    attestation: {
      code,
      sha256,
      kind,
      label: label || null,
      latitude: Number.isFinite(Number(latitude)) ? Number(latitude) : null,
      longitude: Number.isFinite(Number(longitude)) ? Number(longitude) : null,
      accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
      capturedAt: when.toISOString(),
    },
  };
}

/** Records the attestation server-side. Never throws: a failed registration must not lose the report. */
export async function registerAttestation(client, attestation, { recordId = null, bucket = null, path = null } = {}) {
  if (!attestation?.code) return false;
  try {
    const { error } = await client.rpc('register_photo_attestation', {
      p_code: attestation.code,
      p_sha256: attestation.sha256,
      p_kind: attestation.kind,
      p_record_id: recordId != null ? String(recordId) : null,
      p_label: attestation.label,
      p_storage_bucket: bucket,
      p_storage_path: path,
      p_latitude: attestation.latitude,
      p_longitude: attestation.longitude,
      p_accuracy_m: attestation.accuracy,
      p_captured_at: attestation.capturedAt,
    });
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[photo attestation] could not register', attestation.code, err?.message || err);
    return false;
  }
}
