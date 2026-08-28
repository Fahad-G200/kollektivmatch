import assert from 'node:assert/strict';
import {
  LISTING_IMAGES_BUCKET,
  SUPABASE_STORAGE_ORIGIN,
  getOwnedAvatarPath,
  getOwnedStoragePath,
  getOwnedVideoPath,
  safePublicMediaUrl,
} from '../storage-utils.js';

const userId = '11111111-1111-4111-8111-111111111111';
const ownUrl = `${SUPABASE_STORAGE_ORIGIN}/storage/v1/object/public/listing-images/${userId}/photo.webp`;

assert.equal(getOwnedStoragePath(ownUrl, userId), `${userId}/photo.webp`);
assert.equal(getOwnedStoragePath(ownUrl, '22222222-2222-4222-8222-222222222222'), null);
assert.equal(getOwnedStoragePath('https://images.example.org/legacy.jpg', userId), null);
assert.equal(getOwnedStoragePath(`${SUPABASE_STORAGE_ORIGIN}/storage/v1/object/public/listing-images/${userId}/../other.webp`, userId), null);
assert.equal(safePublicMediaUrl(ownUrl, LISTING_IMAGES_BUCKET), ownUrl);
assert.equal(safePublicMediaUrl(`${ownUrl}?tracking=1`, LISTING_IMAGES_BUCKET), '');
assert.equal(safePublicMediaUrl(`https://evil.example/storage/v1/object/public/listing-images/${userId}/photo.webp`, LISTING_IMAGES_BUCKET), '');

const avatarUrl = `${SUPABASE_STORAGE_ORIGIN}/storage/v1/object/public/profile-avatars/${userId}/avatar.webp`;
assert.equal(getOwnedAvatarPath(avatarUrl, userId), `${userId}/avatar.webp`);
assert.equal(getOwnedAvatarPath(avatarUrl, '22222222-2222-4222-8222-222222222222'), null);

const videoUrl = `${SUPABASE_STORAGE_ORIGIN}/storage/v1/object/public/listing-videos/${userId}/tour.mp4`;
assert.equal(getOwnedVideoPath(videoUrl, userId), `${userId}/tour.mp4`);
assert.equal(getOwnedVideoPath(videoUrl, '22222222-2222-4222-8222-222222222222'), null);
assert.equal(getOwnedVideoPath(`${SUPABASE_STORAGE_ORIGIN}/storage/v1/object/public/listing-videos/${userId}/../other.mp4`, userId), null);

console.log('Storage-stier og medie-allowlist: 12 tester besto.');
