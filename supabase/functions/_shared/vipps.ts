import { PublicError } from './http.ts';

type Amount = { value: number; currency: string };
type BoostOrder = {
  id: string;
  reference: string;
  listing_title: string;
  product_name: string;
  amount_ore: number;
  currency: string;
  idempotency_key: string;
};

type VippsConfig = {
  environment: 'test' | 'production';
  apiBase: string;
  appBase: string;
  clientId: string;
  clientSecret: string;
  subscriptionKey: string;
  msn: string;
};

let tokenCache: { value: string; expiresAt: number } | null = null;

function required(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    console.error('Vipps ePayment mangler serverkonfigurasjon', { name });
    throw new PublicError(503, 'VIPPS_PAYMENT_NOT_CONFIGURED', 'Vipps-betaling er ikke aktivert ennå. Prøv igjen senere.');
  }
  return value;
}

export function getVippsConfig(): VippsConfig {
  const environment = required('VIPPS_ENVIRONMENT');
  if (environment !== 'test' && environment !== 'production') {
    throw new PublicError(503, 'VIPPS_PAYMENT_NOT_CONFIGURED', 'Vipps-betaling er ikke aktivert ennå. Prøv igjen senere.');
  }
  const apiBase = required('VIPPS_API_BASE_URL').replace(/\/$/, '');
  if (environment === 'test' && apiBase !== 'https://apitest.vipps.no') {
    throw new PublicError(503, 'VIPPS_PAYMENT_NOT_CONFIGURED', 'Vipps-betaling er ikke aktivert ennå. Prøv igjen senere.');
  }
  if (environment === 'production') {
    if (Deno.env.get('VIPPS_PRODUCTION_CONFIRMED') !== 'true' || apiBase !== 'https://api.vipps.no') {
      throw new PublicError(503, 'VIPPS_PAYMENT_NOT_CONFIGURED', 'Vipps-betaling er ikke aktivert ennå. Prøv igjen senere.');
    }
  }
  let appUrl: URL;
  try {
    appUrl = new URL(required('APP_BASE_URL'));
  } catch {
    throw new PublicError(503, 'VIPPS_PAYMENT_NOT_CONFIGURED', 'Vipps-betaling er ikke aktivert ennå. Prøv igjen senere.');
  }
  if (
    appUrl.protocol !== 'https:'
    || appUrl.username
    || appUrl.password
    || appUrl.search
    || appUrl.hash
    || appUrl.pathname !== '/'
  ) {
    throw new PublicError(503, 'VIPPS_PAYMENT_NOT_CONFIGURED', 'Vipps-betaling er ikke aktivert ennå. Prøv igjen senere.');
  }

  return {
    environment,
    apiBase,
    appBase: appUrl.origin,
    clientId: required('VIPPS_CLIENT_ID'),
    clientSecret: required('VIPPS_CLIENT_SECRET'),
    subscriptionKey: required('VIPPS_SUBSCRIPTION_KEY'),
    msn: required('VIPPS_MSN'),
  };
}

async function parseVippsResponse(response: Response | null) {
  if (!response) {
    throw new PublicError(502, 'PAYMENT_PROVIDER_ERROR', 'Vipps kunne ikke behandle forespørselen nå. Prøv igjen.');
  }
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    console.error('Vipps-kall feilet', { status: response.status });
    throw new PublicError(502, 'PAYMENT_PROVIDER_ERROR', 'Vipps kunne ikke behandle forespørselen nå. Prøv igjen.');
  }
  return body;
}

export async function getAccessToken(config = getVippsConfig()) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const response = await fetch(`${config.apiBase}/accesstoken/get`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      'Ocp-Apim-Subscription-Key': config.subscriptionKey,
      'Merchant-Serial-Number': config.msn,
    },
    body: '',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const body = await parseVippsResponse(response) as { access_token?: string; expires_in?: string | number };
  if (!body?.access_token) throw new Error('Vipps returnerte ikke access token.');
  const expiresIn = Math.max(60, Number(body.expires_in) || 3600);
  tokenCache = { value: body.access_token, expiresAt: Date.now() + expiresIn * 1000 };
  return body.access_token;
}

async function vippsHeaders(idempotencyKey?: string, config = getVippsConfig()) {
  const token = await getAccessToken(config);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Ocp-Apim-Subscription-Key': config.subscriptionKey,
    'Merchant-Serial-Number': config.msn,
    'Vipps-System-Name': 'KollektivMatch',
    'Vipps-System-Version': '1.0.0',
    'Vipps-System-Plugin-Name': 'KollektivMatch-Supabase',
    'Vipps-System-Plugin-Version': '1.0.0',
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return headers;
}

export async function createVippsPayment(order: BoostOrder) {
  const config = getVippsConfig();
  const response = await fetch(`${config.apiBase}/epayment/v1/payments`, {
    method: 'POST',
    headers: await vippsHeaders(order.idempotency_key, config),
    body: JSON.stringify({
      amount: { value: order.amount_ore, currency: order.currency },
      paymentMethod: { type: 'WALLET' },
      reference: order.reference,
      paymentDescription: order.product_name,
      returnUrl: `${config.appBase}/boost-payment-result.html?order=${encodeURIComponent(order.id)}`,
      userFlow: 'WEB_REDIRECT',
      metadata: { orderId: order.id },
    }),
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  const body = await parseVippsResponse(response) as { redirectUrl?: string; reference?: string };
  if (!body?.redirectUrl || body.reference !== order.reference) throw new Error('Ugyldig create-respons fra Vipps.');
  const redirect = new URL(body.redirectUrl);
  if (redirect.protocol !== 'https:') throw new Error('Vipps redirect mangler HTTPS.');
  return body;
}

export async function getVippsPayment(reference: string) {
  const config = getVippsConfig();
  const response = await fetch(`${config.apiBase}/epayment/v1/payments/${encodeURIComponent(reference)}`, {
    method: 'GET',
    headers: await vippsHeaders(undefined, config),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return await parseVippsResponse(response) as Record<string, unknown>;
}

export async function captureVippsPayment(order: BoostOrder) {
  const config = getVippsConfig();
  const response = await fetch(`${config.apiBase}/epayment/v1/payments/${encodeURIComponent(order.reference)}/capture`, {
    method: 'POST',
    headers: await vippsHeaders(`capture-${order.id}`, config),
    body: JSON.stringify({ modificationAmount: { value: order.amount_ore, currency: order.currency } satisfies Amount }),
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  return await parseVippsResponse(response) as Record<string, unknown>;
}

export async function refundVippsPayment(order: BoostOrder) {
  const config = getVippsConfig();
  const response = await fetch(`${config.apiBase}/epayment/v1/payments/${encodeURIComponent(order.reference)}/refund`, {
    method: 'POST',
    headers: await vippsHeaders(`refund-${order.id}`, config),
    body: JSON.stringify({ modificationAmount: { value: order.amount_ore, currency: order.currency } satisfies Amount }),
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  return await parseVippsResponse(response) as Record<string, unknown>;
}
