import { PublicError } from './http.ts';
import { constantTimeEqual } from './webhook-signature.mjs';

type StripeConfig = {
  environment: 'test' | 'production';
  secretKey: string;
  apiBase: string;
  appBase: string;
};

type BoostOrder = Record<string, any> & {
  id: string;
  reference: string;
  listing_title: string;
  product_name: string;
  amount_ore: number;
  currency: string;
  idempotency_key: string;
  payment_provider: string;
  provider_session_id: string | null;
  provider_payment_id: string | null;
};

function required(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    console.error('Stripe mangler serverkonfigurasjon', { name });
    throw new PublicError(503, 'STRIPE_PAYMENT_NOT_CONFIGURED', 'Kortbetaling er ikke aktivert ennå. Prøv igjen senere.');
  }
  return value;
}

function isLocalAppUrl(url: URL) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

export function getStripeConfig(): StripeConfig {
  const environment = required('STRIPE_ENVIRONMENT');
  if (environment !== 'test' && environment !== 'production') {
    throw new PublicError(503, 'STRIPE_PAYMENT_NOT_CONFIGURED', 'Kortbetaling er ikke aktivert ennå. Prøv igjen senere.');
  }
  const secretKey = required('STRIPE_SECRET_KEY');
  if (environment === 'test' && !secretKey.startsWith('sk_test_')) {
    throw new PublicError(503, 'STRIPE_PAYMENT_NOT_CONFIGURED', 'Kortbetaling er ikke aktivert ennå. Prøv igjen senere.');
  }
  if (
    environment === 'production'
    && (!secretKey.startsWith('sk_live_') || Deno.env.get('STRIPE_PRODUCTION_CONFIRMED') !== 'true')
  ) {
    throw new PublicError(503, 'STRIPE_PAYMENT_NOT_CONFIGURED', 'Kortbetaling er ikke aktivert ennå. Prøv igjen senere.');
  }

  let appUrl: URL;
  try {
    appUrl = new URL(required('APP_BASE_URL'));
  } catch {
    throw new PublicError(503, 'STRIPE_PAYMENT_NOT_CONFIGURED', 'Kortbetaling er ikke aktivert ennå. Prøv igjen senere.');
  }
  if (environment === 'production' && appUrl.protocol !== 'https:') {
    throw new PublicError(503, 'STRIPE_PAYMENT_NOT_CONFIGURED', 'Kortbetaling er ikke aktivert ennå. Prøv igjen senere.');
  }
  if (!['https:', 'http:'].includes(appUrl.protocol)) {
    throw new PublicError(503, 'STRIPE_PAYMENT_NOT_CONFIGURED', 'Kortbetaling er ikke aktivert ennå. Prøv igjen senere.');
  }
  if (appUrl.username || appUrl.password || appUrl.search || appUrl.hash || appUrl.pathname !== '/') {
    throw new PublicError(503, 'STRIPE_PAYMENT_NOT_CONFIGURED', 'Kortbetaling er ikke aktivert ennå. Prøv igjen senere.');
  }
  if (
    environment === 'test'
    && !isLocalAppUrl(appUrl)
    && Deno.env.get('ALLOW_DEPLOYED_TEST_PAYMENTS') !== 'true'
  ) {
    console.error('Stripe testbetaling er sperret pa deployert origin');
    throw new PublicError(503, 'STRIPE_PAYMENT_NOT_CONFIGURED', 'Kortbetaling er ikke aktivert ennå. Prøv igjen senere.');
  }

  return {
    environment,
    secretKey,
    apiBase: 'https://api.stripe.com',
    appBase: appUrl.origin,
  };
}

async function stripeRequest(
  path: string,
  options: { method?: string; body?: URLSearchParams; idempotencyKey?: string } = {},
) {
  const config = getStripeConfig();
  const response = await fetch(`${config.apiBase}${path}`, {
    method: options.method || 'GET',
    headers: {
      authorization: `Bearer ${config.secretKey}`,
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
    },
    body: options.body?.toString(),
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!response) {
    throw new PublicError(502, 'PAYMENT_PROVIDER_ERROR', 'Betalingsleverandøren kunne ikke behandle forespørselen nå. Prøv igjen.');
  }
  let value: Record<string, any> | null = null;
  try {
    value = await response.json();
  } catch {
    // Stripe-feil skal ikke lekke leverandørens rå respons til klienten.
  }
  if (!response.ok || !value) {
    console.error('Stripe-kall feilet', { path, status: response.status, type: value?.error?.type || null });
    throw new PublicError(502, 'PAYMENT_PROVIDER_ERROR', 'Betalingsleverandøren kunne ikke behandle forespørselen nå. Prøv igjen.');
  }
  return value;
}

export async function createStripeCheckoutSession(order: BoostOrder) {
  const config = getStripeConfig();
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('client_reference_id', order.id);
  body.set('success_url', `${config.appBase}/boost-payment-result.html?order=${encodeURIComponent(order.id)}`);
  body.set('cancel_url', `${config.appBase}/dashboard.html?payment=cancelled#boost-payments`);
  body.set('locale', 'nb');
  body.set('payment_method_types[0]', 'card');
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', order.currency.toLowerCase());
  body.set('line_items[0][price_data][unit_amount]', String(order.amount_ore));
  body.set('line_items[0][price_data][product_data][name]', order.product_name);
  body.set('line_items[0][price_data][product_data][description]', `Fremheving av ${order.listing_title}`.slice(0, 500));
  body.set('metadata[order_id]', order.id);
  body.set('metadata[reference]', order.reference);
  body.set('payment_intent_data[metadata][order_id]', order.id);
  body.set('payment_intent_data[metadata][reference]', order.reference);

  const session = await stripeRequest('/v1/checkout/sessions', {
    method: 'POST',
    body,
    idempotencyKey: `checkout-${order.idempotency_key}`,
  });
  if (
    typeof session.id !== 'string'
    || typeof session.url !== 'string'
    || session.client_reference_id !== order.id
  ) {
    throw new PublicError(502, 'INVALID_PROVIDER_RESPONSE', 'Betalingsleverandøren returnerte et ugyldig svar.');
  }
  const redirect = new URL(session.url);
  if (redirect.protocol !== 'https:' || redirect.hostname !== 'checkout.stripe.com') {
    throw new PublicError(502, 'INVALID_PROVIDER_RESPONSE', 'Betalingsleverandøren returnerte et ugyldig svar.');
  }
  return session;
}

export async function getStripeCheckoutSession(sessionId: string) {
  if (!/^cs_(?:test_|live_)?[A-Za-z0-9_]{8,240}$/.test(sessionId)) {
    throw new PublicError(400, 'INVALID_PAYMENT_SESSION', 'Betalingssesjonen er ugyldig.');
  }
  return await stripeRequest(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

export async function refundStripePayment(order: BoostOrder) {
  if (order.payment_provider !== 'stripe' || !order.provider_session_id) {
    throw new PublicError(409, 'PAYMENT_MISMATCH', 'Betalingsdetaljene stemmer ikke med ordren.');
  }
  const session = await getStripeCheckoutSession(order.provider_session_id);
  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : '';
  if (
    session.id !== order.provider_session_id
    || session.client_reference_id !== order.id
    || session.metadata?.order_id !== order.id
    || session.metadata?.reference !== order.reference
    || session.payment_status !== 'paid'
    || session.amount_total !== order.amount_ore
    || String(session.currency || '').toUpperCase() !== order.currency
    || !/^pi_[A-Za-z0-9_]{8,240}$/.test(paymentIntent)
    || (order.provider_payment_id && order.provider_payment_id !== paymentIntent)
  ) {
    throw new PublicError(409, 'PAYMENT_MISMATCH', 'Betalingsdetaljene stemmer ikke med ordren.');
  }

  const body = new URLSearchParams();
  body.set('payment_intent', paymentIntent);
  body.set('amount', String(order.amount_ore));
  body.set('metadata[order_id]', order.id);
  body.set('metadata[reference]', order.reference);
  const refund = await stripeRequest('/v1/refunds', {
    method: 'POST',
    body,
    idempotencyKey: `refund-${order.idempotency_key}`,
  });
  if (
    typeof refund.id !== 'string'
    || !/^re_[A-Za-z0-9_]{8,240}$/.test(refund.id)
    || refund.payment_intent !== paymentIntent
    || refund.amount !== order.amount_ore
    || String(refund.currency || '').toUpperCase() !== order.currency
    || refund.status !== 'succeeded'
  ) {
    throw new PublicError(502, 'REFUND_NOT_CONFIRMED', 'Stripe har ikke bekreftet refusjonen.');
  }
  return refund;
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyStripeWebhook(request: Request, rawBody: string) {
  const signatureHeader = request.headers.get('stripe-signature') || '';
  const parts = signatureHeader.split(',').map((part) => part.trim().split('='));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1] || 0);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value).filter(Boolean);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(timestamp) || !signatures.length || Math.abs(nowSeconds - timestamp) > 300) {
    throw new PublicError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Webhook-signaturen er ugyldig.');
  }

  const secret = requireStripeWebhookSecret();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`));
  const expected = hex(digest);
  if (!signatures.some((candidate) => constantTimeEqual(candidate, expected))) {
    throw new PublicError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Webhook-signaturen er ugyldig.');
  }
}

export function requireStripeWebhookSecret() {
  const secret = required('STRIPE_WEBHOOK_SECRET');
  if (!secret.startsWith('whsec_')) {
    throw new PublicError(503, 'STRIPE_PAYMENT_NOT_CONFIGURED', 'Kortbetaling er ikke aktivert ennå.');
  }
  return secret;
}
