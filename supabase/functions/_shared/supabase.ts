import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
import { PublicError } from './http.ts';

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Mangler serverkonfigurasjon: ${name}`);
  return value;
}

function apiKey(jsonName: string, legacyName: string, expectedPrefix: string) {
  const raw = Deno.env.get(jsonName)?.trim();
  if (raw) {
    let keys: unknown;
    try {
      keys = JSON.parse(raw);
    } catch {
      throw new Error(`Ugyldig serverkonfigurasjon: ${jsonName}`);
    }
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
      throw new Error(`Ugyldig serverkonfigurasjon: ${jsonName}`);
    }
    if (!Object.prototype.hasOwnProperty.call(keys, 'default')) return requiredEnv(legacyName);
    const value = (keys as Record<string, unknown>).default;
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized.startsWith(expectedPrefix) || normalized.length < expectedPrefix.length + 12) {
      throw new Error(`Ugyldig serverkonfigurasjon: ${jsonName}.default`);
    }
    return normalized;
  }
  return requiredEnv(legacyName);
}

function serviceFetch(secretKey: string) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    if (secretKey.startsWith('sb_secret_') && headers.get('authorization') === `Bearer ${secretKey}`) {
      headers.delete('authorization');
    }
    headers.set('apikey', secretKey);
    return fetch(input, { ...init, headers });
  };
}

export function serviceClient() {
  const secretKey = apiKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_');
  return createClient(requiredEnv('SUPABASE_URL'), secretKey, {
    global: { fetch: serviceFetch(secretKey) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function userClient(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new PublicError(401, 'AUTH_REQUIRED', 'Du må være logget inn.');
  }
  return createClient(requiredEnv('SUPABASE_URL'), apiKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY', 'sb_publishable_'), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(request: Request) {
  const client = userClient(request);
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new PublicError(401, 'AUTH_REQUIRED', 'Du må være logget inn.');
  return { client, user };
}
