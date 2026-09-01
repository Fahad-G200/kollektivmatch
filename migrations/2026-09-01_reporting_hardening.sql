-- KollektivMatch: serverstyrt rapportering, misbruksvern og moderator-audit.
-- Denne migreringen skal kjores etter 2026-08-23_kollektivmatch_hardening.sql.

begin;

-- Produksjonskontroll viste at anon fortsatt hadde tabellnivaa-SELECT pa
-- messages fra en eldre grant. RLS skjulte radene, men minste privilegium
-- krever at nettleserrollen uten innlogging avvises allerede ved GRANT-laget.
revoke select on public.messages from public, anon;

alter table public.reports
  add column if not exists moderated_at timestamptz;

-- Moderatoridentitet lagres i en separat, nettleserutilgjengelig historikk.
-- Dermed lekker ikke interne moderator-ID-er via brukerens GDPR-eksport av
-- egne rapporter, og flere handlinger på samme rapport bevares.
create table if not exists public.report_moderation_audit (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.reports(id) on delete cascade,
  moderator_id uuid references auth.users(id) on delete set null,
  status text not null check (status in ('reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);

alter table public.report_moderation_audit enable row level security;
revoke all on table public.report_moderation_audit from public, anon, authenticated;
grant select on table public.report_moderation_audit to service_role;

create index if not exists report_moderation_audit_report_created_idx
  on public.report_moderation_audit (report_id, created_at desc);

create index if not exists reports_reporter_created_idx
  on public.reports (reporter_id, created_at desc);

create or replace function public.submit_report(
  p_listing_id uuid,
  p_reason text,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_reason text := lower(btrim(coalesce(p_reason, '')));
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_report_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Innlogging kreves.';
  end if;

  -- Serialiser samtidige rapportforsok fra samme konto, slik at timegrensen
  -- ikke kan omgas med parallelle foresporsler.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('submit_report:' || v_user_id::text, 0)
  );

  if v_reason not in ('svindel', 'spam', 'duplikat', 'annet') then
    raise exception using errcode = '22023', message = 'Ugyldig rapportarsak.';
  end if;

  if v_details is not null and char_length(v_details) > 1000 then
    raise exception using errcode = '22001', message = 'Forklaringen kan ikke overstige 1000 tegn.';
  end if;

  if not exists (
    select 1
    from public.listings l
    where l.id = p_listing_id
      and l.status = 'active'
      and l.user_id <> v_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'Annonsen kan ikke rapporteres.';
  end if;

  if (
    select count(*)
    from public.reports r
    where r.reporter_id = v_user_id
      and r.created_at >= pg_catalog.now() - interval '1 hour'
  ) >= 10 then
    raise exception using errcode = 'P0001', message = 'For mange rapporter. Prov igjen senere.';
  end if;

  insert into public.reports (listing_id, reporter_id, reason, details)
  values (p_listing_id, v_user_id, v_reason, v_details)
  returning id into v_report_id;

  return v_report_id;
end;
$$;

-- Rapportoren bestemmes alltid fra auth.uid() i RPC-en. Klienten skal ikke
-- kunne sette reporter_id eller skrive direkte i tabellen.
revoke insert on public.reports from public, anon, authenticated;
revoke all on function public.submit_report(uuid, text, text) from public;
grant execute on function public.submit_report(uuid, text, text) to authenticated;

create or replace function public.moderate_report(p_report_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_moderator_id uuid := auth.uid();
begin
  if v_moderator_id is null or not public.is_moderator() then
    raise exception using errcode = '42501', message = 'Moderatorrolle kreves.';
  end if;
  if p_status not in ('reviewed', 'dismissed') then
    raise exception using errcode = '22023', message = 'Ugyldig rapportstatus.';
  end if;

  update public.reports
  set status = p_status,
      moderated_at = pg_catalog.now()
  where id = p_report_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Rapporten finnes ikke.';
  end if;

  insert into public.report_moderation_audit (report_id, moderator_id, status)
  values (p_report_id, v_moderator_id, p_status);
end;
$$;

revoke all on function public.moderate_report(uuid, text) from public;
grant execute on function public.moderate_report(uuid, text) to authenticated;

commit;
