// supabase-config.js
//
// Verdiene settes av scripts/prepare-public.mjs under bygging. Dermed ligger
// verken prosjekt-ID eller nøkkel i Git-historikken. Frontend bruker bare en
// publishable key; datatilgang styres fortsatt av RLS-policyene i databasen.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = __SUPABASE_URL__;
const SUPABASE_PUBLISHABLE_KEY = __SUPABASE_PUBLISHABLE_KEY__;

// Google krever ekstern OAuth-konfigurasjon og er skjult til den er satt opp.
// Se README.md før funksjonen aktiveres.
export const ENABLE_GOOGLE_AUTH = false;

// PKCE-bekreftelser kan åpnes fra e-post i en ny fane. Bare de kortlivede,
// engangs kodeverifikatorene deles derfor via localStorage; selve innloggings-
// økten blir værende i sessionStorage og forsvinner når fanen lukkes.
const authStorage = {
  getItem(key) {
    return (key.includes('code-verifier') ? window.localStorage : window.sessionStorage).getItem(key);
  },
  setItem(key, value) {
    return (key.includes('code-verifier') ? window.localStorage : window.sessionStorage).setItem(key, value);
  },
  removeItem(key) {
    return (key.includes('code-verifier') ? window.localStorage : window.sessionStorage).removeItem(key);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: false,
    persistSession: true,
    storage: authStorage,
    storageKey: 'km-auth-session',
  },
});
