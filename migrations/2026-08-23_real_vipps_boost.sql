-- KollektivMatch – trygg, additiv migrering for ekte Vipps-fremheving
-- Dato: 2026-08-23
-- Forutsetter at migrations/2026-08-23_kollektivmatch_hardening.sql er kjørt først.
-- Ingen eksisterende tabeller eller rader slettes.

begin;

-- -------------------------------------------------------------------
-- Valgfri, privat profilinformasjon
-- -------------------------------------------------------------------
alter table public.profiles add column if not exists income_amount integer;
alter table public.profiles add column if not exists income_period text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_income_amount_range') then
    alter table public.profiles add constraint profiles_income_amount_range
      check (income_amount is null or income_amount between 1 and 100000000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_income_period_values') then
    alter table public.profiles add constraint profiles_income_period_values
      check (
        (income_amount is null and income_period is null)
        or (income_amount is not null and income_period in ('hour','month','year'))
      ) not valid;
  end if;
end;
$$;

grant update (income_amount, income_period) on public.profiles to authenticated;

-- -------------------------------------------------------------------
-- Betalingsprodukter og ordrer
-- -------------------------------------------------------------------
create table if not exists public.boost_products (
  id text primary key,
  name text not null,
  duration_days integer not null check (duration_days between 1 and 365),
  price_ore integer not null check (price_ore between 100 and 10000000),
  currency text not null default 'NOK' check (currency = 'NOK'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint boost_products_id_format check (id ~ '^[a-z0-9_]{3,40}$'),
  constraint boost_products_name_length check (char_length(name) between 3 and 100)
);

insert into public.boost_products (id, name, duration_days, price_ore, currency, is_active)
values
  ('boost_7d', 'Fremhevet i 7 dager', 7, 4900, 'NOK', true),
  ('boost_30d', 'Fremhevet i 30 dager', 30, 9900, 'NOK', true)
on conflict (id) do update set
  name = excluded.name,
  duration_days = excluded.duration_days,
  price_ore = excluded.price_ore,
  currency = excluded.currency,
  is_active = excluded.is_active,
  updated_at = now();

create table if not exists public.boost_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  listing_id uuid references public.listings(id) on delete set null,
  listing_title text not null,
  product_id text not null references public.boost_products(id),
  product_name text not null,
  duration_days integer not null check (duration_days between 1 and 365),
  amount_ore integer not null check (amount_ore between 100 and 10000000),
  currency text not null check (currency = 'NOK'),
  status text not null default 'pending' check (
    status in ('pending','authorized','captured','cancelled','aborted','expired','failed','refunded')
  ),
  vipps_psp_reference text,
  idempotency_key uuid not null unique,
  safe_status_code text,
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  authorized_at timestamptz,
  captured_at timestamptz,
  failed_at timestamptz,
  refunded_at timestamptz,
  refunded_amount_ore integer not null default 0 check (refunded_amount_ore >= 0),
  boost_applied_at timestamptz,
  boost_start_at timestamptz,
  boost_end_at timestamptz,
  constraint boost_orders_reference_format check (reference ~ '^KM-[0-9a-f]{32}$'),
  constraint boost_orders_safe_code_length check (safe_status_code is null or char_length(safe_status_code) <= 80),
  constraint boost_orders_psp_reference_length check (vipps_psp_reference is null or char_length(vipps_psp_reference) <= 120)
);

create index if not exists boost_orders_user_created_idx on public.boost_orders (user_id, created_at desc);
create index if not exists boost_orders_listing_created_idx on public.boost_orders (listing_id, created_at desc);
create index if not exists boost_orders_status_idx on public.boost_orders (status, updated_at);

create table if not exists public.boost_payment_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.boost_orders(id) on delete cascade,
  event_key text not null unique,
  event_name text not null,
  source text not null check (source in ('create','webhook','poll','capture','refund','database')),
  vipps_psp_reference text,
  amount_ore integer,
  currency text,
  safe_status_code text,
  vipps_event_at timestamptz,
  created_at timestamptz not null default now(),
  constraint boost_events_name_length check (char_length(event_name) between 2 and 80),
  constraint boost_events_key_length check (char_length(event_key) between 8 and 200),
  constraint boost_events_safe_code_length check (safe_status_code is null or char_length(safe_status_code) <= 80)
);

create index if not exists boost_payment_events_order_idx on public.boost_payment_events (order_id, created_at);

create or replace function public.set_boost_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists boost_products_set_updated_at on public.boost_products;
create trigger boost_products_set_updated_at before update on public.boost_products
  for each row execute function public.set_boost_updated_at();
drop trigger if exists boost_orders_set_updated_at on public.boost_orders;
create trigger boost_orders_set_updated_at before update on public.boost_orders
  for each row execute function public.set_boost_updated_at();

-- Betalingsoppdateringer skal kunne fremheve eldre annonser uten å bli
-- blokkert av validering av brukerredigerbare felt som allerede var tomme.
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
      new.images, new.image_url, new.roommates_info, new.contact_info,
      new.lifestyle_tags, new.amenities, new.preferred_occupations,
      new.transit_minutes, new.grocery_nearby, new.gym_nearby,
      new.green_areas_nearby, new.property_type, new.room_size_m2,
      new.deposit_amount, new.furnished, new.rent_includes, new.status
    ) is distinct from row(
      old.title, old.description, old.price, old.city, old.area, old.move_in_date,
      old.images, old.image_url, old.roommates_info, old.contact_info,
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

-- -------------------------------------------------------------------
-- RLS og minst mulige klientrettigheter
-- -------------------------------------------------------------------
alter table public.boost_products enable row level security;
alter table public.boost_orders enable row level security;
alter table public.boost_payment_events enable row level security;

drop policy if exists "Aktive boost-produkter kan leses" on public.boost_products;
create policy "Aktive boost-produkter kan leses" on public.boost_products for select
  using (is_active = true);

drop policy if exists "Bruker kan lese egne boost-ordrer" on public.boost_orders;
create policy "Bruker kan lese egne boost-ordrer" on public.boost_orders for select
  using (auth.uid() = user_id);

revoke all on public.boost_products from anon, authenticated;
grant select (id, name, duration_days, price_ore, currency, is_active)
  on public.boost_products to anon, authenticated;

revoke all on public.boost_orders from anon, authenticated;
grant select (
  id, reference, listing_id, listing_title, product_id, product_name,
  duration_days, amount_ore, currency, status, created_at, updated_at,
  authorized_at, captured_at, refunded_at, refunded_amount_ore,
  boost_applied_at, boost_start_at, boost_end_at, safe_status_code
) on public.boost_orders to authenticated;

revoke all on public.boost_payment_events from anon, authenticated;
revoke update (is_featured, featured_until) on public.listings from anon, authenticated;

do $$
begin
  if to_regprocedure('public.request_listing_boost(uuid)') is not null then
    execute 'revoke all on function public.request_listing_boost(uuid) from public, anon, authenticated';
  end if;
end;
$$;

-- -------------------------------------------------------------------
-- Kun service_role får opprette/endre ordre og levere fremheving
-- -------------------------------------------------------------------
create or replace function public.create_boost_order(
  p_user_id uuid,
  p_listing_id uuid,
  p_product_id text,
  p_terms_version text
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

  select * into v_listing from public.listings where id = p_listing_id for update;
  if not found or v_listing.user_id <> p_user_id then
    raise exception using errcode = '42501', message = 'Annonsen kan ikke fremheves av denne brukeren.';
  end if;
  if v_listing.status is distinct from 'active' then
    raise exception using errcode = '22023', message = 'Bare aktive annonser kan fremheves.';
  end if;

  select * into v_product from public.boost_products where id = p_product_id and is_active = true;
  if not found then
    raise exception using errcode = '22023', message = 'Ugyldig fremhevingsprodukt.';
  end if;

  select * into v_existing
  from public.boost_orders
  where user_id = p_user_id
    and listing_id = p_listing_id
    and product_id = p_product_id
    and status in ('pending','authorized')
    and created_at > now() - interval '10 minutes'
  order by created_at desc
  limit 1
  for update;
  if found then
    return v_existing;
  end if;

  if (
    select count(*) from public.boost_orders
    where user_id = p_user_id
      and listing_id = p_listing_id
      and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception using errcode = 'P0001', message = 'For mange betalingsforsøk. Vent og prøv igjen.';
  end if;

  insert into public.boost_orders (
    id, reference, user_id, listing_id, listing_title,
    product_id, product_name, duration_days, amount_ore, currency,
    idempotency_key, terms_version, terms_accepted_at
  ) values (
    v_order_id, 'KM-' || replace(v_order_id::text, '-', ''), p_user_id,
    p_listing_id, left(v_listing.title, 100), v_product.id, v_product.name,
    v_product.duration_days, v_product.price_ore, v_product.currency,
    gen_random_uuid(), p_terms_version, now()
  ) returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.mark_boost_order_status(
  p_order_id uuid,
  p_status text,
  p_safe_status_code text default null,
  p_psp_reference text default null
)
returns public.boost_orders
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.boost_orders;
begin
  if p_status not in ('pending','authorized','cancelled','aborted','expired','failed') then
    raise exception using errcode = '22023', message = 'Ugyldig betalingsstatus.';
  end if;
  select * into v_order from public.boost_orders where id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Ordren finnes ikke.'; end if;

  if v_order.status in ('captured','refunded') then return v_order; end if;
  if v_order.status in ('cancelled','aborted','expired','failed') and p_status in ('pending','authorized') then
    return v_order;
  end if;

  update public.boost_orders set
    status = p_status,
    safe_status_code = left(nullif(p_safe_status_code, ''), 80),
    vipps_psp_reference = coalesce(left(nullif(p_psp_reference, ''), 120), vipps_psp_reference),
    authorized_at = case when p_status = 'authorized' then coalesce(authorized_at, now()) else authorized_at end,
    failed_at = case when p_status in ('cancelled','aborted','expired','failed') then coalesce(failed_at, now()) else failed_at end
  where id = p_order_id
  returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.apply_captured_boost(
  p_order_id uuid,
  p_reference text,
  p_amount_ore integer,
  p_currency text,
  p_psp_reference text default null
)
returns public.boost_orders
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.boost_orders;
  v_listing public.listings;
  v_start timestamptz;
  v_end timestamptz;
begin
  select * into v_order from public.boost_orders where id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Ordren finnes ikke.'; end if;
  if v_order.reference <> p_reference
     or v_order.amount_ore <> p_amount_ore
     or v_order.currency <> p_currency then
    raise exception using errcode = '22023', message = 'Betalingsdetaljene stemmer ikke.';
  end if;
  if v_order.status = 'refunded' then
    raise exception using errcode = '22023', message = 'Ordren er refundert.';
  end if;
  if v_order.boost_applied_at is not null then return v_order; end if;
  if v_order.listing_id is null or v_order.user_id is null then
    raise exception using errcode = '22023', message = 'Annonsen eller brukeren finnes ikke lenger.';
  end if;

  select * into v_listing from public.listings where id = v_order.listing_id for update;
  if not found or v_listing.user_id <> v_order.user_id then
    raise exception using errcode = '42501', message = 'Annonsens eier stemmer ikke.';
  end if;

  v_start := case
    when v_listing.is_featured = true and v_listing.featured_until > now()
      then v_listing.featured_until
    else now()
  end;
  v_end := v_start + make_interval(days => v_order.duration_days);

  update public.listings
  set is_featured = true, featured_until = v_end
  where id = v_order.listing_id;

  update public.boost_orders set
    status = 'captured',
    vipps_psp_reference = coalesce(left(nullif(p_psp_reference, ''), 120), vipps_psp_reference),
    authorized_at = coalesce(authorized_at, now()),
    captured_at = coalesce(captured_at, now()),
    boost_applied_at = now(),
    boost_start_at = v_start,
    boost_end_at = v_end,
    safe_status_code = 'CAPTURE_CONFIRMED'
  where id = p_order_id
  returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.apply_boost_refund(
  p_order_id uuid,
  p_reference text,
  p_refunded_amount_ore integer,
  p_currency text,
  p_psp_reference text default null
)
returns public.boost_orders
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.boost_orders;
  v_listing public.listings;
  v_new_end timestamptz;
begin
  select * into v_order from public.boost_orders where id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Ordren finnes ikke.'; end if;
  if v_order.reference <> p_reference or v_order.currency <> p_currency
     or p_refunded_amount_ore < v_order.amount_ore then
    raise exception using errcode = '22023', message = 'Refusjonsdetaljene stemmer ikke.';
  end if;
  if v_order.status = 'refunded' then return v_order; end if;
  if v_order.status <> 'captured' or v_order.boost_applied_at is null then
    raise exception using errcode = '22023', message = 'Bare en captured ordre kan refunderes.';
  end if;

  if v_order.listing_id is not null then
    select * into v_listing from public.listings where id = v_order.listing_id for update;
    if found and v_listing.featured_until is not null then
      if v_listing.featured_until <= v_order.boost_end_at + interval '1 second' then
        v_new_end := v_order.boost_start_at;
      else
        v_new_end := v_listing.featured_until - make_interval(days => v_order.duration_days);
      end if;
      update public.listings set
        is_featured = v_new_end > now(),
        featured_until = case when v_new_end > now() then v_new_end else null end
      where id = v_order.listing_id;
    end if;
  end if;

  update public.boost_orders set
    status = 'refunded',
    refunded_at = coalesce(refunded_at, now()),
    refunded_amount_ore = p_refunded_amount_ore,
    vipps_psp_reference = coalesce(left(nullif(p_psp_reference, ''), 120), vipps_psp_reference),
    safe_status_code = 'REFUND_CONFIRMED'
  where id = p_order_id
  returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.record_boost_payment_event(
  p_order_id uuid,
  p_event_key text,
  p_event_name text,
  p_source text,
  p_psp_reference text default null,
  p_amount_ore integer default null,
  p_currency text default null,
  p_safe_status_code text default null,
  p_vipps_event_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.boost_payment_events (
    order_id, event_key, event_name, source, vipps_psp_reference,
    amount_ore, currency, safe_status_code, vipps_event_at
  ) values (
    p_order_id, left(p_event_key, 200), left(p_event_name, 80), p_source,
    left(p_psp_reference, 120), p_amount_ore, p_currency,
    left(p_safe_status_code, 80), p_vipps_event_at
  ) on conflict (event_key) do nothing;
  return found;
end;
$$;

revoke all on function public.create_boost_order(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.mark_boost_order_status(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.apply_captured_boost(uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.apply_boost_refund(uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.record_boost_payment_event(uuid, text, text, text, text, integer, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_boost_order(uuid, uuid, text, text) to service_role;
grant execute on function public.mark_boost_order_status(uuid, text, text, text) to service_role;
grant execute on function public.apply_captured_boost(uuid, text, integer, text, text) to service_role;
grant execute on function public.apply_boost_refund(uuid, text, integer, text, text) to service_role;
grant execute on function public.record_boost_payment_event(uuid, text, text, text, text, integer, text, text, timestamptz) to service_role;

-- Administratorvennlig SQL-visning. Ingen nettleserrolle får lese den.
create or replace view public.boost_payment_admin_export as
select
  o.reference as payment_reference,
  o.created_at as order_date,
  o.amount_ore,
  o.currency,
  o.status,
  o.user_id,
  o.listing_id,
  o.listing_title,
  o.product_name,
  o.captured_at,
  o.refunded_at,
  o.refunded_amount_ore,
  o.boost_start_at,
  o.boost_end_at
from public.boost_orders o;
revoke all on public.boost_payment_admin_export from public, anon, authenticated;
grant select on public.boost_payment_admin_export to service_role;

-- Inkluder egne, trygge betalingsdata i den eksisterende GDPR-eksporten.
create or replace function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'exported_at', now(),
    'account', (
      select jsonb_build_object(
        'id', u.id, 'email', u.email, 'created_at', u.created_at,
        'updated_at', u.updated_at, 'email_confirmed_at', u.email_confirmed_at,
        'last_sign_in_at', u.last_sign_in_at, 'user_metadata', u.raw_user_meta_data
      ) from auth.users u where u.id = auth.uid()
    ),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'listings', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at) from public.listings l where l.user_id = auth.uid()), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.messages m where m.sender_id = auth.uid() or m.receiver_id = auth.uid()), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.reports r where r.reporter_id = auth.uid()), '[]'::jsonb),
    'boost_orders', coalesce((
      select jsonb_agg(
        to_jsonb(o) - 'idempotency_key' - 'vipps_psp_reference' - 'safe_status_code'
        order by o.created_at
      ) from public.boost_orders o where o.user_id = auth.uid()
    ), '[]'::jsonb)
  ) end;
$$;
revoke all on function public.export_my_data() from public;
grant execute on function public.export_my_data() to authenticated;

-- -------------------------------------------------------------------
-- Profilbilder: offentlig bilde, men bare eier kan skrive i egen mappe
-- -------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('profile-avatars', 'profile-avatars', true)
on conflict (id) do update set public = true;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute 'update storage.buckets set file_size_limit = 2097152 where id = ''profile-avatars''';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute 'update storage.buckets set allowed_mime_types = array[''image/jpeg'',''image/png'',''image/webp''] where id = ''profile-avatars''';
  end if;
end;
$$;

drop policy if exists "Alle kan lese profilbilder" on storage.objects;
drop policy if exists "Bruker kan laste opp eget profilbilde" on storage.objects;
drop policy if exists "Bruker kan oppdatere eget profilbilde" on storage.objects;
drop policy if exists "Bruker kan slette eget profilbilde" on storage.objects;

create policy "Alle kan lese profilbilder" on storage.objects for select
  using (bucket_id = 'profile-avatars');
create policy "Bruker kan laste opp eget profilbilde" on storage.objects for insert
  with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Bruker kan oppdatere eget profilbilde" on storage.objects for update
  using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Bruker kan slette eget profilbilde" on storage.objects for delete
  using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
