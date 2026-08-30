-- KollektivMatch – leverandørisolasjon, kryssleverandørlås og strammere Storage
-- Dato: 2026-08-28
-- Additiv oppfølging: sletter ingen ordrer, filer, annonser eller brukere.

begin;

-- Bare én betalbar fremhevingsordre kan være åpen for samme annonse om gangen,
-- uavhengig av leverandør. Låsen på annonseraden serialiserer samtidige kall.
create or replace function public.create_boost_order(
  p_user_id uuid,
  p_listing_id uuid,
  p_product_id text,
  p_terms_version text,
  p_payment_provider text
)
returns public.boost_orders
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_listing public.listings;
  v_product public.boost_products;
  v_existing public.boost_orders;
  v_order public.boost_orders;
  v_order_id uuid := gen_random_uuid();
begin
  if p_user_id is null or p_listing_id is null then
    raise exception using errcode = '22023', message = 'Ugyldig betalingsforespørsel.';
  end if;
  if p_terms_version is distinct from '2026-08-23' then
    raise exception using errcode = '22023', message = 'Betalingsvilkårene må godtas.';
  end if;
  if p_payment_provider not in ('vipps', 'stripe') then
    raise exception using errcode = '22023', message = 'Ugyldig betalingsleverandør.';
  end if;

  select * into v_listing
  from public.listings
  where id = p_listing_id
  for update;
  if not found or v_listing.user_id <> p_user_id then
    raise exception using errcode = '42501', message = 'Annonsen kan ikke fremheves av denne brukeren.';
  end if;
  if v_listing.status is distinct from 'active' then
    raise exception using errcode = '22023', message = 'Bare aktive annonser kan fremheves.';
  end if;

  select * into v_product
  from public.boost_products
  where id = p_product_id and is_active = true;
  if not found then
    raise exception using errcode = '22023', message = 'Ugyldig fremhevingsprodukt.';
  end if;

  select * into v_existing
  from public.boost_orders
  where user_id = p_user_id
    and listing_id = p_listing_id
    and (
      status = 'authorized'
      or (status = 'pending' and created_at > now() - interval '25 hours')
    )
  order by created_at desc
  limit 1
  for update;

  if found then
    if v_existing.payment_provider = p_payment_provider
       and v_existing.product_id = p_product_id then
      return v_existing;
    end if;
    raise exception using
      errcode = '55000',
      message = 'En annen betaling for denne annonsen pågår. Fullfør eller avbryt den først.';
  end if;

  if (
    select count(*)
    from public.boost_orders
    where user_id = p_user_id
      and listing_id = p_listing_id
      and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception using errcode = 'P0001', message = 'For mange betalingsforsøk. Vent og prøv igjen.';
  end if;

  insert into public.boost_orders (
    id, reference, user_id, listing_id, listing_title,
    product_id, product_name, duration_days, amount_ore, currency,
    idempotency_key, terms_version, terms_accepted_at, payment_provider
  ) values (
    v_order_id, 'KM-' || replace(v_order_id::text, '-', ''), p_user_id,
    p_listing_id, left(v_listing.title, 100), v_product.id, v_product.name,
    v_product.duration_days, v_product.price_ore, v_product.currency,
    gen_random_uuid(), p_terms_version, now(), p_payment_provider
  ) returning * into v_order;

  return v_order;
end;
$$;

-- Legacy-Vipps-signaturen beholdes, men går alltid gjennom den samme
-- leverandørbevisste låsen. Den kan derfor aldri gjenbruke en Stripe-ordre.
create or replace function public.create_boost_order(
  p_user_id uuid,
  p_listing_id uuid,
  p_product_id text,
  p_terms_version text
)
returns public.boost_orders
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.create_boost_order(
    p_user_id,
    p_listing_id,
    p_product_id,
    p_terms_version,
    'vipps'
  );
$$;

revoke all on function public.create_boost_order(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.create_boost_order(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_boost_order(uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.create_boost_order(uuid, uuid, text, text)
  to service_role;

create unique index if not exists boost_orders_provider_payment_unique_idx
  on public.boost_orders (payment_provider, provider_payment_id)
  where provider_payment_id is not null;

-- Statusendring og sletting blokkeres for begge betalingsleverandører.
create or replace function public.guard_listing_during_open_boost_checkout()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  if exists (
    select 1
    from public.boost_orders o
    where o.listing_id = old.id
      and (
        o.status = 'authorized'
        or (o.status = 'pending' and o.created_at > now() - interval '25 hours')
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'Betaling for fremheving pågår. Vent til betalingen er ferdig eller utløpt.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.guard_listing_during_open_boost_checkout()
  from public, anon, authenticated;

-- Meldingsgrenser må også holde ved parallelle direkte API-kall. Den
-- transaksjonelle advisory-låsen serialiserer bare samme avsender.
create or replace function public.send_message(
  p_listing_id uuid,
  p_receiver_id uuid,
  p_content text
)
returns public.messages
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sender_id uuid := auth.uid();
  v_owner_id uuid;
  v_status text;
  v_message public.messages;
  v_content text := btrim(coalesce(p_content, ''));
begin
  if v_sender_id is null then
    raise exception using errcode = '42501', message = 'Innlogging kreves.';
  end if;
  if p_receiver_id is null or p_receiver_id = v_sender_id then
    raise exception using errcode = '22023', message = 'Ugyldig mottaker.';
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 2000 then
    raise exception using errcode = '22023', message = 'Meldingen må inneholde 1–2000 tegn.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_sender_id::text, 0));

  select l.user_id, l.status into v_owner_id, v_status
  from public.listings l where l.id = p_listing_id;
  if not found then
    raise exception using errcode = '22023', message = 'Annonsen finnes ikke.';
  end if;

  if v_sender_id = v_owner_id then
    if not exists (
      select 1 from public.messages m
      where m.listing_id = p_listing_id
        and m.sender_id = p_receiver_id
        and m.receiver_id = v_sender_id
    ) then
      raise exception using errcode = '42501', message = 'Eier kan bare svare i en startet samtale.';
    end if;
  elsif p_receiver_id <> v_owner_id then
    raise exception using errcode = '42501', message = 'Første melding må sendes til annonsens eier.';
  elsif v_status <> 'active' and not exists (
    select 1 from public.messages m
    where m.listing_id = p_listing_id
      and ((m.sender_id = v_sender_id and m.receiver_id = v_owner_id)
        or (m.sender_id = v_owner_id and m.receiver_id = v_sender_id))
  ) then
    raise exception using errcode = '42501', message = 'Annonsen er ikke aktiv.';
  end if;

  if (select count(*) from public.messages m where m.sender_id = v_sender_id and m.created_at > now() - interval '1 minute') >= 5
     or (select count(*) from public.messages m where m.sender_id = v_sender_id and m.created_at > now() - interval '1 hour') >= 50 then
    raise exception using errcode = 'P0001', message = 'For mange meldinger. Vent litt.';
  end if;

  insert into public.messages (listing_id, sender_id, receiver_id, content)
  values (p_listing_id, v_sender_id, p_receiver_id, v_content)
  returning * into v_message;
  return v_message;
end;
$$;
revoke all on function public.send_message(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.send_message(uuid, uuid, text) to authenticated;

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

  perform pg_advisory_xact_lock(hashtextextended(v_owner_id::text, 0));

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
revoke all on function public.contact_home_seeker(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.contact_home_seeker(uuid, uuid, text) to authenticated;

-- Lagrings-URL-er må være én enkel objektsti på riktig origin, bucket og eier.
-- Prosentkoding og ekstra undermapper avvises for å fjerne tvetydig tolking.
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
    and char_length(p_url) between 80 and 600
    and p_url ~ (
      '^https://wsfnnaiytweaarncewcr[.]supabase[.]co/storage/v1/object/public/'
      || p_bucket || '/' || p_owner::text
      || '/[A-Za-z0-9][A-Za-z0-9._-]{0,254}$'
    )
    and (
      (p_bucket = 'listing-images' and lower(p_url) ~ '[.](webp|jpe?g|png)$')
      or (p_bucket = 'listing-videos' and lower(p_url) ~ '[.](mp4|webm|mov)$')
      or (p_bucket = 'profile-avatars' and p_url ~ '/avatar[.]webp$')
    )
  );
$$;

-- Supabase har erstattet den gamle owner-kolonnen med owner_id. Bruk den
-- aktuelle kolonnen når den finnes, med en kompatibel fallback for eldre miljø.
create or replace function public.storage_quota_available(
  p_bucket text,
  p_max_objects integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, storage, information_schema
as $$
declare
  v_user_id uuid := auth.uid();
  v_count bigint := 0;
begin
  if v_user_id is null
     or p_bucket not in ('listing-images', 'listing-videos', 'profile-avatars')
     or p_max_objects not between 1 and 1000 then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || p_bucket, 0)
  );

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id'
  ) then
    execute 'select count(*) from storage.objects where bucket_id = $1 and owner_id = $2'
      into v_count using p_bucket, v_user_id::text;
  else
    execute 'select count(*) from storage.objects where bucket_id = $1 and owner = $2'
      into v_count using p_bucket, v_user_id;
  end if;

  return v_count < p_max_objects;
end;
$$;
revoke all on function public.storage_quota_available(text, integer) from public, anon;
grant execute on function public.storage_quota_available(text, integer) to authenticated;

-- Nye objekter må bruke de tilfeldige UUID-navnene klienten genererer.
drop policy if exists "Bruker kan laste opp i egen bildemappe" on storage.objects;
create policy "Bruker kan laste opp i egen bildemappe" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'listing-images'
    and name ~ ('^' || auth.uid()::text || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](webp|jpe?g|png)$')
    and public.storage_quota_available('listing-images', 500)
  );

drop policy if exists "Bruker kan laste opp i egen videomappe" on storage.objects;
create policy "Bruker kan laste opp i egen videomappe" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'listing-videos'
    and name ~ ('^' || auth.uid()::text || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](mp4|webm|mov)$')
    and public.storage_quota_available('listing-videos', 20)
  );

drop policy if exists "Bruker kan laste opp eget profilbilde" on storage.objects;
create policy "Bruker kan laste opp eget profilbilde" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar.webp'
    and public.storage_quota_available('profile-avatars', 2)
  );

-- Annonsemedia er immutable. Klienten erstatter dem med et nytt UUID-objekt.
drop policy if exists "Bruker kan oppdatere i egen bildemappe" on storage.objects;
drop policy if exists "Bruker kan oppdatere i egen videomappe" on storage.objects;

drop policy if exists "Bruker kan oppdatere eget profilbilde" on storage.objects;
create policy "Bruker kan oppdatere eget profilbilde" on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar.webp'
    and owner_id = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar.webp'
    and owner_id = auth.uid()::text
  );

-- Listing og sletting krever både riktig mappe og faktisk Storage-eierskap.
drop policy if exists "Bruker kan liste egne listing-bilder" on storage.objects;
create policy "Bruker kan liste egne listing-bilder" on storage.objects for select
  to authenticated
  using (bucket_id = 'listing-images' and owner_id = auth.uid()::text);

drop policy if exists "Bruker kan liste egne annonsevideoer" on storage.objects;
create policy "Bruker kan liste egne annonsevideoer" on storage.objects for select
  to authenticated
  using (bucket_id = 'listing-videos' and owner_id = auth.uid()::text);

drop policy if exists "Bruker kan liste egne profilbilder" on storage.objects;
create policy "Bruker kan liste egne profilbilder" on storage.objects for select
  to authenticated
  using (bucket_id = 'profile-avatars' and owner_id = auth.uid()::text);

drop policy if exists "Bruker kan slette i egen bildemappe" on storage.objects;
create policy "Bruker kan slette i egen bildemappe" on storage.objects for delete
  to authenticated
  using (bucket_id = 'listing-images' and owner_id = auth.uid()::text);

drop policy if exists "Bruker kan slette i egen videomappe" on storage.objects;
create policy "Bruker kan slette i egen videomappe" on storage.objects for delete
  to authenticated
  using (bucket_id = 'listing-videos' and owner_id = auth.uid()::text);

drop policy if exists "Bruker kan slette eget profilbilde" on storage.objects;
create policy "Bruker kan slette eget profilbilde" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar.webp'
    and owner_id = auth.uid()::text
  );

commit;
