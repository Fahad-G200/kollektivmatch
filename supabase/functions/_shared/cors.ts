import { PublicError } from './http.ts';

const LOCAL_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
]);

function configuredOrigin() {
  const value = Deno.env.get('APP_BASE_URL');
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol)
      || url.username
      || url.password
      || url.search
      || url.hash
      || url.pathname !== '/'
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function localOriginsEnabled() {
  const appOrigin = configuredOrigin();
  // Et glemt miljoeflagg skal aldri kunne slippe localhost inn sammen med en
  // publisert APP_BASE_URL. Lokal CORS krever bade eksplisitt flagg og at
  // selve app-origin er en kjent lokal utviklingsadresse.
  return appOrigin !== null
    && LOCAL_ORIGINS.has(appOrigin)
    && Deno.env.get('ALLOW_LOCAL_ORIGINS') === 'true';
}

export function isAllowedOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  return origin === configuredOrigin() || (localOriginsEnabled() && LOCAL_ORIGINS.has(origin));
}

export function requireAllowedOrigin(request: Request) {
  if (!isAllowedOrigin(request)) {
    throw new PublicError(403, 'ORIGIN_NOT_ALLOWED', 'Forespørselen kom fra et domene som ikke er tillatt.');
  }
}

export function corsHeaders(request: Request) {
  const origin = request.headers.get('origin');
  const allowed = origin && isAllowedOrigin(request) ? origin : configuredOrigin() || '';
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

export function handlePreflight(request: Request) {
  if (request.method !== 'OPTIONS') return null;
  requireAllowedOrigin(request);
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
