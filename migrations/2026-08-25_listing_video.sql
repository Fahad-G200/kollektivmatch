-- KollektivMatch – én valgfri, kort video per annonse
-- Dato: 2026-08-25
-- Additiv migrering: ingen eksisterende rader eller filer slettes.

begin;

alter table public.listings add column if not exists video_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_video_url_format') then
    alter table public.listings add constraint listings_video_url_format
      check (
        video_url is null
        or (
          char_length(video_url) between 20 and 1500
          and video_url ~ '^https://[^[:space:]]+/storage/v1/object/public/listing-videos/'
        )
      ) not valid;
  end if;
end;
$$;

-- En video er et vanlig, brukerredigerbart annonsefelt. Triggeren validerer
-- fortsatt resten av annonseinnholdet når bare videoen endres.
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
      new.title, new.description, new.price, new.city, new.area, new.move_in_date,
      new.images, new.image_url, new.video_url, new.roommates_info, new.contact_info,
      new.lifestyle_tags, new.amenities, new.preferred_occupations,
      new.transit_minutes, new.grocery_nearby, new.gym_nearby,
      new.green_areas_nearby, new.property_type, new.room_size_m2,
      new.deposit_amount, new.furnished, new.rent_includes, new.status
    ) is distinct from row(
      old.title, old.description, old.price, old.city, old.area, old.move_in_date,
      old.images, old.image_url, old.video_url, old.roommates_info, old.contact_info,
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
  end if;
  return new;
end;
$$;

grant select (video_url) on public.listings to anon, authenticated;
grant insert (video_url) on public.listings to authenticated;
grant update (video_url) on public.listings to authenticated;

insert into storage.buckets (id, name, public)
values ('listing-videos', 'listing-videos', true)
on conflict (id) do update set public = true;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute 'update storage.buckets set file_size_limit = 52428800 where id = ''listing-videos''';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute 'update storage.buckets set allowed_mime_types = array[''video/mp4'',''video/webm'',''video/quicktime''] where id = ''listing-videos''';
  end if;
end;
$$;

drop policy if exists "Alle kan lese annonsevideoer" on storage.objects;
drop policy if exists "Bruker kan laste opp i egen videomappe" on storage.objects;
drop policy if exists "Bruker kan oppdatere i egen videomappe" on storage.objects;
drop policy if exists "Bruker kan slette i egen videomappe" on storage.objects;

create policy "Alle kan lese annonsevideoer" on storage.objects for select
  using (bucket_id = 'listing-videos');
create policy "Bruker kan laste opp i egen videomappe" on storage.objects for insert
  with check (bucket_id = 'listing-videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Bruker kan oppdatere i egen videomappe" on storage.objects for update
  using (bucket_id = 'listing-videos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'listing-videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Bruker kan slette i egen videomappe" on storage.objects for delete
  using (bucket_id = 'listing-videos' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
