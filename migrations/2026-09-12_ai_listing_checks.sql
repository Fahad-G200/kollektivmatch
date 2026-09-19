-- KollektivMatch – frivillig AI-bildekontroll og serverkvote
-- Dato: 2026-09-12
-- Additiv migrering: eksisterende annonser blir ikke analysert uten at eieren
-- uttrykkelig slår på funksjonen.

begin;

alter table public.listings
  add column if not exists ai_image_analysis_allowed boolean not null default false,
  add column if not exists ai_image_analysis_allowed_at timestamptz;

comment on column public.listings.ai_image_analysis_allowed is
  'Eierens frivillige valg om KollektivMatch kan sende annonsebilder til konfigurert AI-leverandør for en begrenset boligkvalitetsanalyse.';
comment on column public.listings.ai_image_analysis_allowed_at is
  'Serverstyrt tidspunkt for når eieren sist slo på frivillig AI-bildekontroll.';

grant select (ai_image_analysis_allowed)
  on public.listings to anon, authenticated;
grant insert (ai_image_analysis_allowed)
  on public.listings to authenticated;
grant update (ai_image_analysis_allowed)
  on public.listings to authenticated;

create or replace function public.record_listing_ai_analysis_choice()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    new.ai_image_analysis_allowed_at := case when new.ai_image_analysis_allowed then now() else null end;
  elsif new.ai_image_analysis_allowed = false then
    new.ai_image_analysis_allowed_at := null;
  elsif old.ai_image_analysis_allowed is distinct from true then
    new.ai_image_analysis_allowed_at := now();
  else
    new.ai_image_analysis_allowed_at := old.ai_image_analysis_allowed_at;
  end if;
  return new;
end;
$$;

revoke all on function public.record_listing_ai_analysis_choice()
  from public, anon, authenticated;

drop trigger if exists record_listing_ai_analysis_choice_trigger on public.listings;
create trigger record_listing_ai_analysis_choice_trigger
before insert or update of ai_image_analysis_allowed on public.listings
for each row execute function public.record_listing_ai_analysis_choice();

-- Bare generiske observasjoner om selve boligen lagres. Personlige
-- preferanser, Google Places-treff og reiseruter lagres ikke i denne tabellen.
create table if not exists public.listing_image_analysis_cache (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  image_fingerprint text not null
    check (image_fingerprint ~ '^[0-9a-f]{64}$'),
  model_version text not null
    check (char_length(model_version) between 1 and 100),
  prompt_version text not null
    check (char_length(prompt_version) between 1 and 40),
  analyzed_images smallint not null
    check (analyzed_images between 1 and 6),
  total_images integer not null
    check (total_images >= analyzed_images),
  result jsonb not null
    check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.listing_image_analysis_cache enable row level security;
revoke all on public.listing_image_analysis_cache from public, anon, authenticated;
grant select, insert, update, delete on public.listing_image_analysis_cache to service_role;

create or replace function public.purge_stale_listing_image_analysis()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.ai_image_analysis_allowed = false
    or new.images is distinct from old.images
    or new.image_url is distinct from old.image_url
  then
    delete from public.listing_image_analysis_cache where listing_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.purge_stale_listing_image_analysis()
  from public, anon, authenticated;

drop trigger if exists purge_stale_listing_image_analysis_trigger on public.listings;
create trigger purge_stale_listing_image_analysis_trigger
after update of ai_image_analysis_allowed, images, image_url on public.listings
for each row execute function public.purge_stale_listing_image_analysis();

create table if not exists public.listing_analysis_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  requested_at timestamptz not null default now()
);

create index if not exists listing_analysis_requests_user_time_idx
  on public.listing_analysis_requests (user_id, requested_at desc);
create index if not exists listing_analysis_requests_retention_idx
  on public.listing_analysis_requests (requested_at);

alter table public.listing_analysis_requests enable row level security;
revoke all on public.listing_analysis_requests from public, anon, authenticated;
revoke all on sequence public.listing_analysis_requests_id_seq from public, anon, authenticated;

-- Kvoten tas atomisk under en transaksjonslås per bruker. Bare service_role kan
-- kalle funksjonen; nettleseren får aldri skrive sin egen kvotelogg.
create or replace function public.consume_listing_analysis_quota(
  p_user_id uuid,
  p_listing_id uuid
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
  if p_user_id is null or p_listing_id is null then
    return query select false, 3600;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('listing-analysis:' || p_user_id::text, 0));

  delete from public.listing_analysis_requests
  where requested_at < v_now - interval '7 days';

  select count(*), min(requested_at)
    into v_hour_count, v_oldest
  from public.listing_analysis_requests
  where user_id = p_user_id
    and requested_at >= v_now - interval '1 hour';

  if v_hour_count >= 6 then
    v_retry := greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - v_now)))::integer);
    return query select false, v_retry;
    return;
  end if;

  select count(*), min(requested_at)
    into v_day_count, v_oldest
  from public.listing_analysis_requests
  where user_id = p_user_id
    and requested_at >= v_now - interval '24 hours';

  if v_day_count >= 20 then
    v_retry := greatest(1, ceil(extract(epoch from (v_oldest + interval '24 hours' - v_now)))::integer);
    return query select false, v_retry;
    return;
  end if;

  insert into public.listing_analysis_requests (user_id, listing_id, requested_at)
  values (p_user_id, p_listing_id, v_now);

  return query select true, 0;
end;
$$;

revoke all on function public.consume_listing_analysis_quota(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_listing_analysis_quota(uuid, uuid)
  to service_role;

comment on function public.consume_listing_analysis_quota(uuid, uuid) is
  'Serverintern, atomisk kvote for kostnadsbelagt bilde-, sted- og rutekontroll.';

commit;
