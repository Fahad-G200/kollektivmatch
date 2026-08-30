# Sikkerhetsrevisjon – 28. august 2026

Status: lokal kodegjennomgang og herding fullført. Ekstern migrering,
Edge Function-deploy og stagingtester gjenstår hos administrator.

Ingen nettjeneste kan garanteres 100 prosent sikker. Endringene under fjerner
bekreftede svakheter og reduserer risiko, men erstatter ikke driftsovervåking,
oppdateringer, backup, tilgangsrevisjoner eller hendelseshåndtering.

## Omfang og arkitektur

- Nettleserklient med lokalt bygget JavaScript og Tailwind
- Supabase Auth med PKCE, PostgreSQL, RLS, Storage og Realtime
- Supabase Edge Functions for Vipps Login, Vipps ePayment og Stripe Checkout
- Signerte Stripe- og Vipps-webhooks
- Vinext, Cloudflare Workers/Wrangler og OpenAI Sites
- NPM-avhengigheter, produksjonsbygg, publiseringsarkiv og Git-historikk

Dataflyten er nettleser → Supabase Auth/RLS eller autentisert Edge Function →
Stripe/Vipps. Nettleseren sender bare produkt- og annonse-ID. Pris, valuta,
varighet, eierskap og leveranse bestemmes på serveren. Kortnummer, CVC,
bankpassord og betalingsnøkler skal aldri gå gjennom nettleserkoden.

## Baseline og sammenligning

Baseline var `docs/AUDIT-2026-08-23.md`,
`docs/VIPPS-TESTPLAN-2026-08-23.md` og committene `265a88a`/`31aa760`.
Den tidligere revisjonen hadde allerede etablert PKCE, streng CSP, HSTS,
serverpris, signerte webhooks, RLS/RPC-herding, lokale frontendavhengigheter,
størrelsesgrenser og media-allowlist. Denne oppfølgingen fant nye problemer i
kombinasjonen Stripe/Vipps, nyere Supabase Storage-eierskap, parallelle kall,
Stripe-refusjon og enkelte driftsdetaljer.

## Bekreftede funn

| ID | Grad | Komponent | Status |
|---|---|---|---|
| KM-2026-01 | Høy | Stripe/Vipps ordreoppretting | Rettet lokalt |
| KM-2026-02 | Høy | Stripe-refusjon og refund-webhook | Rettet lokalt |
| KM-2026-03 | Middels | Leverandørisolasjon i Vipps webhook/refusjon | Rettet lokalt |
| KM-2026-04 | Middels | Supabase Storage-eierskap og objektstier | Rettet lokalt |
| KM-2026-05 | Middels | Parallelle meldings- og opplastingsgrenser | Rettet lokalt |
| KM-2026-06 | Lav | Cache på private sider | Rettet lokalt |
| KM-2026-07 | Lav | Retur-/konfigurasjons- og betalings-URL-er | Rettet lokalt |
| KM-2026-08 | Lav | Forsyningskjede og utdatert personverntekst | Rettet lokalt |
| KM-2026-09 | Lav | Kontoenumerering og tabnabbing | Rettet lokalt |

### KM-2026-01 – to betalbare løp for samme annonse

- Scenario: En bruker kunne starte Stripe og Vipps samtidig eller etter
  hverandre. Den gamle Vipps-signaturen kunne gjenbruke feil ordre, mens
  Stripe-varianten bare dedupliserte innen samme leverandør.
- Konsekvens: risiko for dobbelt belastning, leverandørforveksling eller dobbel
  fremhevingsleveranse.
- Rotårsak: åpen-ordre-kontrollen var ikke global per annonse.
- Rettelse: ny fem-arguments RPC låser annonseraden og tillater bare én
  `pending`/`authorized` ordre per annonse på tvers av leverandører. Legacy-RPC
  går gjennom samme kode med eksplisitt `vipps`. Statusendring og sletting
  blokkeres mens ordren er betalbar.
- Verifikasjon: nye statiske regresjonskontroller bekrefter lås, provider-felt,
  minst privilegium og begge kallestedene. Transaksjonell stagingtest gjenstår.

### KM-2026-02 – manglende sikker Stripe-refusjon

- Scenario: Adminfunksjonen antok Vipps. En Stripe-refusjon gjort i Dashboard
  ville ikke nødvendigvis markere ordren refundert eller trekke tilbake ubrukt
  fremheving.
- Konsekvens: feil mellom betaling, regnskap og levert produkt.
- Rotårsak: refusjonsflyten og webhook-listen var ikke leverandørnøytral.
- Rettelse: Stripe-refusjon bruker PaymentIntent, serverlagret beløp og valuta,
  separat idempotency key og full identitetskontroll. `charge.refunded` håndteres
  på signert rå webhook-body; bare full refund anvendes. PaymentIntent lagres
  før levering og har unik indeks.
- Verifikasjon: regresjonstester dekker refund-endepunkt, idempotens,
  PaymentIntent-binding, webhook-oppslag, beløp og `apply_boost_refund`.

### KM-2026-03 – leverandørforveksling

- Scenario: En Stripe-ordre kunne sendes til gammel Vipps-refusjonskode, og
  Vipps-webhooken søkte bare på referanse.
- Konsekvens: feil leverandørkall og uklar ordretilstand.
- Rettelse: alle Vipps-avstemminger, webhooks og refusjoner krever eksplisitt
  `payment_provider = 'vipps'`; ukjent leverandør avvises.

### KM-2026-04 – Storage-eierskap, stier og overskriving

- Scenario: eldre policyer brukte det utfasete `owner`-feltet og godtok bredere
  mapper/URL-er. Listing-media kunne overskrives på samme sti.
- Konsekvens: svakere eierskapskontroll, tvetydige kodede stier og større
  misbruksflate.
- Rettelse: `owner_id`, eksakt bucket/eier/origin, ett filsegment,
  UUID-filnavn og tillatte endelser. Annonsemedia er immutable; avatar kan bare
  være `<user>/avatar.webp`. Listing og sletting krever faktisk Storage-eier.

### KM-2026-05 – parallelle kall kunne omgå tellinger

- Scenario: samtidige meldinger eller opplastinger kunne lese samme tellestand
  før noen av transaksjonene skrev.
- Konsekvens: overskridelse av spam- og lagringsgrenser.
- Rettelse: transaksjonelle advisory-låser serialiserer samme avsender eller
  samme bruker/bucket før telling og skriving. Andre brukere blokkeres ikke.

### KM-2026-06 til KM-2026-09 – nettleser og drift

- `dashboard.html` og `create-listing.html` har nå `no-store` i både statisk og
  serverstyrt headerkonfigurasjon.
- `returnTo` har lengde-, scheme-, origin- og credential-kontroll.
- APP_BASE_URL/Supabase-callback må være en ren rot-origin uten credentials,
  query eller fragment. Stripe/Vipps-kall har eksplisitte timeouts.
- Nettleseren tillater bare HTTPS-redirect til `checkout.stripe.com`.
- Sites-pluginen er eksakt låst til `0.2.0`; personvernteksten beskriver nå
  lokal bundling i stedet for gamle CDN-importer.
- Registreringsfeil avslører ikke lenger direkte at en e-post finnes, og alle
  lenker som åpner ny fane bruker `noopener noreferrer`.

## Testresultater

- `npm test`: 23 av 23 Node-testoppføringer besto, 0 feilet. Testfilene
  rapporterer samlet 395 funksjonelle og statiske kontroller, inkludert 50 nye
  oppfølgingskontroller og 41 Stripe-kontroller.
- Nettleser-JavaScript/MJS: `node --check` besto for alle filer.
- Edge Functions: Node sin TypeScript-syntakskontroll besto for alle `.ts`-
  filer. Full Deno-typekontroll kunne ikke kjøres fordi Deno/Supabase CLI ikke
  er installert i miljøet.
- Frontend/Workers: `tsc --noEmit --incremental false` besto.
- `npm run build`: Vinext-produksjonsbygg besto.
- `npm audit --audit-level=low --include=dev`: 0 kjente sårbarheter i hele den
  låste transitive grafen.
- Produksjonsartefakt: ingen source maps, `.env`, SQL, tester, arkiver eller
  kjente serverhemmelighetsmønstre. Wrangler-artefakten har ingen D1/R2/KV-
  bindings eller runtime-secrets.
- `git diff --check`: besto.
- Git-historikk: ingen private nøkler, provider-secrets eller service-role JWT
  ble funnet. Bare den tilsiktede offentlige Supabase publishable key finnes i
  klientkonfigurasjonen.

## Kontroller som ikke er bevist lokalt

- Migreringen er ikke kjørt mot Supabase, og oppdaterte Edge Functions er ikke
  deployet. RLS/Storage og parallelle transaksjoner må derfor testes i staging
  med to testbrukere før offentlig lansering.
- Ingen ekte eller test-providerbetaling/refusjon ble utført i denne revisjonen.
- Deno-typekontroll, Supabase Security Advisor, faktisk Auth-konfigurasjon,
  SMTP, CAPTCHA, MFA, lekkede-passord-kontroll og rate limits krever dashboard-
  eller CLI-tilgang.
- Produksjonsheaderne må kontrolleres på den publiserte URL-en etter deploy.

## Gjenværende risiko

1. Bilder og video valideres med bucket-MIME/endelse/størrelse og klientkontroll,
   men det finnes ikke en server-side medieproxy som dekoder filsignatur,
   dimensjoner, kodek, varighet og metadata. Før stor offentlig trafikk bør
   opplasting gå gjennom isolert scanning/transkoding med CPU-/minne-/tidsgrenser.
2. Sesjonen lagres i `sessionStorage`, mens bare kortlivet PKCE code-verifier
   deles via `localStorage` for e-postcallback i ny fane. Dette begrenser
   persistens, men enhver XSS i samme origin kan fortsatt lese aktiv sesjon. En
   HttpOnly-cookie krever et reelt BFF/serverarkitekturbytte; streng CSP, lokal
   bundling og escaping er derfor dagens primære vern.
3. Eiere av en aktiv annonse kan lese opptil 100 frivillig synlige
   boligsøkerprofiler. Det er tilsiktet, men krever overvåking mot scraping og en
   tydelig misbruks-/blokkeringsrutine.
4. Vinext er beta og flere byggkomponenter er pre-1.0. Versjonene er eksakt
   låst og audit er ren, men kjeden må oppdateres kontrollert og bygges på nytt
   minst månedlig.
5. Workers-observability er aktiv i bygget. Sett kort oppbevaring, tilgang på
   minste privilegium og varsling uten å logge auth-koder, tokens, meldinger
   eller komplette persondata.
6. Juridisk navn, organisasjonsnummer, kontaktadresse, driftsleverandør,
   datalagringsregion og slettefrister er fortsatt plassholdere. Dette er en
   lanseringsblokkering som krever eier/juridisk vurdering.

## Prioritert administratorliste

### Før offentlig lansering

1. Ta Supabase-backup. Kjør
   `migrations/2026-08-28_payment_and_storage_followup.sql` i staging først og
   deretter produksjon. Ikke kjør fresh-install-skjemaet.
2. Deploy alle endrede Edge Functions og registrer `charge.refunded` i Stripe-
   webhooken. Bekreft eksakt produksjons-APP_BASE_URL og secrets uten å kopiere
   dem til Git eller chat.
3. Med to testbrukere: test IDOR/RLS for profiler, annonser, meldinger,
   betalinger og Storage; test parallelle Stripe/Vipps-startkall, dobbel
   webhook, full refusjon og sletting/status under åpen betaling.
4. Aktiver minst 12 tegn, lekkede-passord-kontroll, CAPTCHA, forsvarlige Auth-
   rate limits, egnet SMTP/SPF/DKIM/DMARC og MFA for administratorer.
5. Fyll alle juridiske plassholdere og få vilkår, refusjon, angrerett,
   personvern og slettefrister kvalitetssikret.

### Første uke

1. Sett alarmer på økning i 401/403/409/429/5xx, webhook-feil, gjentatte
   betalingsforsøk, Storage-kvote og moderatorhendelser.
2. Test backup-gjenoppretting, dokumenter RTO/RPO og lag en kontaktliste for
   Supabase, Stripe, Vipps, hosting og Datatilsynet.
3. Innfør administratortilgang med separat konto, MFA, minste privilegium og
   månedlig tilgangsrevisjon.
4. Planlegg isolert mediescanning/transkoding før stor trafikk.

### Månedlig og ved hver release

1. Kjør full test, produksjonsbygg, `npm audit`, Supabase Security Advisor og
   kontroll av faktiske responsheadere.
2. Gå gjennom avhengelsesoppdateringer, webhook-feil, auth-/betalingslogger,
   moderatoravgjørelser og unormalt høy meldings-/opplastingsaktivitet.
3. Test restore, roter secrets etter plan eller mistanke, fjern gamle
   tilganger og gjennomfør en enkel hendelsesøvelse.
