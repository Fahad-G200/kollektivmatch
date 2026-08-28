// supabase-config.js
//
// Oppretter én delt Supabase-klient som resten av appen importerer.
// Hent URL og anon key fra: Supabase Dashboard → Settings → API.
// Den "anon" nøkkelen er trygg å ha i frontend-koden – tilgangen
// styres uansett av RLS-policyene i database/schema.sql.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://wsfnnaiytweaarncewcr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zkVUCyW9fmJ9nEEVFJzCeg_UliKpxKl';

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

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // PKCE keeps reusable credentials out of callback URLs. Session storage
    // also limits how long a stolen browser profile can expose a live session.
    flowType: 'pkce',
    detectSessionInUrl: false,
    persistSession: true,
    storage: authStorage,
    storageKey: 'km-auth-session',
  },
});
