# KollektivMatch

[![Tester og bygg](https://github.com/Fahad-G200/kollektivmatch/actions/workflows/ci.yml/badge.svg)](https://github.com/Fahad-G200/kollektivmatch/actions/workflows/ci.yml)

Et selvstendig porteføljeprosjekt for å finne og annonsere kollektivrom. Jeg har
utviklet løsningen fra idé og brukerflyt til database, sikkerhet, integrasjoner,
automatiserte tester og produksjonsbygg.

## Kort fortalt

KollektivMatch lar boligsøkere filtrere annonser, sammenligne dokumenterte
preferanser og forstå hvorfor en bolig passer. Utleiere kan opprette annonser,
håndtere bilder og video og kommunisere med interesserte brukere. Løsningen er
bygget med vanlig HTML, CSS og JavaScript i frontend, mens Supabase leverer
innlogging, PostgreSQL, tilgangskontroll, fillagring og sanntidsmeldinger.

Prosjektet er en teknisk demonstrasjon og ikke en ferdig kommersiell tjeneste.
Juridiske virksomhetsopplysninger, produksjonsavtaler og enkelte eksterne
integrasjoner må ferdigstilles før reell lansering.

## Dette demonstrerer prosjektet

- **Webutvikling:** responsivt grensesnitt i HTML, Tailwind/CSS og modulær
  JavaScript, med en liten Next/Vinext-ramme for bygg og hosting.
- **Databaser og integrasjoner:** PostgreSQL, Supabase Auth, Row Level Security,
  Storage, Realtime, Edge Functions og dokumenterte migreringer.
- **Automatisering og kvalitet:** Git-basert arbeidsflyt, repeterbart bygg og 71
  automatiserte testresultater for blant annet brukerflyt, matching, betaling,
  personvern og sikkerhet.
- **Praktisk bruk av AI:** avgrensede bildeobservasjoner med strukturert output,
  kostnadsgrenser og tydelig kildevisning. Selve matchprosenten beregnes
  deterministisk i kode og overlates ikke til modellen.
- **Produkteierskap og problemløsning:** funksjoner er vurdert ut fra brukerbehov,
  personvern, feilsituasjoner og driftsrisiko, med tekniske valg forklart i et
  språk som også ikke-tekniske kan følge.

## Utvalgte funksjoner

- Forklarbar Smart Match med oppfylte, delvise og ukjente kriterier.
- Boligsøk, annonser, profiler, meldinger, rapportering og dataeksport.
- Bilde- og videohåndtering med validering og opplasting til brukerens mappe.
- Skolesøk via Kartverket og valgfrie kartkontroller via Google Maps.
- Serververifisert betalingsflyt for annonsefremheving med Stripe/Vipps-kode.
- Sikkerhetstiltak som PKCE, RLS, rate limits, sikre webhooks og private
  serverhemmeligheter.

## Teknisk oversikt

```text
Nettleser (HTML/CSS/JavaScript)
          │
          ├── Supabase Auth og sikre sesjoner
          ├── PostgreSQL med RLS og RPC-er
          ├── Storage og Realtime
          └── Edge Functions
                 ├── betaling og webhooks
                 ├── AI-bildekontroll
                 └── kart- og rutekontroll
```

Produktlogikken er vanlig nettleser-JavaScript og er ikke avhengig av
Next-spesifikke API-er. Tailwind og den låste Supabase-klienten bygges lokalt,
slik at nettleseren ikke kjører produktkode fra et flytende tredjeparts-CDN.

## Kom raskt i gang

Forutsetninger: Node.js 22.13 eller nyere og npm.

```bash
git clone https://github.com/Fahad-G200/kollektivmatch.git
cd kollektivmatch
npm ci
npm test
npm run dev
```

Åpne adressen utviklingsserveren skriver ut. De lokale eksempelannonsene er
oppdiktede og gjør det mulig å utforske søk og matching uten produksjonsdata.

## Andre relevante prosjekter

- [IT Helpdesk – Python/Flask, SQL, Docker og rollebasert tilgang](https://github.com/Fahad-G200/helpdesk-prosjekt-struktur)

Detaljer om databaseoppsett, migreringer og produksjonskontroller følger under.

## Viktig før oppstart

Prosjektet har eksisterende brukere og annonser. For en eksisterende database
skal du kjøre disse tjueto migreringene i rekkefølge:

`migrations/2026-08-23_kollektivmatch_hardening.sql`

`migrations/2026-08-23_real_vipps_boost.sql`

`migrations/2026-08-23_vipps_account_verification.sql`

`migrations/2026-08-25_listing_video.sql`

`migrations/2026-08-25_school_proximity.sql`

`migrations/2026-08-25_unlimited_listing_images.sql`

`migrations/2026-08-25_security_advisor_fixes.sql`

`migrations/2026-08-26_home_seeker_profiles.sql`

`migrations/2026-08-26_stripe_boost_fallback.sql`

`migrations/2026-08-27_boost_delivery_guard.sql`

`migrations/2026-08-28_media_and_input_hardening.sql`

`migrations/2026-08-28_payment_and_storage_followup.sql`

`migrations/2026-08-31_contact_privacy_hardening.sql`

`migrations/2026-09-01_reporting_hardening.sql`

`migrations/2026-09-07_public_listing_access.sql`

`migrations/2026-09-07_cabin_property_type.sql`

`migrations/2026-09-08_security_definer_execute_grants.sql`

`migrations/2026-09-11_match_preference_coverage.sql`

`migrations/2026-09-12_ai_listing_checks.sql`

`migrations/2026-09-12_external_listing_analysis.sql`

`migrations/2026-09-12_ai_listing_retention_cron.sql`

`migrations/2026-09-12_external_listing_analysis_retention_cron.sql`

De tjue migreringene som ikke gjelder Cron er additive og legger til felter,
validering, funksjoner, rettigheter og policyer uten å slette eksisterende
bruker- eller annonsedata. De to Cron-migreringene installerer bare slettejobber
for private analysekvoter. `schema.sql` er nå kun en sikker veiviser. Ikke kjør
`schema_fresh_install_DELETES_ALL_DATA.sql` på en eksisterende database; den
filen inneholder med hensikt `DROP TABLE` for en helt ny installasjon. Ved en tom
førstegangsinstallasjon kjøres fresh-install-filen først, deretter de daterte
migreringene i rekkefølgen over.

Frontend kan midlertidig publisere mot det gamle skjemaet med forsidebildet,
men migreringene må kjøres for bildegalleri, nye boligfelt, Smart Match,
kontosletting, dataeksport, rapportering og den sikrede meldingsflyten.

> **Ikke publiser som ferdig tjeneste ennå:** Fyll ut alle hakeparenteser i
> `privacy.html` og `terms.html`, gjennomfør produksjonssjekklisten nedenfor, og
> få vilkår/personvernerklæring kvalitetssikret for den faktiske virksomheten.

## Kjør lokalt

Installer låste avhengigheter og start den lokale utviklingsserveren fra
prosjektmappen:

```bash
npm ci
npm run dev
```

Utviklingskommandoen bygger først Tailwind lokalt og oppretter den offentlige
leveransen uten eldre Vipps-verifiseringssider.

Supabase-klienten er låst til `@supabase/supabase-js@2.111.0` og bundtes til
`public/supabase-config.js` under bygging. Den flytende `@2`-importen og direkte
CDN-kjøring brukes ikke.

## Supabase Dashboard – konkret rekkefølge

1. Ta en database-backup i Supabase.
2. Åpne **SQL Editor**, lim inn hele
   `migrations/2026-08-23_kollektivmatch_hardening.sql`, og kjør den én gang.
   Kjør deretter `migrations/2026-08-23_real_vipps_boost.sql` og
   `migrations/2026-08-23_vipps_account_verification.sql` og til slutt
   `migrations/2026-08-25_listing_video.sql`,
   `migrations/2026-08-25_school_proximity.sql`,
   `migrations/2026-08-25_unlimited_listing_images.sql` og
   `migrations/2026-08-25_security_advisor_fixes.sql` og
   `migrations/2026-08-26_home_seeker_profiles.sql` og
   `migrations/2026-08-26_stripe_boost_fallback.sql`,
   `migrations/2026-08-27_boost_delivery_guard.sql` og
   `migrations/2026-08-28_media_and_input_hardening.sql` og
   `migrations/2026-08-28_payment_and_storage_followup.sql` og
   `migrations/2026-08-31_contact_privacy_hardening.sql` og
   `migrations/2026-09-01_reporting_hardening.sql`,
   `migrations/2026-09-07_public_listing_access.sql` og
   `migrations/2026-09-07_cabin_property_type.sql`,
   `migrations/2026-09-08_security_definer_execute_grants.sql` og
   `migrations/2026-09-11_match_preference_coverage.sql` og
   `migrations/2026-09-12_ai_listing_checks.sql` og
   `migrations/2026-09-12_external_listing_analysis.sql`. Aktiver deretter
   **Cron** under **Integrations** i Supabase, og kjør
   `migrations/2026-09-12_ai_listing_retention_cron.sql` og
   `migrations/2026-09-12_external_listing_analysis_retention_cron.sql`.
   Cron-migreringene feiler tydelig hvis Cron ikke er aktivert, og sletter kun
   private analysekvotelogger. Ingen av migreringene sletter eksisterende
   brukere eller annonser.
3. Åpne **Authentication → URL Configuration**.
4. Sett **Site URL** til den faktiske rotadressen. Lokalt kan dette være
   `http://localhost:3000/`. I produksjon bruker du `<PRODUCTION_URL>/`.
5. Legg inn følgende under **Redirect URLs**:

   - `http://localhost:3000/auth-callback.html`
   - `http://localhost:3000/reset-password.html`
   - `<PRODUCTION_URL>/auth-callback.html`
   - `<PRODUCTION_URL>/reset-password.html`

   Bruk de samme adressene med riktig undermappe dersom nettstedet ikke ligger
   i domenets rot. Ikke bruk jokertegn i produksjon med mindre det er nødvendig.
6. Åpne **Authentication → Email Templates → Confirm signup**. Du kan beholde
   Supabase-standardmalen for PKCE/code-flyt. Dersom du bruker en egen
   `token_hash`-mal, skal lenken peke til:

   ```html
   <a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=signup">Bekreft e-post</a>
   ```

   Appen legger alltid `?flow=auth` i `RedirectTo`, derfor skal malen bruke `&`
   foran `token_hash`.
7. Åpne **Authentication → Email Templates → Reset password**. Standardmalen
   fungerer med code-/implicit-flyten. For en egen `token_hash`-mal bruker du:

   ```html
   <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Velg nytt passord</a>
   ```

8. Bekreft under **Storage** at bucketen `listing-images` er opprettet. Det gjør
   migreringen automatisk. Den setter ca. 6 MB grense og tillater JPEG, PNG og
   WebP når Supabase-versjonen støtter disse bucket-feltene.
   Bekreft også `listing-videos`, som tillater én offentlig annonsevideo på maks
   50 MB i MP4-, WebM- eller MOV-format, lagret i brukerens egen mappe.
9. Under **Authentication → Password Security** setter du minimumslengde til
   6 tegn, slik at backend og skjemaene har samme krav. Aktiver
   lekkede-passord-kontroll dersom Supabase-planen støtter det.
10. Kontroller Auth-rate limits, aktiver CAPTCHA på registrering/innlogging ved
    produksjonsbruk, og sett opp en egnet SMTP-leverandør med SPF, DKIM og DMARC.
11. Opprett moderatorer ved å sette `app_metadata.role` til `moderator` eller
    `admin` via en betrodd server/admin-klient. Rollen må aldri ligge i
    brukerredigerbar `user_metadata`. RPC-ene `list_reports_for_moderation()` og
    `moderate_report(uuid, text)` er låst til disse rollene.
12. Test med egne testbrukere. Ikke test sletting eller policyforsøk mot
    produksjonsdata.

## Avviklet Vipps-kontobekreftelse

Vipps-kontobekreftelse er fjernet fra grensesnittet, og start-/callback-
funksjonene returnerer nå HTTP 410 uten å behandle innlogging eller identitet.
Deploy begge for å stenge eventuelle eldre installasjoner:

```bash
supabase functions deploy start-vipps-verification
supabase functions deploy vipps-verification-callback --no-verify-jwt
```

Ikke gjenaktiver gammel koblingskode. En fremtidig løsning må knytte godkjenningen
til nettleseren som startet den, i tillegg til PKCE, state og nonce.

## Slik aktiverer du ekte Vipps-betaling

Implementasjonen bruker Vipps MobilePay **ePayment API**, ikke den gamle eCom-
løsningen. Den starter låst til testmiljø. Frontend sender bare produkt-ID og
annonse-ID; pris og varighet leses fra `boost_products` i databasen. Annonsen
aktiveres først når Edge Function har hentet status direkte fra Vipps og
bekreftet at hele beløpet er captured.

1. Registrer virksomheten, få organisasjonsnummer og opprett bedriftskonto.
2. Søk om Vipps MobilePay-bedriftsavtale med ePayment, og registrer riktig
   oppgjørskonto i avtalen.
3. Opprett en test sales unit i Vipps-portalen og hent testverdiene for client
   ID, client secret, subscription key og Merchant Serial Number (MSN).
4. Ta Supabase-backup. Kjør først
   `migrations/2026-08-23_kollektivmatch_hardening.sql` og deretter
   `migrations/2026-08-23_real_vipps_boost.sql` i SQL Editor. Den siste lager
   produkter, betalingsordrer, audit-logg, sikre RPC-er og avatar-bucket.
5. Lag en lokal, git-ignorert secrets-fil basert på `.env.example`. Bruk i test:

   ```text
   VIPPS_ENVIRONMENT=test
   VIPPS_PRODUCTION_CONFIRMED=false
   VIPPS_API_BASE_URL=https://apitest.vipps.no
   APP_BASE_URL=https://din-https-testside.no
   ```

   `APP_BASE_URL` må være HTTPS fordi Vipps `WEB_REDIRECT` ikke godtar vanlig
   `http://localhost`. Bruk en publisert testside eller en kontrollert HTTPS-
   tunnel. Legg aldri secrets i `supabase-config.js`, HTML eller frontend-JS.
6. Koble Supabase CLI til testprosjektet og sett secrets med en lokal fil:

   ```bash
   supabase login
   supabase link --project-ref <PROJECT_REF>
   supabase secrets set --env-file .env.vipps.local
   ```

   Supabase leverer `SUPABASE_URL`, `SUPABASE_ANON_KEY` og
   `SUPABASE_SERVICE_ROLE_KEY` til Edge Functions. Kontroller dette i prosjektet;
   `service_role` skal aldri sendes til nettleseren.
7. Deploy funksjonene:

   ```bash
   supabase functions deploy create-boost-payment
   supabase functions deploy get-boost-payment-status
   supabase functions deploy refund-boost-payment
   supabase functions deploy vipps-payment-webhook --no-verify-jwt
   supabase functions deploy vipps-integration-status --no-verify-jwt
   ```

   Webhooken har gateway-JWT avslått fordi Vipps ikke har Supabase-token. Den
   godtar i stedet bare gyldig Vipps HMAC-signatur og ferskt tidspunkt.
8. Hent et Vipps test access token og registrer denne callback-adressen:

   `https://<PROJECT_REF>.supabase.co/functions/v1/vipps-payment-webhook`

   Registrer alle hendelsene:

   ```json
   [
     "epayments.payment.created.v1",
     "epayments.payment.authorized.v1",
     "epayments.payment.captured.v1",
     "epayments.payment.cancelled.v1",
     "epayments.payment.aborted.v1",
     "epayments.payment.expired.v1",
     "epayments.payment.refunded.v1",
     "epayments.payment.terminated.v1"
   ]
   ```

   Vipps viser webhook-secret bare ved registreringen. Lagre den umiddelbart som
   `VIPPS_WEBHOOK_SECRET` via `supabase secrets set`; mister du den, må webhooken
   erstattes.
9. Test i Vipps testmiljø med en bruker som eier en aktiv annonse. Test begge
   produkter, avbrudd, utløp, ugyldig webhook, dobbelklikk, webhook-retry,
   forlenget eksisterende periode og at return-URL alene ikke aktiverer noe.
10. Kontroller betalingsoversikten på Min side og SQL-visningen
    `public.boost_payment_admin_export`. I Supabase SQL Editor kan resultatet fra
    `select * from public.boost_payment_admin_export order by order_date desc;`
    lastes ned som CSV. Visningen er ikke tilgjengelig for nettleserroller.
11. Test refusjon med `refund-boost-payment` fra en betrodd adminflyt. Funksjonen
    krever at Supabase-brukeren har `app_metadata.role = admin`, kontrollerer
    capture hos Vipps og bekrefter full refund før databasen endres. Ikke bygg et
    offentlig klientkall rundt denne funksjonen.
12. Før produksjon: fyll inn juridisk navn, organisasjonsnummer og kontaktinfo i
    vilkår/personvern, kvalitetssikre angrerett/refusjonsrutine, gjennomfør Vipps
    ePayment-sjekklisten, og få godkjent produksjons-sales unit, merchant agreement,
    produksjonsnøkler og oppgjørskonto.
13. Bytt deretter secrets samlet til produksjonsverdier, sett nøyaktig
    `VIPPS_API_BASE_URL=https://api.vipps.no`, `VIPPS_ENVIRONMENT=production`,
    `VIPPS_PRODUCTION_CONFIRMED=true` og korrekt HTTPS `APP_BASE_URL`. Registrer en
    ny produksjonswebhook, oppdater tillatte domener, gjør én liten ekte betaling
    og kontroller capture, oppgjør i Vipps-portalen og innbetaling på bedriftskonto.

Koden alene betyr ikke at penger går til en konto. Det skjer først etter at en
gyldig produksjonsavtale, produksjonsnøkler, sales unit og oppgjørskonto faktisk
er aktivert og kontrollert hos Vipps MobilePay.

## Slik aktiverer du Stripe Checkout som reserve

Stripe-reserven bruker en leverandørhostet Checkout-side. Frontend sender bare
annonse-ID og produkt-ID; serveren henter pris og varighet fra databasen.
Annonsen fremheves først etter at en signert Stripe-webhook eller en
serverkontroll har bekreftet riktig ordre, beløp, valuta og betalt status.

1. Opprett Stripe-konto og fullfør Stripes identitets-/virksomhetskontroll. Legg
   inn oppgjørskonto bare i Stripe Dashboard – aldri i prosjektfiler eller chat.
2. Start i testmodus. Sett `STRIPE_ENVIRONMENT=test`, testnøkkelen som
   `STRIPE_SECRET_KEY`, webhook-hemmeligheten som `STRIPE_WEBHOOK_SECRET` og
   korrekt `APP_BASE_URL` som Supabase Edge Function-secrets. Testbetaling er
   bare tillatt mot localhost som standard. En separat, privat staging-side kan
   bruke `ALLOW_DEPLOYED_TEST_PAYMENTS=true`; flagget skal aldri stå på for en
   offentlig eller produksjonsmerket side.
3. Kjør `migrations/2026-08-26_stripe_boost_fallback.sql` i Supabase SQL Editor.
4. Deploy de nye og oppdaterte funksjonene:

   ```bash
   supabase functions deploy create-stripe-boost-payment
   supabase functions deploy stripe-payment-webhook --no-verify-jwt
   supabase functions deploy get-boost-payment-status
   supabase functions deploy vipps-integration-status --no-verify-jwt
   ```

5. Registrer webhook-adressen
   `https://<PROJECT_REF>.supabase.co/functions/v1/stripe-payment-webhook` i
   Stripe Workbench og velg hendelsene `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired` og
   `charge.refunded`.
6. Test vellykket betaling, avbrudd, utløp, feil signatur, feil beløp, dobbelt
   webhook-kall, full refusjon og forlengelse av en eksisterende
   fremhevingsperiode.
7. Før ekte salg: fyll ut juridiske plassholdere i vilkår/personvern og sett
   `STRIPE_ENVIRONMENT=production`, live secret, ny live webhook-secret og
   `STRIPE_PRODUCTION_CONFIRMED=true`. Gjør én liten betaling og kontroller både
   fremheving og faktisk utbetaling i Stripe Dashboard.

Stripe har ingen oppstarts- eller månedsavgift på standard Checkout, men tar
transaksjonsgebyr per vellykket betaling. Koden kan ikke omgå leverandørens
kundekontroll, avtale, skatte-/regnskapskrav eller krav om oppgjørskonto.

## Google-innlogging

Google-knappen er skjult som standard fordi provideren ikke er konfigurert:

```js
export const ENABLE_GOOGLE_AUTH = false;
```

For å aktivere den må du først konfigurere Google under **Authentication →
Providers → Google**, legge Supabase-prosjektets callback-URL fra Dashboard inn
hos Google Cloud, og teste både lokal og publisert redirect. Sett deretter
`ENABLE_GOOGLE_AUTH = true` i `supabase-config.js`. Ingen OAuth-hemmeligheter
skal legges i frontend. Før aktivering må OAuth-flyten også få et eget steg der
brukeren godtar gjeldende vilkår; e-postskjemaets avkryssing dekker ikke OAuth.

## Frivillig AI- og Google Maps-kontroll

Annonsesiden har en manuell tilleggskontroll for interne KollektivMatch-
annonser. Den viser først Smart Match fra alle valgte, strukturerte annonsefelt.
Detaljsiden viser alltid fem separate kontrollområder:

- område mot annonsens strukturerte by- og områdefelt;
- transport mot annonsefeltet og, på forespørsel, Google Routes-gangtid til
  nærmeste Google Places-kollektivtreff;
- fasiliteter mot annonsefeltet og karttreff innen 1500 meter;
- boligkvalitet mot annonsefeltet og, når en bildevurderbar kvalitet er valgt og
  annonsøren har samtykket, synlige tegn i opptil seks godkjente bilder;
- skole som omtrentlig luftlinje og, på forespørsel, en veiledende
  kollektivrute fra Google Routes.

Et kontrollområde som ikke er valgt vises eksplisitt som «Ikke valgt», mens
manglende grunnlag vises som «Kan ikke fastslås». Det gjør at ett enkelt valg
fortsatt blir kontrollert selv om minst to valg kreves for en matchprosent.

AI- og kartresultatene endrer aldri Smart Match-prosenten. Usikre eller
manglende funn vises som «Kan ikke fastslås». Bildekontroll er avslått som
standard og krever at annonsøren slår den på i publiserings-/redigeringsskjemaet.
Den generiske bildecachen slettes ved nye bilder, avslått tillatelse eller
slettet annonse. Google-treff og ruter lagres ikke i databasen.

Aktivering i et testprosjekt:

1. Kjør `migrations/2026-09-12_ai_listing_checks.sql` etter de øvrige
   migreringene. Den legger til eierens valg, en privat generisk bildecache og
   en atomisk kvote på 6 kontroller per time og 20 per døgn per bruker.
2. Aktiver **Cron** under **Integrations** i Supabase og kjør
   `migrations/2026-09-12_ai_listing_retention_cron.sql`. Kontroller deretter
   jobben med:

   ```sql
   select jobname, schedule, command, active
   from cron.job
   where jobname = 'purge-listing-analysis-requests';
   ```

3. Opprett en OpenAI API-nøkkel og velg en modell som støtter bilder og
   strukturerte svar. Aktiver Places API (New) og Routes API i et Google Cloud-
   testprosjekt. Bruk en egen servernøkkel begrenset til bare disse API-ene og,
   når driftsmiljøet tillater det, Edge Function-utgående IP-er.
4. Lag en lokal, git-ignorert fil, for eksempel `.env.analysis.local`, med:

   ```text
   OPENAI_API_KEY=...
   OPENAI_VISION_MODEL=...
   GOOGLE_MAPS_API_KEY=...
   ```

   For kontroll fra den lokale Vinext-serveren setter du i det samme lokale
   testprosjektet `APP_BASE_URL=http://localhost:3000` og
   `ALLOW_LOCAL_ORIGINS=true`. Ikke bruk disse lokalverdiene i produksjon;
   produksjonsprosjektet skal ha eksakt HTTPS-origin og lokalflagget avslått.

5. Sett Supabase-secrets og deploy den JWT-beskyttede funksjonen:

   ```bash
   supabase secrets set --env-file .env.analysis.local
   supabase functions deploy analyze-listing-fit
   supabase functions deploy analyze-external-listing
   ```

6. Rediger en testannonse, slå på «Tillat AI-bildekontroll», åpne annonsen som
   en annen innlogget testbruker og kontroller både fullstendig, delvis og
   utilgjengelig leverandørstatus. Følg med på API-kostnader og kvoter.

Nøklene skal aldri legges i `supabase-config.js`, HTML eller nettleser-JavaScript.
Serverfunksjonen godtar bare annonse-ID og tillatte preferanseverdier; den
henter medieadressene fra databasen og avviser alle bilder utenfor annonsørens
egen `listing-images`-mappe.

## Viktige funksjoner

- Egen auth-callback håndterer `code`, implicit tokens, `token_hash`, utløpte
  lenker og sikker intern `returnTo`.
- Bildevelgeren beholder flere valg, støtter drag-and-drop, opptil 100 bilder,
  rekkefølge og sekvensiell komprimering/opplasting til WebP.
  HEIC/HEIF avvises med en tydelig melding.
- Hver annonse kan ha én valgfri boligvideo på maks 90 sekunder og 50 MB.
  Videoen forhåndsvises før publisering, vises med kontroller på annonsen og
  ryddes sammen med annonsen eller kontoen.
- Boligtype, romstørrelse, depositum, møblering, inkludert husleie og
  annonsestatus støttes gjennom hele flyten.
- Smart Match normaliserer bare over vurderbare preferanser. Aktive søkefiltre
  overstyrer samme lagrede profilvalg, manglende data gir ingen poeng, og opptil
  de 500 nyeste ordinære treffene rangeres før paginering når «Beste match»
  brukes. Ved større resultatsett opplyser grensesnittet om grensen. Hver vist
  prosent kan åpnes for å se oppfylte, delvise og svake kriterier.
- Skole/studiested er et frivillig søkefelt basert på Kartverkets åpne
  stedsnavn-API. Valgt skole kan sortere annonser etter nærhet og inngå i den
  veiledende matchprosenten. Annonsen lagrer bare et omtrentlig område-/bypunkt,
  aldri gateadresse, og avstand vises som luftlinje – ikke reisetid.
- Annonsedetaljen viderefører aktive søkepreferanser og viser alle kontrollerte
  Smart Match-kriterier. Den frivillige serverfunksjonen kan i tillegg vise
  generiske bildeobservasjoner, Google-fasiliteter og reisetid som egne kilder,
  uten at disse blandes inn i prosenttallet.
- Meldinger opprettes via `send_message`-RPC. Annonseeieren kan bare svare noen
  som allerede har startet en legitim samtale, og innhold kan ikke redigeres.
  Samtaledeltakere beholder tilgang når annonsen pauses eller blir utleid, og
  nye meldinger kan leveres via Realtime.
- Anonyme brukere får fortsatt ikke lese `contact_info` eller private
  profilfelt.
- Rapporter lagres i `reports`. Moderator-RPC-ene kontrollerer en serverstyrt
  rolle. Innlevering går gjennom en serverstyrt RPC med timegrense, og
  moderatorhandlinger får et separat, nettleserutilgjengelig revisjonsspor. Et
  eget admin-grensesnitt er fortsatt anbefalt.
- Brukere kan laste ned maskinlesbar kopi av egne data og slette konto, innhold
  og refererte annonsebilder fra «Min side».
- Profilen støtter valgfritt profilbilde og omtrentlig time-, måneds- eller
  årsinntekt. Inntekten er privat og brukes ikke som filter eller Smart Match-
  kriterium.
- Vipps-verifisering ligger kun igjen som historisk kildekode og migreringer;
  den kopieres ikke til den offentlige leveransen og vises ikke i produktet.
- Utleiere kan kjøpe 7 dager (4900 øre) eller 30 dager (9900 øre) fremheving via
  serververifisert Stripe Checkout. Kjøpt plassering er tydelig adskilt fra Smart
  Match og eksplisitt prissortering forblir ren. Publiseringsskjemaet kan åpne
  fremhevingsvalgene etter publisering, men starter aldri betaling automatisk.
- «Nyinnflyttet?» viser live spotpris for NO1–NO5 fra den åpne tjenesten
  Hva koster strømmen, med tydelig forbehold om nettleie, avgifter, påslag og
  eventuell strømstøtte.
- Resultatlisten viser antall treff, har ryddig tomtilstand og bruker et lokalt
  plassholderbilde uten forespørsel til en tredjepart.
- Personvern-, vilkårs- og sikkerhetssider er lagt inn, men juridiske
  virksomhetsopplysninger må fylles ut før publisering.

## FINN.no-data

Denne versjonen scraper, rammer inn eller kopierer ikke annonser fra FINN.no.
Både FINNs API og partner-iframe krever en betalt partneravtale, og løsningene er
beregnet på annonser kunden selv eier eller forvalter. De gir ikke generell rett
til å hente FINNs boligmarked inn i en annen markedsplass. En FINN-integrasjon
skal derfor ikke aktiveres før KollektivMatch har en skriftlig avtale, FINN-orgID,
API-nøkkel og dokumentert rett til å vise de aktuelle annonsene. Hold nøkkelen i
en serverfunksjon, aldri i frontend, og merk annonsenes kilde tydelig.

Forsiden lager i stedet et preferansebasert utgående FINN-søk i
`external-search.js`. Kontrollvisningen skiller mellom eksakte FINN-filtre,
søkeord som ikke er verifisert, og kriterier som må bekreftes i hver annonse.
Støttede boligtyper, makspris, innflyttingsmåned og enkelte sorteringer sendes
som faktiske FINN-filtre. Sted og studentbolig sendes som søkeord, og vises også
som uverifiserte der innholdet må kontrolleres per annonse. Skoleavstand,
kollektivtransport, fasiliteter, ønsket hverdag og boligkvaliteter står i den
samme kontrollisten når de er valgt.

Kontrollisten betyr ikke at KollektivMatch har lest eller godkjent annonsen;
hvert punkt er først merket «Må bekreftes». Valgene blir også gjort om til en
søketekst som brukeren kan kopiere til Husleie.no, Hybel.no eller Facebook
Marketplace. Ingen av sidene leses automatisk.

Forsiden har i tillegg en separat, brukerinitiert «Kontrollert match (beta)» for
én konkret FINN-annonse. Dette er ikke scraping eller en FINN-integrasjon:

- FINN-lenken formatvalideres og brukes som deeplink, men hentes aldri av
  klienten eller serverfunksjonen;
- brukeren oppgir selv gateadresse, pris, boligtype, innflyttingsdato og ønsket
  hverdag, og kan merke faste påstander fra annonsen;
- nettleseren skalerer maksimalt tre bruker-valgte boligbilder til WebP;
- `analyze-external-listing` geokoder adressen, kontrollerer nærmeste valgte
  fasiliteter, gangtid til kollektivtransport og skoleavstand/-rute med Google,
  og bruker OpenAI kun for valgte, synlige boligkvaliteter;
- serveren beregner prosenten deterministisk med samme vekter som Smart Match.
  AI får aldri beregne prosent, og ukjent inngår i nevneren med null poeng;
- resultatet viser «Har», «Mangler eller delvis» og «Kan ikke fastslås», med
  kilde per kriterium og en egen dekningsprosent;
- lenke, finnkode, adresse, bilder, Google-resultat og analyseresultat lagres
  ikke av KollektivMatch. En minimal privat kvotelogg lagrer bare bruker-ID og
  tidspunkt i opptil omtrent 25 timer.

Kjør `migrations/2026-09-12_external_listing_analysis.sql` før funksjonen
deployes. Aktiver deretter Supabase Cron og kjør
`migrations/2026-09-12_external_listing_analysis_retention_cron.sql` for
uavhengig opprydding av kvoteloggen. Funksjonen godtar bare
`multipart/form-data`, krever innlogging og
samtykkeflagg, tillater maksimalt tre WebP-bilder på 2 MiB hver og har en atomisk
kvote på 3 kontroller per time og 10 per døgn. Eksterne bilde-URL-er godtas
aldri. `store: false` brukes hos OpenAI, men dette er ikke et løfte om null
leverandøroppbevaring; sikkerhets-/misbrukslogger og et eventuelt ZDR-oppsett må
dokumenteres før produksjon.

Denne manuelle flyten gir heller ikke automatisk rett til å sende FINN-innhold
til en tredjepart. Før produksjonslansering må virksomheten avklare skriftlig at
brukeren og KollektivMatch har nødvendige rettigheter til de valgte bildene og
den aktuelle behandlingen. Automatisk FINN-søk, bildehenting eller markedsfeed
forblir sperret frem til en uttrykkelig avtale dekker dette.

## Produksjonssjekkliste for personvern og sikkerhet

- Fyll inn behandlingsansvarlig, organisasjonsnummer, fysisk adresse og overvåket
  personvernkontakt i `privacy.html` og `terms.html`.
- Dokumenter valgt Supabase-region, driftsleverandør, underleverandører,
  databehandleravtaler og eventuelt overføringsgrunnlag utenfor EØS.
- Vedta konkrete slettefrister for inaktive kontoer, annonser, meldinger,
  rapporter, logger og backup. Planlegg en faktisk slettejobb der det trengs.
- Lag en tilgangsstyrt moderatorrutine med responstid, klagemulighet og logg over
  avgjørelser. Overvåk også personverninnboksen.
- Dokumenter risikovurdering, tilgangsrevisjon, backup-gjenoppretting og rutine
  for sikkerhetsbrudd. Varslingsfristen til Datatilsynet kan være 72 timer.
- Server nettstedet over HTTPS. `_headers` håndhever HSTS, streng CSP,
  clickjacking-beskyttelse, minimal nettlesertilgang og `no-store` på sensitive
  callback-, chat- og betalingssider; bekreft headerne på det publiserte domenet.
- Kjør oppfølgingsmigreringen fra 28. august 2026 før nye betalinger. Den låser
  en annonse til ett åpent betalingsløp på tvers av Stripe og Vipps, isolerer
  leverandørwebhooks og bruker Supabase Storage-feltet `owner_id`.
- Rydd eventuelle gamle eksterne media-URL-er og valider deretter constraintene
  `profiles_public_fields_hardened` og `listings_owned_media_urls` i databasen.
- Ikke legg til analyse eller markedsføringssporing uten egen vurdering og gyldig
  forhåndssamtykke. Nødvendig sesjonslagring alene trenger ikke et kunstig banner.
- Før AI-/kartkontrollen aktiveres i produksjon: gjennomfør personvern- og
  leverandørvurdering, inngå nødvendige avtaler, verifiser overføringsgrunnlag,
  begrens begge API-nøkler og kvoter, og verifiser at Cron-jobben
  `purge-listing-analysis-requests` er aktiv og fullfører uten feil.
- Test RLS, Storage, meldingsbegrensning, eksport og sletting i et separat
  Supabase-testprosjekt. Verifiser spesielt at anonyme brukere ikke kan lese
  `contact_info`, private profilfelt, meldinger eller rapporter.

Den fullstendige gjennomgangen og produktforslagene ligger i
`docs/AUDIT-2026-08-23.md`. En samtykkebasert plan for de første annonsene
ligger i `docs/FIRST-LISTINGS-PLAN.md`.

## Filstruktur

```text
kollektivmatch/
├── auth-callback.html / auth-callback.js
├── index.html / app.js / auth.js / feed.js / match.js / external-search.js
├── listing-analysis.js
├── location-utils.js
├── create-listing.html / create-listing.js / storage-utils.js
├── listing-detail.html / listing-detail.js
├── dashboard.html / dashboard.js
├── boost-payment-result.html / boost-payment-result.js
├── vipps-verification-result.html / vipps-verification-result.js
├── chat.html / chat.js
├── reset-password.html / reset-password.js
├── moving-in.html / moving-in.js / power-prices.js
├── privacy.html / terms.html / safety.html
├── supabase-config.js / ui.js
├── avatar-crop.js
├── css/style.css / css/tailwind-input.css / css/tailwind.css
├── migrations/2026-08-23_kollektivmatch_hardening.sql
├── migrations/2026-08-23_real_vipps_boost.sql
├── migrations/2026-08-23_vipps_account_verification.sql
├── migrations/2026-08-25_listing_video.sql
├── migrations/2026-08-25_school_proximity.sql
├── migrations/2026-08-25_unlimited_listing_images.sql
├── migrations/2026-08-25_security_advisor_fixes.sql
├── migrations/2026-08-26_home_seeker_profiles.sql
├── migrations/2026-08-26_stripe_boost_fallback.sql
├── migrations/2026-08-27_boost_delivery_guard.sql
├── migrations/2026-08-28_media_and_input_hardening.sql
├── migrations/2026-08-28_payment_and_storage_followup.sql
├── migrations/2026-08-31_contact_privacy_hardening.sql
├── migrations/2026-09-01_reporting_hardening.sql
├── migrations/2026-09-07_public_listing_access.sql
├── migrations/2026-09-07_cabin_property_type.sql
├── migrations/2026-09-08_security_definer_execute_grants.sql
├── migrations/2026-09-11_match_preference_coverage.sql
├── migrations/2026-09-12_ai_listing_checks.sql
├── migrations/2026-09-12_ai_listing_retention_cron.sql
├── supabase/config.toml
├── supabase/functions/{create-boost-payment,create-stripe-boost-payment,get-boost-payment-status,
│   vipps-payment-webhook,refund-boost-payment,start-vipps-verification,
│   vipps-verification-callback,vipps-integration-status,stripe-payment-webhook,
│   analyze-listing-fit}
├── docs/AUDIT-2026-08-23.md
├── schema.sql
├── schema_fresh_install_DELETES_ALL_DATA.sql
└── tests/*.test.mjs
```

## Tester

Kjør hele den lokale testsuiten med:

```bash
npm test
npm run build
```

Testsuiten dekker blant annet Smart Match og den fullstendige forklaringen,
strømprisberegning, Storage/medier, profilbildeutsnitt, skolenærhet,
annonsevideo, ressursbegrenset bildegalleri, meldingsregresjoner og serververifisert
fremheving. Bygget skal i tillegg bekrefte at lokal Tailwind genereres og at
den offentlige leveransen ikke inneholder eldre Vipps-verifiseringssider.

Grunnmigreringene og alle sju Edge Functions ble installert i Supabase-
prosjektet `wsfnnaiytweaarncewcr` 23. august 2026. Migreringen som fjerner den
faste bildegrensen ble installert og kontrollert 25. august 2026. Transaksjonelle tester mot
prosjektet bekreftet start/svar/lesestatus/pauset samtale for meldinger samt
serverpris, capture-leveranse, idempotens og avvisning av feil beløp for
fremheving. All testdata ble rullet tilbake.

`docs/VIPPS-TESTPLAN-2026-08-23.md` oppbevares som historisk dokumentasjon.
Vipps-flytene er ikke en del av den offentlige leveransen. Produksjonsbetaling
for fremheving går via Stripe og må fortsatt verifiseres med en kontrollert
testordre etter enhver endring av nøkler, webhook eller bankkonto.

Før produksjonssetting må auth-e-post, Storage-RLS, meldings-RPC og responsive
visninger testes mot et eget Supabase-testprosjekt. Ekstern e-postlevering,
OAuth, Realtime og databasepolicyer kan ikke fullverifiseres med bare statiske
prosjektfiler.

## Endringer 7. september 2026

- Søket kommer før inspirasjon og FINN-lenker. To sammenlignbare preferanser,
  eller en skole med koordinater, gir veiledende matchprosent med korrekt forklaring.
- Når ingen ekte treff vises, kan brukeren teste seks lokale, tydelig merkede
  eksempelboliger. De har ingen utleier, meldingsflyt eller betalingsflyt og
  skrives aldri til Supabase. Hytter støttes også i skjema og preferanser etter
  den nye migreringen.
- `2026-09-07_public_listing_access.sql` reparerer anonym annonse-/profillesing
  uten å åpne private meldinger. Den må kjøres etter rapporteringsmigreringen.
- `docs/STATUS-2026-09-07.md` skiller mellom lokalt verifiserte rettinger og
  gjenværende arbeid i drift. Tester alene beviser ikke sikkerheten i produksjon.
