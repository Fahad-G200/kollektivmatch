import { corsHeaders, handlePreflight, requireAllowedOrigin } from '../_shared/cors.ts';
import { PublicError, jsonResponse, safeErrorResponse } from '../_shared/http.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';
import {
  buildVippsAuthorizationUrl,
  getVippsDiscovery,
  getVippsLoginConfig,
  pkceChallenge,
  randomToken,
  sha256Hex,
} from '../_shared/vipps-login.ts';

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  try {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    if (request.method !== 'POST') throw new PublicError(405, 'METHOD_NOT_ALLOWED', 'Metoden er ikke tillatt.');
    requireAllowedOrigin(request);
    const { user } = await requireUser(request);
    const admin = serviceClient();

    await admin.from('vipps_verification_sessions').delete()
      .lt('expires_at', new Date(Date.now() - 24 * 60 * 60_000).toISOString());

    const { data: profile, error: profileError } = await admin.from('profiles')
      .select('vipps_verified').eq('id', user.id).single();
    if (profileError || !profile) throw new PublicError(404, 'PROFILE_NOT_FOUND', 'Fant ikke profilen din.');
    if (profile.vipps_verified === true) {
      return jsonResponse({ already_verified: true }, 200, headers);
    }

    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60_000).toISOString();
    const { count, error: countError } = await admin.from('vipps_verification_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', fifteenMinutesAgo);
    if (countError) throw new Error(`Kunne ikke kontrollere verifiseringsforsøk: ${countError.code}`);
    if ((count || 0) >= 5) {
      throw new PublicError(429, 'RATE_LIMITED', 'For mange verifiseringsforsøk. Vent litt og prøv igjen.');
    }

    const config = getVippsLoginConfig();
    const discovery = await getVippsDiscovery(config);
    const state = randomToken(32);
    const nonce = randomToken(32);
    const codeVerifier = randomToken(48);
    const stateHash = await sha256Hex(state);
    const codeChallenge = await pkceChallenge(codeVerifier);
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

    await admin.from('vipps_verification_sessions')
      .update({
        status: 'failed',
        last_error_code: 'SUPERSEDED',
        code_verifier: 'x'.repeat(43),
        nonce: 'x'.repeat(22),
      })
      .eq('user_id', user.id)
      .eq('status', 'pending');

    const { error: insertError } = await admin.from('vipps_verification_sessions').insert({
      user_id: user.id,
      state_hash: stateHash,
      nonce,
      code_verifier: codeVerifier,
      expires_at: expiresAt,
    });
    if (insertError) {
      console.error('Kunne ikke opprette Vipps-verifiseringssesjon', { code: insertError.code });
      throw new PublicError(500, 'VERIFICATION_SESSION_FAILED', 'Kunne ikke starte verifiseringen.');
    }

    const verificationUrl = buildVippsAuthorizationUrl(discovery, config, { state, nonce, codeChallenge });
    return jsonResponse({ verification_url: verificationUrl, expires_in: 600 }, 200, headers);
  } catch (error) {
    return safeErrorResponse(error, headers);
  }
});
