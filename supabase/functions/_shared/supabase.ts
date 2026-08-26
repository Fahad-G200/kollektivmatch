import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import { PublicError } from './http.ts';

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Mangler serverkonfigurasjon: ${name}`);
  return value;
}

export function serviceClient() {
  return createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function userClient(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new PublicError(401, 'AUTH_REQUIRED', 'Du må være logget inn.');
  }
  return createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_ANON_KEY'), {
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

