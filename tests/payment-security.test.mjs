import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('migrations/2026-08-23_real_vipps_boost.sql');
const createFunction = read('supabase/functions/create-boost-payment/index.ts');
const reconcile = read('supabase/functions/_shared/reconcile.ts');
const vipps = read('supabase/functions/_shared/vipps.ts');
const webhook = read('supabase/functions/vipps-payment-webhook/index.ts');
const webhookAuth = read('supabase/functions/_shared/webhook-auth.ts');
const webhookSignature = read('supabase/functions/_shared/webhook-signature.mjs');
const resultPage = read('boost-payment-result.js');
const dashboard = read('dashboard.js');
const feed = read('feed.js');

assert.match(migration, /'boost_7d'.+7, 4900, 'NOK'/s);
assert.match(migration, /'boost_30d'.+30, 9900, 'NOK'/s);
assert.match(migration, /revoke all on function public\.request_listing_boost\(uuid\)/i);
assert.match(migration, /revoke update \(is_featured, featured_until\)/i);
assert.match(migration, /auth\.uid\(\) = user_id/);
assert.match(migration, /v_listing\.featured_until > now\(\)/);
assert.match(migration, /if v_order\.boost_applied_at is not null then return v_order/i, 'Duplikat capture må være idempotent');
assert.match(migration, /to service_role/);

assert.match(createFunction, /create_boost_order/);
assert.doesNotMatch(createFunction, /amount_ore\s*:\s*body|duration_days\s*:\s*body/, 'Klienten skal ikke bestemme pris eller varighet');
assert.match(createFunction, /accepted_terms !== true/);
assert.match(reconcile, /capturedAmountMatches/);
assert.match(reconcile, /apply_captured_boost/);
assert.match(webhook, /verifyVippsWebhook\(request, rawBody\)/);
assert.match(webhook, /getVippsConfig\(\)\.msn/);
assert.match(webhookAuth, /x-ms-content-sha256/);
assert.match(webhookAuth, /buildVippsAuthorization/);
assert.match(webhookSignature, /crypto\.subtle\.sign\('HMAC'/);
assert.match(vipps, /VIPPS_PRODUCTION_CONFIRMED/);
assert.match(vipps, /apiBase !== 'https:\/\/api\.vipps\.no'/);
assert.match(resultPage, /order\.status === 'captured'/);
assert.doesNotMatch(resultPage, /from\('listings'\).*update|is_featured|featured_until/s, 'Return-siden skal aldri aktivere fremheving');
assert.match(dashboard, /button\.disabled = true[\s\S]+create-boost-payment/);
assert.match(feed, /case 'price_low': return query\.order\('price', \{ ascending: true \}\)/, 'Prissortering må forbli eksplisitt');

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const frontendFiles = walk(root).filter((path) => {
  const name = relative(root, path);
  return !name.startsWith('supabase/') && !name.startsWith('tests/') && !name.startsWith('migrations/')
    && !name.startsWith('docs/') && !name.endsWith('.zip') && !['README.md', '.env.example'].includes(name)
    && /\.(?:html|js|css)$/.test(name);
});
const frontend = frontendFiles.map((path) => readFileSync(path, 'utf8')).join('\n');
assert.doesNotMatch(frontend, /VIPPS_CLIENT_SECRET|VIPPS_SUBSCRIPTION_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(frontend, /\.update\(\s*\{[^}]*is_featured/s);

console.log('Betalingssikkerhet: 25 statiske kontroller besto.');
