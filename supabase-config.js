// supabase-config.js
//
// Oppretter én delt Supabase-klient som resten av appen importerer.
// Hent URL og anon key fra: Supabase Dashboard → Settings → API.
// Den "anon" nøkkelen er trygg å ha i frontend-koden – tilgangen
// styres uansett av RLS-policyene i database/schema.sql.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';

const SUPABASE_URL = 'https://wsfnnaiytweaarncewcr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zkVUCyW9fmJ9nEEVFJzCeg_UliKpxKl';

// Google krever ekstern OAuth-konfigurasjon og er skjult til den er satt opp.
// Se README.md før funksjonen aktiveres.
export const ENABLE_GOOGLE_AUTH = false;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
