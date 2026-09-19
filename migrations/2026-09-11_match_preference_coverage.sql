-- KollektivMatch – lagrede transport- og fasilitetspreferanser
-- Dato: 2026-09-11
-- Additiv migrering: sletter ingen profiler, annonser eller meldinger.

begin;

alter table public.profiles
  add column if not exists max_transit_minutes integer,
  add column if not exists preferred_amenities text[] not null default '{}';

-- Gjør en eventuell delvis tidligere installasjon konsistent og idempotent.
alter table public.profiles
  alter column preferred_amenities set default '{}';
update public.profiles
set preferred_amenities = '{}'
where preferred_amenities is null;
alter table public.profiles
  alter column preferred_amenities set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_max_transit_minutes_range'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles add constraint profiles_max_transit_minutes_range
      check (max_transit_minutes is null or max_transit_minutes between 0 and 600) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_preferred_amenities_values'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles add constraint profiles_preferred_amenities_values
      check (
        preferred_amenities <@ array['matbutikk','kollektivtransport','treningssenter','grontomrade']::text[]
        and cardinality(preferred_amenities) <= 4
      ) not valid;
  end if;
end;
$$;

alter table public.profiles validate constraint profiles_max_transit_minutes_range;
alter table public.profiles validate constraint profiles_preferred_amenities_values;

grant update (max_transit_minutes, preferred_amenities)
  on public.profiles to authenticated;

create or replace function public.validate_home_seeker_profile()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_criteria integer := 0;
begin
  new.seeker_bio := nullif(btrim(new.seeker_bio), '');
  new.search_location := nullif(btrim(new.search_location), '');

  if new.home_seeker_visible then
    v_criteria :=
      (case when new.monthly_budget_max is not null then 1 else 0 end)
      + (case when cardinality(coalesce(new.preferred_property_types, '{}'::text[])) > 0 then 1 else 0 end)
      + (case when new.desired_move_in_date is not null then 1 else 0 end)
      + (case when new.occupation is not null then 1 else 0 end)
      + (case when cardinality(coalesce(new.priority_tags, '{}'::text[])) > 0 then 1 else 0 end)
      + (case when cardinality(coalesce(new.preferred_amenities, '{}'::text[])) > 0 then 1 else 0 end)
      + (case when new.max_transit_minutes is not null then 1 else 0 end)
      + (case when new.search_location is not null then 1 else 0 end);

    if nullif(btrim(coalesce(new.full_name, '')), '') is null then
      raise exception using errcode = '23514', message = 'Navn må fylles ut før boligsøkerprofilen kan vises.';
    end if;
    if v_criteria < 2 then
      raise exception using errcode = '23514', message = 'Fyll ut minst to søkepreferanser før boligsøkerprofilen kan vises.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_home_seeker_profile()
  from public, anon, authenticated;

drop function if exists public.get_home_seekers(uuid);
create function public.get_home_seekers(p_listing_id uuid)
returns table (
  id uuid,
  full_name text,
  avatar_url text,
  occupation text,
  institution text,
  monthly_budget_max integer,
  max_transit_minutes integer,
  preferred_amenities text[],
  priority_tags text[],
  preferred_property_types text[],
  desired_move_in_date date,
  search_location text,
  seeker_bio text,
  is_verified boolean,
  vipps_verified boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Innlogging kreves.';
  end if;
  if not exists (
    select 1 from public.listings l
    where l.id = p_listing_id and l.user_id = auth.uid() and l.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Du må eie en aktiv annonse for å se boligsøkere.';
  end if;

  return query
  select
    p.id, p.full_name, p.avatar_url, p.occupation, p.institution,
    p.monthly_budget_max, p.max_transit_minutes, p.preferred_amenities,
    p.priority_tags, p.preferred_property_types, p.desired_move_in_date,
    p.search_location, p.seeker_bio, p.is_verified,
    coalesce(p.vipps_verified, false), p.updated_at
  from public.profiles p
  where p.home_seeker_visible = true
    and p.id <> auth.uid()
  order by p.updated_at desc
  limit 100;
end;
$$;

revoke all on function public.get_home_seekers(uuid)
  from public, anon, authenticated;
grant execute on function public.get_home_seekers(uuid)
  to authenticated;

comment on function public.get_home_seekers(uuid) is
  'Returnerer frivillig synlige boligsøkere til eieren av en aktiv annonse, uten e-post, telefon eller inntekt.';

commit;
