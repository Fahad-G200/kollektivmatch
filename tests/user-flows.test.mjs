import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const htmlNames = readdirSync(root).filter((name) => name.endsWith('.html'));
const htmlByName = new Map(htmlNames.map((name) => [name, read(name)]));

// Navigasjon og dokumentstruktur: ingen duplikate ID-er, døde lokale HTML-lenker
// eller nye faner uten opener-beskyttelse.
for (const [name, html] of htmlByName) {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${name} har duplikate id-attributter`);
  for (const match of html.matchAll(/href="([^"#?]+\.html)(?:[?#][^"]*)?"/g)) {
    const target = match[1].replace(/^\.\//, '');
    assert.ok(htmlByName.has(target), `${name} lenker til manglende ${target}`);
  }
  for (const match of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
    assert.match(match[0], /rel="[^"]*noopener[^"]*"/, `${name} mangler noopener`);
    assert.match(match[0], /rel="[^"]*noreferrer[^"]*"/, `${name} mangler noreferrer`);
  }
}

const auth = read('auth.js');
const callback = read('auth-callback.js');
const recovery = read('reset-password.js');
const create = read('create-listing.js');
const dashboard = read('dashboard.js');
const detail = read('listing-detail.js');
const chat = read('chat.js');
const seekers = read('home-seekers.js');
const paymentResult = read('boost-payment-result.js');
const storage = read('storage-utils.js');
const config = read('supabase-config.js');
const allBrowserJs = readdirSync(root)
  .filter((name) => name.endsWith('.js'))
  .map(read)
  .join('\n');

// Innlogging/callback/recovery og åpne redirects.
assert.match(auth, /target\.origin !== window\.location\.origin/);
assert.match(auth, /target\.username \|\| target\.password/);
assert.match(config, /flowType: 'pkce'/);
assert.match(callback, /exchangeCodeForSession/);
assert.match(callback, /clearSensitiveUrl\(\)/);
assert.doesNotMatch(callback, /getSession\(\)/);
assert.match(recovery, /type: 'recovery'/);
assert.match(recovery, /password\.length < 12/);
assert.match(recovery, /await supabase\.auth\.signOut\(\)/);
assert.doesNotMatch(recovery, /getSession\(\)/);

// Oppretting, redigering, sletting og dataeksport er knyttet til innlogget ID.
assert.match(create, /user_id: currentUser\.id/);
assert.match(create, /\.eq\('id', editId\)\.eq\('user_id', currentUser\.id\)/);
assert.match(dashboard, /\.delete\(\)\.eq\('id', item\.id\)\.eq\('user_id', currentUser\.id\)/);
assert.match(dashboard, /confirmation !== 'SLETT'/);
assert.match(dashboard, /removeAllUserImages\(currentUser\.id\)/);
assert.match(dashboard, /removeAllUserVideos\(currentUser\.id\)/);
assert.match(dashboard, /supabase\.rpc\('export_my_data'\)/);
assert.match(dashboard, /supabase\.rpc\('delete_my_account'/);

// Meldinger, rapporter og kontaktdata går gjennom avgrensede server-RPC-er.
assert.match(chat, /supabase\.rpc\('send_message'/);
assert.match(chat, /text\.textContent = message\.content/);
assert.match(chat, /isConversationMessage\(message\)/);
assert.match(seekers, /supabase\.rpc\('contact_home_seeker'/);
assert.match(detail, /supabase\.rpc\('submit_report'/);
assert.doesNotMatch(detail, /supabase\.from\('reports'\)\.insert/);
assert.match(detail, /supabase\.rpc\('get_listing_contact'/);
assert.doesNotMatch(detail, /select\('contact_info'\)/);

// Brukerinnhold rendres som tekst eller escapes før HTML-malbruk.
assert.match(detail, /listing-desc'\)\.textContent = listing\.description/);
assert.match(detail, /pill\.textContent = labels\[value\] \|\| value/);
assert.match(dashboard, /escapeHtml\(message\.content\)/);
assert.match(seekers, /escapeHtml\(seeker\.seeker_bio\)/);
assert.doesNotMatch(allBrowserJs, /\beval\s*\(|new Function\s*\(/);

// Eksterne media og betalingsredirects må følge allowlist/serverstatus.
assert.match(storage, /url\.origin !== SUPABASE_STORAGE_ORIGIN/);
assert.match(storage, /url\.username \|\| url\.password \|\| url\.search \|\| url\.hash/);
assert.match(paymentResult, /functions\.invoke\('get-boost-payment-status'/);
assert.doesNotMatch(paymentResult, /searchParams\.get\(['"]status['"]\)/);

for (const privatePage of [
  'auth-callback.html', 'reset-password.html', 'boost-payment-result.html',
  'dashboard.html', 'chat.html', 'create-listing.html', 'home-seekers.html',
]) {
  const html = htmlByName.get(privatePage);
  assert.match(html, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(html, /name="referrer" content="no-referrer"/);
}

console.log('Brukerflytmatrise og HTML-integritet: alle statiske kontroller besto.');
