-- KollektivMatch – minst mulige kjøretillatelser for SECURITY DEFINER-RPC-er
-- Dato: 2026-09-08
-- Additiv migrering: endrer bare hvem som kan kalle funksjonene.

begin;

-- Supabase kan gi anon/authenticated EXECUTE gjennom standardrettigheter når
-- en funksjon opprettes. Nye funksjoner skal derfor være stengt til en senere
-- migrering gir en eksplisitt, begrunnet rettighet.
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

-- Disse funksjonene brukes bare av database-triggere.
revoke all on function public.handle_new_user()
  from public, anon, authenticated;
revoke all on function public.sync_profile_email_verification()
  from public, anon, authenticated;

-- Bruker-RPC-er krever en gyldig innlogget Supabase-bruker. Funksjonene har
-- i tillegg egne auth.uid()- og eierskapskontroller, men anon skal ikke kunne
-- starte dem i det hele tatt.
revoke all on function public.contact_home_seeker(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.contact_home_seeker(uuid, uuid, text)
  to authenticated;

revoke all on function public.delete_my_account(text)
  from public, anon, authenticated;
grant execute on function public.delete_my_account(text)
  to authenticated;

revoke all on function public.export_my_data()
  from public, anon, authenticated;
grant execute on function public.export_my_data()
  to authenticated;

revoke all on function public.get_home_seekers(uuid)
  from public, anon, authenticated;
grant execute on function public.get_home_seekers(uuid)
  to authenticated;

revoke all on function public.get_listing_contact(uuid)
  from public, anon, authenticated;
grant execute on function public.get_listing_contact(uuid)
  to authenticated;

revoke all on function public.get_my_listing(uuid)
  from public, anon, authenticated;
grant execute on function public.get_my_listing(uuid)
  to authenticated;

revoke all on function public.get_my_listings()
  from public, anon, authenticated;
grant execute on function public.get_my_listings()
  to authenticated;

revoke all on function public.get_my_profile()
  from public, anon, authenticated;
grant execute on function public.get_my_profile()
  to authenticated;

revoke all on function public.list_reports_for_moderation()
  from public, anon, authenticated;
grant execute on function public.list_reports_for_moderation()
  to authenticated;

revoke all on function public.mark_messages_read(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_messages_read(uuid, uuid)
  to authenticated;

revoke all on function public.moderate_report(uuid, text)
  from public, anon, authenticated;
grant execute on function public.moderate_report(uuid, text)
  to authenticated;

revoke all on function public.send_message(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.send_message(uuid, uuid, text)
  to authenticated;

revoke all on function public.submit_report(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_report(uuid, text, text)
  to authenticated;

-- get_response_stats(uuid) er bevisst tilgjengelig for både anon og
-- authenticated. Den returnerer bare aggregert svarprosent og utvalgsstørrelse
-- som vises på offentlige annonsekort; den returnerer ingen meldinger.
revoke all on function public.get_response_stats(uuid)
  from public, anon, authenticated;
grant execute on function public.get_response_stats(uuid)
  to anon, authenticated;

commit;
