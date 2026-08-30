import { PublicError, UUID_PATTERN, jsonResponse, readTextBody, safeErrorResponse } from '../_shared/http.ts';
import { recordPaymentEvent } from '../_shared/reconcile.ts';
import { reconcileStripeOrder, reconcileStripeRefund } from '../_shared/stripe-reconcile.ts';
import { getStripeConfig, verifyStripeWebhook } from '../_shared/stripe.ts';
import { serviceClient } from '../_shared/supabase.ts';

Deno.serve(async (request) => {
  try {
    if (request.method !== 'POST') throw new PublicError(405, 'METHOD_NOT_ALLOWED', 'Metoden er ikke tillatt.');
    const rawBody = await readTextBody(request, 256 * 1024);
    await verifyStripeWebhook(request, rawBody);

    let event: Record<string, any>;
    try {
      event = JSON.parse(rawBody);
    } catch {
      throw new PublicError(400, 'INVALID_JSON', 'Ugyldig webhook-innhold.');
    }
    const supported = new Set([
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed',
      'checkout.session.expired',
      'charge.refunded',
    ]);
    if (!supported.has(event.type)) return jsonResponse({ received: true });
    const config = getStripeConfig();
    if (Boolean(event.livemode) !== (config.environment === 'production')) {
      throw new PublicError(401, 'PAYMENT_ENVIRONMENT_MISMATCH', 'Webhooken tilhører feil betalingsmiljø.');
    }

    const admin = serviceClient();
    if (event.type === 'charge.refunded') {
      const charge = event.data?.object;
      const paymentIntent = typeof charge?.payment_intent === 'string' ? charge.payment_intent : '';
      if (!/^pi_[A-Za-z0-9_]{8,240}$/.test(paymentIntent)) {
        throw new PublicError(400, 'INVALID_WEBHOOK', 'Webhooken mangler gyldig betalingsreferanse.');
      }
      const { data: order, error } = await admin.from('boost_orders').select('*')
        .eq('payment_provider', 'stripe').eq('provider_payment_id', paymentIntent).single();
      if (error || !order) throw new PublicError(404, 'ORDER_NOT_FOUND', 'Betalingsordren finnes ikke.');
      await recordPaymentEvent(admin, order, event.type, 'webhook', {
        eventKey: `stripe|${event.id}|${event.type}`,
        pspReference: typeof charge.id === 'string' ? charge.id : null,
        amountOre: Number.isInteger(charge.amount_refunded) ? charge.amount_refunded : null,
        currency: typeof charge.currency === 'string' ? charge.currency.toUpperCase() : null,
        eventAt: new Date(Number(event.created || 0) * 1000).toISOString(),
      });
      await reconcileStripeRefund(admin, order, charge);
      return jsonResponse({ received: true });
    }

    const session = event.data?.object;
    const orderId = typeof session?.metadata?.order_id === 'string' ? session.metadata.order_id : '';
    if (!UUID_PATTERN.test(orderId) || typeof session?.id !== 'string') {
      throw new PublicError(400, 'INVALID_WEBHOOK', 'Webhooken mangler gyldig ordre eller betalingssesjon.');
    }
    const { data: order, error } = await admin.from('boost_orders').select('*')
      .eq('id', orderId).eq('payment_provider', 'stripe').single();
    if (error || !order) throw new PublicError(404, 'ORDER_NOT_FOUND', 'Betalingsordren finnes ikke.');
    if (order.provider_session_id !== session.id) {
      throw new PublicError(409, 'PAYMENT_MISMATCH', 'Betalingssesjonen stemmer ikke med ordren.');
    }

    await recordPaymentEvent(admin, order, event.type, 'webhook', {
      eventKey: `stripe|${event.id}|${event.type}`,
      pspReference: session.id,
      amountOre: Number.isInteger(session.amount_total) ? session.amount_total : null,
      currency: typeof session.currency === 'string' ? session.currency.toUpperCase() : null,
      eventAt: new Date(Number(event.created || 0) * 1000).toISOString(),
    });

    await reconcileStripeOrder(admin, order, 'webhook', session);
    if (event.type === 'checkout.session.async_payment_failed') {
      await admin.rpc('mark_boost_order_status', {
        p_order_id: order.id,
        p_status: 'failed',
        p_safe_status_code: 'STRIPE_ASYNC_PAYMENT_FAILED',
        p_psp_reference: null,
      });
    }
    return jsonResponse({ received: true });
  } catch (error) {
    return safeErrorResponse(error);
  }
});
