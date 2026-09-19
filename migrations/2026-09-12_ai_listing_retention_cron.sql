-- KollektivMatch – garantert opprydding av privat analysekvotelogg
-- Aktiver Supabase Cron / pg_cron før denne produksjonsmigreringen kjøres.

begin;

do $migration$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception
      'Supabase Cron/pg_cron må aktiveres før analysekvoteloggens slettejobb installeres';
  end if;
end
$migration$;

-- Navngitt planlegging oppdaterer samme jobb ved ny kjøring av migreringen.
-- 17 minutter over hver hele time begrenser overskytende lagring til under én time.
select cron.schedule(
  'purge-listing-analysis-requests',
  '17 * * * *',
  $job$
    delete from public.listing_analysis_requests
    where requested_at < now() - interval '7 days';
  $job$
);

commit;
