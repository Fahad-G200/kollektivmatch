-- KollektivMatch – frivillig skolesøk og omtrentlig områdenærhet
-- Dato: 2026-08-25
-- Additiv migrering: ingen eksisterende rader slettes.

begin;

alter table public.listings add column if not exists location_lat double precision;
alter table public.listings add column if not exists location_lon double precision;
alter table public.listings add column if not exists location_precision text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_approximate_location_valid') then
    alter table public.listings add constraint listings_approximate_location_valid
      check (
        (location_lat is null and location_lon is null and location_precision is null)
        or (
          location_lat between -90 and 90
          and location_lon between -180 and 180
          and location_precision in ('area', 'city')
        )
      ) not valid;
  end if;
end;
$$;

alter table public.listings validate constraint listings_approximate_location_valid;

comment on column public.listings.location_lat is
  'Omtrentlig breddegrad for oppgitt område/by, ikke gateadresse.';
comment on column public.listings.location_lon is
  'Omtrentlig lengdegrad for oppgitt område/by, ikke gateadresse.';
comment on column public.listings.location_precision is
  'Kildenivå for omtrentlig posisjon: area eller city.';

-- Beholder den samlede annonsevalideringen fra forrige migrering og inkluderer
-- de tre nye brukerredigerbare feltene i endringskontrollen.
create or replace function public.validate_listing_write()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_user_fields_changed boolean := true;
begin
  if tg_op = 'UPDATE' then
    v_user_fields_changed := row(
      new.title, new.description, new.price, new.city, new.area, new.location_lat,
      new.location_lon, new.location_precision, new.move_in_date, new.images,
      new.image_url, new.video_url, new.roommates_info, new.contact_info,
      new.lifestyle_tags, new.amenities, new.preferred_occupations,
      new.transit_minutes, new.grocery_nearby, new.gym_nearby,
      new.green_areas_nearby, new.property_type, new.room_size_m2,
      new.deposit_amount, new.furnished, new.rent_includes, new.status
    ) is distinct from row(
      old.title, old.description, old.price, old.city, old.area, old.location_lat,
      old.location_lon, old.location_precision, old.move_in_date, old.images,
      old.image_url, old.video_url, old.roommates_info, old.contact_info,
      old.lifestyle_tags, old.amenities, old.preferred_occupations,
      old.transit_minutes, old.grocery_nearby, old.gym_nearby,
      old.green_areas_nearby, old.property_type, old.room_size_m2,
      old.deposit_amount, old.furnished, old.rent_includes, old.status
    );
  end if;

  if v_user_fields_changed then
    if new.property_type is null then
      raise exception using errcode = '23514', message = 'Boligtype må velges.';
    end if;
    if new.description is null then
      raise exception using errcode = '23514', message = 'Beskrivelse må fylles ut.';
    end if;
    new.title := btrim(new.title);
    new.description := btrim(new.description);
    new.city := btrim(new.city);
    new.area := nullif(btrim(new.area), '');
    new.contact_info := nullif(btrim(new.contact_info), '');
    new.location_precision := nullif(btrim(new.location_precision), '');
  end if;
  return new;
end;
$$;

grant select (location_lat, location_lon, location_precision)
  on public.listings to anon, authenticated;
grant insert (location_lat, location_lon, location_precision)
  on public.listings to authenticated;
grant update (location_lat, location_lon, location_precision)
  on public.listings to authenticated;

commit;
