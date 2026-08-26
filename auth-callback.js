import { supabase } from './supabase-config.js';
import { getSafeReturnTo, resendConfirmation } from './auth.js';

const loading = document.getElementById('callback-loading');
const success = document.getElementById('callback-success');
const errorState = document.getElementById('callback-error');
const errorMessage = document.getElementById('callback-error-message');
const continueLink = document.getElementById('continue-link');
const resendForm = document.getElementById('resend-form');
const resendButton = document.getElementById('resend-btn');
const query = new URLSearchParams(window.location.search);
const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const returnTo = getSafeReturnTo(query.get('returnTo'), new URL('./index.html', document.baseURI).toString());
let cooldownTimer = null;

function clearSensitiveUrl() {
  history.replaceState(null, '', window.location.pathname);
}

function showError(message = 'Lenken kan være utløpt eller allerede brukt. Be om en ny e-post og prøv igjen.') {
  loading.classList.add('hidden');
  success.classList.add('hidden');
  errorState.classList.remove('hidden');
  errorMessage.textContent = message;
}

function showSuccess() {
  loading.classList.add('hidden');
  errorState.classList.add('hidden');
  success.classList.remove('hidden');
  continueLink.href = returnTo;
  setTimeout(() => window.location.assign(returnTo), 1800);
}

async function completeAuth() {
  const authError = query.get('error') || fragment.get('error');
  if (authError || query.get('error_code') || fragment.get('error_code')) {
    clearSensitiveUrl();
    showError();
    return;
  }

  let result = null;
  if (query.get('code')) {
    result = await supabase.auth.exchangeCodeForSession(query.get('code'));
  } else if (query.get('token_hash')) {
    const allowedTypes = ['signup', 'email', 'magiclink', 'invite', 'recovery', 'email_change'];
    const type = allowedTypes.includes(query.get('type')) ? query.get('type') : 'signup';
    result = await supabase.auth.verifyOtp({ token_hash: query.get('token_hash'), type });
  } else if (fragment.get('access_token') && fragment.get('refresh_token')) {
    result = await supabase.auth.setSession({
      access_token: fragment.get('access_token'),
      refresh_token: fragment.get('refresh_token'),
    });
  } else {
    result = await supabase.auth.getSession();
    if (!result.data?.session) result = { error: new Error('Ingen gyldig økt') };
  }

  clearSensitiveUrl();
  if (result.error) {
    console.error('Auth-callback feilet:', result.error.message);
    showError();
    return;
  }
  showSuccess();
}

function startCooldown(seconds = 60) {
  clearInterval(cooldownTimer);
  let remaining = seconds;
  resendButton.disabled = true;
  const tick = () => {
    if (remaining <= 0) {
      resendButton.disabled = false;
      resendButton.textContent = 'Send bekreftelses-e-post på nytt';
      clearInterval(cooldownTimer);
      return;
    }
    resendButton.textContent = `Prøv igjen om ${remaining} sek`;
    remaining -= 1;
  };
  tick();
  cooldownTimer = setInterval(tick, 1000);
}

resendForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (resendButton.disabled) return;
  const sent = await resendConfirmation(event.target.email.value.trim());
  if (sent) startCooldown();
});

completeAuth();
