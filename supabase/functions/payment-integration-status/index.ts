import { corsHeaders, handlePreflight, requireAllowedOrigin } from '../_shared/cors.ts';
import { PublicError, jsonResponse, safeErrorResponse } from '../_shared/http.ts';
import { getStripeConfig, requireStripeWebhookSecret } from '../_shared/stripe.ts';

Deno.serve((request) => {
  const headers = corsHeaders(request);
  try {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    if (request.method !== 'POST') throw new PublicError(405, 'METHOD_NOT_ALLOWED', 'Metoden er ikke tillatt.');
    requireAllowedOrigin(request);

    let stripePaymentReady = false;
    let environment: 'test' | 'production' | null = null;
    try {
      const config = getStripeConfig();
      requireStripeWebhookSecret();
      stripePaymentReady = true;
      environment = config.environment;
    } catch {
      // Bare tilgjengelighet returneres. Nøkler og webhook-secret forblir på serveren.
    }

    return jsonResponse({
      stripe_payment_ready: stripePaymentReady,
      preferred_payment_provider: stripePaymentReady ? 'stripe' : null,
      environment,
    }, 200, headers);
  } catch (error) {
    return safeErrorResponse(error, headers);
  }
});
