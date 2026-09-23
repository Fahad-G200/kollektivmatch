-- KollektivMatch – oppfølging av Supabase Security/Performance Advisor.
-- Endrer ingen brukerdata. Kjør etter alle tidligere migreringer.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

-- Offentlig tillitsstatistikk skal bare bygge på aktive annonser. Eksakt volum
-- skjules; frontend trenger bare å vite om terskelen på tre samtaler er nådd.
create or replace function public.get_response_stats(target_user uuid)
returns table(response_rate integer, sample_size integer)
language sql
stable
security definer
set search_path = ''
as $function$
  with incoming as (
    select distinct m.listing_id, m.sender_id as asker_id
    from public.messages m
    join public.listings l
      on l.id = m.listing_id
     and l.user_id = target_user
     and l.status = 'active'
    where m.receiver_id = target_user
  ), replied as (
    select i.listing_id, i.asker_id
    from incoming i
    where exists (
      select 1
      from public.messages m
      where m.listing_id = i.listing_id
        and m.sender_id = target_user
        and m.receiver_id = i.asker_id
    )
  ), counts as (
    select
      count(*)::integer as actual_sample_size,
      count(r.asker_id)::integer as actual_replied
    from incoming i
    left join replied r using (listing_id, asker_id)
  )
  select
    case
      when c.actual_sample_size < 3 then null::integer
      else round(100.0 * c.actual_replied / c.actual_sample_size)::integer
    end,
    case when c.actual_sample_size < 3 then 0 else 3 end
  from counts c;
$function$;

revoke all on function public.get_response_stats(uuid)
  from public, anon, authenticated;
grant execute on function public.get_response_stats(uuid)
  to anon, authenticated;

comment on function public.get_response_stats(uuid) is
  'Svarprosent bare for aktive annonser. sample_size er et terskelsignal (0 eller 3), ikke eksakt meldingsvolum.';

-- Samme RLS-tilgang som før, men auth.uid() evalueres én gang per statement.
drop policy if exists "Bruker kan opprette egen profil" on public.profiles;
create policy "Bruker kan opprette egen profil"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Bruker kan oppdatere egen profil" on public.profiles;
create policy "Bruker kan oppdatere egen profil"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Relevant profilinformasjon kan leses" on public.profiles;
create policy "Relevant profilinformasjon kan leses"
  on public.profiles for select to authenticated
  using (
    (select auth.uid()) = id
    or exists (
      select 1 from public.listings l
      where l.user_id = profiles.id and l.status = 'active'
    )
    or exists (
      select 1 from public.messages m
      where (m.sender_id = (select auth.uid()) and m.receiver_id = profiles.id)
         or (m.receiver_id = (select auth.uid()) and m.sender_id = profiles.id)
    )
  );

drop policy if exists "Aktive annonser er offentlige og deltakere ser samtaleannonse"
  on public.listings;
create policy "Aktive annonser er offentlige og deltakere ser samtaleannonse"
  on public.listings for select to authenticated
  using (
    status = 'active'
    or (select auth.uid()) = user_id
    or exists (
      select 1 from public.messages m
      where m.listing_id = listings.id
        and (m.sender_id = (select auth.uid()) or m.receiver_id = (select auth.uid()))
    )
  );

drop policy if exists "Innloggede brukere kan opprette egne annonser" on public.listings;
create policy "Innloggede brukere kan opprette egne annonser"
  on public.listings for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Eier kan oppdatere egen annonse" on public.listings;
create policy "Eier kan oppdatere egen annonse"
  on public.listings for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Eier kan slette egen annonse" on public.listings;
create policy "Eier kan slette egen annonse"
  on public.listings for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Kun avsender og mottaker kan se meldingen" on public.messages;
create policy "Kun avsender og mottaker kan se meldingen"
  on public.messages for select to authenticated
  using ((select auth.uid()) = sender_id or (select auth.uid()) = receiver_id);

-- Direkte INSERT er tilbakekalt, men policyen beholdes som ekstra vern.
drop policy if exists "Brukere kan rapportere andres annonser" on public.reports;
create policy "Brukere kan rapportere andres annonser"
  on public.reports for insert to authenticated
  with check (
    (select auth.uid()) = reporter_id
    and exists (
      select 1 from public.listings l
      where l.id = reports.listing_id and l.user_id <> (select auth.uid())
    )
  );

drop policy if exists "Bruker kan lese egne boost-ordrer" on public.boost_orders;
create policy "Bruker kan lese egne boost-ordrer"
  on public.boost_orders for select to authenticated
  using ((select auth.uid()) = user_id);

-- Storage-policyene beholdes funksjonelt like, med initplan-vennlig auth.uid().
drop policy if exists "Bruker kan laste opp i egen bildemappe" on storage.objects;
create policy "Bruker kan laste opp i egen bildemappe"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'listing-images'
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](webp|jpe?g|png)$')
    and public.storage_quota_available('listing-images', 500)
  );

drop policy if exists "Bruker kan laste opp i egen videomappe" on storage.objects;
create policy "Bruker kan laste opp i egen videomappe"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'listing-videos'
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](mp4|webm|mov)$')
    and public.storage_quota_available('listing-videos', 20)
  );

drop policy if exists "Bruker kan laste opp eget profilbilde" on storage.objects;
create policy "Bruker kan laste opp eget profilbilde"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and name = (select auth.uid())::text || '/avatar.webp'
    and public.storage_quota_available('profile-avatars', 2)
  );

drop policy if exists "Bruker kan oppdatere eget profilbilde" on storage.objects;
create policy "Bruker kan oppdatere eget profilbilde"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-avatars'
    and name = (select auth.uid())::text || '/avatar.webp'
    and owner_id = (select auth.uid())::text
  )
  with check (
    bucket_id = 'profile-avatars'
    and name = (select auth.uid())::text || '/avatar.webp'
    and owner_id = (select auth.uid())::text
  );

drop policy if exists "Bruker kan liste egne listing-bilder" on storage.objects;
create policy "Bruker kan liste egne listing-bilder"
  on storage.objects for select to authenticated
  using (bucket_id = 'listing-images' and owner_id = (select auth.uid())::text);

drop policy if exists "Bruker kan liste egne annonsevideoer" on storage.objects;
create policy "Bruker kan liste egne annonsevideoer"
  on storage.objects for select to authenticated
  using (bucket_id = 'listing-videos' and owner_id = (select auth.uid())::text);

drop policy if exists "Bruker kan liste egne profilbilder" on storage.objects;
create policy "Bruker kan liste egne profilbilder"
  on storage.objects for select to authenticated
  using (bucket_id = 'profile-avatars' and owner_id = (select auth.uid())::text);

drop policy if exists "Bruker kan slette i egen bildemappe" on storage.objects;
create policy "Bruker kan slette i egen bildemappe"
  on storage.objects for delete to authenticated
  using (bucket_id = 'listing-images' and owner_id = (select auth.uid())::text);

drop policy if exists "Bruker kan slette i egen videomappe" on storage.objects;
create policy "Bruker kan slette i egen videomappe"
  on storage.objects for delete to authenticated
  using (bucket_id = 'listing-videos' and owner_id = (select auth.uid())::text);

drop policy if exists "Bruker kan slette eget profilbilde" on storage.objects;
create policy "Bruker kan slette eget profilbilde"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-avatars'
    and name = (select auth.uid())::text || '/avatar.webp'
    and owner_id = (select auth.uid())::text
  );

-- Direkte indekser på FK-kolonner som ellers mangler venstrestilt dekning.
create index if not exists listings_user_id_idx on public.listings (user_id);
create index if not exists messages_sender_id_idx on public.messages (sender_id);
create index if not exists boost_orders_product_id_idx on public.boost_orders (product_id);
create index if not exists listing_contact_accesses_listing_id_idx
  on public.listing_contact_accesses (listing_id);
create index if not exists report_moderation_audit_moderator_id_idx
  on public.report_moderation_audit (moderator_id);
create index if not exists listing_analysis_requests_listing_id_idx
  on public.listing_analysis_requests (listing_id);

commit;
