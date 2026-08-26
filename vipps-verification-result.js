import { supabase } from './supabase-config.js';
import { rememberReturnTo } from './auth.js';

const resultHint = new URLSearchParams(window.location.search).get('result');
const icon = document.getElementById('verification-result-icon');
const title = document.getElementById('verification-result-title');
const message = document.getElementById('verification-result-message');
const details = document.getElementById('verification-result-details');
const retry = document.getElementById('verification-retry');

function setState(kind, heading, text) {
  icon.className = `result-icon${kind === 'success' ? ' is-success' : kind === 'error' ? ' is-error' : ''}`;
  icon.textContent = kind === 'success' ? '✓' : kind === 'error' ? '!' : '···';
  title.textContent = heading;
  message.textContent = text;
  retry.classList.toggle('hidden', kind !== 'error');
  details.classList.toggle('hidden', kind !== 'success');
}

async function checkProfile() {
  setState('loading', 'Kontrollerer Vipps-koblingen …', 'Vi kontrollerer status direkte mot profilen din.');
  const { data, error } = await supabase.rpc('get_my_profile');
  const profile = Array.isArray(data) ? data[0] : data;
  if (!error && profile?.vipps_verified === true) {
    setState('success', 'Kontoen din er bekreftet', 'Vipps-kontoen ble koblet sikkert til den innloggede KollektivMatch-kontoen.');
    return;
  }
  if (error) console.error('Kunne ikke kontrollere Vipps-verifisering:', error.message);
  if (resultHint === 'cancelled') {
    setState('error', 'Verifiseringen ble avbrutt', 'Ingen kobling ble lagret. Du kan starte på nytt fra profilen din når du vil.');
  } else {
    setState('error', 'Verifiseringen ble ikke fullført', 'Profilen er ikke merket som Vipps-bekreftet. Prøv igjen fra Min side.');
  }
}

retry.addEventListener('click', checkProfile);

async function init() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    rememberReturnTo(window.location.href);
    const target = new URL('./index.html', document.baseURI);
    target.searchParams.set('auth', 'login');
    target.searchParams.set('returnTo', window.location.href);
    window.location.replace(target.toString());
    return;
  }
  checkProfile();
}

init();

