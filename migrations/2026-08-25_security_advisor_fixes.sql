-- KollektivMatch – strammere Storage-listing og funksjonsrettigheter
-- Dato: 2026-08-25
-- Additiv migrering: sletter ingen filer, annonser, profiler eller meldinger.

begin;

-- Offentlige buckets kan fortsatt vise en fil via den kjente public-URL-en,
-- men besøkende skal ikke kunne liste alle objektnavn i hele bucketen.
drop policy if exists "Alle kan lese listing-bilder" on storage.objects;
drop policy if exists "Alle kan lese annonsevideoer" on storage.objects;
drop policy if exists "Alle kan lese profilbilder" on storage.objects;

drop policy if exists "Bruker kan liste egne listing-bilder" on storage.objects;
create policy "Bruker kan liste egne listing-bilder" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Bruker kan liste egne annonsevideoer" on storage.objects;
create policy "Bruker kan liste egne annonsevideoer" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'listing-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Bruker kan liste egne profilbilder" on storage.objects;
create policy "Bruker kan liste egne profilbilder" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- CREATE FUNCTION gir ellers PUBLIC kjøretillatelse som standard. Fjern den
-- fra alle SECURITY DEFINER-funksjoner uten å endre eksplisitte grants til
-- authenticated, anon eller service_role.
do $$
declare
  fn record;
begin
  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public',
      fn.nspname, fn.proname, fn.arguments
    );
  end loop;
end;
$$;

-- Disse tre brukes bare av database-triggere og skal ikke kalles direkte.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.set_boost_updated_at() from public, anon, authenticated;
revoke execute on function public.validate_listing_write() from public, anon, authenticated;

commit;
