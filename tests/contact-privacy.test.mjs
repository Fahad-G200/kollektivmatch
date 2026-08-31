import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../migrations/2026-08-31_contact_privacy_hardening.sql', import.meta.url), 'utf8');
const detail = await readFile(new URL('../listing-detail.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dashboard.js', import.meta.url), 'utf8');
const createListing = await readFile(new URL('../create-listing.js', import.meta.url), 'utf8');
const privacy = await readFile(new URL('../privacy.html', import.meta.url), 'utf8');

test('authenticated users cannot bulk-select listing contact_info', () => {
  assert.match(migration, /revoke select on table public\.listings from authenticated/i);
  const publicGrant = migration.match(/grant select \(([\s\S]*?)\) on public\.listings to authenticated/i)?.[1] || '';
  assert.ok(publicGrant);
  assert.doesNotMatch(publicGrant, /\bcontact_info\b/i);
});

test('contact lookup requires auth and serializes its rate limit', () => {
  assert.match(migration, /create or replace function public\.get_listing_contact\(p_listing_id uuid\)/i);
  assert.match(migration, /if v_viewer_id is null then/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /v_recent_distinct >= 30/i);
  assert.match(migration, /last_accessed_at < now\(\) - interval '7 days'/i);
  assert.match(migration, /grant execute on function public\.get_listing_contact\(uuid\) to authenticated/i);
});

test('listing page fetches public fields and contact separately', () => {
  assert.doesNotMatch(detail, /select\(viewer \? '\*'/);
  assert.match(detail, /rpc\('get_listing_contact'/);
  assert.match(detail, /Kontaktinformasjonen kunne ikke hentes nå/);
});

test('owners load full listing rows only through scoped RPC', () => {
  assert.match(migration, /create or replace function public\.get_my_listings\(\)/i);
  assert.match(migration, /where l\.user_id = auth\.uid\(\)/i);
  assert.match(dashboard, /rpc\('get_my_listings'\)/);
  assert.match(migration, /create or replace function public\.get_my_listing\(p_listing_id uuid\)/i);
  assert.match(migration, /l\.id = p_listing_id[\s\S]*l\.user_id = auth\.uid\(\)/i);
  assert.match(createListing, /rpc\('get_my_listing'/);
});

test('privacy notice documents on-demand access and short retention', () => {
  assert.match(privacy, /konkrete annonsesiden/i);
  assert.match(privacy, /eldre enn sju dager/i);
  assert.match(privacy, /uavhengig tidsstyrt opprydding/i);
});
