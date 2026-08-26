import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import { PublicError } from './http.ts';
import { captureVippsPayment, getVippsPayment } from './vipps.ts';
import {
  amountMatches,
  authorizedAmountMatches,
  capturedAmountMatches,
  refundedAmountCovers,
} from './payment-rules.mjs';

type Order = Record<string, any> & {
  id: string;
  reference: string;
  amount_ore: number;
  currency: string;
  status: string;
};

async function sha256Hex(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function rpcOrThrow(client: SupabaseClient, name: string, params: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, params);
  if (error) {
    console.error('Sikker betalings-RPC feilet', { name, code: error.code });
    throw new PublicError(500, 'PAYMENT_STATE_ERROR', 'Betalingsstatusen kunne ikke oppdateres.');
  }
  return data;
}

export async function recordPaymentEvent(
  client: SupabaseClient,
  order: Order,
  eventName: string,
  source: 'create' | 'webhook' | 'poll' | 'capture' | 'refund' | 'database',
  options: Record<string, any> = {},
) {
  const rawKey = options.eventKey || [
    order.reference,
    eventName,
    source,
    options.pspReference || '',
    options.eventAt || '',
    options.amountOre ?? '',
  ].join('|');
  const eventKey = await sha256Hex(rawKey);
  const { error } = await client.rpc('record_boost_payment_event', {
    p_order_id: order.id,
    p_event_key: eventKey,
    p_event_name: eventName,
    p_source: source,
    p_psp_reference: options.pspReference || null,
    p_amount_ore: Number.isInteger(options.amountOre) ? options.amountOre : null,
    p_currency: options.currency || null,
    p_safe_status_code: options.safeStatusCode || null,
    p_vipps_event_at: options.eventAt || null,
  });
  if (error) console.error('Kunne ikke lagre betalingshendelse', { code: error.code });
}

function assertPaymentIdentity(order: Order, details: Record<string, any>) {
  if (details.reference !== order.reference || !amountMatches(details.amount, order.amount_ore, order.currency)) {
    throw new PublicError(409, 'PAYMENT_MISMATCH', 'Betalingsdetaljene stemmer ikke med ordren.');
  }
}

async function freshOrder(client: SupabaseClient, orderId: string) {
  const { data, error } = await client.from('boost_orders').select('*').eq('id', orderId).single();
  if (error || !data) throw new PublicError(404, 'ORDER_NOT_FOUND', 'Betalingsordren finnes ikke.');
  return data as Order;
}

export async function reconcileBoostOrder(
  client: SupabaseClient,
  order: Order,
  source: 'webhook' | 'poll',
) {
  const details = await getVippsPayment(order.reference) as Record<string, any>;
  assertPaymentIdentity(order, details);
  const pspReference = typeof details.pspReference === 'string' ? details.pspReference : null;

  if (refundedAmountCovers(details, order.amount_ore, order.currency)) {
    const refunded = await rpcOrThrow(client, 'apply_boost_refund', {
      p_order_id: order.id,
      p_reference: order.reference,
      p_refunded_amount_ore: details.aggregate.refundedAmount.value,
      p_currency: order.currency,
      p_psp_reference: pspReference,
    });
    await recordPaymentEvent(client, order, 'REFUND_CONFIRMED', source, {
      pspReference,
      amountOre: details.aggregate.refundedAmount.value,
      currency: order.currency,
    });
    return refunded as Order;
  }

  if (capturedAmountMatches(details, order.amount_ore, order.currency)) {
    const captured = await rpcOrThrow(client, 'apply_captured_boost', {
      p_order_id: order.id,
      p_reference: order.reference,
      p_amount_ore: order.amount_ore,
      p_currency: order.currency,
      p_psp_reference: pspReference,
    });
    await recordPaymentEvent(client, order, 'CAPTURE_CONFIRMED', source, {
      pspReference,
      amountOre: order.amount_ore,
      currency: order.currency,
    });
    return captured as Order;
  }

  const state = String(details.state || '').toUpperCase();
  if (state === 'AUTHORIZED') {
    if (!authorizedAmountMatches(details, order.amount_ore, order.currency)) {
      throw new PublicError(409, 'AUTHORIZED_AMOUNT_MISMATCH', 'Det autoriserte beløpet stemmer ikke med ordren.');
    }
    await rpcOrThrow(client, 'mark_boost_order_status', {
      p_order_id: order.id,
      p_status: 'authorized',
      p_safe_status_code: 'AUTHORIZED_PENDING_CAPTURE',
      p_psp_reference: pspReference,
    });
    await recordPaymentEvent(client, order, 'AUTHORIZED', source, {
      pspReference,
      amountOre: order.amount_ore,
      currency: order.currency,
    });

    try {
      const capture = await captureVippsPayment(order) as Record<string, any>;
      if (!capturedAmountMatches(capture, order.amount_ore, order.currency)) {
        throw new PublicError(502, 'CAPTURE_NOT_CONFIRMED', 'Vipps har ikke bekreftet betalingen ennå.');
      }
      const captured = await rpcOrThrow(client, 'apply_captured_boost', {
        p_order_id: order.id,
        p_reference: order.reference,
        p_amount_ore: order.amount_ore,
        p_currency: order.currency,
        p_psp_reference: typeof capture.pspReference === 'string' ? capture.pspReference : pspReference,
      });
      await recordPaymentEvent(client, order, 'CAPTURE_CONFIRMED', 'capture', {
        pspReference,
        amountOre: order.amount_ore,
        currency: order.currency,
      });
      return captured as Order;
    } catch (error) {
      await recordPaymentEvent(client, order, 'CAPTURE_RETRY_REQUIRED', 'capture', {
        pspReference,
        safeStatusCode: 'CAPTURE_RETRY_REQUIRED',
      });
      if (source === 'webhook') throw error;
      return await freshOrder(client, order.id);
    }
  }

  const terminalMap: Record<string, string> = {
    ABORTED: 'aborted',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired',
    TERMINATED: 'failed',
  };
  if (terminalMap[state]) {
    const marked = await rpcOrThrow(client, 'mark_boost_order_status', {
      p_order_id: order.id,
      p_status: terminalMap[state],
      p_safe_status_code: `VIPPS_${state}`,
      p_psp_reference: pspReference,
    });
    await recordPaymentEvent(client, order, state, source, { pspReference, safeStatusCode: `VIPPS_${state}` });
    return marked as Order;
  }

  return await freshOrder(client, order.id);
}

