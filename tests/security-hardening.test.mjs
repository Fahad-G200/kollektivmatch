import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const headers = read('_headers');
const config = read('supabase-config.js');
const prepare = read('scripts/prepare-public.mjs');
const nextConfig = read('next.config.ts');
const http = read('supabase/functions/_shared/http.ts');
const cors = read('supabase/functions/_shared/cors.ts');
const edgeSupabase = read('supabase/functions/_shared/supabase.ts');
const reconcile = read('supabase/functions/_shared/reconcile.ts');
const stripeReconcile = read('supabase/functions/_shared/stripe-reconcile.ts');
const migration = read('migrations/2026-08-28_media_and_input_hardening.sql');
const environmentExample = read('.env.example');

for (const directive of [
  "default-src 'self'", "script-src 'self'", "script-src-attr 'none'",
  "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'",
]) assert.match(headers, new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(headers, /Strict-Transport-Security: max-age=63072000/);
assert.match(headers, /X-Content-Type-Options: nosniff/);
assert.match(headers, /\/auth-callback\.html[\s\S]+Cache-Control: no-store/);
assert.match(headers, /\/chat\.html[\s\S]+Cache-Control: no-store/);
assert.match(headers, /\/dashboard\.html[\s\S]+Cache-Control: no-store/);
assert.match(headers, /\/create-listing\.html[\s\S]+Cache-Control: no-store/);
assert.match(nextConfig, /source: '\/:path\*'/);
assert.match(nextConfig, /Content-Security-Policy/);
assert.match(nextConfig, /Strict-Transport-Security/);
assert.match(nextConfig, /privatePageHeaders/);

assert.match(config, /from '@supabase\/supabase-js'/);
assert.doesNotMatch(config, /https:\/\/esm\.sh/);
assert.match(config, /flowType: 'pkce'/);
assert.match(config, /key\.includes\('code-verifier'\) \? window\.localStorage : window\.sessionStorage/);
assert.match(config, /storage: authStorage/);
assert.match(prepare, /bundle: true/);
assert.match(prepare, /join\(root, '_headers'\)/);

assert.match(http, /DEFAULT_JSON_LIMIT = 64 \* 1024/);
assert.match(http, /BODY_TOO_LARGE/);
assert.match(http, /UNSUPPORTED_MEDIA_TYPE/);
assert.match(http, /'cache-control': 'no-store'/);
assert.match(cors, /ALLOW_LOCAL_ORIGINS/);
assert.match(cors, /localOriginsEnabled\(\) && LOCAL_ORIGINS\.has\(origin\)/);
assert.match(cors, /LOCAL_ORIGINS\.has\(appOrigin\)[\s\S]{0,100}&& Deno\.env\.get\('ALLOW_LOCAL_ORIGINS'\) === 'true'/);
assert.doesNotMatch(cors, /LOCAL_ORIGINS\.has\(appOrigin\)\)[\s\S]{0,20}\|\|/);
assert.match(environmentExample, /ALLOW_DEPLOYED_TEST_PAYMENTS=false/);

for (const source of [edgeSupabase, reconcile, stripeReconcile]) {
  assert.doesNotMatch(source, /https:\/\/esm\.sh/);
  assert.match(source, /npm:@supabase\/supabase-js@2\.111\.0/);
}

assert.match(migration, /is_owned_public_storage_url/);
assert.match(migration, /storage_quota_available\('listing-images', 500\)/);
assert.match(migration, /storage_quota_available\('listing-videos', 20\)/);
assert.match(migration, /name = auth\.uid\(\)::text \|\| '\/avatar\.webp'/);

console.log('Sikkerhetsherding: 38 statiske kontroller besto.');
