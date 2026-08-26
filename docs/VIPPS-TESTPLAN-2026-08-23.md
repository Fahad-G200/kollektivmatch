# Vipps ePayment – testplan

Dato: 23. august 2026. Miljø for integrasjonstest skal være Vipps test og et
eget Supabase-testprosjekt. Ingen test skal kjøres mot produksjonsdata.

## Det som er kjørt lokalt

- JavaScript-syntaks for alle endrede frontendfiler.
- TypeScript-syntaks for alle Edge Functions med Node sin TypeScript-parser.
- 5 Smart Match-tester, 6 Storage/avatar-tester, 12 betalingsregeltester, 4
  webhook-signaturtester basert på Vipps sitt offisielle eksempel og 25 statiske
  betalingssikkerhetskontroller.
- Lokal nettlesertest av forside, Min side, innloggingsretur, ugyldig
  ordrenummer, vilkår/personvern og mobilbredde. Ingen horisontal overflow eller
  nye konsollfeil ble funnet etter cache-versjoneringen.

Dette verifiserer kode og sikkerhetskontrakter, men er ikke det samme som et
ekte Vipps-oppgjør. Følgende integrasjonstester må kjøres etter at testnøkler,
webhook-secret, migrasjon og Edge Functions er aktivert:

| # | Test i Vipps testmiljø | Forventet resultat |
|---|---|---|
| 1 | Kjøp for egen aktiv annonse og forsøk mot en annens annonse | Egen tillates; annen avvises med 403 og ingen ordre/boost |
| 2 | Endre vist pris eller request-body i DevTools | Edge Function bruker produktets databasepris |
| 3 | Kjøp `boost_7d` | Vipps og ordre bruker nøyaktig 4900 øre NOK |
| 4 | Kjøp `boost_30d` | Vipps og ordre bruker nøyaktig 9900 øre NOK |
| 5 | Avbryt i Vipps | Ordre blir aborted/cancelled; ingen fremheving |
| 6 | La betalingen utløpe | Ordre blir expired; ingen fremheving |
| 7 | Åpne return-URL med en tilfeldig egen/annen UUID | Ingen aktivering; annen brukers ordre gir 404 |
| 8 | Send webhook uten/med feil HMAC | 401; ingen statusendring eller fremheving |
| 9 | Stopp etter AUTHORIZED | UI viser ikke betalt før full capture er bekreftet |
| 10 | Fullfør godkjent capture | Ordre captured og fremheving aktiveres i samme DB-transaksjon |
| 11 | Lever samme CAPTURED-webhook flere ganger | Samme `boost_applied_at`; perioden forlenges bare én gang |
| 12 | Dobbeltklikk «Betal med Vipps» | Knappen låses og samme pendingordre/idempotency brukes |
| 13 | Kjøp 7 dager med 10 dager igjen | Ny `featured_until` blir ca. 17 dager frem |
| 14 | Hent en annen brukers ordre fra REST og statusfunksjon | RLS/statusfunksjon avviser uten datalekkasje |
| 15 | Kall `request_listing_boost()` som authenticated | Manglende execute-rettighet; ingen fremheving |
| 16 | Refunder captured ordre som admin og som vanlig bruker | Admin fullfører bekreftet refund; vanlig bruker får 403 |
| 17 | Skann frontend/deploy og nettverkslogger | Ingen Vipps-secret eller `service_role`; ingen kortdata lagres |
| 18 | Prøv testnøkler mot prod-base og prod uten bekreftelsesflagg | Funksjonen stopper før Vipps-kall |

I tillegg skal oppgjør kontrolleres manuelt i Vipps-portalen og på registrert
bedriftskonto ved en liten produksjonsbetaling etter godkjent produksjonsavtale.
