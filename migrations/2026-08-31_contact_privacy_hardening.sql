-- KollektivMatch – behovsstyrt tilgang til kontaktinformasjon
-- Kjør etter 2026-08-28_payment_and_storage_followup.sql.
-- Migreringen er additiv og sletter ikke annonser eller kontaktdata.

begin;

-- Innloggede brukere skal ikke kunne hente kontakt_info i bulk gjennom
-- listings-tabellen. De beholder samme offentlige annonsefelt som utloggede
-- besøkende. Eieren får egne komplette annonser gjennom get_my_listings().
revoke select on table public.listings from authenticated;

grant select (
  id, user_id, title, description, price, city, area, location_lat,
  location_lon, location_precision, move_in_date, images, image_url,
  video_url, roommates_info, lifestyle_tags, amenities,
  preferred_occupations, transit_minutes, grocery_nearby,
  gym_nearby, green_areas_nearby, property_type, room_size_m2,
  deposit_amount, furnished, rent_includes, status, is_featured,
  featured_until, created_at, updated_at
) on public.listings to authenticated;

create or replace function public.get_my_listings()
returns setof public.listings
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select l.*
  from public.listings l
  where l.user_id = auth.uid()
  order by l.created_at desc;
$$;

revoke all on function public.get_my_listings() from public;
grant execute on function public.get_my_listings() to authenticated;

create or replace function public.get_my_listing(p_listing_id uuid)
returns public.listings
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select l
  from public.listings l
  where l.id = p_listing_id
    and l.user_id = auth.uid();
$$;

revoke all on function public.get_my_listing(uuid) from public;
grant execute on function public.get_my_listing(uuid) to authenticated;

-- En kortlivet tilgangslogg gjør det mulig å begrense systematisk uthenting
-- av kontaktinformasjon uten å eksponere loggen gjennom Data API-et.
create table if not exists public.listing_contact_accesses (
  viewer_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  last_accessed_at timestamptz not null default now(),
  primary key (viewer_id, listing_id)
);

alter table public.listing_contact_accesses enable row level security;
revoke all on table public.listing_contact_accesses from public, anon, authenticated;

create index if not exists listing_contact_accesses_retention_idx
  on public.listing_contact_accesses (last_accessed_at);

create or replace function public.get_listing_contact(p_listing_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_viewer_id uuid := auth.uid();
  v_owner_id uuid;
  v_contact_info text;
  v_already_accessed boolean;
  v_recent_distinct integer;
begin
  if v_viewer_id is null then
    raise exception using errcode = '42501', message = 'Innlogging kreves.';
  end if;

  if p_listing_id is null then
    return null;
  end if;

  -- Serialiser telleren per bruker slik at samtidige kall ikke kan omgå grensen.
  perform pg_advisory_xact_lock(hashtextextended('listing-contact:' || v_viewer_id::text, 0));

  select l.user_id, l.contact_info
    into v_owner_id, v_contact_info
  from public.listings l
  where l.id = p_listing_id
    and (l.status = 'active' or l.user_id = v_viewer_id);

  if not found then
    return null;
  end if;

  -- Eieren kan alltid administrere kontaktfeltet på egne annonser.
  if v_owner_id = v_viewer_id then
    return v_contact_info;
  end if;

  delete from public.listing_contact_accesses
  where last_accessed_at < now() - interval '7 days';

  select exists (
    select 1
    from public.listing_contact_accesses a
    where a.viewer_id = v_viewer_id
      and a.listing_id = p_listing_id
      and a.last_accessed_at >= now() - interval '1 hour'
  ) into v_already_accessed;

  if not v_already_accessed then
    select count(*)::integer
      into v_recent_distinct
    from public.listing_contact_accesses a
    where a.viewer_id = v_viewer_id
      and a.last_accessed_at >= now() - interval '1 hour';

    if v_recent_distinct >= 30 then
      raise exception using
        errcode = '55000',
        message = 'For mange kontaktoppslag. Prøv igjen senere.';
    end if;
  end if;

  insert into public.listing_contact_accesses (viewer_id, listing_id, last_accessed_at)
  values (v_viewer_id, p_listing_id, now())
  on conflict (viewer_id, listing_id)
  do update set last_accessed_at = excluded.last_accessed_at;

  return v_contact_info;
end;
$$;

revoke all on function public.get_listing_contact(uuid) from public;
grant execute on function public.get_listing_contact(uuid) to authenticated;

commit;
