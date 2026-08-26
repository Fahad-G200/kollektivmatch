-- KollektivMatch – sikker kobling av eksisterende konto til Vipps Login
-- Dato: 2026-08-23
-- Kjøres etter de to andre 2026-08-23-migreringene.
-- Migreringen er additiv og sletter ingen eksisterende brukerdata.

begin;

-- Bare den ufarlige statusen er offentlig. Selve Vipps-identifikatoren lagres
-- separat og kan aldri leses eller endres av nettleserroller.
alter table public.profiles add column if not exists vipps_verified boolean not null default false;
alter table public.profiles add column if not exists vipps_verified_at timestamptz;

grant select (vipps_verified) on public.profiles to anon, authenticated;
revoke update (vipps_verified, vipps_verified_at) on public.profiles from anon, authenticated;

create table if not exists public.vipps_identity_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  vipps_sub text not null unique,
  linked_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  constraint vipps_identity_links_sub_length check (char_length(vipps_sub) between 8 and 255)
);

create table if not exists public.vipps_verification_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique,
  nonce text not null,
  code_verifier text not null,
  status text not null default 'pending',
  last_error_code text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  completed_at timestamptz,
  constraint vipps_verification_state_hash_format check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint vipps_verification_nonce_length check (char_length(nonce) between 22 and 128),
  constraint vipps_verification_code_verifier_length check (char_length(code_verifier) between 43 and 128),
  constraint vipps_verification_status_values check (status in ('pending','processing','completed','failed')),
  constraint vipps_verification_error_length check (last_error_code is null or char_length(last_error_code) <= 80),
  constraint vipps_verification_expiry_window check (expires_at > created_at and expires_at <= created_at + interval '30 minutes')
);

create index if not exists vipps_verification_sessions_user_created_idx
  on public.vipps_verification_sessions (user_id, created_at desc);
create index if not exists vipps_verification_sessions_expiry_idx
  on public.vipps_verification_sessions (expires_at);

alter table public.vipps_identity_links enable row level security;
alter table public.vipps_verification_sessions enable row level security;
revoke all on public.vipps_identity_links from public, anon, authenticated;
revoke all on public.vipps_verification_sessions from public, anon, authenticated;
grant all on public.vipps_identity_links to service_role;
grant all on public.vipps_verification_sessions to service_role;

-- Fullfører koblingen atomisk. Funksjonen er kun tilgjengelig for serverrollen.
create or replace function public.complete_vipps_verification(
  p_session_id uuid,
  p_vipps_sub text
)
returns table (user_id uuid, verified_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.vipps_verification_sessions;
  v_existing_user uuid;
  v_existing_sub text;
  v_verified_at timestamptz := now();
begin
  if p_session_id is null or char_length(coalesce(p_vipps_sub, '')) not between 8 and 255 then
    raise exception using errcode = '22023', message = 'Ugyldig Vipps-verifisering.';
  end if;

  select * into v_session
  from public.vipps_verification_sessions
  where id = p_session_id
  for update;

  if not found
     or v_session.status <> 'processing'
     or v_session.used_at is null
     or v_session.used_at > v_session.expires_at then
    raise exception using errcode = '22023', message = 'Vipps-verifiseringen er ikke gyldig.';
  end if;

  select l.user_id into v_existing_user
  from public.vipps_identity_links l
  where l.vipps_sub = p_vipps_sub
  for update;
  if found and v_existing_user <> v_session.user_id then
    raise exception using errcode = '23505', message = 'Denne Vipps-kontoen er allerede koblet til en annen konto.';
  end if;

  select l.vipps_sub into v_existing_sub
  from public.vipps_identity_links l
  where l.user_id = v_session.user_id
  for update;
  if found and v_existing_sub <> p_vipps_sub then
    raise exception using errcode = '23505', message = 'Kontoen er allerede koblet til en annen Vipps-konto.';
  end if;

  insert into public.vipps_identity_links (user_id, vipps_sub, linked_at, last_verified_at)
  values (v_session.user_id, p_vipps_sub, v_verified_at, v_verified_at)
  on conflict (user_id) do update
    set last_verified_at = excluded.last_verified_at;

  update public.profiles
  set vipps_verified = true, vipps_verified_at = v_verified_at
  where id = v_session.user_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Profilen finnes ikke.';
  end if;

  update public.vipps_verification_sessions
  set status = 'completed', completed_at = v_verified_at, last_error_code = null,
      code_verifier = repeat('x', 43), nonce = repeat('x', 22)
  where id = v_session.id;

  return query select v_session.user_id, v_verified_at;
end;
$$;
revoke all on function public.complete_vipps_verification(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_vipps_verification(uuid, text) to service_role;

-- Deltakere må fortsatt kunne åpne samtalen hvis eieren pauser eller markerer
-- annonsen som utleid. Anonyme besøkende ser fremdeles bare aktive annonser.
drop policy if exists "Aktive annonser er offentlige og eier ser egne" on public.listings;
drop policy if exists "Aktive annonser er offentlige og deltakere ser samtaleannonse" on public.listings;
create policy "Aktive annonser er offentlige og deltakere ser samtaleannonse"
  on public.listings for select
  using (
    status = 'active'
    or auth.uid() = user_id
    or exists (
      select 1 from public.messages m
      where m.listing_id = listings.id
        and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
    )
  );

-- Realtime for meldinger installeres idempotent, slik at nye meldinger dukker
-- opp uten at brukeren må laste siden på nytt.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'messages'
     ) then
    alter publication supabase_realtime add table public.messages;
  end if;
exception when duplicate_object then
  null;
end;
$$;

create index if not exists messages_listing_created_idx
  on public.messages (listing_id, created_at);
create index if not exists messages_receiver_unread_idx
  on public.messages (receiver_id, is_read, created_at desc);

-- GDPR-eksport uten state, nonce, PKCE-verifier eller rå Vipps subject.
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
    'vipps_verification', (
      select jsonb_build_object(
        'linked_at', l.linked_at,
        'last_verified_at', l.last_verified_at
      ) from public.vipps_identity_links l where l.user_id = auth.uid()
    ),
    'vipps_verification_sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', s.status,
        'created_at', s.created_at,
        'expires_at', s.expires_at,
        'used_at', s.used_at,
        'completed_at', s.completed_at
      ) order by s.created_at)
      from public.vipps_verification_sessions s where s.user_id = auth.uid()
    ), '[]'::jsonb),
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

commit;
