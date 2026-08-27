import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('migrations/2026-08-26_stripe_boost_fallback.sql');
const stripe = read('supabase/functions/_shared/stripe.ts');
const reconcile = read('supabase/functions/_shared/stripe-reconcile.ts');
const createPayment = read('supabase/functions/create-stripe-boost-payment/index.ts');
const webhook = read('supabase/functions/stripe-payment-webhook/index.ts');
const status = read('supabase/functions/get-boost-payment-status/index.ts');
const integrationStatus = read('supabase/functions/payment-integration-status/index.ts');
const dashboard = read('dashboard.js');
const deliveryGuard = read('migrations/2026-08-27_boost_delivery_guard.sql');

assert.match(migration, /add column if not exists payment_provider text not null default 'vipps'/i);
assert.match(migration, /payment_provider in \('vipps', 'stripe'\)/i);
assert.match(migration, /create_boost_order\([\s\S]+p_payment_provider text[\s\S]+v_product\.price_ore/s);
assert.match(migration, /payment_provider = p_payment_provider[\s\S]+status in \('pending', 'authorized'\)/s);
assert.match(migration, /revoke all on function public\.create_boost_order\(uuid, uuid, text, text, text\)[\s\S]+authenticated/i);
assert.match(migration, /grant execute on function public\.attach_stripe_checkout_session\(uuid, text\)[\s\S]+service_role/i);
assert.doesNotMatch(migration, /grant select \([^)]*provider_session_id/i, 'Stripe-sesjons-ID skal ikke eksponeres som klientkolonne');

assert.match(createPayment, /p_payment_provider: 'stripe'/);
assert.match(createPayment, /createStripeCheckoutSession\(order\)/);
assert.match(createPayment, /attach_stripe_checkout_session/);
assert.doesNotMatch(createPayment, /amount_ore\s*:\s*body|duration_days\s*:\s*body/, 'Klienten skal ikke bestemme pris eller varighet');

assert.match(stripe, /authorization: `Bearer \$\{config\.secretKey\}`/);
assert.match(stripe, /payment_method_types\[0\]'?,?\s*'?,?\s*'card'|body\.set\('payment_method_types\[0\]', 'card'\)/);
assert.match(stripe, /metadata\[order_id\]/);
assert.match(stripe, /Math\.abs\(nowSeconds - timestamp\) > 300/);
assert.match(stripe, /crypto\.subtle\.sign\('HMAC'/);
assert.match(stripe, /constantTimeEqual\(candidate, expected\)/);
assert.match(stripe, /redirect\.hostname !== 'checkout\.stripe\.com'/);

assert.match(webhook, /const rawBody = await request\.text\(\)[\s\S]+verifyStripeWebhook\(request, rawBody\)/s);
assert.match(webhook, /checkout\.session\.completed/);
assert.match(webhook, /event\.livemode/);
assert.match(reconcile, /session\.amount_total !== order\.amount_ore/);
assert.match(reconcile, /session\.metadata\?\.reference !== order\.reference/);
assert.match(reconcile, /session\.payment_status === 'paid'[\s\S]+apply_captured_boost/s);
assert.match(status, /payment_provider === 'stripe'[\s\S]+reconcileStripeOrder/s);
assert.match(integrationStatus, /getStripeConfig\(\)/);
assert.match(integrationStatus, /requireStripeWebhookSecret\(\)/);
assert.doesNotMatch(integrationStatus, /Vipps|vipps/);
assert.match(dashboard, /functions\.invoke\('payment-integration-status'/);
assert.match(dashboard, /functions\.invoke\('create-stripe-boost-payment'/);
assert.doesNotMatch(dashboard, /create-boost-payment|vipps/i);
assert.doesNotMatch(dashboard, /from\('listings'\).*update[\s\S]*is_featured/s, 'Frontend skal ikke aktivere fremheving');
assert.match(deliveryGuard, /before delete or update of status on public\.listings/i);
assert.match(deliveryGuard, /provider_session_id is not null[\s\S]+status in \('pending', 'authorized'\)[\s\S]+interval '25 hours'/s);
assert.match(deliveryGuard, /raise exception[\s\S]+Betaling for fremheving pågår/s);
assert.match(dashboard, /hasOpenBoostPayment\(item\.id\)[\s\S]+Vent til betalingen er ferdig eller utløpt/s);
assert.match(dashboard, /Gjenstående fremheving refunderes ikke automatisk/);

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (['node_modules', 'public', 'dist', '.next', '.vinext', '.wrangler'].includes(name)) return [];
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
assert.doesNotMatch(frontend, /sk_(?:test|live)_|whsec_|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET/);

console.log('Stripe-fremheving: 37 sikkerhetskontroller besto.');
