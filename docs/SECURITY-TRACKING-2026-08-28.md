# Sikkerhets-, funksjons- og UX-revisjon – 1. september 2026

Status: kodegjennomgang, lokal herding, regresjonstester og produksjonsbygg er
fullført. Ny databasemigrering og endrede Supabase Edge Functions er **ikke**
installert i produksjon av denne revisjonen. Disse punktene er derfor ikke
produksjonsbevist før administrator har fulgt sjekklisten nederst.

Ingen nettjeneste kan garanteres 100 prosent sikker eller «umulig å hacke».
Arbeidet under fjerner bekreftede svakheter og reduserer risiko, men erstatter
ikke oppdateringer, overvåking, backup, tilgangsrevisjon og hendelseshåndtering.

## 1. Kort konklusjon

KollektivMatch har et gjennomgående godt sikkerhetsmønster: en lokalbundet
frontend, PKCE, streng CSP, serverstyrte betalingsbeløp, signerte webhooks,
kolonnebegrensede grants og `SECURITY DEFINER`-RPC-er med fast `search_path`.
Denne revisjonen bekreftet de tidligere betalings- og kontaktrettelsene og la
til herding for rapportering, moderatorhistorikk, recovery/callback,
produksjons-CORS, Edge-avhengigheter og Smart Match.

Alle 32 Node-testoppføringer består, TypeScript-kontrollen består,
produksjonsbygget består og npm audit rapporterer 0 kjente sårbarheter. Den
genererte klienten inneholder ingen `.env`, SQL, tester, ZIP-filer, source maps
eller kjente serverhemmelighetsmønstre. Workers-konfigurasjonen har ingen
D1-, R2-, KV-, service- eller secret-bindinger.

Sammenlignet med revisjonen 28.–31. august er kryssleverandørbetaling,
Stripe-refusjon, Storage-eierskap og skjerming av `contact_info` fortsatt
intakt. Nytt siden sist er særlig:

- rapporter går via server-RPC med allowlist, rate limit og lås;
- moderatorhandlinger får eget, app-utilgjengelig revisjonsspor;
- klienten feiler lukket hvis rapport-/kontakt-RPC mangler;
- en vanlig eksisterende sesjon godtas ikke som callback- eller recoverybevis;
- localhost-CORS krever både lokal `APP_BASE_URL` og eksplisitt flagg;
- Edge-importer bruker eksakt låst `npm:`-pakke i stedet for runtime-CDN;
- Smart Match krasjer ikke når en annonse mangler koordinater, og 500-grensen
  opplyses tydelig i grensesnittet.

Nettsiden er **ikke klar for offentlig lansering** ennå. Juridiske plassholdere
står igjen, Stripe rapporterer testmiljø, Vipps er av, Supabase-endringene må
installeres/testes, og markedsplassen har ingen aktive annonser.

### Arkitektur og verifisert dataflyt

Nettleser → Supabase Auth/RLS/Storage/Realtime eller autentisert Edge Function
→ Stripe/Vipps. Nettleseren sender produkt- og annonse-ID. Pris, valuta,
varighet, eierskap, betalingsstatus og leveranse bestemmes på serveren.
Kortnummer, CVC og bankpassord går ikke gjennom KollektivMatch-koden.

## 2. Bekreftede funn

| ID | Grad | Komponent | Status |
|---|---|---|---|
| KM-2026-01 | Høy | Stripe/Vipps ordreoppretting | Rettet lokalt tidligere, bekreftet på nytt |
| KM-2026-02 | Høy | Stripe-refusjon og webhook | Rettet lokalt tidligere, bekreftet på nytt |
| KM-2026-03 | Middels | Leverandørisolasjon | Rettet lokalt tidligere, bekreftet på nytt |
| KM-2026-04 | Middels | Storage-eierskap og stier | Rettet lokalt tidligere, rest-risiko åpen |
| KM-2026-05 | Middels | Parallelle meldings-/opplastingsgrenser | Rettet lokalt tidligere |
| KM-2026-06 | Lav | Cache/headere på private sider | Rettet lokalt; app-headere må fjernverifiseres |
| KM-2026-07 | Lav | Retur-, callback- og betalings-URL-er | Rettet lokalt |
| KM-2026-08 | Lav | Forsyningskjede | Ytterligere rettet lokalt |
| KM-2026-09 | Lav | Kontoenumerering/tabnabbing | Rettet lokalt tidligere |
| KM-2026-10 | Middels | Masseuthenting av annonsekontakt | Rettet lokalt tidligere, bekreftet mot API |
| KM-2026-11 | Blokkering | Juridisk eieridentitet/domene | Åpen eierbeslutning |
| KM-2026-12 | Middels | Fail-open klientfallback | Rettet lokalt |
| KM-2026-13 | Middels | Rapportmisbruk/moderatoraudit | Rettet lokalt; migrering gjenstår |
| KM-2026-14 | Lav | Auth callback/recovery-status | Rettet lokalt |
| KM-2026-15 | Lav | Anonym `messages`-grant | Rettet i ny migrering |
| KM-2026-16 | Middels | Localhost tillatt av prod-CORS | Rettet lokalt; Edge-deploy gjenstår |
| KM-2026-17 | Lav | Edge runtime-CDN | Rettet lokalt |
| KM-2026-18 | Middels funksjonell | Smart Match uten koordinater | Rettet lokalt |

### KM-2026-01 til KM-2026-03 – betaling

- **Scenario og konsekvens:** To samtidige betalingsveier kunne tidligere lage
  konkurrerende ordrer for samme annonse; eldre leverandørkode kunne blande
  leverandører; Stripe-refusjon manglet komplett leverandørnøytral flyt. Det
  kunne gitt dobbelt betaling/leveranse eller uoverensstemmelse etter refusjon.
- **Rotårsak:** deduplisering og enkelte oppslag var leverandørspesifikke.
- **Rettelse:** annonseraden låses, bare én `pending`/`authorized` ordre tillates
  per annonse på tvers av leverandører, leverandør bindes eksplisitt, status og
  sletting låses under åpen betaling, og levering/refusjon/hendelser er
  idempotente.
- **Verifikasjon:** Stripe- og Vipps-signaturkode bruker rå body, HMAC,
  tidsvindu og konstant-tid-sammenligning. Pris/valuta/produkt hentes på
  serveren. 41 Stripe-kontroller, 25 felles betalingskontroller, 12
  betalingsregeltester og 4 Vipps-signaturtester består. Ingen ekte betaling
  ble gjennomført.

### KM-2026-04 og KM-2026-05 – Storage og samtidighet

- **Scenario og konsekvens:** eldre `owner`-policyer, bredere stier og
  tell-før-skriv kunne gi svakere eierskap og la samtidige forespørsler
  overskride kvoter/spamgrenser.
- **Rettelse:** `owner_id`, eksakt origin/bucket/eier, ett UUID-filsegment,
  immutable annonsemedia, eksakt avatarsti og transaksjonelle advisory-låser.
- **Verifikasjon:** Storage-sti-, quota-, MIME-, filendelse-, pixel-, størrelse-
  og samtidighetstester består. Direkte Storage API kan fortsatt omgå
  klientens video-varighet/kodek-kontroll; se gjenværende risiko.

### KM-2026-06 til KM-2026-10 – nettleser, auth og kontakt

- Private sider har `no-store`, `noindex`, `no-referrer`; callbackparametere
  fjernes fra URL. `returnTo` tillater bare samme origin uten credentials.
- Sesjonen ligger i `sessionStorage`; bare kortlivet PKCE code-verifier deles i
  `localStorage` for e-postcallback i ny fane. Dette reduserer persistens, men
  beskytter ikke mot XSS i samme origin. HttpOnly-cookie krever et BFF.
- Offentlig profilgrant er begrenset til visningsfelter. Produksjonsprobe ga
  200 for offentlige profil-/annonsefelt og 401 for `income_status` og
  `contact_info`. Kontakt hentes én annonse om gangen via innloggingskrevende
  RPC med 30 forskjellige annonser/time.
- CSP har ingen `unsafe-inline`/`unsafe-eval`; media-URL-er må matche eksakt
  Supabase-origin/bucket uten query/hash/path traversal. Brukertekst escapes
  eller settes med `textContent`.

### KM-2026-11 – offentlig anonymitet og juridisk identitet

- Det bygde nettstedet inneholder ikke Git-forfatternavn/-e-post, lokale
  filstier, privat telefon, bankinformasjon eller serverhemmeligheter.
- Vilkår og personvern inneholder fortsatt `[JURIDISK NAVN]`, `[ORG.NR.]` og
  kontaktplassholdere. Dette blokkerer offentlig lansering.
- Den tidligere Sites-adressen inneholdt en personlig arbeidsområdeetikett.
  Produksjonssiden bruker nå den nøytrale gratisadressen
  `https://kollektivmatch.pages.dev`.
- En lovlig kommersiell tjeneste kan ikke love anonymitet overfor Stripe,
  Vipps, bank, hosting, myndigheter eller virksomhetsregistre. Bruk separat
  virksomhets-e-post/telefon og egnet forretningsadresse i offentlig kontakt.

### KM-2026-12 og KM-2026-13 – rapportering feilet åpent

- **Scenario:** hvis den nye RPC-en manglet, falt klienten tilbake til direkte
  lesing av `contact_info` eller direkte INSERT i `reports`. Rapportøren kom fra
  klienten, og rapportering manglet en global timegrense og moderatorhistorikk.
- **Konsekvens:** en feil migreringsrekkefølge kunne gjenåpne eldre
  kontaktprivilegier eller gi rapportspam og dårlig etterprøvbar moderering.
- **Rotårsak:** kompatibilitet ble prioritert over fail-closed oppførsel.
- **Rettelse:** begge fallbackene er fjernet. Ny `submit_report()` bruker
  `auth.uid()`, allowlist, maksimum 1000 tegn, aktiv annen-eiers annonse,
  10/time og per-bruker advisory-lås. Direkte INSERT tilbakekalles. Moderator-
  handlinger lagres i separat tabell som app-rollene ikke kan lese/skrive.
- **Verifikasjon:** 26 rapporteringskontroller og effektiv-grant-matrisen
  består. Runtimeverifikasjon krever at migreringen installeres i staging.

### KM-2026-14 – eksisterende sesjon ble tolket som callback/recoverybevis

- **Scenario:** direkte besøk til callback- eller reset-siden kunne bruke en
  allerede eksisterende sesjon og vise suksess/passordskjema uten en innkommende
  auth-/recoverylenke.
- **Konsekvens:** misvisende sikkerhetstilstand og svakere bekreftelse av at
  brukeren faktisk kom fra riktig flyt.
- **Rettelse:** sidene krever code, `token_hash` eller eksplisitte tokens fra
  den innkommende flyten og feiler ellers lukket. Etter passordbytte logges
  sesjonen ut.
- **Verifikasjon:** 12 recovery-regresjonskontroller består.

### KM-2026-15 – anonym tabellrettighet på meldinger

- **Scenario:** produksjons-Data API svarte 200 på anonym `messages`-SELECT.
  RLS skjulte radene i proben, men tabellrettigheten var unødvendig.
- **Konsekvens:** ekstra angrepsflate og større skade ved en fremtidig
  feilkonfigurert policy.
- **Rettelse:** ny migrering tilbakekaller SELECT fra `public` og `anon`.
- **Verifikasjon:** statisk effektiv-tilgangstest består; produksjon fortsetter
  å svare 200 til migreringen faktisk er kjørt.

### KM-2026-16 – localhost var tillatt i produksjons-CORS

- **Scenario:** statusfunksjonen svarte 200 for produksjonsorigin, 403 for
  `evil.example`, men også 200 for `http://localhost:5500`.
- **Konsekvens:** en lokal tjeneste i brukerens nettleser kunne kalle åpne Edge-
  endepunkter under en glemt produksjonskonfigurasjon. Autentiserte funksjoner
  krever fortsatt bearer-token, men origin-flaten var bredere enn tilsiktet.
- **Rettelse:** localhost krever både eksplisitt `ALLOW_LOCAL_ORIGINS=true` og
  at `APP_BASE_URL` selv er en kjent localhost-origin.
- **Verifikasjon:** CORS-regresjonstest består. Produksjon er ikke rettet før
  alle funksjoner som importerer `_shared/cors.ts` er deployet på nytt.

### KM-2026-17 – mutable runtime-CDN i Edge Functions

- **Scenario:** Edge-funksjoner importerte Supabase-klienten fra `esm.sh` ved
  runtime. Versjonen var låst, men en ekstra CDN var del av forsyningskjeden.
- **Konsekvens:** ekstra tilgjengelighets- og leverandørrisiko.
- **Rettelse:** eksakt `npm:@supabase/supabase-js@2.111.0` brukes. Dette følger
  Supabase sin anbefalte Deno/npm-modell. Se
  https://supabase.com/docs/guides/functions/dependencies og
  https://supabase.com/docs/guides/security/npm-security.
- **Verifikasjon:** statiske tester av alle tre importsteder og TypeScript-
  syntaks består. Full Deno-typekontroll krever Deno/Supabase CLI.

### KM-2026-18 – Smart Match krasjet ved manglende koordinater

- **Scenario:** valgt skole sammen med en eldre annonse uten koordinater kunne
  gjøre `null` om til 0 km og deretter kalle `toLocaleString` på `null`.
- **Konsekvens:** hele resultatvisningen kunne stoppe for et legitimt datasett.
- **Rettelse:** manglende/blank avstand gir `null` og nærhetskriteriet utelates.
  UI opplyser også at bare de 500 nyeste ordinære treffene rangeres hvis
  resultatsettet er større.
- **Verifikasjon:** 29 Smart Match-tester dekker 0–100, grenseverdier,
  budsjettavvik, manglende koordinater, sortering, deduplisering og 500-grensen.

## 3. Endringer

- `migrations/2026-09-01_reporting_hardening.sql`: rapport-RPC, rate limit,
  moderatoraudit, minste privilegium for meldinger/rapporter.
- `listing-detail.js`: serverstyrt rapportering og fail-closed kontakt/rapport.
- `auth-callback.js`, `reset-password.js`: eksplisitt callback-/recoverybevis.
- `match.js`, `feed.js`: manglende koordinater og ærlig 500-grense.
- `supabase/functions/_shared/cors.ts`: streng produksjons-CORS.
- Edge Supabase-importer: eksakt `npm:`-import uten runtime-CDN.
- `README.md`, `schema.sql`: migreringsrekkefølge og driftsdokumentasjon.
- Nye tester: effektiv tilgang, rapportering, recovery og full brukerflyt/HTML.

Funksjonell konsekvens: rapportering og direkte kontaktinfo feiler kontrollert
hvis påkrevde RPC-er ikke er installert. Dette er tilsiktet; eldre, bredere
direkte tabelltilgang blir ikke brukt som reserve.

## 4. Testresultater

- `npm test`: 32 besto, 0 feilet, 0 hoppet over.
- JavaScript/MJS: `node --check` besto for alle kilde- og testfiler.
- Edge/konfigurasjon TypeScript: syntakskontroll besto for alle `.ts`-filer.
- Frontend/Workers: `tsc --noEmit --incremental false` besto.
- `npm run build`: Vinext/Vite-produksjonsbygg besto.
- `npm audit --audit-level=low --include=dev`: 0 kjente sårbarheter.
- `npm ls --all --omit=optional --depth=4`: grafen kunne løses. Vinext og flere
  byggkomponenter er fortsatt beta/pre-1.0 og må følges månedlig.
- Artefaktsjekk: 0 `.env`, SQL, tester, ZIP, source maps eller kjente
  serverhemmelighetsmønstre i klient-/serverbygget.
- Wrangler: tomme `vars`, secrets, D1, R2, KV og service-bindings;
  observability er aktivert.
- `git diff --check`: besto.
- Git-historikk: ingen private nøkler, provider-secrets eller service-role JWT
  funnet. Den tilsiktede offentlige Supabase publishable key finnes i klienten.

### Faktiske, ikke-destruktive produksjonsprober

- Den private Sites-adressen svarte 401 uten eierøkt og `no-store` ved
  tilgangsporten. Dette beviser privat adgang, ikke appens egne CSP-headere.
- Med eierøkt rendret forsiden uten konsollstopp, med 0 annonser og en tydelig
  tomtilstand.
- Supabase Data API: offentlige profil-/annonsefelt 200; private profilfelt,
  `contact_info`, `reports` og `boost_orders` 401. Anonym `messages` ga 200 med
  RLS-skjulte rader og er derfor lagt inn som funn.
- Stripe-status: klar i **testmiljø**. Vipps Login/betaling: av. Ingen ekte eller
  test-providerbetaling/refusjon ble utført.
- CORS: produksjonsorigin 200, ukjent ekstern origin 403, localhost 200 før
  Edge-redeploy.

### Ikke bevist i dette miljøet

- Faktisk migreringshistorikk, policyer, Auth-innstillinger og Storage-regler i
  Supabase Dashboard. Ingen `psql`, Deno, Docker eller Supabase CLI var
  tilgjengelig lokalt.
- Tverrbruker-IDOR med to stagingkontoer, Storage-race, Realtime-lekkasje og
  parallelle databasekall mot en ekte stagingdatabase.
- Stripe/Vipps sandboxbetaling, dobbel webhook og refusjon end-to-end.
- Faktiske app-headere bak Sites etter publisering; eierportens 401 skjuler
  applikasjonsresponsen for ekstern curl.
- Supabase Security Advisor, CAPTCHA, SMTP, lekkede-passord-kontroll, MFA,
  rate-limit-konfigurasjon og leverandørdashboard.

## 5. Gjenværende risiko

1. **Medieprosessering:** normal bildeklient dekoder og re-enkoder WebP og
   fjerner metadata, men direkte Storage API kan omgå klientens varighet,
   kodek, filsignatur, dimensjoner og metadata. Før stor trafikk bør opplasting
   gå gjennom isolert scanning/transkoding med CPU-/minne-/tidsgrenser.
2. **Offentlig media:** bucketene er bevisst offentlige. En kjent URL kan leses
   frem til objektet slettes. Opplast-og-forlat kan etterlate foreldreløse
   objekter; innfør en planlagt oppryddingsjobb via Storage API.
3. **Kontosletting:** klienten sletter media før auth-bruker. Hvis databasekallet
   feiler etter medieopprydding, kan kontoen stå igjen uten media. En fullt
   konsistent løsning krever en betrodd serverstyrt slettingsjobb med status og
   retries.
4. **Sesjon/XSS:** `sessionStorage` begrenser persistens, men enhver XSS i samme
   origin kan lese aktiv sesjon. HttpOnly-cookie krever BFF/serverarkitektur.
5. **Boligsøkerskraping:** eier av aktiv annonse kan lese maksimalt 100 synlige
   profiler. Det strukturelle taket er godt, men samme RPC bør få rate limit og
   misbruksovervåking.
6. **Smart Match:** de 500 nyeste ordinære treffene rangeres klient-side. UI er
   nå ærlig om grensen; global rangering krever server-side søk/rangering.
7. **Forsyningskjede:** `vinext@1.0.0-beta.8`, Sites-plugin og enkelte
   byggkomponenter er pre-1.0. Eksakte lockfile-versjoner og ren audit reduserer,
   men fjerner ikke, risikoen. Bruk `npm ci` i CI.
8. **Observability:** Workers-observability er aktivert. Sett kort oppbevaring,
   minste privilegium og filtrering som aldri logger auth-koder, tokens,
   meldinger eller komplett persondata.
9. **Juridisk/organisatorisk:** eieridentitet, organisasjonsnummer,
   kontaktadresse, lagringsregion, behandlingsgrunnlag, slettefrister, refusjon
   og angrerett krever menneskelig/juridisk kvalitetssikring.
10. **Markedsplass/UX:** 0 annonser er den største konverteringsrisikoen. Før
    offentlig åpning bør et lite, verifisert startutvalg skaffes uten falske
    annonser. Hero, filtre, sikkerhetsforklaringer og tomtilstand er ellers
    tydelige og attraktive.

## 6. Prioritert administratorliste

### Kritisk før offentlig lansering

1. Ta Supabase-backup. Kjør alle manglende migreringer i oppgitt rekkefølge i
   staging, særlig 28. august, 31. august og
   `2026-09-01_reporting_hardening.sql`; kjør deretter i produksjon. Ikke bruk
   fresh-install-skjemaet.
2. Deploy alle endrede Edge Functions som importerer `_shared/cors.ts` eller de
   endrede Supabase-hjelperne. Bekreft at localhost nå får 403 i produksjon.
3. Med to testkontoer: test CRUD/IDOR for profiler, annonser, meldinger,
   rapporter, betalinger og Storage; test Realtime-filtrering og at RPC-mangel
   feiler lukket.
4. Kjør Stripe/Vipps sandbox: parallelle startkall, manipulert produkt/beløp,
   dobbel/replayet webhook, feil signatur, full refusjon og åpen-ordre-lås.
5. Aktiver minst 12 tegn, lekkede-passord-kontroll, CAPTCHA, forsvarlige Auth-
   grenser, egen SMTP med SPF/DKIM/DMARC og MFA for administratorer.
6. Fyll alle juridiske plassholdere og få personvern, vilkår, angrerett,
   refusjon, moderering og slettefrister kvalitetssikret.
7. Flytt til nøytralt egendefinert domene og bruk virksomhetskontakt. Sett
   Stripe/Vipps i produksjon først etter full leverandørverifisering og en
   dokumentert go-live-beslutning.

### Første uke etter kontrollert lansering

1. Varsle på økning i 401/403/409/429/5xx, webhook-feil, betalingsforsøk,
   Storage-kvote, rapportspam og moderatorhandlinger.
2. Test backup-gjenoppretting, dokumenter RTO/RPO og kontaktliste for Supabase,
   Stripe, Vipps, hosting og Datatilsynet.
3. Sett administratorroller via separat MFA-konto, minste privilegium og
   revisjonsspor. Ikke bruk privat hovedkonto i daglig moderering.
4. Planlegg isolert mediescanning/transkoding og foreldreløs-media-opprydding.

### Månedlig og ved hver release

1. Kjør `npm ci`, full test, typekontroll, produksjonsbygg, `npm audit`,
   Supabase Security Advisor og faktiske header-/CORS-prober.
2. Gå gjennom avhengelser, beta-komponenter, webhook-/auth-/betalingslogger,
   rapporter, moderatorhistorikk og unormalt høy meldings-/Storage-aktivitet.
3. Test restore, roter secrets etter plan/mistanke, fjern gamle tilganger og
   gjennomfør en enkel hendelsesøvelse.
