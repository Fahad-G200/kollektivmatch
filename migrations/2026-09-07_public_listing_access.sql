-- KollektivMatch: offentlig lesing uten tilgang til private meldinger.
-- Kjøres etter 2026-09-01_reporting_hardening.sql. Ingen brukerdata endres.
begin;

-- RLS-uttrykk kjøres med leserens rettigheter. Samtalekontrollen skal derfor
-- bare gjelde authenticated, som allerede har SELECT på egne meldinger.
drop policy if exists "Aktive annonser er offentlige og eier ser egne" on public.listings;
drop policy if exists "Aktive annonser er offentlige og deltakere ser samtaleannonse" on public.listings;
drop policy if exists "Anonyme kan se aktive annonser" on public.listings;
create policy "Anonyme kan se aktive annonser"
  on public.listings for select to anon
  using (status = 'active');

create policy "Aktive annonser er offentlige og deltakere ser samtaleannonse"
  on public.listings for select to authenticated
  using (
    status = 'active'
    or auth.uid() = user_id
    or exists (
      select 1 from public.messages m
      where m.listing_id = listings.id
        and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
    )
  );

drop policy if exists "Relevant profilinformasjon kan leses" on public.profiles;
drop policy if exists "Anonyme kan se profiler med aktive annonser" on public.profiles;
create policy "Anonyme kan se profiler med aktive annonser"
  on public.profiles for select to anon
  using (
    exists (
      select 1 from public.listings l
      where l.user_id = profiles.id and l.status = 'active'
    )
  );

create policy "Relevant profilinformasjon kan leses"
  on public.profiles for select to authenticated
  using (
    auth.uid() = id
    or exists (
      select 1 from public.listings l
      where l.user_id = profiles.id and l.status = 'active'
    )
    or exists (
      select 1 from public.messages m
      where (m.sender_id = auth.uid() and m.receiver_id = profiles.id)
         or (m.receiver_id = auth.uid() and m.sender_id = profiles.id)
    )
  );

-- Behold den tilsiktede sperren for anonyme meldingsoppslag.
revoke select on public.messages from public, anon;

commit;
