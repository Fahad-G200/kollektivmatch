import { supabase } from './supabase-config.js';
import { showToast } from './ui.js';

const loadingState = document.getElementById('loading-state');
const invalidState = document.getElementById('invalid-state');
const resetForm = document.getElementById('reset-form');
const successState = document.getElementById('success-state');
const query = new URLSearchParams(window.location.search);
const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));

function clearSensitiveUrl() {
  history.replaceState(null, '', window.location.pathname);
}

function showForm() {
  loadingState.classList.add('hidden');
  invalidState.classList.add('hidden');
  resetForm.classList.remove('hidden');
}

function showInvalid() {
  loadingState.classList.add('hidden');
  resetForm.classList.add('hidden');
  invalidState.classList.remove('hidden');
}

async function establishRecoverySession() {
  if (query.get('error') || fragment.get('error') || query.get('error_code') || fragment.get('error_code')) {
    clearSensitiveUrl();
    showInvalid();
    return;
  }

  let result;
  if (query.get('code')) {
    result = await supabase.auth.exchangeCodeForSession(query.get('code'));
  } else if (query.get('token_hash')) {
    result = await supabase.auth.verifyOtp({ token_hash: query.get('token_hash'), type: 'recovery' });
  } else if (fragment.get('access_token') && fragment.get('refresh_token')) {
    result = await supabase.auth.setSession({
      access_token: fragment.get('access_token'),
      refresh_token: fragment.get('refresh_token'),
    });
  } else {
    // En vanlig aktiv innloggingsokt er ikke bevis pa at denne siden ble apnet
    // fra en recovery-lenke. Passordbyttet krever derfor en kode, token_hash
    // eller eksplisitte recovery-tokens i selve innkommende lenken.
    clearSensitiveUrl();
    showInvalid();
    return;
  }

  clearSensitiveUrl();
  if (result.error || !result.data?.session) {
    if (result.error) console.error('Ugyldig recovery-lenke:', result.error.message);
    showInvalid();
    return;
  }
  showForm();
}

resetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('reset-submit-btn');
  const password = event.target.password.value;
  const passwordConfirm = event.target.passwordConfirm.value;

  if (password.length < 6) {
    showToast('Passordet må være minst 6 tegn.', 'error');
    return;
  }

  if (password !== passwordConfirm) {
    showToast('Passordene er ikke like.', 'error');
    return;
  }

  button.disabled = true;
  button.textContent = 'Lagrer...';
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error('Kunne ikke oppdatere passord:', error.message);
    showToast('Kunne ikke oppdatere passordet. Be om en ny lenke og prøv igjen.', 'error');
    button.disabled = false;
    button.textContent = 'Lagre nytt passord';
    return;
  }

  await supabase.auth.signOut();
  resetForm.classList.add('hidden');
  successState.classList.remove('hidden');
});

establishRecoverySession();
