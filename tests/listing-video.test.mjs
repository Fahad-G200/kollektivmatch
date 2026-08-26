import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('migrations/2026-08-25_listing_video.sql');
const createHtml = read('create-listing.html');
const createJs = read('create-listing.js');
const detailHtml = read('listing-detail.html');
const detailJs = read('listing-detail.js');
const dashboard = read('dashboard.js');
const storage = read('storage-utils.js');
const privacy = read('privacy.html');
const terms = read('terms.html');

assert.match(migration, /add column if not exists video_url text/i);
assert.match(migration, /listing-videos/i);
assert.match(migration, /file_size_limit = 52428800/i, 'Storage må håndheve 50 MB');
assert.match(migration, /video\/mp4[\s\S]+video\/webm[\s\S]+video\/quicktime/i);
assert.match(migration, /storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/i, 'Videoer må lagres i eierens mappe');
assert.match(migration, /grant insert \(video_url\)[\s\S]+to authenticated/i);
assert.match(createHtml, /id="video-file-input"[\s\S]+video\/mp4/);
assert.match(createJs, /MAX_VIDEO_SIZE = 50 \* 1024 \* 1024/);
assert.match(createJs, /MAX_VIDEO_DURATION = 90/);
assert.match(createJs, /from\(LISTING_VIDEOS_BUCKET\)\.upload/);
assert.match(createJs, /video_url: videoUpload\.url/);
assert.match(detailHtml, /id="listing-video"[\s\S]+controls[\s\S]+playsinline/);
assert.match(detailJs, /function renderVideo\(\)[\s\S]+listing\.video_url/);
assert.match(storage, /getOwnedVideoPath[\s\S]+removeOwnedVideo/);
assert.match(dashboard, /removeAllUserVideos[\s\S]+removeOwnedVideo/);
assert.match(createHtml, /name="boost_after_publish"[\s\S]+valgfritt[\s\S]+tydelig merket kjøp/i);
assert.match(dashboard, /publishedId[\s\S]+openBoostModal\(publishedListing\)/);
assert.match(privacy, /valgfri video|annonsevideo/i);
assert.match(terms, /tekst, bilder og video/i);

console.log('Annonsevideo og fremheving: 19 statiske kontroller besto.');
