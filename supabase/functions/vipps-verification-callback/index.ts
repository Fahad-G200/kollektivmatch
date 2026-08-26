import { PublicError, safeErrorResponse } from '../_shared/http.ts';
import { serviceClient } from '../_shared/supabase.ts';
import {
  exchangeVippsAuthorizationCode,
  getVippsDiscovery,
  getVippsLoginConfig,
  sha256Hex,
  verifyVippsIdentity,
} from '../_shared/vipps-login.ts';

function safeResultUrl(result: 'completed' | 'cancelled' | 'failed') {
  const appBase = Deno.env.get('APP_BASE_URL')?.trim().replace(/\/$/, '');
  if (!appBase) return null;
  try {
    const url = new URL(`${appBase}/vipps-verification-result.html`);
    if (url.protocol !== 'https:') return null;
    url.searchParams.set('result', result);
    return url.toString();
  } catch {
    return null;
  }
}

function redirectToResult(result: 'completed' | 'cancelled' | 'failed') {
  const location = safeResultUrl(result);
  if (!location) throw new Error('APP_BASE_URL er ikke konfigurert.');
  return new Response(null, {
    status: 303,
    headers: {
      location,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}

async function markFailed(admin: ReturnType<typeof serviceClient>, sessionId: string, errorCode: string) {
  await admin.from('vipps_verification_sessions').update({
    status: 'failed',
    last_error_code: errorCode.slice(0, 80),
    code_verifier: 'x'.repeat(43),
    nonce: 'x'.repeat(22),
  }).eq('id', sessionId).eq('status', 'processing');
}

Deno.serve(async (request) => {
  let claimedSessionId = '';
  try {
    if (request.method !== 'GET') throw new PublicError(405, 'METHOD_NOT_ALLOWED', 'Metoden er ikke tillatt.');
    const url = new URL(request.url);
    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    const providerError = url.searchParams.get('error') || '';
    if (!/^[A-Za-z0-9_-]{40,128}$/.test(state)) return redirectToResult('failed');

    const admin = serviceClient();
    const stateHash = await sha256Hex(state);
    const now = new Date().toISOString();
    const { data: claimed, error: claimError } = await admin.from('vipps_verification_sessions')
      .update({ status: 'processing', used_at: now })
      .eq('state_hash', stateHash)
      .eq('status', 'pending')
      .gt('expires_at', now)
      .select('id, user_id, nonce, code_verifier, expires_at')
      .maybeSingle();
    if (claimError || !claimed) return redirectToResult('failed');
    claimedSessionId = claimed.id;

    if (providerError || !code || code.length > 4096) {
      await markFailed(admin, claimed.id, providerError ? 'USER_CANCELLED_OR_PROVIDER_ERROR' : 'MISSING_CODE');
      return redirectToResult(providerError === 'access_denied' ? 'cancelled' : 'failed');
    }

    const config = getVippsLoginConfig();
    const discovery = await getVippsDiscovery(config);
    const tokens = await exchangeVippsAuthorizationCode(code, claimed.code_verifier, discovery, config);
    const identity = await verifyVippsIdentity(tokens, claimed.nonce, discovery, config);
    const { error: completeError } = await admin.rpc('complete_vipps_verification', {
      p_session_id: claimed.id,
      p_vipps_sub: identity.sub,
    });
    if (completeError) {
      console.error('Kunne ikke fullføre Vipps-kobling', { code: completeError.code });
      await markFailed(admin, claimed.id, completeError.code === '23505' ? 'IDENTITY_ALREADY_LINKED' : 'LINK_FAILED');
      return redirectToResult('failed');
    }
    return redirectToResult('completed');
  } catch (error) {
    if (claimedSessionId) {
      try {
        await markFailed(serviceClient(), claimedSessionId, error instanceof PublicError ? error.code : 'CALLBACK_FAILED');
      } catch {
        // Resultatsiden viser fortsatt en sikker feilmelding hvis statusoppdateringen feiler.
      }
    }
    const redirect = safeResultUrl('failed');
    if (redirect) return new Response(null, { status: 303, headers: { location: redirect, 'cache-control': 'no-store' } });
    return safeErrorResponse(error);
  }
});

