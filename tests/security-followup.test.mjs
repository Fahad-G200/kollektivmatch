import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('migrations/2026-08-28_payment_and_storage_followup.sql');
const createVipps = read('supabase/functions/create-boost-payment/index.ts');
const createStripe = read('supabase/functions/create-stripe-boost-payment/index.ts');
const reconcile = read('supabase/functions/_shared/reconcile.ts');
const stripeReconcile = read('supabase/functions/_shared/stripe-reconcile.ts');
const stripeWebhook = read('supabase/functions/stripe-payment-webhook/index.ts');
const vippsWebhook = read('supabase/functions/vipps-payment-webhook/index.ts');
const refund = read('supabase/functions/refund-boost-payment/index.ts');
const vipps = read('supabase/functions/_shared/vipps.ts');
const stripe = read('supabase/functions/_shared/stripe.ts');
const auth = read('auth.js');
const dashboard = read('dashboard.js');
const cors = read('supabase/functions/_shared/cors.ts');
const vippsLogin = read('supabase/functions/_shared/vipps-login.ts');
const vippsCallback = read('supabase/functions/vipps-verification-callback/index.ts');
const headers = read('_headers');
const privacy = read('privacy.html');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));

// Én aktiv betalingsordre per annonse, også når leverandøren byttes.
assert.match(migration, /from public\.boost_orders[\s\S]+where user_id = p_user_id[\s\S]+listing_id = p_listing_id[\s\S]+status = 'authorized'[\s\S]+status = 'pending'[\s\S]+interval '25 hours'/);
const openOrderQuery = migration.match(/select \* into v_existing[\s\S]*?for update;/)?.[0] || '';
assert.doesNotMatch(openOrderQuery, /payment_provider\s*=/i, 'Åpen-ordre-låsen må gjelde på tvers av leverandører');
assert.match(migration, /raise exception[\s\S]+En annen betaling for denne annonsen pågår/);
assert.match(migration, /select public\.create_boost_order\([\s\S]+p_terms_version,[\s\S]+'vipps'[\s\S]+\);/);
assert.match(migration, /revoke all on function public\.create_boost_order\(uuid, uuid, text, text\)[\s\S]+service_role/);
assert.match(migration, /guard_listing_during_open_boost_checkout[\s\S]+status = 'authorized'[\s\S]+status = 'pending'/);
assert.match(migration, /create or replace function public\.send_message[\s\S]+pg_advisory_xact_lock[\s\S]+interval '1 minute'/);
assert.match(migration, /create or replace function public\.contact_home_seeker[\s\S]+pg_advisory_xact_lock[\s\S]+For mange nye henvendelser/);

// Hvert leverandørkall og hver webhook/refusjon må være eksplisitt isolert.
assert.match(createVipps, /p_payment_provider: 'vipps'/);
assert.match(createStripe, /p_payment_provider: 'stripe'/);
assert.match(createVipps, /PAYMENT_ALREADY_OPEN/);
assert.match(createStripe, /PAYMENT_ALREADY_OPEN/);
assert.match(reconcile, /order\.payment_provider !== 'vipps'/);
assert.match(vippsWebhook, /eq\('payment_provider', 'vipps'\)/);
assert.match(refund, /\['vipps', 'stripe'\]\.includes\(order\.payment_provider\)/);
assert.match(refund, /order\.payment_provider === 'stripe'[\s\S]+refundStripePayment\(order\)/);
assert.match(stripe, /export async function refundStripePayment[\s\S]+idempotencyKey: `refund-/);
assert.match(stripeWebhook, /'charge\.refunded'/);
assert.match(stripeWebhook, /eq\('provider_payment_id', paymentIntent\)/);
assert.match(stripeReconcile, /reconcileStripeRefund[\s\S]+charge\.amount_refunded < order\.amount_ore/);
assert.match(migration, /boost_orders_provider_payment_unique_idx/);

// Storage-eierskap, objektsti og overskriving er strammet inn.
assert.match(migration, /column_name = 'owner_id'/);
assert.match(migration, /owner_id = \$2/);
assert.match(migration, /storage_quota_available[\s\S]+volatile[\s\S]+pg_advisory_xact_lock/);
assert.ok(
  migration.includes("and name ~ ('^' || auth.uid()::text || '/[0-9a-f]{8}-"),
  'Annonsemedia må bruke UUID-baserte objektnavn',
);
assert.match(migration, /drop policy if exists "Bruker kan oppdatere i egen bildemappe"/);
assert.match(migration, /drop policy if exists "Bruker kan oppdatere i egen videomappe"/);
assert.match(migration, /name = auth\.uid\(\)::text \|\| '\/avatar\.webp'[\s\S]+owner_id = auth\.uid\(\)::text/);
assert.match(migration, /\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,254\}/);

// Uventet trege leverandører skal ikke holde Edge Functions åpne uten grense.
for (const source of [vipps, stripe]) {
  assert.match(source, /AbortSignal\.timeout\(/);
  assert.match(source, /appUrl\.username[\s\S]{0,40}appUrl\.password/);
  assert.match(source, /appUrl\.pathname !== '\/'/);
}

// Retur-URL-er, private sider og leverandørkjeden skal være eksplisitt avgrenset.
assert.match(auth, /typeof value !== 'string'[\s\S]+value\.length > 2048/);
assert.match(auth, /target\.username \|\| target\.password/);
assert.doesNotMatch(auth, /Denne e-postadressen er allerede registrert/);
assert.match(dashboard, /redirect\.hostname !== 'checkout\.stripe\.com'/);
assert.match(cors, /url\.pathname !== '\/'/);
assert.match(cors, /LOCAL_ORIGINS\.has\(appOrigin\)[\s\S]{0,100}ALLOW_LOCAL_ORIGINS/);
assert.match(vippsLogin, /appUrl!\.pathname !== '\/'/);
assert.match(vippsLogin, /supabaseProjectUrl!\.hostname\.endsWith\('\.supabase\.co'\)/);
assert.match(vippsCallback, /status: 410/);
assert.doesNotMatch(vippsCallback, /location:|serviceClient|complete_vipps_verification/);
assert.match(headers, /\/dashboard\.html\s+Cache-Control: no-store, max-age=0/);
assert.match(headers, /\/create-listing\.html\s+Cache-Control: no-store, max-age=0/);
assert.equal(pkg.devDependencies['@openai/sites-vite-plugin'], '0.2.0');
assert.equal(lock.packages[''].devDependencies['@openai/sites-vite-plugin'], '0.2.0');
assert.doesNotMatch(privacy, /henter foreløpig programkode fra esm\.sh og Tailwind CDN/);

console.log('Sikkerhetsoppfølging: 50 statiske regresjonskontroller besto.');
