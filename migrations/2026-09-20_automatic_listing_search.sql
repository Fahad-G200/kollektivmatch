-- KollektivMatch – privat kostkvote for brukerinitiert automatisk boligsøk.
-- Søkeord, preferanser, annonselenker, bilder og resultater lagres aldri her.

begin;

create table if not exists public.automatic_listing_search_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);

create index if not exists automatic_listing_search_requests_user_time_idx
  on public.automatic_listing_search_requests (user_id, requested_at desc);
create index if not exists automatic_listing_search_requests_retention_idx
  on public.automatic_listing_search_requests (requested_at);

alter table public.automatic_listing_search_requests enable row level security;
revoke all on public.automatic_listing_search_requests from public, anon, authenticated;
revoke all on sequence public.automatic_listing_search_requests_id_seq from public, anon, authenticated;
grant select, insert, delete on public.automatic_listing_search_requests to service_role;

create or replace function public.consume_automatic_listing_search_quota(
  p_user_id uuid
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_count integer;
  v_oldest timestamptz;
  v_retry integer;
begin
  if p_user_id is null then
    return query select false, 3600;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('automatic-listing-search:' || p_user_id::text, 0)
  );

  delete from public.automatic_listing_search_requests
  where requested_at < v_now - interval '25 hours';

  select count(*), min(requested_at)
    into v_count, v_oldest
  from public.automatic_listing_search_requests
  where user_id = p_user_id
    and requested_at >= v_now - interval '1 hour';

  if v_count >= 2 then
    v_retry := greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - v_now)))::integer);
    return query select false, v_retry;
    return;
  end if;

  select count(*), min(requested_at)
    into v_count, v_oldest
  from public.automatic_listing_search_requests
  where user_id = p_user_id
    and requested_at >= v_now - interval '24 hours';

  if v_count >= 6 then
    v_retry := greatest(1, ceil(extract(epoch from (v_oldest + interval '24 hours' - v_now)))::integer);
    return query select false, v_retry;
    return;
  end if;

  insert into public.automatic_listing_search_requests (user_id, requested_at)
  values (p_user_id, v_now);

  return query select true, 0;
end;
$$;

revoke all on function public.consume_automatic_listing_search_quota(uuid)
  from public, anon, authenticated;
grant execute on function public.consume_automatic_listing_search_quota(uuid)
  to service_role;

comment on table public.automatic_listing_search_requests is
  'Privat kostkvote. Inneholder bare bruker-ID og tidspunkt, aldri preferanser, kilder, bilder eller søkeresultat.';
comment on function public.consume_automatic_listing_search_quota(uuid) is
  'Serverintern atomisk kvote: maksimalt 2 automatiske boligsøk per time og 6 per 24 timer.';

commit;
