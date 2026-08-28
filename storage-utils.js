export const LISTING_IMAGES_BUCKET = 'listing-images';
export const LISTING_VIDEOS_BUCKET = 'listing-videos';
export const PROFILE_AVATARS_BUCKET = 'profile-avatars';
export const SUPABASE_STORAGE_ORIGIN = 'https://wsfnnaiytweaarncewcr.supabase.co';

function publicStoragePath(urlValue, bucket) {
  if (!urlValue) return null;
  try {
    const url = new URL(urlValue);
    if (url.origin !== SUPABASE_STORAGE_ORIGIN || url.username || url.password || url.search || url.hash) return null;
    const marker = `/storage/v1/object/public/${bucket}/`;
    if (!url.pathname.startsWith(marker)) return null;
    const path = decodeURIComponent(url.pathname.slice(marker.length));
    if (!path || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) return null;
    return path;
  } catch {
    return null;
  }
}

export function safePublicMediaUrl(urlValue, bucket, fallback = '') {
  return publicStoragePath(urlValue, bucket) ? String(urlValue) : fallback;
}

export function getOwnedStoragePath(urlValue, userId) {
  if (!userId) return null;
  const path = publicStoragePath(urlValue, LISTING_IMAGES_BUCKET);
  return path?.startsWith(`${userId}/`) ? path : null;
}

export async function removeOwnedImages(client, urls, userId) {
  const paths = [...new Set((urls || []).map((url) => getOwnedStoragePath(url, userId)).filter(Boolean))];
  if (!paths.length) return { error: null, paths: [] };
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await client.storage.from(LISTING_IMAGES_BUCKET).remove(paths.slice(index, index + 100));
    if (error) return { error, paths };
  }
  return { error: null, paths };
}

export function getOwnedVideoPath(urlValue, userId) {
  if (!userId) return null;
  const path = publicStoragePath(urlValue, LISTING_VIDEOS_BUCKET);
  return path?.startsWith(`${userId}/`) ? path : null;
}

export async function removeOwnedVideo(client, videoUrl, userId) {
  const path = getOwnedVideoPath(videoUrl, userId);
  if (!path) return { error: null, path: null };
  const { error } = await client.storage.from(LISTING_VIDEOS_BUCKET).remove([path]);
  return { error, path };
}

export function getOwnedAvatarPath(urlValue, userId) {
  if (!userId) return null;
  const path = publicStoragePath(urlValue, PROFILE_AVATARS_BUCKET);
  return path?.startsWith(`${userId}/`) ? path : null;
}

export async function removeOwnedAvatar(client, avatarUrl, userId) {
  const path = getOwnedAvatarPath(avatarUrl, userId);
  if (!path) return { error: null, path: null };
  const { error } = await client.storage.from(PROFILE_AVATARS_BUCKET).remove([path]);
  return { error, path };
}

export function installImageFallback(img, fallbackUrl) {
  img.addEventListener('error', () => {
    if (img.dataset.fallbackApplied === 'true') return;
    img.dataset.fallbackApplied = 'true';
    img.src = fallbackUrl;
  });
}
