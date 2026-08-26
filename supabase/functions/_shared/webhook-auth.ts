import { PublicError } from './http.ts';
import { buildVippsAuthorization, constantTimeEqual, sha256Base64 } from './webhook-signature.mjs';

export async function verifyVippsWebhook(request: Request, rawBody: string) {
  const secret = Deno.env.get('VIPPS_WEBHOOK_SECRET');
  if (!secret) throw new Error('Mangler VIPPS_WEBHOOK_SECRET.');
  const date = request.headers.get('x-ms-date');
  const contentHash = request.headers.get('x-ms-content-sha256');
  const host = request.headers.get('host') || new URL(request.url).host;
  const authorization = request.headers.get('authorization');
  if (!date || !contentHash || !host || !authorization) {
    throw new PublicError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Ugyldig webhook-signatur.');
  }

  const eventTime = Date.parse(date);
  if (!Number.isFinite(eventTime) || Math.abs(Date.now() - eventTime) > 5 * 60 * 1000) {
    throw new PublicError(401, 'STALE_WEBHOOK', 'Webhook-tidspunktet er ugyldig.');
  }

  const calculatedHash = await sha256Base64(rawBody);
  if (!constantTimeEqual(calculatedHash, contentHash)) {
    throw new PublicError(401, 'INVALID_WEBHOOK_CONTENT', 'Ugyldig webhook-signatur.');
  }

  const url = new URL(request.url);
  const expected = await buildVippsAuthorization({
    secret,
    pathAndQuery: `${url.pathname}${url.search}`,
    date,
    host,
    contentHash,
  });
  if (!constantTimeEqual(expected, authorization)) {
    throw new PublicError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Ugyldig webhook-signatur.');
  }
}
