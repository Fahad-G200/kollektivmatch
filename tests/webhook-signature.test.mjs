import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  buildVippsAuthorization,
  constantTimeEqual,
  sha256Base64,
} from '../supabase/functions/_shared/webhook-signature.mjs';

// Offisiell Vipps MobilePay-eksempelverdi fra webhook-auth-dokumentasjonen.
const secret = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
const content = '{"some-unique-content":"ee6e441b-cc4a-46f8-895d-a5af79bcc233/hello-world"}';
const contentHash = 'lNlsp1XA03N34HrQsVzPgJKtC+r7l/RBF4V3JQUWMj4=';
const date = 'Thu, 30 Mar 2023 08:38:32 GMT';
const host = 'webhook.site';
const pathAndQuery = '/e2cee29b-012e-4f1d-8ef4-e95fd74a7a63';
const signedString = `POST\n${pathAndQuery}\n${date};${host};${contentHash}`;
const expectedAuthorization = `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${createHmac('sha256', secret).update(signedString).digest('base64')}`;

assert.equal(await sha256Base64(content), contentHash);
assert.equal(await buildVippsAuthorization({
  secret,
  pathAndQuery,
  date,
  host,
  contentHash,
}), expectedAuthorization);
assert.equal(constantTimeEqual(expectedAuthorization, expectedAuthorization), true);
assert.equal(constantTimeEqual(expectedAuthorization, `${expectedAuthorization}x`), false);

console.log('Vipps webhook-signatur: 4 tester besto.');
