begin;

-- En Stripe Checkout-sesjon kan fullføres etter at brukeren har forlatt
-- KollektivMatch. Annonsen må derfor ikke slettes eller settes på pause mens
-- en aktiv betalingssesjon fortsatt kan bli betalt. Stripe Checkout utløper
-- senest etter 24 timer; den ekstra timen hindrer kappløp rundt utløpsgrensen.
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
      and o.payment_provider = 'stripe'
      and o.provider_session_id is not null
      and o.status in ('pending', 'authorized')
      and o.created_at > now() - interval '25 hours'
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

drop trigger if exists guard_listing_during_open_boost_checkout on public.listings;
create trigger guard_listing_during_open_boost_checkout
before delete or update of status on public.listings
for each row
execute function public.guard_listing_during_open_boost_checkout();

commit;
