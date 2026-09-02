# KollektivMatch

KollektivMatch er en HTML/CSS/JavaScript-plattform for å finne og annonsere
kollektivrom. Supabase brukes til Auth, PostgreSQL, RLS, Storage og Realtime.
Next/Vinext-laget finnes bare for bygging og publisering hos OpenAI Sites;
produktlogikken er fortsatt vanlig nettleser-JavaScript og er ikke avhengig av
Next-spesifikke API-er. Tailwind og den låste Supabase-klienten bygges lokalt;
nettleseren kjører ikke produktkode fra et tredjeparts-CDN.

## Viktig før oppstart

Prosjektet har eksisterende brukere og annonser. For en eksisterende database
skal du kjøre disse fjorten migreringene i rekkefølge:

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

Migreringen er ikke-destruktiv og legger til felter, validering, funksjoner,
rettigheter og policyer uten å slette eksisterende data. `schema.sql` er nå kun
en sikker veiviser. Ikke kjør `schema_fresh_install_DELETES_ALL_DATA.sql` på en
eksisterende database; den filen inneholder med hensikt `DROP TABLE` for en helt
ny installasjon. Ved en tom førstegangsinstallasjon kjøres fresh-install-filen
først, deretter de daterte migreringene i rekkefølgen over.

Frontend kan midlertidig publisere mot det gamle skjemaet med forsidebildet,
men migreringen må kjøres for bildegalleri, nye boligfelt, Smart Match,
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
   `migrations/2026-09-01_reporting_hardening.sql`. Alle er
   additive og skal ikke slette eksisterende brukere eller annonser.
3. Åpne **Authentication → URL Configuration**.
4. Sett **Site URL** til den faktiske rotadressen. Lokalt kan dette være
   `http://localhost:5500/`. I produksjon bruker du `<PRODUCTION_URL>/`.
5. Legg inn følgende under **Redirect URLs**:

   - `http://localhost:5500/auth-callback.html`
   - `http://localhost:5500/reset-password.html`
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
   minst 12 tegn. Aktiver lekkede-passord-kontroll dersom Supabase-planen støtter
   det.
10. Kontroller Auth-rate limits, aktiver CAPTCHA på registrering/innlogging ved
    produksjonsbruk, og sett opp en egnet SMTP-leverandør med SPF, DKIM og DMARC.
11. Opprett moderatorer ved å sette `app_metadata.role` til `moderator` eller
    `admin` via en betrodd server/admin-klient. Rollen må aldri ligge i
    brukerredigerbar `user_metadata`. RPC-ene `list_reports_for_moderation()` og
    `moderate_report(uuid, text)` er låst til disse rollene.
12. Test med egne testbrukere. Ikke test sletting eller policyforsøk mot
    produksjonsdata.

## Slik aktiverer du Vipps-kontobekreftelse

Vipps-koblingen bruker Authorization Code-flyt med PKCE S256, tilfeldig state og
nonce, server-side kodeutveksling, signaturkontroll av ID token via Vipps JWKS,
issuer/audience/utløp-kontroll og samsvar med Userinfo. Bare Vipps `sub` og
tidspunkter lagres. Merket betyr «koblet til en Vipps-konto» og skal aldri
omtales som BankID eller elektronisk ID.

1. Aktiver **Login** på riktig sales unit i Vipps MobilePay-portalen. Be bare om
   `openid`-scope; denne løsningen trenger ikke telefon, e-post, adresse eller
   fødselsnummer.
2. Registrer callback-adressen helt nøyaktig, inkludert eventuelle skråstreker:

   `https://<PROJECT_REF>.supabase.co/functions/v1/vipps-verification-callback`

3. Sett `VIPPS_LOGIN_CLIENT_ID`, `VIPPS_LOGIN_CLIENT_SECRET`,
   `VIPPS_LOGIN_SUBSCRIPTION_KEY` og `VIPPS_LOGIN_MSN` som Supabase Edge
   Function-secrets. Hvis Login og ePayment bruker samme sales unit og nøkler,
   faller funksjonen tilbake til de tilsvarende `VIPPS_*`-verdiene.
4. Sett korrekt HTTPS `APP_BASE_URL`. Callbacken sender brukeren tilbake til
   `<APP_BASE_URL>/vipps-verification-result.html`, som kontrollerer den lagrede
   profilstatusen i stedet for å stole på URL-parameteren.
5. Deploy funksjonene:

   ```bash
   supabase functions deploy start-vipps-verification
   supabase functions deploy vipps-verification-callback --no-verify-jwt
   supabase functions deploy vipps-integration-status --no-verify-jwt
   ```

6. Test fullført flyt, avbrudd, utløpt state, gjenbruk av callback, feil nonce,
   feil issuer/audience og forsøk på å koble samme Vipps-konto til to brukere.
   `VIPPS_LOGIN_FORCE_APP_AUTH=true` skal bare brukes når sales unit har advanced
   Login og støtter `acr_values=urn:vipps:acr:app_auth`.

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
├── index.html / app.js / auth.js / feed.js / match.js
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
├── migrations/2026-08-25_security_advisor_fixes.sql
├── migrations/2026-08-26_home_seeker_profiles.sql
├── migrations/2026-08-26_stripe_boost_fallback.sql
├── migrations/2026-08-27_boost_delivery_guard.sql
├── migrations/2026-08-28_media_and_input_hardening.sql
├── migrations/2026-08-28_payment_and_storage_followup.sql
├── migrations/2026-08-31_contact_privacy_hardening.sql
├── migrations/2026-09-01_reporting_hardening.sql
├── supabase/config.toml
├── supabase/functions/{create-boost-payment,create-stripe-boost-payment,get-boost-payment-status,
│   vipps-payment-webhook,refund-boost-payment,start-vipps-verification,
│   vipps-verification-callback,vipps-integration-status,stripe-payment-webhook}
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
