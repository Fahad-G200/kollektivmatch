import { corsHeaders, handlePreflight, requireAllowedOrigin } from '../_shared/cors.ts';
import { PublicError, UUID_PATTERN, jsonResponse, readJsonObject, safeErrorResponse } from '../_shared/http.ts';
import { reconcileBoostOrder } from '../_shared/reconcile.ts';
import { reconcileStripeOrder } from '../_shared/stripe-reconcile.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';
import { safePaymentStatus } from '../_shared/payment-rules.mjs';

function safeOrder(order: Record<string, any>) {
  return {
    id: order.id,
    reference: order.reference,
    listing_id: order.listing_id,
    listing_title: order.listing_title,
    product_id: order.product_id,
    product_name: order.product_name,
    duration_days: order.duration_days,
    amount_ore: order.amount_ore,
    currency: order.currency,
    status: safePaymentStatus(order.status),
    created_at: order.created_at,
    authorized_at: order.authorized_at,
    captured_at: order.captured_at,
    refunded_at: order.refunded_at,
    boost_start_at: order.boost_start_at,
    boost_end_at: order.boost_end_at,
    payment_provider: order.payment_provider || 'vipps',
  };
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  try {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    if (request.method !== 'POST') throw new PublicError(405, 'METHOD_NOT_ALLOWED', 'Metoden er ikke tillatt.');
    requireAllowedOrigin(request);
    const { user } = await requireUser(request);
    const body = await readJsonObject(request);
    const orderId = typeof body.order_id === 'string' ? body.order_id : '';
    if (!UUID_PATTERN.test(orderId)) throw new PublicError(400, 'INVALID_ORDER_ID', 'Ugyldig ordrenummer.');

    const admin = serviceClient();
    const { data, error } = await admin.from('boost_orders').select('*')
      .eq('id', orderId).eq('user_id', user.id).single();
    if (error || !data) throw new PublicError(404, 'ORDER_NOT_FOUND', 'Betalingsordren finnes ikke.');

    let order = data;
    if (order.status === 'pending' || order.status === 'authorized') {
      order = order.payment_provider === 'stripe'
        ? await reconcileStripeOrder(admin, order, 'poll')
        : await reconcileBoostOrder(admin, order, 'poll');
    }
    return jsonResponse({ order: safeOrder(order) }, 200, headers);
  } catch (error) {
    return safeErrorResponse(error, headers);
  }
});
