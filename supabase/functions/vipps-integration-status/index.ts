import { corsHeaders, handlePreflight, requireAllowedOrigin } from '../_shared/cors.ts';
import { PublicError, jsonResponse, safeErrorResponse } from '../_shared/http.ts';
import { getVippsLoginConfig } from '../_shared/vipps-login.ts';
import { getVippsConfig } from '../_shared/vipps.ts';
import { getStripeConfig, requireStripeWebhookSecret } from '../_shared/stripe.ts';

Deno.serve((request) => {
  const headers = corsHeaders(request);
  try {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    if (request.method !== 'POST') throw new PublicError(405, 'METHOD_NOT_ALLOWED', 'Metoden er ikke tillatt.');
    requireAllowedOrigin(request);

    let loginReady = false;
    let paymentReady = false;
    let stripePaymentReady = false;
    let environment: 'test' | 'production' | null = null;
    try {
      const config = getVippsLoginConfig();
      loginReady = true;
      environment = config.environment;
    } catch {
      // Bare tilgjengelighet returneres. Konfigurasjonsdetaljer forblir hemmelige.
    }
    try {
      const config = getVippsConfig();
      paymentReady = true;
      environment ||= config.environment;
    } catch {
      // Bare tilgjengelighet returneres. Konfigurasjonsdetaljer forblir hemmelige.
    }
    try {
      const config = getStripeConfig();
      requireStripeWebhookSecret();
      stripePaymentReady = true;
      environment ||= config.environment;
    } catch {
      // Stripe-nøkler og webhook-secret returneres aldri til nettleseren.
    }
    return jsonResponse({
      login_ready: loginReady,
      payment_ready: paymentReady,
      stripe_payment_ready: stripePaymentReady,
      preferred_payment_provider: stripePaymentReady ? 'stripe' : paymentReady ? 'vipps' : null,
      environment,
    }, 200, headers);
  } catch (error) {
    return safeErrorResponse(error, headers);
  }
});
