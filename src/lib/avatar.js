/* avatar.js — profile photos for citizen and farmer accounts.
 *
 * Photos live in the public `avatars` bucket under <user id>/, and the public
 * URL is saved on the account (user_metadata.avatar_url). Saving it there
 * fires Supabase's USER_UPDATED auth event, which is what makes the header
 * avatar (ProfileAvatar) change straight away without a page reload.
 *
 * Bucket + policies: supabase_profile_avatars.sql.
 */

const BUCKET = 'avatars';
const OUTPUT_SIZE = 320;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

export function getAvatarUrl(user) {
  return user?.user_metadata?.avatar_url || '';
}

export function getInitials(name, fallback = 'U') {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || fallback;
}

// Center-crops to a square and scales down, so a 5 MB phone photo uploads as
// a ~20-40 KB JPEG and every avatar has the same shape.
async function toSquareJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That file could not be read as an image.'));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const out = Math.min(OUTPUT_SIZE, side);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out, out);
    ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('Could not process that image.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function clearFolder(client, userId, keepName) {
  const { data } = await client.storage.from(BUCKET).list(userId);
  const stale = (data || []).filter((f) => f.name !== keepName).map((f) => `${userId}/${f.name}`);
  if (stale.length) await client.storage.from(BUCKET).remove(stale);
}

/** Uploads a new photo for the signed-in account and returns its URL. */
export async function uploadAvatar(client, file) {
  if (!file) throw new Error('No file selected.');
  if (!file.type?.startsWith('image/')) throw new Error('Please choose an image file (JPG, PNG or WebP).');
  if (file.size > MAX_INPUT_BYTES) throw new Error('That photo is larger than 8 MB. Please choose a smaller one.');

  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('You need to be signed in.');

  const blob = await toSquareJpeg(file);
  // A new name each time, so browsers and the CDN never show the old cached photo.
  const name = `avatar-${Date.now()}.jpg`;
  const path = `${user.id}/${name}`;

  const { error: uploadError } = await client.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
  });
  if (uploadError) {
    if (/bucket not found/i.test(uploadError.message)) {
      throw new Error('Photo storage is not set up yet (run supabase_profile_avatars.sql).');
    }
    throw uploadError;
  }

  const { data: { publicUrl } } = client.storage.from(BUCKET).getPublicUrl(path);
  const { error: metaError } = await client.auth.updateUser({ data: { avatar_url: publicUrl } });
  if (metaError) throw metaError;

  // Best effort: an old file left behind is harmless, so don't fail the upload over it.
  clearFolder(client, user.id, name).catch(() => {});
  return publicUrl;
}

/** Removes the account's photo; the header falls back to initials. */
export async function removeAvatar(client) {
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('You need to be signed in.');
  const { error } = await client.auth.updateUser({ data: { avatar_url: null, avatar_data_url: null } });
  if (error) throw error;
  clearFolder(client, user.id, null).catch(() => {});
}
