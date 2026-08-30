import { corsHeaders, handlePreflight, requireAllowedOrigin } from '../_shared/cors.ts';
import { PublicError, UUID_PATTERN, jsonResponse, readJsonObject, safeErrorResponse } from '../_shared/http.ts';
import { recordPaymentEvent } from '../_shared/reconcile.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';
import { capturedAmountMatches, refundedAmountCovers } from '../_shared/payment-rules.mjs';
import { getVippsPayment, refundVippsPayment } from '../_shared/vipps.ts';
import { refundStripePayment } from '../_shared/stripe.ts';

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  try {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    if (request.method !== 'POST') throw new PublicError(405, 'METHOD_NOT_ALLOWED', 'Metoden er ikke tillatt.');
    requireAllowedOrigin(request);
    const { user } = await requireUser(request);
    if (user.app_metadata?.role !== 'admin') {
      throw new PublicError(403, 'ADMIN_REQUIRED', 'Bare administrator kan refundere betalinger.');
    }
    const body = await readJsonObject(request);
    const orderId = typeof body.order_id === 'string' ? body.order_id : '';
    if (!UUID_PATTERN.test(orderId)) throw new PublicError(400, 'INVALID_ORDER_ID', 'Ugyldig ordrenummer.');

    const admin = serviceClient();
    const { data: order, error } = await admin.from('boost_orders').select('*').eq('id', orderId).single();
    if (error || !order) throw new PublicError(404, 'ORDER_NOT_FOUND', 'Betalingsordren finnes ikke.');
    if (!['vipps', 'stripe'].includes(order.payment_provider)) {
      throw new PublicError(409, 'REFUND_PROVIDER_UNSUPPORTED', 'Denne betalingen må refunderes hos riktig betalingsleverandør.');
    }
    if (order.status === 'refunded') return jsonResponse({ order_id: order.id, status: 'refunded' }, 200, headers);

    if (order.payment_provider === 'stripe') {
      if (order.status !== 'captured') {
        throw new PublicError(409, 'NOT_CAPTURED', 'Bare en bekreftet captured betaling kan refunderes.');
      }
      const refund = await refundStripePayment(order);
      const { error: applyError } = await admin.rpc('apply_boost_refund', {
        p_order_id: order.id,
        p_reference: order.reference,
        p_refunded_amount_ore: refund.amount,
        p_currency: order.currency,
        p_psp_reference: null,
      });
      if (applyError) throw new PublicError(500, 'REFUND_STATE_ERROR', 'Refusjonen er bekreftet, men status må kontrolleres av administrator.');
      await recordPaymentEvent(admin, order, 'REFUND_CONFIRMED', 'refund', {
        eventKey: `stripe|${refund.id}|refunded`,
        pspReference: refund.id,
        amountOre: refund.amount,
        currency: order.currency,
        safeStatusCode: 'STRIPE_REFUND_SUCCEEDED',
      });
      return jsonResponse({ order_id: order.id, status: 'refunded' }, 200, headers);
    }

    const details = await getVippsPayment(order.reference) as Record<string, any>;
    if (refundedAmountCovers(details, order.amount_ore, order.currency)) {
      const { error: applyError } = await admin.rpc('apply_boost_refund', {
        p_order_id: order.id,
        p_reference: order.reference,
        p_refunded_amount_ore: details.aggregate.refundedAmount.value,
        p_currency: order.currency,
        p_psp_reference: details.pspReference || null,
      });
      if (applyError) throw new PublicError(500, 'REFUND_STATE_ERROR', 'Refusjonen er bekreftet, men status må kontrolleres av administrator.');
      return jsonResponse({ order_id: order.id, status: 'refunded' }, 200, headers);
    }
    if (order.status !== 'captured' || !capturedAmountMatches(details, order.amount_ore, order.currency)) {
      throw new PublicError(409, 'NOT_CAPTURED', 'Bare en bekreftet captured betaling kan refunderes.');
    }

    const refund = await refundVippsPayment(order) as Record<string, any>;
    if (!refundedAmountCovers(refund, order.amount_ore, order.currency)) {
      throw new PublicError(502, 'REFUND_NOT_CONFIRMED', 'Vipps har ikke bekreftet refusjonen.');
    }
    const { error: applyError } = await admin.rpc('apply_boost_refund', {
      p_order_id: order.id,
      p_reference: order.reference,
      p_refunded_amount_ore: refund.aggregate.refundedAmount.value,
      p_currency: order.currency,
      p_psp_reference: refund.pspReference || details.pspReference || null,
    });
    if (applyError) throw new PublicError(500, 'REFUND_STATE_ERROR', 'Refusjonen er bekreftet, men status må kontrolleres av administrator.');
    await recordPaymentEvent(admin, order, 'REFUND_CONFIRMED', 'refund', {
      pspReference: refund.pspReference || details.pspReference,
      amountOre: refund.aggregate.refundedAmount.value,
      currency: order.currency,
    });
    return jsonResponse({ order_id: order.id, status: 'refunded' }, 200, headers);
  } catch (error) {
    return safeErrorResponse(error, headers);
  }
});
