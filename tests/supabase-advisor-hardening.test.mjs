import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const migration = read('migrations/2026-09-20_supabase_advisor_hardening.sql');
const schema = read('schema.sql');
const readme = read('README.md');

test('offentlig svarstatistikk er avgrenset og skjuler eksakt volum', () => {
  assert.match(migration, /join public\.listings l[\s\S]+l\.status = 'active'/);
  assert.match(migration, /actual_sample_size < 3 then null/);
  assert.match(migration, /actual_sample_size < 3 then 0 else 3/);
  assert.match(migration, /revoke all on function public\.get_response_stats\(uuid\)[\s\S]+from public, anon, authenticated/);
  assert.match(migration, /set search_path = ''/);
});

test('aktive RLS- og Storage-policyer bruker initplan-vennlig auth uid', () => {
  for (const policy of [
    'Bruker kan opprette egen profil',
    'Relevant profilinformasjon kan leses',
    'Aktive annonser er offentlige og deltakere ser samtaleannonse',
    'Kun avsender og mottaker kan se meldingen',
    'Bruker kan lese egne boost-ordrer',
    'Bruker kan laste opp i egen bildemappe',
  ]) assert.match(migration, new RegExp(`create policy "${policy}"`));
  assert.match(migration, /\(select auth\.uid\(\)\)/);
  const sqlWithoutComments = migration.replace(/--.*$/gm, '');
  assert.doesNotMatch(sqlWithoutComments, /(?<!select )auth\.uid\(\)/);
});

test('manglende direkte fremmednøkkelindekser opprettes', () => {
  for (const index of [
    'listings_user_id_idx',
    'messages_sender_id_idx',
    'boost_orders_product_id_idx',
    'listing_contact_accesses_listing_id_idx',
    'report_moderation_audit_moderator_id_idx',
    'listing_analysis_requests_listing_id_idx',
  ]) assert.match(migration, new RegExp(`create index if not exists ${index}`));
});

test('begge installasjonsveivisere inneholder alle nye migreringer', () => {
  for (const name of [
    '2026-09-12_external_listing_analysis.sql',
    '2026-09-12_external_listing_analysis_retention_cron.sql',
    '2026-09-20_automatic_listing_search.sql',
    '2026-09-20_supabase_advisor_hardening.sql',
    '2026-09-20_automatic_listing_search_retention_cron.sql',
  ]) {
    assert.match(schema, new RegExp(name.replaceAll('.', '\\.')));
    assert.match(readme, new RegExp(name.replaceAll('.', '\\.')));
  }
});
