-- KollektivMatch – minimal serverkvote for brukerinitiert kontroll av én
-- ekstern bolig. Lenke, adresse, bilder og analyseresultat lagres aldri her.

begin;

create table if not exists public.external_listing_analysis_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);

create index if not exists external_listing_analysis_requests_user_time_idx
  on public.external_listing_analysis_requests (user_id, requested_at desc);
create index if not exists external_listing_analysis_requests_retention_idx
  on public.external_listing_analysis_requests (requested_at);

alter table public.external_listing_analysis_requests enable row level security;
revoke all on public.external_listing_analysis_requests from public, anon, authenticated;
revoke all on sequence public.external_listing_analysis_requests_id_seq from public, anon, authenticated;
grant select, insert, delete on public.external_listing_analysis_requests to service_role;

create or replace function public.consume_external_listing_analysis_quota(
  p_user_id uuid
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_hour_count integer;
  v_day_count integer;
  v_oldest timestamptz;
  v_retry integer;
begin
  if p_user_id is null then
    return query select false, 3600;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('external-listing-analysis:' || p_user_id::text, 0));

  delete from public.external_listing_analysis_requests
  where requested_at < v_now - interval '25 hours';

  select count(*), min(requested_at)
    into v_hour_count, v_oldest
  from public.external_listing_analysis_requests
  where user_id = p_user_id
    and requested_at >= v_now - interval '1 hour';

  if v_hour_count >= 3 then
    v_retry := greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - v_now)))::integer);
    return query select false, v_retry;
    return;
  end if;

  select count(*), min(requested_at)
    into v_day_count, v_oldest
  from public.external_listing_analysis_requests
  where user_id = p_user_id
    and requested_at >= v_now - interval '24 hours';

  if v_day_count >= 10 then
    v_retry := greatest(1, ceil(extract(epoch from (v_oldest + interval '24 hours' - v_now)))::integer);
    return query select false, v_retry;
    return;
  end if;

  insert into public.external_listing_analysis_requests (user_id, requested_at)
  values (p_user_id, v_now);

  return query select true, 0;
end;
$$;

revoke all on function public.consume_external_listing_analysis_quota(uuid)
  from public, anon, authenticated;
grant execute on function public.consume_external_listing_analysis_quota(uuid)
  to service_role;

comment on table public.external_listing_analysis_requests is
  'Minimal privat kostkvote. Inneholder aldri FINN-lenke, finnkode, adresse, bilder eller analyseresultat.';
comment on function public.consume_external_listing_analysis_quota(uuid) is
  'Serverintern atomisk kvote: maksimalt 3 eksterne boligkontroller per time og 10 per 24 timer.';

commit;
