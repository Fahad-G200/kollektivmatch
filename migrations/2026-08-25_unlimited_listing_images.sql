-- KollektivMatch – fjern fast antallsgrense for annonsebilder
-- Dato: 2026-08-25
-- Additiv og databevarende: eksisterende annonser og bilder endres ikke.

begin;

-- Den opprinnelige constrainten samlet bildegrensen med validering av øvrige
-- annonse-arrays. Opprett den på nytt uten bildeantallsleddet, slik at
-- kvalitets-, fasilitets-, målgruppe- og leieinkluderingsverdier fortsatt
-- valideres på databasesiden.
alter table public.listings drop constraint if exists listings_array_limits;

alter table public.listings add constraint listings_array_limits
  check (
    lifestyle_tags <@ array['stort-rom','moderne-stil','nyoppusset-bad','rolig-miljo','stort-kjokken']::text[]
    and cardinality(lifestyle_tags) <= 5
    and amenities <@ array['matbutikk','kollektivtransport','treningssenter','grontomrade']::text[]
    and cardinality(amenities) <= 4
    and preferred_occupations <@ array['student','jobb','annet']::text[]
    and cardinality(preferred_occupations) <= 3
    and rent_includes <@ array['strom','internett','oppvarming','vann']::text[]
    and cardinality(rent_includes) <= 4
  ) not valid;

commit;
