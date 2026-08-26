export const LISTING_IMAGES_BUCKET = 'listing-images';
export const LISTING_VIDEOS_BUCKET = 'listing-videos';
export const PROFILE_AVATARS_BUCKET = 'profile-avatars';

export function getOwnedStoragePath(urlValue, userId) {
  if (!urlValue || !userId) return null;
  try {
    const url = new URL(urlValue);
    const marker = `/storage/v1/object/public/${LISTING_IMAGES_BUCKET}/`;
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex === -1) return null;
    const path = decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    return path.startsWith(`${userId}/`) && !path.includes('..') ? path : null;
  } catch {
    return null;
  }
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
  if (!urlValue || !userId) return null;
  try {
    const url = new URL(urlValue);
    const marker = `/storage/v1/object/public/${LISTING_VIDEOS_BUCKET}/`;
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex === -1) return null;
    const path = decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    return path.startsWith(`${userId}/`) && !path.includes('..') ? path : null;
  } catch {
    return null;
  }
}

export async function removeOwnedVideo(client, videoUrl, userId) {
  const path = getOwnedVideoPath(videoUrl, userId);
  if (!path) return { error: null, path: null };
  const { error } = await client.storage.from(LISTING_VIDEOS_BUCKET).remove([path]);
  return { error, path };
}

export function getOwnedAvatarPath(urlValue, userId) {
  if (!urlValue || !userId) return null;
  try {
    const url = new URL(urlValue);
    const marker = `/storage/v1/object/public/${PROFILE_AVATARS_BUCKET}/`;
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex === -1) return null;
    const path = decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    return path.startsWith(`${userId}/`) && !path.includes('..') ? path : null;
  } catch {
    return null;
  }
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
