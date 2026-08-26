import assert from 'node:assert/strict';
import { getOwnedAvatarPath, getOwnedStoragePath, getOwnedVideoPath } from '../storage-utils.js';

const userId = '11111111-1111-4111-8111-111111111111';
const ownUrl = `https://example.supabase.co/storage/v1/object/public/listing-images/${userId}/photo.webp`;

assert.equal(getOwnedStoragePath(ownUrl, userId), `${userId}/photo.webp`);
assert.equal(getOwnedStoragePath(ownUrl, '22222222-2222-4222-8222-222222222222'), null);
assert.equal(getOwnedStoragePath('https://images.example.org/legacy.jpg', userId), null);
assert.equal(getOwnedStoragePath(`https://example.supabase.co/storage/v1/object/public/listing-images/${userId}/../other.webp`, userId), null);

const avatarUrl = `https://example.supabase.co/storage/v1/object/public/profile-avatars/${userId}/avatar.webp`;
assert.equal(getOwnedAvatarPath(avatarUrl, userId), `${userId}/avatar.webp`);
assert.equal(getOwnedAvatarPath(avatarUrl, '22222222-2222-4222-8222-222222222222'), null);

const videoUrl = `https://example.supabase.co/storage/v1/object/public/listing-videos/${userId}/tour.mp4`;
assert.equal(getOwnedVideoPath(videoUrl, userId), `${userId}/tour.mp4`);
assert.equal(getOwnedVideoPath(videoUrl, '22222222-2222-4222-8222-222222222222'), null);
assert.equal(getOwnedVideoPath(`https://example.supabase.co/storage/v1/object/public/listing-videos/${userId}/../other.mp4`, userId), null);

console.log('Storage-stier: 9 tester besto.');
