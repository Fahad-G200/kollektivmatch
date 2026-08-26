export const TERMINAL_STATUSES = new Set(['captured', 'cancelled', 'aborted', 'expired', 'failed', 'refunded']);

export function amountMatches(amount, expectedValue, expectedCurrency = 'NOK') {
  return Boolean(amount)
    && Number.isInteger(amount.value)
    && amount.value === expectedValue
    && amount.currency === expectedCurrency;
}

export function capturedAmountMatches(details, expectedValue, expectedCurrency = 'NOK') {
  return amountMatches(details?.aggregate?.capturedAmount, expectedValue, expectedCurrency);
}

export function authorizedAmountMatches(details, expectedValue, expectedCurrency = 'NOK') {
  return amountMatches(details?.aggregate?.authorizedAmount, expectedValue, expectedCurrency);
}

export function refundedAmountCovers(details, expectedValue, expectedCurrency = 'NOK') {
  const amount = details?.aggregate?.refundedAmount;
  return Boolean(amount)
    && Number.isInteger(amount.value)
    && amount.value >= expectedValue
    && amount.currency === expectedCurrency;
}

export function safePaymentStatus(status) {
  return ['pending','authorized','captured','cancelled','aborted','expired','failed','refunded'].includes(status)
    ? status
    : 'pending';
}

export function calculateBoostEndMs(nowMs, currentEndMs, durationDays) {
  if (!Number.isFinite(nowMs) || !Number.isInteger(durationDays) || durationDays < 1) {
    throw new TypeError('Ugyldige fremhevingsverdier');
  }
  const base = Number.isFinite(currentEndMs) && currentEndMs > nowMs ? currentEndMs : nowMs;
  return base + durationDays * 24 * 60 * 60 * 1000;
}
