-- KollektivMatch – uavhengig opprydding av kvoteloggen for automatisk boligsøk.
-- Kjør etter 2026-09-20_automatic_listing_search.sql og aktiver Supabase Cron.

begin;

do $migration$
begin
  if to_regclass('public.automatic_listing_search_requests') is null then
    raise exception 'Kjør migreringen for automatisk boligsøk før slettejobben installeres';
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'Supabase Cron/pg_cron må aktiveres før slettejobben installeres';
  end if;
end
$migration$;

select cron.schedule(
  'purge-automatic-listing-search-requests',
  '41 * * * *',
  $job$
    delete from public.automatic_listing_search_requests
    where requested_at < now() - interval '25 hours';
  $job$
);

commit;
