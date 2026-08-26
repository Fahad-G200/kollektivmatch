-- KollektivMatch – additiv Stripe Checkout-reserve for betalt fremheving
-- Dato: 2026-08-26
-- Forutsetter migrations/2026-08-23_real_vipps_boost.sql.
-- Ingen eksisterende rader slettes, og eksisterende Vipps-ordrer beholdes.

begin;

alter table public.boost_orders
  add column if not exists payment_provider text not null default 'vipps',
  add column if not exists provider_session_id text,
  add column if not exists provider_payment_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'boost_orders_payment_provider_values'
  ) then
    alter table public.boost_orders add constraint boost_orders_payment_provider_values
      check (payment_provider in ('vipps', 'stripe')) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'boost_orders_provider_session_length'
  ) then
    alter table public.boost_orders add constraint boost_orders_provider_session_length
      check (provider_session_id is null or char_length(provider_session_id) between 8 and 255) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'boost_orders_provider_payment_length'
  ) then
    alter table public.boost_orders add constraint boost_orders_provider_payment_length
      check (provider_payment_id is null or char_length(provider_payment_id) between 3 and 255) not valid;
  end if;
end;
$$;

alter table public.boost_orders validate constraint boost_orders_payment_provider_values;
alter table public.boost_orders validate constraint boost_orders_provider_session_length;
alter table public.boost_orders validate constraint boost_orders_provider_payment_length;

create unique index if not exists boost_orders_provider_session_unique_idx
  on public.boost_orders (payment_provider, provider_session_id)
  where provider_session_id is not null;
create index if not exists boost_orders_provider_created_idx
  on public.boost_orders (payment_provider, created_at desc);

-- Fem-argumentsvarianten brukes av nye betalingsleverandører. Den gamle
-- fire-argumentsvarianten beholdes uendret for eksisterende Vipps-kode.
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

  select * into v_listing from public.listings where id = p_listing_id for update;
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
    and product_id = p_product_id
    and payment_provider = p_payment_provider
    and status in ('pending', 'authorized')
    and created_at > now() - interval '10 minutes'
  order by created_at desc
  limit 1
  for update;
  if found then return v_existing; end if;

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

create or replace function public.attach_stripe_checkout_session(
  p_order_id uuid,
  p_session_id text
)
returns public.boost_orders
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.boost_orders;
begin
  if p_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9_]{8,240}$' then
    raise exception using errcode = '22023', message = 'Ugyldig betalingssesjon.';
  end if;

  select * into v_order from public.boost_orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Ordren finnes ikke.';
  end if;
  if v_order.payment_provider <> 'stripe' or v_order.status <> 'pending' then
    raise exception using errcode = '22023', message = 'Betalingssesjonen kan ikke kobles til ordren.';
  end if;
  if v_order.provider_session_id is not null and v_order.provider_session_id <> p_session_id then
    raise exception using errcode = '22023', message = 'Ordren har allerede en annen betalingssesjon.';
  end if;

  update public.boost_orders
  set provider_session_id = p_session_id,
      safe_status_code = 'STRIPE_CHECKOUT_CREATED'
  where id = p_order_id
  returning * into v_order;
  return v_order;
end;
$$;

revoke all on function public.create_boost_order(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.attach_stripe_checkout_session(uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_boost_order(uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.attach_stripe_checkout_session(uuid, text)
  to service_role;

-- De to leverandør-ID-ene er kun for server, webhook, feilsøking og refusjon.
-- Nettleseren får bare se navnet på leverandøren for sine egne ordrer.
grant select (payment_provider) on public.boost_orders to authenticated;

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
  o.boost_end_at,
  o.payment_provider
from public.boost_orders o;
revoke all on public.boost_payment_admin_export from public, anon, authenticated;
grant select on public.boost_payment_admin_export to service_role;

commit;
