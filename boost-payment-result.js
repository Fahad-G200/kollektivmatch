import { supabase } from './supabase-config.js';
import { rememberReturnTo } from './auth.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const orderId = new URLSearchParams(window.location.search).get('order');
const terminalStatuses = new Set(['captured', 'cancelled', 'aborted', 'expired', 'failed', 'refunded']);
const labels = {
  pending: 'Venter på betaling', authorized: 'Autorisert – capture kontrolleres', captured: 'Betalt og levert',
  cancelled: 'Kansellert', aborted: 'Avbrutt', expired: 'Utløpt', failed: 'Mislykket', refunded: 'Refundert',
};
let attempts = 0;
let polling = false;

function formatNok(value) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', minimumFractionDigits: 0 }).format(Number(value || 0) / 100);
}

function formatDate(value, withTime = false) {
  if (!value) return 'Ikke oppgitt';
  return new Date(value).toLocaleString('nb-NO', withTime
    ? { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'long', year: 'numeric' });
}

function setState(kind, title, message) {
  const icon = document.getElementById('result-icon');
  icon.className = `result-icon${kind === 'success' ? ' is-success' : kind === 'error' ? ' is-error' : ''}`;
  icon.textContent = kind === 'success' ? '✓' : kind === 'error' ? '!' : '···';
  document.getElementById('result-title').textContent = title;
  document.getElementById('result-message').textContent = message;
}

function renderSummary(order) {
  document.getElementById('result-summary').classList.remove('hidden');
  document.getElementById('summary-reference').textContent = order.reference;
  document.getElementById('summary-status').textContent = labels[order.status] || 'Kontrolleres';
  document.getElementById('summary-listing').textContent = order.listing_title;
  document.getElementById('summary-product').textContent = `${order.product_name} (${order.duration_days} dager)`;
  document.getElementById('summary-total').textContent = `${formatNok(order.amount_ore)} ${order.currency}`;
  document.getElementById('summary-date').textContent = order.captured_at ? formatDate(order.captured_at, true) : 'Ikke captured';
  document.getElementById('summary-until').textContent = order.boost_end_at ? formatDate(order.boost_end_at, true) : 'Ikke aktivert';
}

function renderOrder(order) {
  renderSummary(order);
  if (order.status === 'captured') {
    setState('success', 'Betalingen er bekreftet', 'Annonsen er nå fremhevet. Bekreftelsen under er en betalingsoversikt, ikke en formell faktura.');
  } else if (order.status === 'refunded') {
    setState('error', 'Betalingen er refundert', 'Refusjonen er bekreftet, og den kjøpte fremhevingsperioden er trukket tilbake.');
  } else if (['cancelled', 'aborted'].includes(order.status)) {
    setState('error', 'Betalingen ble avbrutt', 'Du er ikke belastet med en levert fremheving, og annonsen er ikke aktivert av denne ordren.');
  } else if (order.status === 'expired') {
    setState('error', 'Betalingen utløp', 'Betalingsfristen gikk ut. Annonsen ble ikke fremhevet.');
  } else if (order.status === 'failed') {
    setState('error', 'Betalingen kunne ikke fullføres', 'Annonsen ble ikke fremhevet. Prøv igjen fra Min side eller kontakt kundestøtte.');
  } else {
    setState('loading', 'Kontrollerer betalingen …', order.status === 'authorized'
      ? 'Beløpet er autorisert, men vises ikke som betalt før capture er bekreftet.'
      : 'Betalingsleverandøren har ikke bekreftet en ferdig betaling ennå.');
  }
}

async function checkStatus() {
  if (polling) return;
  polling = true;
  document.getElementById('retry-status').classList.add('hidden');
  const { data, error } = await supabase.functions.invoke('get-boost-payment-status', { body: { order_id: orderId } });
  polling = false;
  if (error || !data?.order) {
    console.error('Kunne ikke kontrollere betalingsstatus:', error?.message || data?.error || 'UNKNOWN');
    setState('error', 'Kunne ikke kontrollere status', data?.message || 'Prøv igjen. Hvis feilen fortsetter, se betalingsoversikten på Min side.');
    document.getElementById('retry-status').classList.remove('hidden');
    return;
  }
  attempts += 1;
  renderOrder(data.order);
  if (!terminalStatuses.has(data.order.status) && attempts < 12) {
    window.setTimeout(checkStatus, 5000);
  } else if (!terminalStatuses.has(data.order.status)) {
    document.getElementById('retry-status').classList.remove('hidden');
    document.getElementById('result-message').textContent = 'Kontrollen tar lenger tid enn normalt. Prøv på nytt, eller gå til Min side og kontroller senere.';
  }
}

document.getElementById('retry-status').addEventListener('click', () => {
  attempts = 0;
  setState('loading', 'Kontrollerer betalingen …', 'Vi henter en ny, serverbekreftet status.');
  checkStatus();
});

async function init() {
  if (!UUID_PATTERN.test(orderId || '')) {
    setState('error', 'Ugyldig ordrenummer', 'Gå tilbake til Min side for å se betalingsoversikten din.');
    return;
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    rememberReturnTo(window.location.href);
    const target = new URL('./index.html', document.baseURI);
    target.searchParams.set('auth', 'login');
    target.searchParams.set('returnTo', window.location.href);
    window.location.replace(target.toString());
    return;
  }
  checkStatus();
}

init();
