-- Add Hytte consistently to listings and saved preferences. No data is deleted.
begin;
alter table public.listings drop constraint if exists listings_property_type_values;
alter table public.listings add constraint listings_property_type_values
  check (property_type is null or property_type in ('leilighet','hybel','enebolig','rekkehus','studentbolig','hytte','annet')) not valid;
alter table public.profiles drop constraint if exists profiles_preferred_property_types_values;
alter table public.profiles add constraint profiles_preferred_property_types_values
  check (preferred_property_types <@ array['leilighet','hybel','enebolig','rekkehus','studentbolig','hytte','annet']::text[]
    and cardinality(preferred_property_types) <= 7) not valid;
commit;
