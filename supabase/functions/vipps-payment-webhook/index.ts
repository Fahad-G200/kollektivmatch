import { PublicError, jsonResponse, readTextBody, safeErrorResponse } from '../_shared/http.ts';
import { reconcileBoostOrder, recordPaymentEvent } from '../_shared/reconcile.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { getVippsConfig } from '../_shared/vipps.ts';
import { verifyVippsWebhook } from '../_shared/webhook-auth.ts';

Deno.serve(async (request) => {
  try {
    if (request.method !== 'POST') throw new PublicError(405, 'METHOD_NOT_ALLOWED', 'Metoden er ikke tillatt.');
    const rawBody = await readTextBody(request, 256 * 1024);
    await verifyVippsWebhook(request, rawBody);

    let event: Record<string, any>;
    try {
      event = JSON.parse(rawBody);
    } catch {
      throw new PublicError(400, 'INVALID_JSON', 'Ugyldig webhook-innhold.');
    }
    const reference = typeof event.reference === 'string' ? event.reference : '';
    const eventName = String(event.name || event.eventName || '').toUpperCase();
    if (!/^KM-[0-9a-f]{32}$/.test(reference) || !eventName) {
      throw new PublicError(400, 'INVALID_WEBHOOK', 'Webhooken mangler gyldig referanse eller hendelse.');
    }
    if (String(event.msn || '') !== getVippsConfig().msn) {
      throw new PublicError(401, 'MSN_MISMATCH', 'Webhooken tilhører ikke denne salgsenheten.');
    }

    const admin = serviceClient();
    const { data: order, error } = await admin.from('boost_orders').select('*')
      .eq('reference', reference).eq('payment_provider', 'vipps').single();
    if (error || !order) throw new PublicError(404, 'ORDER_NOT_FOUND', 'Betalingsordren finnes ikke.');
    if (event.amount && (event.amount.value !== order.amount_ore || event.amount.currency !== order.currency)) {
      throw new PublicError(409, 'PAYMENT_MISMATCH', 'Webhookens beløp stemmer ikke med ordren.');
    }

    await recordPaymentEvent(admin, order, eventName, 'webhook', {
      eventKey: [reference, eventName, event.pspReference || '', event.timestamp || '', event.idempotencyKey || ''].join('|'),
      pspReference: event.pspReference,
      amountOre: event.amount?.value,
      currency: event.amount?.currency,
      eventAt: event.timestamp,
    });

    const supported = new Set(['AUTHORIZED','CAPTURED','ABORTED','EXPIRED','CANCELLED','REFUNDED','TERMINATED']);
    if (supported.has(eventName)) await reconcileBoostOrder(admin, order, 'webhook');
    return jsonResponse({ received: true });
  } catch (error) {
    return safeErrorResponse(error);
  }
});
