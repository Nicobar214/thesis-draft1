// Shared helpers so LguDashboard.jsx (provisioning) and FarmerAuth.jsx
// (login) derive the exact same synthetic email from a username and can
// never drift out of sync. Supabase Auth is fundamentally email-based;
// farmers and LGU staff only ever see/type a "username" -- this constructs
// the hidden email Supabase Auth actually uses underneath.

export const FARMER_SYNTHETIC_EMAIL_DOMAIN = 'farmer.kalsatrack.internal';

// Trim, lowercase, strip anything outside [a-z0-9_] so the result always
// matches profiles_username_format_check and is a valid email local-part.
export function normalizeUsername(rawUsername) {
  return String(rawUsername || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

export function usernameToSyntheticEmail(rawUsername) {
  return `${normalizeUsername(rawUsername)}@${FARMER_SYNTHETIC_EMAIL_DOMAIN}`;
}

// Farmer accounts provisioned before the username migration still sign in
// with their real email (stored as-is in auth.users); accounts provisioned
// after it only have a username + synthetic email. Accept either at login.
export function resolveLoginEmail(rawInput) {
  const trimmed = String(rawInput || '').trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  return usernameToSyntheticEmail(trimmed);
}
