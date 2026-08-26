import { corsHeaders, handlePreflight, requireAllowedOrigin } from '../_shared/cors.ts';
import { PublicError, UUID_PATTERN, jsonResponse, readJsonObject, safeErrorResponse } from '../_shared/http.ts';
import { recordPaymentEvent } from '../_shared/reconcile.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';
import { createVippsPayment } from '../_shared/vipps.ts';

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  try {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    if (request.method !== 'POST') throw new PublicError(405, 'METHOD_NOT_ALLOWED', 'Metoden er ikke tillatt.');
    requireAllowedOrigin(request);
    const { user } = await requireUser(request);
    const body = await readJsonObject(request);
    const listingId = typeof body.listing_id === 'string' ? body.listing_id : '';
    const productId = typeof body.product_id === 'string' ? body.product_id : '';
    if (!UUID_PATTERN.test(listingId) || !/^[a-z0-9_]{3,40}$/.test(productId)) {
      throw new PublicError(400, 'INVALID_REQUEST', 'Velg en gyldig annonse og pakke.');
    }
    if (body.accepted_terms !== true) {
      throw new PublicError(400, 'TERMS_REQUIRED', 'Du må godta pris, leveranse og vilkår før betaling.');
    }

    const admin = serviceClient();
    const { data: order, error: orderError } = await admin.rpc('create_boost_order', {
      p_user_id: user.id,
      p_listing_id: listingId,
      p_product_id: productId,
      p_terms_version: '2026-08-23',
    });
    if (orderError || !order) {
      console.error('Kunne ikke opprette boost-ordre', { code: orderError?.code });
      const message = orderError?.message || '';
      if (/For mange betalingsforsøk/i.test(message)) throw new PublicError(429, 'RATE_LIMITED', 'For mange betalingsforsøk. Vent en stund og prøv igjen.');
      if (/Bare aktive annonser/i.test(message)) throw new PublicError(409, 'LISTING_NOT_ACTIVE', 'Bare aktive annonser kan fremheves.');
      if (/eier|fremheves av/i.test(message)) throw new PublicError(403, 'NOT_LISTING_OWNER', 'Du kan bare fremheve dine egne annonser.');
      throw new PublicError(400, 'ORDER_CREATE_FAILED', 'Betalingen kunne ikke opprettes. Kontroller valgene og prøv igjen.');
    }

    try {
      const payment = await createVippsPayment(order);
      await recordPaymentEvent(admin, order, 'PAYMENT_CREATED', 'create', { safeStatusCode: 'VIPPS_CREATED' });
      return jsonResponse({ order_id: order.id, redirect_url: payment.redirectUrl }, 200, headers);
    } catch (error) {
      await admin.rpc('mark_boost_order_status', {
        p_order_id: order.id,
        p_status: 'failed',
        p_safe_status_code: 'VIPPS_CREATE_FAILED',
        p_psp_reference: null,
      });
      await recordPaymentEvent(admin, order, 'PAYMENT_CREATE_FAILED', 'create', { safeStatusCode: 'VIPPS_CREATE_FAILED' });
      throw error;
    }
  } catch (error) {
    return safeErrorResponse(error, headers);
  }
});

