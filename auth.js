// auth.js
//
// All Supabase Auth-logikk samlet på ett sted. UI-koden i app.js
// kaller kun disse funksjonene og trenger ikke vite noe om Supabase.

import { supabase } from './supabase-config.js';
import { showToast, closeModal } from './ui.js';

const RETURN_TO_KEY = 'kmReturnTo';

// Kjente Supabase/Postgres-feilmeldinger oversatt til noe en bruker
// faktisk forstår. Alt annet vises som en generisk, vennlig melding –
// aldri den rå tekniske feilteksten – men logges til konsollen slik at
// vi (utviklerne) fortsatt kan feilsøke.
const AUTH_ERROR_MESSAGES = {
  'Invalid login credentials': 'Feil e-post eller passord.',
  'Email not confirmed': 'E-posten din er ikke bekreftet enda. Sjekk innboksen (og søppelpost) for bekreftelseslenken.',
  'User already registered': 'Denne e-postadressen er allerede registrert. Prøv å logge inn i stedet.',
  'Password should be at least 6 characters': 'Passordet oppfyller ikke minimumskravet.',
};

function friendlyAuthError(error, fallback = 'Noe gikk galt. Prøv igjen.') {
  console.error('Auth-feil:', error?.message);
  return AUTH_ERROR_MESSAGES[error?.message] || fallback;
}

export function getSafeReturnTo(value, fallback = 'index.html') {
  if (!value) return fallback;
  try {
    const target = new URL(value, document.baseURI);
    if (target.origin !== window.location.origin) return fallback;
    if (!['http:', 'https:'].includes(target.protocol)) return fallback;
    return target.href;
  } catch {
    return fallback;
  }
}

export function rememberReturnTo(value) {
  const safe = getSafeReturnTo(value, '');
  if (safe) sessionStorage.setItem(RETURN_TO_KEY, safe);
}

export function consumeReturnTo(fallback = '') {
  const saved = sessionStorage.getItem(RETURN_TO_KEY);
  sessionStorage.removeItem(RETURN_TO_KEY);
  return getSafeReturnTo(saved, fallback);
}

function callbackUrl() {
  const url = new URL('./auth-callback.html', document.baseURI);
  url.searchParams.set('flow', 'auth');
  const returnTo = sessionStorage.getItem(RETURN_TO_KEY);
  if (returnTo) url.searchParams.set('returnTo', getSafeReturnTo(returnTo));
  return url.toString();
}

/**
 * @returns {Promise<{data, needsConfirmation: boolean}|null>} needsConfirmation
 * er true når Supabase krever at brukeren bekrefter e-posten før innlogging
 * (dvs. ingen session ble opprettet med én gang) – appen skal da IKKE late
 * som brukeren er logget inn.
 */
export async function signUp(email, password, fullName, role, profileExtras = {}) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: callbackUrl(),
      data: {
        full_name: fullName,
        role,
        occupation: profileExtras.occupation,
        institution: profileExtras.institution,
        income_status: profileExtras.income_status,
        monthly_budget_max: profileExtras.monthly_budget_max,
        priority_tags: Array.isArray(profileExtras.priority_tags) ? profileExtras.priority_tags : [],
        terms_accepted_at: profileExtras.terms_accepted_at,
        terms_version: profileExtras.terms_version,
      },
    },
  });

  if (error) {
    showToast(friendlyAuthError(error), 'error');
    return null;
  }

  const needsConfirmation = !data.session;

  if (needsConfirmation) {
    showToast('Sjekk e-posten din for å bekrefte kontoen.', 'success');
  } else {
    showToast('Kontoen er opprettet, og du er logget inn.', 'success');
    closeModal('auth-modal');
  }

  return { data, needsConfirmation };
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    showToast(friendlyAuthError(error, 'Kunne ikke logge inn. Prøv igjen.'), 'error');
    return null;
  }

  showToast('Du er logget inn.', 'success');
  closeModal('auth-modal');
  const returnTo = consumeReturnTo();
  if (returnTo) window.location.assign(returnTo);
  return data;
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: callbackUrl() },
  });

  if (error) {
    console.error('Google-innlogging feilet:', error.message);
    showToast('Google-innlogging er ikke satt opp enda av administrator.', 'error');
  }
  // Ved suksess sender Supabase brukeren til Google og tilbake automatisk –
  // ingenting mer å gjøre her.
}

/** Sender e-post for tilbakestilling av passord. Landingssiden er reset-password.html. */
export async function requestPasswordReset(email) {
  if (!email) {
    showToast('Skriv inn e-postadressen din over først.', 'error');
    return;
  }

  const redirectTo = new URL('./reset-password.html', document.baseURI).toString();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  if (error) {
    showToast(friendlyAuthError(error, 'Kunne ikke sende tilbakestillingslenke.'), 'error');
    return;
  }

  showToast('Sjekk e-posten din for en lenke til å tilbakestille passordet.', 'success');
}

export async function resendConfirmation(email) {
  if (!email) {
    showToast('Skriv inn e-postadressen din.', 'error');
    return false;
  }

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: callbackUrl() },
  });

  if (error) {
    showToast(friendlyAuthError(error, 'Kunne ikke sende e-posten på nytt. Prøv igjen senere.'), 'error');
    return false;
  }

  showToast('Ny bekreftelses-e-post er sendt.', 'success');
  return true;
}

export async function signOut() {
  await supabase.auth.signOut();
  showToast('Du er logget ut.', 'success');
}

/** Kjører callback(user) med én gang og hver gang auth-status endrer seg. */
export function onAuthChange(callback) {
  supabase.auth.getUser().then(({ data }) => callback(data?.user ?? null));
  supabase.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null));
}
