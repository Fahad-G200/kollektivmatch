-- KollektivMatch – tidsstyrt opprydding av ekstern analysekvotelogg.
-- Kjør etter 2026-09-12_external_listing_analysis.sql og aktiver Supabase Cron.

begin;

do $migration$
begin
  if to_regclass('public.external_listing_analysis_requests') is null then
    raise exception
      'Kjør migreringen for ekstern boligkontroll før slettejobben installeres';
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception
      'Supabase Cron/pg_cron må aktiveres før den eksterne analysekvoteloggens slettejobb installeres';
  end if;
end
$migration$;

-- 29 minutter over hver time gir en uavhengig slettefrist på maksimalt
-- omtrent 26 timer, også dersom ingen nye kontroller startes.
select cron.schedule(
  'purge-external-listing-analysis-requests',
  '29 * * * *',
  $job$
    delete from public.external_listing_analysis_requests
    where requested_at < now() - interval '25 hours';
  $job$
);

commit;
