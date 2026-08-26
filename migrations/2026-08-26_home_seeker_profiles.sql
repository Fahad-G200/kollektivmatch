-- KollektivMatch – frivillige boligsøkerprofiler for utleiere
-- Dato: 2026-08-26
-- Additiv migrering: sletter ingen profiler, annonser eller meldinger.

begin;

alter table public.profiles add column if not exists home_seeker_visible boolean not null default false;
alter table public.profiles add column if not exists seeker_bio text;
alter table public.profiles add column if not exists search_location text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_home_seeker_text_limits') then
    alter table public.profiles add constraint profiles_home_seeker_text_limits
      check (
        (seeker_bio is null or char_length(seeker_bio) <= 300)
        and (search_location is null or char_length(search_location) <= 100)
      ) not valid;
  end if;
end;
$$;

alter table public.profiles validate constraint profiles_home_seeker_text_limits;

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

drop trigger if exists validate_home_seeker_profile_trigger on public.profiles;
create trigger validate_home_seeker_profile_trigger
  before insert or update on public.profiles
  for each row execute function public.validate_home_seeker_profile();

create index if not exists profiles_visible_home_seekers_idx
  on public.profiles (updated_at desc)
  where home_seeker_visible = true;

-- De nye feltene kan bare endres av profilens eier gjennom eksisterende RLS.
-- De gis ikke som direkte SELECT-kolonner til andre brukere.
grant update (home_seeker_visible, seeker_bio, search_location)
  on public.profiles to authenticated;

create or replace function public.get_home_seekers(p_listing_id uuid)
returns table (
  id uuid,
  full_name text,
  avatar_url text,
  occupation text,
  institution text,
  monthly_budget_max integer,
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
    p.monthly_budget_max, p.priority_tags, p.preferred_property_types,
    p.desired_move_in_date, p.search_location, p.seeker_bio,
    p.is_verified, coalesce(p.vipps_verified, false), p.updated_at
  from public.profiles p
  where p.home_seeker_visible = true
    and p.id <> auth.uid()
  order by p.updated_at desc
  limit 100;
end;
$$;
revoke all on function public.get_home_seekers(uuid) from public;
grant execute on function public.get_home_seekers(uuid) to authenticated;

-- En utleier kan starte én samtale med en frivillig synlig boligsøker.
-- Videre meldinger går gjennom den eksisterende, begrensede send_message-RPC-en.
create or replace function public.contact_home_seeker(
  p_listing_id uuid,
  p_seeker_id uuid,
  p_content text
)
returns public.messages
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_content text := btrim(coalesce(p_content, ''));
  v_message public.messages;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Innlogging kreves.';
  end if;
  if p_seeker_id is null or p_seeker_id = v_owner_id then
    raise exception using errcode = '22023', message = 'Ugyldig mottaker.';
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 2000 then
    raise exception using errcode = '22023', message = 'Meldingen må inneholde 1–2000 tegn.';
  end if;
  if not exists (
    select 1 from public.listings l
    where l.id = p_listing_id and l.user_id = v_owner_id and l.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Du må eie en aktiv annonse for å kontakte boligsøkeren.';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_seeker_id and p.home_seeker_visible = true
  ) then
    raise exception using errcode = '42501', message = 'Boligsøkerprofilen er ikke tilgjengelig.';
  end if;

  select m.* into v_message
  from public.messages m
  where m.listing_id = p_listing_id
    and ((m.sender_id = v_owner_id and m.receiver_id = p_seeker_id)
      or (m.sender_id = p_seeker_id and m.receiver_id = v_owner_id))
  order by m.created_at desc
  limit 1;
  if found then
    return v_message;
  end if;

  if (select count(*) from public.messages m where m.sender_id = v_owner_id and m.created_at > now() - interval '1 minute') >= 5
     or (select count(*) from public.messages m where m.sender_id = v_owner_id and m.created_at > now() - interval '1 hour') >= 25 then
    raise exception using errcode = 'P0001', message = 'For mange nye henvendelser. Vent litt.';
  end if;

  insert into public.messages (listing_id, sender_id, receiver_id, content)
  values (p_listing_id, v_owner_id, p_seeker_id, v_content)
  returning * into v_message;
  return v_message;
end;
$$;
revoke all on function public.contact_home_seeker(uuid, uuid, text) from public;
grant execute on function public.contact_home_seeker(uuid, uuid, text) to authenticated;

comment on column public.profiles.home_seeker_visible is
  'Eksplisitt opt-in: trygg profilinformasjon kan vises til innloggede eiere av aktive annonser.';
comment on function public.get_home_seekers(uuid) is
  'Returnerer bare frivillig synlige og begrensede profilfelt til eieren av en aktiv annonse.';

commit;
