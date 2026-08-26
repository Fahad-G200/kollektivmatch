import assert from 'node:assert/strict';
import {
  amountMatches,
  authorizedAmountMatches,
  calculateBoostEndMs,
  capturedAmountMatches,
  refundedAmountCovers,
  safePaymentStatus,
} from '../supabase/functions/_shared/payment-rules.mjs';

assert.equal(amountMatches({ value: 4900, currency: 'NOK' }, 4900), true);
assert.equal(amountMatches({ value: 4901, currency: 'NOK' }, 4900), false, 'Manipulert pris må avvises');
assert.equal(amountMatches({ value: 4900, currency: 'EUR' }, 4900), false, 'Feil valuta må avvises');

const authorized = { aggregate: { authorizedAmount: { value: 9900, currency: 'NOK' }, capturedAmount: { value: 0, currency: 'NOK' } } };
assert.equal(authorizedAmountMatches(authorized, 9900), true);
assert.equal(capturedAmountMatches(authorized, 9900), false, 'AUTHORIZED alene er ikke ferdig betaling');

const captured = { aggregate: { capturedAmount: { value: 9900, currency: 'NOK' } } };
assert.equal(capturedAmountMatches(captured, 9900), true);
assert.equal(capturedAmountMatches(captured, 4900), false);

const refunded = { aggregate: { refundedAmount: { value: 9900, currency: 'NOK' } } };
assert.equal(refundedAmountCovers(refunded, 9900), true);
assert.equal(refundedAmountCovers(refunded, 10000), false);

const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 7, 23);
assert.equal(calculateBoostEndMs(now, null, 7), now + 7 * day);
assert.equal(calculateBoostEndMs(now, now + 10 * day, 7), now + 17 * day, 'Ny periode skal legges til gjenværende tid');

assert.equal(safePaymentStatus('captured'), 'captured');
assert.equal(safePaymentStatus('hacked'), 'pending');

console.log('Betalingsregler: 12 tester besto.');

