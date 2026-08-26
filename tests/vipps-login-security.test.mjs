import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('migrations/2026-08-23_vipps_account_verification.sql');
const shared = read('supabase/functions/_shared/vipps-login.ts');
const start = read('supabase/functions/start-vipps-verification/index.ts');
const callback = read('supabase/functions/vipps-verification-callback/index.ts');
const result = read('vipps-verification-result.js');
const dashboard = read('dashboard.js');

assert.match(migration, /vipps_sub text not null unique/i, 'Én Vipps-identitet kan bare kobles én gang');
assert.match(migration, /user_id uuid primary key references auth\.users\(id\) on delete cascade/i);
assert.match(migration, /revoke all on public\.vipps_identity_links from public, anon, authenticated/i);
assert.match(migration, /grant all on public\.vipps_identity_links to service_role/i);
assert.match(migration, /revoke update \(vipps_verified, vipps_verified_at\)/i);
assert.match(migration, /complete_vipps_verification[\s\S]+to service_role/i);
assert.match(migration, /IDENTITY|allerede koblet|allerede koblet/i);
assert.match(migration, /supabase_realtime add table public\.messages/i);
assert.match(migration, /deltakere ser samtaleannonse/i);
assert.doesNotMatch(migration, /grant (?:select|all)[\s\S]{0,80}vipps_identity_links[\s\S]{0,40}(?:anon|authenticated)/i);

assert.match(shared, /code_challenge_method', 'S256'/);
assert.match(shared, /randomToken\(byteLength = 32\)/);
assert.match(shared, /state/);
assert.match(shared, /nonce/);
assert.match(shared, /createRemoteJWKSet/);
assert.match(shared, /issuer: discovery\.issuer/);
assert.match(shared, /audience: config\.clientId/);
assert.match(shared, /algorithms: \['RS256'\]/);
assert.match(shared, /payload\.nonce !== expectedNonce/);
assert.match(shared, /userinfo\.sub !== payload\.sub/);
assert.match(shared, /scope', 'openid'/, 'Bare nødvendig OpenID-scope skal forespørres');
assert.match(shared, /VIPPS_LOGIN_SUBSCRIPTION_KEY', 'VIPPS_SUBSCRIPTION_KEY'/);
assert.match(shared, /VIPPS_LOGIN_MSN', 'VIPPS_MSN'/);
assert.match(shared, /'Merchant-Serial-Number': config\.msn/);
assert.match(shared, /'Ocp-Apim-Subscription-Key'.+config\.subscriptionKey/);
assert.match(shared, /\.\.\.vippsLoginHeaders\(config\),[\s\S]{0,120}authorization: `Basic/,
  'Token-kallet skal identifisere sales unit og integrasjonen');
assert.match(shared, /\.\.\.vippsLoginHeaders\(config, true\),[\s\S]{0,120}authorization: `Bearer/,
  'Userinfo-kallet skal sende subscription key, MSN og system-headere');
assert.doesNotMatch(shared, /phoneNumber|birthDate|\bnin\b|\baddress\b/);

assert.match(start, /requireAllowedOrigin\(request\)/);
assert.match(start, /requireUser\(request\)/);
assert.match(start, /sha256Hex\(state\)/);
assert.match(start, /gte\('created_at', fifteenMinutesAgo\)/, 'Verifiseringsforsøk skal begrenses');
assert.match(callback, /eq\('status', 'pending'\)/, 'Callback skal kunne brukes bare én gang');
assert.match(callback, /gt\('expires_at', now\)/, 'Utløpt state skal avvises');
assert.match(callback, /complete_vipps_verification/);
assert.match(callback, /cache-control': 'no-store'/);
assert.doesNotMatch(callback, /console\.(?:log|error)\([^\n]*(?:access_token|id_token|codeVerifier|vipps_sub)/i);

assert.match(result, /rpc\('get_my_profile'\)/, 'Resultatsiden skal kontrollere serverlagret profilstatus');
assert.match(result, /profile\?\.vipps_verified === true/);
assert.doesNotMatch(result, /resultHint === 'completed'[\s\S]{0,120}success/i, 'URL-hint alene skal ikke gi suksess');
assert.match(dashboard, /start-vipps-verification/);

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (['node_modules', 'public', 'dist', '.next', '.vinext', '.wrangler'].includes(name)) return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const frontend = walk(root)
  .filter((path) => /\.(?:html|js|css)$/.test(path) && !path.includes('/supabase/functions/'))
  .map((path) => readFileSync(path, 'utf8')).join('\n');
assert.doesNotMatch(frontend, /VIPPS_LOGIN_CLIENT_SECRET|vipps_sub|code_verifier/);

console.log('Vipps Login-sikkerhet: 42 statiske kontroller besto.');
