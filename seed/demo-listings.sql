-- ============================================================================
-- KollektivMatch – valgfrie DEMO-annonser for å teste Smart Match
-- ============================================================================
--
-- Hva dette er:
--   5 tydelig oppdiktede testannonser (ingen ekte personer, adresser eller
--   bilder) slik at du kan se Smart Match og matchprosenten fungere med et
--   ikke-tomt resultatsett før dere har ekte annonsører.
--
-- Hva dette IKKE er:
--   Dette er ikke hentet fra FINN.no eller noen annen markedsplass. Dette
--   prosjektet skal aldri kopiere, skrape eller vise andres reelle annonser
--   uten samtykke og avtale – se README.md ("FINN.no-data") og
--   docs/FIRST-LISTINGS-PLAN.md. Bruk den planen for å skaffe ekte,
--   samtykkebaserte annonser når dere er klare for det.
--
-- Slik bruker du filen:
--   1. Kjør migreringene i README.md først (denne filen forutsetter at alle
--      daterte migreringene allerede er kjørt).
--   2. Opprett en egen test-bruker (f.eks. via registreringsskjemaet eller
--      Supabase Authentication-fanen) som får eie testannonsene.
--   3. Hent brukerens id: i Supabase SQL Editor,
--        select id, email from auth.users order by created_at desc;
--   4. Lim inn den UUID-en i stedet for null her
--      under (én plass, i variabelen v_user_id).
--   5. Kjør hele filen i Supabase SQL Editor.
--   6. Fjern testdataene igjen når dere ikke trenger dem lenger, se
--      opprydningsspørringen helt nederst i filen.
--
-- Denne filen er trygg å kjøre flere ganger: den sletter først eventuelle
-- tidligere demo-rader for samme bruker (kjenner dem igjen på "[DEMO]"-
-- prefikset i tittelen) før den setter inn nye.

do $$
declare
  v_user_id uuid := null; -- Erstatt null med testprofilens UUID i enkle anførselstegn.
begin
  if v_user_id is null then
    raise exception 'Sett v_user_id til en ekte profil-id før du kjører denne filen.';
  end if;

  if not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'Testprofilen finnes ikke.';
  end if;

  delete from public.listings
  where user_id = v_user_id and title like '[DEMO]%';

  insert into public.listings (
    user_id, title, description, price, city, area, move_in_date,
    roommates_info, contact_info, lifestyle_tags, amenities,
    preferred_occupations, transit_minutes, grocery_nearby, gym_nearby,
    green_areas_nearby, location_lat, location_lon, location_precision, property_type, room_size_m2, deposit_amount,
    furnished, rent_includes, status
  ) values
  (
    v_user_id,
    '[DEMO] Lyst rom nær Blindern',
    'Oppdiktet testannonse for Smart Match. Rolig kollektiv med tre studenter, femten minutter til Blindern med sykkel. Fellesareal er nypusset og delt likt mellom alle beboerne.',
    7900, 'Oslo', 'Blindern', current_date + interval '30 days',
    'To jenter og en gutt, alle på NTNU/UiO-alder, rolige hverdager og sosiale helger.',
    'Bruk meldingsfunksjonen i appen for testing.',
    array['rolig-miljo','stort-kjokken'], array['matbutikk','kollektivtransport','grontomrade'],
    array['student'], 12, true, false, true, 59.94, 10.72, 'area',
    'hybel', 14.0, 7900, true, array['internett','vann'], 'active'
  ),
  (
    v_user_id,
    '[DEMO] Moderne leilighet i Bergen sentrum',
    'Oppdiktet testannonse for Smart Match. Ett soverom ledig i delt leilighet med kort vei til Høyden og bybanen. Nyoppusset bad og godt lysinnslipp.',
    9200, 'Bergen', 'Sentrum', current_date + interval '14 days',
    'Delt med en person som jobber turnus, så det er stille på dagtid.',
    'Bruk meldingsfunksjonen i appen for testing.',
    array['nyoppusset-bad','moderne-stil'], array['matbutikk','kollektivtransport','treningssenter'],
    array['student','jobb'], 8, true, true, false, 60.39, 5.32, 'area',
    'leilighet', 16.5, 9200, true, array['strom','internett'], 'active'
  ),
  (
    v_user_id,
    '[DEMO] Studenthybel ved Gløshaugen',
    'Oppdiktet testannonse for Smart Match. Enkel og rimelig hybel i studentbolig-kompleks rett ved campus, perfekt for første studieår.',
    5600, 'Trondheim', 'Gløshaugen', current_date + interval '45 days',
    null,
    'Bruk meldingsfunksjonen i appen for testing.',
    array['stort-rom'], array['matbutikk'],
    array['student'], 5, true, false, false, 63.42, 10.40, 'area',
    'studentbolig', 12.0, 5600, false, array['strom','vann','internett'], 'active'
  ),
  (
    v_user_id,
    '[DEMO] Rom i rekkehus med hage, Tromsø',
    'Oppdiktet testannonse for Smart Match. Ledig rom i rekkehus delt med to i jobb, god plass og en liten hage som brukes om sommeren.',
    6800, 'Tromsø', 'Tromsdalen', current_date + interval '20 days',
    'To i full jobb, stille husholdning på hverdager.',
    'Bruk meldingsfunksjonen i appen for testing.',
    array['stort-kjokken','rolig-miljo'], array['grontomrade'],
    array['jobb'], 20, false, false, true, 69.64, 19.00, 'area',
    'rekkehus', 18.0, 6800, true, array[]::text[], 'active'
  ),
  (
    v_user_id,
    '[DEMO] Rolig enebolig utenfor Stavanger',
    'Oppdiktet testannonse for Smart Match. Ledig rom i enebolig litt utenfor sentrum, passer for noen som ønsker ro og har egen transport.',
    6200, 'Stavanger', 'Hundvåg', current_date + interval '60 days',
    'Delt med en eldre student og en katt.',
    'Bruk meldingsfunksjonen i appen for testing.',
    array['rolig-miljo'], array['grontomrade'],
    array['annet'], 35, false, false, true, 58.99, 5.73, 'area',
    'enebolig', 15.0, 6200, false, array['oppvarming'], 'active'
  );
end $$;

-- ----------------------------------------------------------------------------
-- Opprydning – kjør denne når du er ferdig med å teste Smart Match:
--
--   delete from public.listings
--   where user_id = 'REPLACE_WITH_TEST_PROFILE_UUID' and title like '[DEMO]%';
-- ----------------------------------------------------------------------------
