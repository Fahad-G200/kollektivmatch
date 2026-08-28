-- KollektivMatch – valider eierskap til media og begrens uventet store profilfelt
-- Dato: 2026-08-28
-- Additiv migrering: eksisterende rader beholdes. Nye skriver valideres straks.

begin;

create or replace function public.is_owned_public_storage_url(
  p_url text,
  p_bucket text,
  p_owner uuid
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_url is null or (
    p_owner is not null
    and p_bucket in ('listing-images', 'listing-videos', 'profile-avatars')
    and char_length(p_url) between 80 and 1500
    and p_url like (
      'https://wsfnnaiytweaarncewcr.supabase.co/storage/v1/object/public/'
      || p_bucket || '/' || p_owner::text || '/%'
    )
    and p_url !~ '[[:space:]?#]'
    and p_url !~ E'\\\\'
    and p_url !~ '(^|/)\.\.(/|$)'
  );
$$;

create or replace function public.are_owned_public_storage_urls(
  p_urls text[],
  p_bucket text,
  p_owner uuid
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select
    cardinality(coalesce(p_urls, '{}'::text[])) <= 100
    and coalesce(bool_and(public.is_owned_public_storage_url(value, p_bucket, p_owner)), true)
  from unnest(coalesce(p_urls, '{}'::text[])) as item(value);
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_public_fields_hardened') then
    alter table public.profiles add constraint profiles_public_fields_hardened
      check (
        (full_name is null or char_length(btrim(full_name)) between 1 and 120)
        and (institution is null or char_length(btrim(institution)) between 1 and 160)
        and public.is_owned_public_storage_url(avatar_url, 'profile-avatars', id)
      ) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'listings_owned_media_urls') then
    alter table public.listings add constraint listings_owned_media_urls
      check (
        public.are_owned_public_storage_urls(images, 'listing-images', user_id)
        and public.is_owned_public_storage_url(image_url, 'listing-images', user_id)
        and public.is_owned_public_storage_url(video_url, 'listing-videos', user_id)
        and (
          (cardinality(coalesce(images, '{}'::text[])) = 0 and image_url is null)
          or image_url = images[1]
        )
      ) not valid;
  end if;
end;
$$;

comment on function public.is_owned_public_storage_url(text, text, uuid) is
  'Godtar bare denne installasjonens offentlige Supabase-media i brukerens egen mappe.';
comment on constraint listings_owned_media_urls on public.listings is
  'Hindrer eksterne sporingsressurser, media fra andre brukere og urimelig store bildegallerier.';

-- En gyldig konto skal ikke kunne brukes som ubegrenset offentlig fillager.
-- Funksjonen kjører med eierrettigheter for å telle alle objekter til brukeren
-- uten å åpne storage.objects for direkte lesing.
create or replace function public.storage_quota_available(
  p_bucket text,
  p_max_objects integer
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, storage
as $$
  select
    auth.uid() is not null
    and p_bucket in ('listing-images', 'listing-videos', 'profile-avatars')
    and p_max_objects between 1 and 1000
    and (
      select count(*)
      from storage.objects o
      where o.bucket_id = p_bucket and o.owner = auth.uid()
    ) < p_max_objects;
$$;
revoke all on function public.storage_quota_available(text, integer) from public, anon;
grant execute on function public.storage_quota_available(text, integer) to authenticated;

drop policy if exists "Bruker kan laste opp i egen bildemappe" on storage.objects;
create policy "Bruker kan laste opp i egen bildemappe" on storage.objects for insert
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and lower(name) ~ '\.(webp|jpe?g|png)$'
    and public.storage_quota_available('listing-images', 500)
  );

drop policy if exists "Bruker kan laste opp i egen videomappe" on storage.objects;
create policy "Bruker kan laste opp i egen videomappe" on storage.objects for insert
  with check (
    bucket_id = 'listing-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and lower(name) ~ '\.(mp4|webm|mov)$'
    and public.storage_quota_available('listing-videos', 20)
  );

drop policy if exists "Bruker kan laste opp eget profilbilde" on storage.objects;
create policy "Bruker kan laste opp eget profilbilde" on storage.objects for insert
  with check (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar.webp'
    and public.storage_quota_available('profile-avatars', 2)
  );

commit;
