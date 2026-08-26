import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('migrations/2026-08-23_vipps_account_verification.sql');
const chat = read('chat.js');
const gitignore = read('.gitignore');

assert.match(
  migration,
  /create policy "Aktive annonser er offentlige og deltakere ser samtaleannonse"[\s\S]+on public\.listings for select/i,
  'Migreringen må opprette en avgrenset SELECT-policy for samtaleannonsen',
);
assert.match(migration, /status\s*=\s*'active'/i, 'Aktive annonser skal fortsatt være offentlige');
assert.match(migration, /auth\.uid\(\)\s*=\s*user_id/i, 'Eieren skal fortsatt se egen annonse');
assert.match(
  migration,
  /exists\s*\(\s*select 1 from public\.messages m[\s\S]+m\.listing_id\s*=\s*listings\.id/i,
  'Tilgang til ikke-aktive annonser må kreve en melding på samme annonse',
);
assert.match(
  migration,
  /m\.sender_id\s*=\s*auth\.uid\(\)\s+or\s+m\.receiver_id\s*=\s*auth\.uid\(\)/i,
  'Bare avsender eller mottaker i samtalen skal få tilgang',
);
assert.doesNotMatch(
  migration,
  /create policy "Aktive annonser er offentlige og deltakere ser samtaleannonse"[\s\S]{0,900}using\s*\(\s*true\s*\)/i,
  'Policyen må aldri gi generell tilgang til alle annonser',
);
assert.match(
  chat,
  /select\('id, user_id, title, city, price'\)\.eq\('id', listingId\)\.single\(\)/,
  'Chat skal bare hente annonsefeltene den trenger',
);
assert.match(gitignore, /^\*\.zip$/m, 'Lokale ZIP-arkiver skal være utelatt fra publisering');

console.log('P0-regresjoner: 8 statiske kontroller besto.');
