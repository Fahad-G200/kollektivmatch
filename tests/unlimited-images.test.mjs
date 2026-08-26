import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const createHtml = read('create-listing.html');
const createJs = read('create-listing.js');
const migration = read('migrations/2026-08-25_unlimited_listing_images.sql');
const hardening = read('migrations/2026-08-23_kollektivmatch_hardening.sql');
const storage = read('storage-utils.js');

assert.doesNotMatch(createJs, /MAX_IMAGES|imageItems\.length\s*>=/, 'Frontend skal ikke ha en fast bildegrense');
assert.match(createJs, /imageItems\.length === 1 \? 'bilde' : 'bilder'/, 'Bildetelleren skal fungere uten maksimum');
assert.match(createHtml, /så mange JPG-, PNG- eller WebP-bilder du trenger/i);
assert.match(createHtml, /id="image-files-input"[^>]+multiple/, 'Flere bilder skal kunne velges samtidig');
assert.match(migration, /drop constraint if exists listings_array_limits/i);
assert.doesNotMatch(migration, /cardinality\s*\(\s*images\s*\)/i, 'Ny databaseconstraint skal ikke begrense bildeantall');
assert.doesNotMatch(hardening, /cardinality\s*\(\s*images\s*\)/i, 'Nye installasjoner skal heller ikke få bildegrensen');
assert.match(storage, /for \(let index = 0; index < paths\.length; index \+= 100\)[\s\S]+paths\.slice\(index, index \+ 100\)/, 'Mange bilder skal slettes i trygge puljer');

console.log('Bildeopplasting uten fast antallsgrense: 8 kontroller besto.');
