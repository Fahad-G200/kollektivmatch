-- KollektivMatch – ikke-destruktiv migrering for eksisterende database
-- Dato: 2026-08-23
-- Denne filen sletter ingen tabeller og endrer ikke eksisterende verdier.

begin;

-- -------------------------------------------------------------------
-- Nye profil- og annonsefelt
-- -------------------------------------------------------------------
alter table public.profiles add column if not exists preferred_property_types text[] not null default '{}';
alter table public.profiles add column if not exists desired_move_in_date date;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists terms_version text;

alter table public.listings add column if not exists images text[] not null default '{}';
alter table public.listings add column if not exists property_type text;
alter table public.listings add column if not exists room_size_m2 numeric(6,1);
alter table public.listings add column if not exists deposit_amount integer;
alter table public.listings add column if not exists furnished boolean;
alter table public.listings add column if not exists rent_includes text[] not null default '{}';
alter table public.listings add column if not exists updated_at timestamptz not null default now();
alter table public.listings add column if not exists status text not null default 'active';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_preferred_property_types_values') then
    alter table public.profiles add constraint profiles_preferred_property_types_values
      check (preferred_property_types <@ array['leilighet','hybel','enebolig','rekkehus','studentbolig','annet']::text[]
             and cardinality(preferred_property_types) <= 6) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_priority_tags_values') then
    alter table public.profiles add constraint profiles_priority_tags_values
      check (priority_tags <@ array['stort-rom','moderne-stil','nyoppusset-bad','rolig-miljo','stort-kjokken']::text[]
             and cardinality(priority_tags) <= 3) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_property_type_values') then
    alter table public.listings add constraint listings_property_type_values
      check (property_type is null or property_type in ('leilighet','hybel','enebolig','rekkehus','studentbolig','annet')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_status_values') then
    alter table public.listings add constraint listings_status_values
      check (status in ('active','paused','rented')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_text_lengths') then
    alter table public.listings add constraint listings_text_lengths
      check (char_length(btrim(title)) between 5 and 100
             and char_length(btrim(description)) between 30 and 5000
             and char_length(city) <= 100
             and (area is null or char_length(area) <= 120)
             and (roommates_info is null or char_length(roommates_info) <= 500)
             and (contact_info is null or char_length(contact_info) <= 250)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_numeric_limits') then
    alter table public.listings add constraint listings_numeric_limits
      check (price between 1 and 1000000
             and (deposit_amount is null or deposit_amount between 0 and 1000000)
             and (room_size_m2 is null or room_size_m2 between 1 and 1000)
             and (transit_minutes is null or transit_minutes between 0 and 600)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_array_limits') then
    alter table public.listings add constraint listings_array_limits
      check (lifestyle_tags <@ array['stort-rom','moderne-stil','nyoppusset-bad','rolig-miljo','stort-kjokken']::text[]
             and cardinality(lifestyle_tags) <= 5
             and amenities <@ array['matbutikk','kollektivtransport','treningssenter','grontomrade']::text[]
             and cardinality(amenities) <= 4
             and preferred_occupations <@ array['student','jobb','annet']::text[]
             and cardinality(preferred_occupations) <= 3
             and rent_includes <@ array['strom','internett','oppvarming','vann']::text[]
             and cardinality(rent_includes) <= 4) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_content_length') then
    alter table public.messages add constraint messages_content_length
      check (char_length(btrim(content)) between 1 and 2000 and sender_id <> receiver_id) not valid;
  end if;
end;
$$;

create or replace function public.validate_listing_write()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
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
  return new;
end;
$$;

drop trigger if exists validate_listing_write_trigger on public.listings;
create trigger validate_listing_write_trigger
  before insert or update on public.listings
  for each row execute function public.validate_listing_write();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists listings_set_updated_at on public.listings;
create trigger listings_set_updated_at before update on public.listings
  for each row execute function public.set_updated_at();
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create index if not exists listings_public_feed_idx on public.listings (status, created_at desc);
create index if not exists listings_property_type_idx on public.listings (property_type);
create index if not exists listings_move_in_date_idx on public.listings (move_in_date);
create index if not exists listings_area_idx on public.listings (area);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles (
    id, full_name, role, occupation, institution, income_status,
    monthly_budget_max, priority_tags, is_verified, terms_accepted_at, terms_version
  ) values (
    new.id,
    left(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 120),
    case when new.raw_user_meta_data ->> 'role' in ('boligjeger','utleier')
         then new.raw_user_meta_data ->> 'role' else 'boligjeger' end,
    case when new.raw_user_meta_data ->> 'occupation' in ('student','jobb','annet')
         then new.raw_user_meta_data ->> 'occupation' else null end,
    left(nullif(btrim(new.raw_user_meta_data ->> 'institution'), ''), 160),
    case when new.raw_user_meta_data ->> 'income_status' in ('fast','deltid','stipend','annet')
         then new.raw_user_meta_data ->> 'income_status' else null end,
    case when coalesce(new.raw_user_meta_data ->> 'monthly_budget_max', '') ~ '^\d{1,7}$'
              and (new.raw_user_meta_data ->> 'monthly_budget_max')::integer between 1 and 1000000
         then (new.raw_user_meta_data ->> 'monthly_budget_max')::integer else null end,
    case when jsonb_typeof(new.raw_user_meta_data -> 'priority_tags') = 'array' then
      array(
        select distinct tag
        from jsonb_array_elements_text(new.raw_user_meta_data -> 'priority_tags') as tags(tag)
        where tag = any(array['stort-rom','moderne-stil','nyoppusset-bad','rolig-miljo','stort-kjokken']::text[])
        limit 3
      )
    else '{}'::text[] end,
    new.email_confirmed_at is not null
      and lower(coalesce(new.email, '')) ~ '@([a-z0-9-]+\.)*(uio|uib|uit|uia|ntnu|nmbu|nhh|usn|nord|inn|himolde|khio|vid|hvl|oslomet|bi|kristiania)\.no$',
    case when new.raw_user_meta_data ->> 'terms_version' = '2026-08-23' then now() else null end,
    case when new.raw_user_meta_data ->> 'terms_version' = '2026-08-23' then '2026-08-23' else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Et utdanningsmerke gis først etter faktisk bekreftet e-post, og synkroniseres
-- hvis e-post eller bekreftelsesstatus endres.
create or replace function public.sync_profile_email_verification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.profiles
  set is_verified = (
    new.email_confirmed_at is not null
    and lower(coalesce(new.email, '')) ~ '@([a-z0-9-]+\.)*(uio|uib|uit|uia|ntnu|nmbu|nhh|usn|nord|inn|himolde|khio|vid|hvl|oslomet|bi|kristiania)\.no$'
  )
  where id = new.id;
  return new;
end;
$$;
revoke all on function public.sync_profile_email_verification() from public;
drop trigger if exists on_auth_user_verification_changed on auth.users;
create trigger on_auth_user_verification_changed
  after update of email, email_confirmed_at on auth.users
  for each row execute function public.sync_profile_email_verification();

update public.profiles p
set is_verified = (
  u.email_confirmed_at is not null
  and lower(coalesce(u.email, '')) ~ '@([a-z0-9-]+\.)*(uio|uib|uit|uia|ntnu|nmbu|nhh|usn|nord|inn|himolde|khio|vid|hvl|oslomet|bi|kristiania)\.no$'
)
from auth.users u
where p.id = u.id;

-- -------------------------------------------------------------------
-- Begrensede tabellrettigheter og RLS
-- -------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Profiler kan leses av alle" on public.profiles;
drop policy if exists "Relevant profilinformasjon kan leses" on public.profiles;
create policy "Relevant profilinformasjon kan leses"
  on public.profiles for select
  using (
    auth.uid() = id
    or exists (
      select 1 from public.listings l where l.user_id = profiles.id and l.status = 'active'
    )
    or exists (
      select 1 from public.messages m
      where (m.sender_id = auth.uid() and m.receiver_id = profiles.id)
         or (m.receiver_id = auth.uid() and m.sender_id = profiles.id)
    )
  );

drop policy if exists "Alle kan se annonser" on public.listings;
drop policy if exists "Aktive annonser er offentlige og eier ser egne" on public.listings;
create policy "Aktive annonser er offentlige og eier ser egne"
  on public.listings for select
  using (status = 'active' or auth.uid() = user_id);

drop policy if exists "Innloggede brukere kan opprette annonser" on public.listings;
drop policy if exists "Innloggede brukere kan opprette egne annonser" on public.listings;
create policy "Innloggede brukere kan opprette egne annonser"
  on public.listings for insert
  with check (auth.uid() = user_id);

drop policy if exists "Eier kan oppdatere egen annonse" on public.listings;
create policy "Eier kan oppdatere egen annonse"
  on public.listings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Eier kan slette egen annonse" on public.listings;
create policy "Eier kan slette egen annonse"
  on public.listings for delete
  using (auth.uid() = user_id);

revoke select, insert, update on public.listings from anon, authenticated;
grant select (
  id, user_id, title, description, price, city, area, move_in_date,
  images, image_url, roommates_info, lifestyle_tags, amenities,
  preferred_occupations, transit_minutes, grocery_nearby, gym_nearby,
  green_areas_nearby, property_type, room_size_m2, deposit_amount,
  furnished, rent_includes, status, is_featured, featured_until,
  created_at, updated_at
) on public.listings to anon;
grant select on public.listings to authenticated;
grant insert (
  user_id, title, description, price, city, area, move_in_date,
  images, image_url, roommates_info, contact_info, lifestyle_tags,
  amenities, preferred_occupations, transit_minutes, grocery_nearby,
  gym_nearby, green_areas_nearby, property_type, room_size_m2,
  deposit_amount, furnished, rent_includes, status
) on public.listings to authenticated;
grant update (
  title, description, price, city, area, move_in_date, images,
  image_url, roommates_info, contact_info, lifestyle_tags, amenities,
  preferred_occupations, transit_minutes, grocery_nearby, gym_nearby,
  green_areas_nearby, property_type, room_size_m2, deposit_amount,
  furnished, rent_includes, status
) on public.listings to authenticated;
grant delete on public.listings to authenticated;

revoke select, insert, update on public.profiles from anon, authenticated;
grant select (id, full_name, avatar_url, is_verified)
  on public.profiles to anon, authenticated;
grant insert (id, full_name, occupation, institution, income_status, monthly_budget_max, priority_tags, preferred_property_types, desired_move_in_date)
  on public.profiles to authenticated;
grant update (full_name, avatar_url, occupation, institution, income_status, monthly_budget_max, priority_tags, preferred_property_types, desired_move_in_date)
  on public.profiles to authenticated;

create or replace function public.get_my_profile()
returns public.profiles
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.* from public.profiles p where p.id = auth.uid();
$$;
revoke all on function public.get_my_profile() from public;
grant execute on function public.get_my_profile() to authenticated;

-- Meldinger kan bare opprettes og merkes lest via kontrollerte RPC-er.
drop policy if exists "Innloggede brukere kan sende meldinger" on public.messages;
drop policy if exists "Meldinger kun mellom legitime deltakere i annonsen" on public.messages;
drop policy if exists "Mottaker kan markere melding som lest" on public.messages;
drop policy if exists "Kun avsender og mottaker kan se meldingen" on public.messages;
create policy "Kun avsender og mottaker kan se meldingen"
  on public.messages for select
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

revoke insert, update, delete on public.messages from anon, authenticated;
grant select on public.messages to authenticated;

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
revoke all on function public.send_message(uuid, uuid, text) from public;
grant execute on function public.send_message(uuid, uuid, text) to authenticated;

create or replace function public.mark_messages_read(p_listing_id uuid, p_sender_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Innlogging kreves.';
  end if;
  update public.messages
  set is_read = true
  where listing_id = p_listing_id
    and sender_id = p_sender_id
    and receiver_id = auth.uid()
    and is_read = false;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.mark_messages_read(uuid, uuid) from public;
grant execute on function public.mark_messages_read(uuid, uuid) to authenticated;

-- -------------------------------------------------------------------
-- Rapportering
-- -------------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('svindel','spam','duplikat','annet')),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open','reviewed','dismissed')),
  created_at timestamptz not null default now(),
  unique (listing_id, reporter_id),
  check (char_length(reason) between 1 and 30)
);
alter table public.reports enable row level security;
drop policy if exists "Brukere kan rapportere andres annonser" on public.reports;
create policy "Brukere kan rapportere andres annonser"
  on public.reports for insert
  with check (
    auth.uid() = reporter_id
    and exists (select 1 from public.listings l where l.id = reports.listing_id and l.user_id <> auth.uid())
  );
revoke all on public.reports from anon, authenticated;
grant insert (listing_id, reporter_id, reason, details) on public.reports to authenticated;
create index if not exists reports_status_created_idx on public.reports (status, created_at desc);

create or replace function public.is_moderator()
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'moderator');
$$;
revoke all on function public.is_moderator() from public;
grant execute on function public.is_moderator() to authenticated;

create or replace function public.list_reports_for_moderation()
returns table (
  id uuid,
  listing_id uuid,
  listing_title text,
  reporter_id uuid,
  reason text,
  details text,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_moderator() then
    raise exception using errcode = '42501', message = 'Moderatorrolle kreves.';
  end if;
  return query
    select r.id, r.listing_id, l.title, r.reporter_id, r.reason, r.details, r.status, r.created_at
    from public.reports r
    join public.listings l on l.id = r.listing_id
    order by (r.status = 'open') desc, r.created_at asc;
end;
$$;
revoke all on function public.list_reports_for_moderation() from public;
grant execute on function public.list_reports_for_moderation() to authenticated;

create or replace function public.moderate_report(p_report_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_moderator() then
    raise exception using errcode = '42501', message = 'Moderatorrolle kreves.';
  end if;
  if p_status not in ('reviewed', 'dismissed') then
    raise exception using errcode = '22023', message = 'Ugyldig rapportstatus.';
  end if;
  update public.reports set status = p_status where id = p_report_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Rapporten finnes ikke.';
  end if;
end;
$$;
revoke all on function public.moderate_report(uuid, text) from public;
grant execute on function public.moderate_report(uuid, text) to authenticated;

-- -------------------------------------------------------------------
-- Registrertes rettigheter: maskinlesbar eksport og selvbetjent sletting
-- -------------------------------------------------------------------
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
        'id', u.id,
        'email', u.email,
        'created_at', u.created_at,
        'updated_at', u.updated_at,
        'email_confirmed_at', u.email_confirmed_at,
        'last_sign_in_at', u.last_sign_in_at,
        'user_metadata', u.raw_user_meta_data
      ) from auth.users u where u.id = auth.uid()
    ),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'listings', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at) from public.listings l where l.user_id = auth.uid()
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created_at) from public.messages m
      where m.sender_id = auth.uid() or m.receiver_id = auth.uid()
    ), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at) from public.reports r where r.reporter_id = auth.uid()
    ), '[]'::jsonb)
  ) end;
$$;
revoke all on function public.export_my_data() from public;
grant execute on function public.export_my_data() to authenticated;

create or replace function public.delete_my_account(p_confirmation text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Innlogging kreves.';
  end if;
  if p_confirmation is distinct from 'SLETT' then
    raise exception using errcode = '22023', message = 'Ugyldig bekreftelse.';
  end if;

  delete from auth.users where id = v_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Kontoen finnes ikke.';
  end if;
end;
$$;
revoke all on function public.delete_my_account(text) from public;
grant execute on function public.delete_my_account(text) to authenticated;

-- -------------------------------------------------------------------
-- Eksisterende SECURITY DEFINER-funksjoner får kontrollert search_path.
-- -------------------------------------------------------------------
create or replace function public.get_response_stats(target_user uuid)
returns table(response_rate integer, sample_size integer)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with incoming as (
    select distinct m.listing_id, m.sender_id as asker_id
    from public.messages m where m.receiver_id = target_user
  ), replied as (
    select i.listing_id, i.asker_id from incoming i
    where exists (
      select 1 from public.messages m
      where m.listing_id = i.listing_id
        and m.sender_id = target_user
        and m.receiver_id = i.asker_id
    )
  )
  select case when (select count(*) from incoming) = 0 then null
              else round(100.0 * (select count(*) from replied) / (select count(*) from incoming))::integer end,
         (select count(*) from incoming)::integer;
$$;
revoke all on function public.get_response_stats(uuid) from public;
grant execute on function public.get_response_stats(uuid) to anon, authenticated;

do $$
begin
  if to_regprocedure('public.request_listing_boost(uuid)') is not null then
    execute 'revoke all on function public.request_listing_boost(uuid) from public, anon, authenticated';
  end if;
end;
$$;

-- -------------------------------------------------------------------
-- Storage: bruker-ID må være første mappe, og bucket har klare grenser.
-- -------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute 'update storage.buckets set file_size_limit = 6291456 where id = ''listing-images''';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute 'update storage.buckets set allowed_mime_types = array[''image/jpeg'',''image/png'',''image/webp''] where id = ''listing-images''';
  end if;
end;
$$;

drop policy if exists "Alle kan lese listing-bilder" on storage.objects;
drop policy if exists "Innloggede kan laste opp listing-bilder" on storage.objects;
drop policy if exists "Eier kan oppdatere egne listing-bilder" on storage.objects;
drop policy if exists "Eier kan slette egne listing-bilder" on storage.objects;
drop policy if exists "Bruker kan laste opp i egen bildemappe" on storage.objects;
drop policy if exists "Bruker kan oppdatere i egen bildemappe" on storage.objects;
drop policy if exists "Bruker kan slette i egen bildemappe" on storage.objects;

create policy "Alle kan lese listing-bilder" on storage.objects for select
  using (bucket_id = 'listing-images');
create policy "Bruker kan laste opp i egen bildemappe" on storage.objects for insert
  with check (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Bruker kan oppdatere i egen bildemappe" on storage.objects for update
  using (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Bruker kan slette i egen bildemappe" on storage.objects for delete
  using (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
