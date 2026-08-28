import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const createHtml = read('create-listing.html');
const createJs = read('create-listing.js');
const migration = read('migrations/2026-08-25_unlimited_listing_images.sql');
const securityMigration = read('migrations/2026-08-28_media_and_input_hardening.sql');
const hardening = read('migrations/2026-08-23_kollektivmatch_hardening.sql');
const storage = read('storage-utils.js');

assert.match(createJs, /const MAX_IMAGES = 100/, 'Frontend skal stoppe ressursmisbruk med en romslig bildegrense');
assert.match(createJs, /imageItems\.length >= MAX_IMAGES/, 'Bildegrensen skal håndheves før opplasting');
assert.match(createHtml, /opptil 100 JPG-, PNG- eller WebP-bilder/i);
assert.match(createHtml, /id="image-files-input"[^>]+multiple/, 'Flere bilder skal kunne velges samtidig');
assert.match(migration, /drop constraint if exists listings_array_limits/i);
assert.doesNotMatch(migration, /cardinality\s*\(\s*images\s*\)/i, 'Ny databaseconstraint skal ikke begrense bildeantall');
assert.doesNotMatch(hardening, /cardinality\s*\(\s*images\s*\)/i, 'Nye installasjoner skal heller ikke få bildegrensen');
assert.match(securityMigration, /cardinality\(coalesce\(p_urls,[\s\S]+<= 100/i, 'Siste sikkerhetsmigrering skal ha en eksplisitt ressursgrense');
assert.match(storage, /for \(let index = 0; index < paths\.length; index \+= 100\)[\s\S]+paths\.slice\(index, index \+ 100\)/, 'Mange bilder skal slettes i trygge puljer');

console.log('Ressurssikret bildeopplasting: 9 kontroller besto.');
