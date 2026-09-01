import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0';
import { PublicError } from './http.ts';
import { recordPaymentEvent } from './reconcile.ts';
import { getStripeCheckoutSession } from './stripe.ts';

type Order = Record<string, any> & {
  id: string;
  reference: string;
  amount_ore: number;
  currency: string;
  status: string;
  payment_provider: string;
  provider_session_id: string | null;
  provider_payment_id: string | null;
};

async function rpcOrThrow(client: SupabaseClient, name: string, params: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, params);
  if (error) {
    console.error('Stripe betalings-RPC feilet', { name, code: error.code });
    throw new PublicError(500, 'PAYMENT_STATE_ERROR', 'Betalingsstatusen kunne ikke oppdateres.');
  }
  return data as Order;
}

function assertStripeIdentity(order: Order, session: Record<string, any>) {
  if (
    order.payment_provider !== 'stripe'
    || session.id !== order.provider_session_id
    || session.client_reference_id !== order.id
    || session.metadata?.order_id !== order.id
    || session.metadata?.reference !== order.reference
    || session.amount_total !== order.amount_ore
    || String(session.currency || '').toUpperCase() !== order.currency
  ) {
    throw new PublicError(409, 'PAYMENT_MISMATCH', 'Betalingsdetaljene stemmer ikke med ordren.');
  }
}

export async function reconcileStripeOrder(
  client: SupabaseClient,
  order: Order,
  source: 'webhook' | 'poll',
  suppliedSession?: Record<string, any>,
) {
  if (!order.provider_session_id) return order;
  const session = suppliedSession || await getStripeCheckoutSession(order.provider_session_id);
  assertStripeIdentity(order, session);
  const paymentId = typeof session.payment_intent === 'string' ? session.payment_intent : null;

  if (session.payment_status === 'paid') {
    if (!paymentId) {
      throw new PublicError(409, 'PAYMENT_MISMATCH', 'Betalingsdetaljene stemmer ikke med ordren.');
    }
    const { error: paymentIdError } = await client.from('boost_orders')
      .update({ provider_payment_id: paymentId })
      .eq('id', order.id)
      .eq('payment_provider', 'stripe');
    if (paymentIdError) {
      console.error('Stripe PaymentIntent kunne ikke lagres', { code: paymentIdError.code });
      throw new PublicError(500, 'PAYMENT_STATE_ERROR', 'Betalingsstatusen kunne ikke oppdateres.');
    }
    const captured = await rpcOrThrow(client, 'apply_captured_boost', {
      p_order_id: order.id,
      p_reference: order.reference,
      p_amount_ore: order.amount_ore,
      p_currency: order.currency,
      p_psp_reference: null,
    });
    await recordPaymentEvent(client, order, 'PAYMENT_CONFIRMED', source, {
      eventKey: `stripe|${session.id}|paid`,
      pspReference: session.id,
      amountOre: order.amount_ore,
      currency: order.currency,
      safeStatusCode: 'STRIPE_PAID',
    });
    return captured;
  }

  const terminalStatus = session.status === 'expired' ? 'expired' : null;
  if (terminalStatus) {
    const marked = await rpcOrThrow(client, 'mark_boost_order_status', {
      p_order_id: order.id,
      p_status: terminalStatus,
      p_safe_status_code: 'STRIPE_EXPIRED',
      p_psp_reference: null,
    });
    await recordPaymentEvent(client, order, 'PAYMENT_EXPIRED', source, {
      eventKey: `stripe|${session.id}|expired`,
      pspReference: session.id,
      safeStatusCode: 'STRIPE_EXPIRED',
    });
    return marked;
  }

  return order;
}

export async function reconcileStripeRefund(
  client: SupabaseClient,
  order: Order,
  charge: Record<string, any>,
) {
  if (
    order.payment_provider !== 'stripe'
    || !order.provider_payment_id
    || charge.payment_intent !== order.provider_payment_id
    || charge.amount !== order.amount_ore
    || String(charge.currency || '').toUpperCase() !== order.currency
  ) {
    throw new PublicError(409, 'PAYMENT_MISMATCH', 'Refusjonsdetaljene stemmer ikke med ordren.');
  }
  if (charge.refunded !== true || !Number.isInteger(charge.amount_refunded)
      || charge.amount_refunded < order.amount_ore) {
    return order;
  }
  return await rpcOrThrow(client, 'apply_boost_refund', {
    p_order_id: order.id,
    p_reference: order.reference,
    p_refunded_amount_ore: charge.amount_refunded,
    p_currency: order.currency,
    p_psp_reference: null,
  });
}
