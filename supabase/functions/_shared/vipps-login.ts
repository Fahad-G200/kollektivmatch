import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.2';
import { PublicError } from './http.ts';

export type VippsLoginConfig = {
  environment: 'test' | 'production';
  apiBase: string;
  appBase: string;
  clientId: string;
  clientSecret: string;
  subscriptionKey: string;
  msn: string;
  callbackUrl: string;
  forceAppAuth: boolean;
};

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  id_token_signing_alg_values_supported?: string[];
};

type TokenResponse = {
  access_token: string;
  id_token: string;
  token_type?: string;
  expires_in?: number;
};

let discoveryCache: { apiBase: string; value: Discovery; expiresAt: number } | null = null;

function configured(name: string, fallback?: string) {
  return Deno.env.get(name)?.trim() || (fallback ? Deno.env.get(fallback)?.trim() : '') || '';
}

function notConfigured(): never {
  throw new PublicError(
    503,
    'VIPPS_LOGIN_NOT_CONFIGURED',
    'Vipps-verifisering er ikke aktivert ennå. Prøv igjen senere.',
  );
}

export function getVippsLoginConfig(): VippsLoginConfig {
  const environment = configured('VIPPS_ENVIRONMENT');
  const apiBase = configured('VIPPS_API_BASE_URL').replace(/\/$/, '');
  const appBase = configured('APP_BASE_URL').replace(/\/$/, '');
  const clientId = configured('VIPPS_LOGIN_CLIENT_ID', 'VIPPS_CLIENT_ID');
  const clientSecret = configured('VIPPS_LOGIN_CLIENT_SECRET', 'VIPPS_CLIENT_SECRET');
  const subscriptionKey = configured('VIPPS_LOGIN_SUBSCRIPTION_KEY', 'VIPPS_SUBSCRIPTION_KEY');
  const msn = configured('VIPPS_LOGIN_MSN', 'VIPPS_MSN');
  const supabaseUrl = configured('SUPABASE_URL').replace(/\/$/, '');
  if (!environment || !apiBase || !appBase || !clientId || !clientSecret
      || !subscriptionKey || !msn || !supabaseUrl) notConfigured();
  if (environment !== 'test' && environment !== 'production') notConfigured();
  if (environment === 'test' && apiBase !== 'https://apitest.vipps.no') notConfigured();
  if (environment === 'production' && (
    apiBase !== 'https://api.vipps.no'
    || configured('VIPPS_PRODUCTION_CONFIRMED') !== 'true'
  )) notConfigured();

  let appUrl: URL;
  let supabaseProjectUrl: URL;
  try {
    appUrl = new URL(appBase);
    supabaseProjectUrl = new URL(supabaseUrl);
  } catch {
    notConfigured();
  }
  if (appUrl!.protocol !== 'https:' || supabaseProjectUrl!.protocol !== 'https:') notConfigured();

  return {
    environment,
    apiBase,
    appBase,
    clientId,
    clientSecret,
    subscriptionKey,
    msn,
    callbackUrl: `${supabaseUrl}/functions/v1/vipps-verification-callback`,
    forceAppAuth: configured('VIPPS_LOGIN_FORCE_APP_AUTH') === 'true',
  };
}

function vippsLoginHeaders(config: VippsLoginConfig, includeSubscriptionKey = false) {
  const headers: Record<string, string> = {
    'Merchant-Serial-Number': config.msn,
    'Vipps-System-Name': 'KollektivMatch',
    'Vipps-System-Version': '1.0.0',
    'Vipps-System-Plugin-Name': 'KollektivMatch-Supabase',
    'Vipps-System-Plugin-Version': '1.0.0',
  };
  if (includeSubscriptionKey) headers['Ocp-Apim-Subscription-Key'] = config.subscriptionKey;
  return headers;
}

function assertVippsUrl(value: unknown, config: VippsLoginConfig) {
  if (typeof value !== 'string') throw new Error('Vipps discovery mangler endepunkt.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== new URL(config.apiBase).origin) {
    throw new Error('Vipps discovery returnerte et ugyldig endepunkt.');
  }
  return value;
}

export async function getVippsDiscovery(config = getVippsLoginConfig()) {
  if (discoveryCache?.apiBase === config.apiBase && discoveryCache.expiresAt > Date.now()) {
    return discoveryCache.value;
  }
  const response = await fetch(
    `${config.apiBase}/access-management-1.0/access/.well-known/openid-configuration`,
    {
      headers: { ...vippsLoginHeaders(config), accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    },
  ).catch(() => null);
  if (!response?.ok) {
    console.error('Vipps Login discovery feilet', { status: response?.status || 0 });
    throw new PublicError(502, 'VIPPS_LOGIN_UNAVAILABLE', 'Vipps-verifisering er midlertidig utilgjengelig.');
  }
  const raw = await response.json().catch(() => null) as Record<string, unknown> | null;
  const expectedIssuer = `${config.apiBase}/access-management-1.0/access/`;
  if (!raw || raw.issuer !== expectedIssuer) throw new Error('Vipps discovery har uventet issuer.');
  const discovery: Discovery = {
    issuer: expectedIssuer,
    authorization_endpoint: assertVippsUrl(raw.authorization_endpoint, config),
    token_endpoint: assertVippsUrl(raw.token_endpoint, config),
    userinfo_endpoint: assertVippsUrl(raw.userinfo_endpoint, config),
    jwks_uri: assertVippsUrl(raw.jwks_uri, config),
    id_token_signing_alg_values_supported: Array.isArray(raw.id_token_signing_alg_values_supported)
      ? raw.id_token_signing_alg_values_supported.filter((value): value is string => typeof value === 'string')
      : [],
  };
  if (!discovery.id_token_signing_alg_values_supported?.includes('RS256')) {
    throw new Error('Vipps discovery støtter ikke forventet signeringsalgoritme.');
  }
  discoveryCache = { apiBase: config.apiBase, value: discovery, expiresAt: Date.now() + 55 * 60_000 };
  return discovery;
}

function base64Url(bytes: Uint8Array) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function randomToken(byteLength = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Hex(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function pkceChallenge(codeVerifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return base64Url(new Uint8Array(digest));
}

export function buildVippsAuthorizationUrl(
  discovery: Discovery,
  config: VippsLoginConfig,
  values: { state: string; nonce: string; codeChallenge: string },
) {
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid');
  url.searchParams.set('state', values.state);
  url.searchParams.set('nonce', values.nonce);
  url.searchParams.set('redirect_uri', config.callbackUrl);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', values.codeChallenge);
  url.searchParams.set('market', 'NO');
  if (config.forceAppAuth) url.searchParams.set('acr_values', 'urn:vipps:acr:app_auth');
  return url.toString();
}

export async function exchangeVippsAuthorizationCode(
  code: string,
  codeVerifier: string,
  discovery: Discovery,
  config: VippsLoginConfig,
) {
  const credentials = btoa(`${config.clientId}:${config.clientSecret}`);
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.callbackUrl,
    code_verifier: codeVerifier,
  });
  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      ...vippsLoginHeaders(config),
      authorization: `Basic ${credentials}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: form,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response?.ok) {
    console.error('Vipps Login token exchange feilet', { status: response?.status || 0 });
    throw new PublicError(502, 'VIPPS_LOGIN_TOKEN_FAILED', 'Vipps-verifiseringen kunne ikke fullføres.');
  }
  const body = await response.json().catch(() => null) as Partial<TokenResponse> | null;
  if (!body?.access_token || !body.id_token) throw new Error('Vipps returnerte ikke forventede tokens.');
  return body as TokenResponse;
}

async function expectedAccessTokenHash(accessToken: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken)));
  return base64Url(digest.slice(0, digest.length / 2));
}

export async function verifyVippsIdentity(
  tokens: TokenResponse,
  expectedNonce: string,
  discovery: Discovery,
  config: VippsLoginConfig,
) {
  const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri), {
    timeoutDuration: 8_000,
    cooldownDuration: 30_000,
  });
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: discovery.issuer,
    audience: config.clientId,
    algorithms: ['RS256'],
    clockTolerance: 5,
    maxTokenAge: '10m',
  });
  if (payload.nonce !== expectedNonce) throw new Error('Vipps ID token har ugyldig nonce.');
  if (typeof payload.sub !== 'string' || payload.sub.length < 8 || payload.sub.length > 255) {
    throw new Error('Vipps ID token mangler gyldig subject.');
  }
  if (typeof payload.at_hash === 'string'
      && payload.at_hash !== await expectedAccessTokenHash(tokens.access_token)) {
    throw new Error('Vipps ID token har ugyldig access token hash.');
  }
  if (config.forceAppAuth && payload.acr !== 'urn:vipps:acr:app_auth') {
    throw new Error('Vipps bekreftet ikke påkrevd app-autentisering.');
  }

  const userinfoResponse = await fetch(discovery.userinfo_endpoint, {
    headers: {
      ...vippsLoginHeaders(config, true),
      authorization: `Bearer ${tokens.access_token}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!userinfoResponse?.ok) {
    console.error('Vipps Login userinfo feilet', { status: userinfoResponse?.status || 0 });
    throw new PublicError(502, 'VIPPS_LOGIN_USERINFO_FAILED', 'Vipps-verifiseringen kunne ikke fullføres.');
  }
  const userinfo = await userinfoResponse.json().catch(() => null) as Record<string, unknown> | null;
  if (!userinfo || userinfo.sub !== payload.sub) throw new Error('Vipps userinfo stemmer ikke med ID token.');
  return { sub: payload.sub };
}
