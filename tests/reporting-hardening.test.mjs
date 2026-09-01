import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('migrations/2026-09-01_reporting_hardening.sql');
const listingDetail = read('listing-detail.js');

assert.match(migration, /revoke select on public\.messages from public, anon/);
assert.match(migration, /create or replace function public\.submit_report\(/);
assert.match(migration, /security definer\s+set search_path = pg_catalog, public/);
assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /hashtextextended\('submit_report:' \|\| v_user_id::text, 0\)/);
assert.match(migration, /r\.created_at >= pg_catalog\.now\(\) - interval '1 hour'/);
assert.match(migration, /\) >= 10 then/);
assert.match(migration, /l\.status = 'active'/);
assert.match(migration, /l\.user_id <> v_user_id/);
assert.match(migration, /v_reason not in \('svindel', 'spam', 'duplikat', 'annet'\)/);
assert.match(migration, /char_length\(v_details\) > 1000/);
assert.match(migration, /revoke insert on public\.reports from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.submit_report\(uuid, text, text\) to authenticated/);

assert.match(migration, /add column if not exists moderated_at timestamptz/);
assert.match(migration, /create table if not exists public\.report_moderation_audit/);
assert.match(migration, /moderator_id uuid references auth\.users\(id\) on delete set null/);
assert.match(migration, /revoke all on table public\.report_moderation_audit from public, anon, authenticated/);
assert.match(migration, /grant select on table public\.report_moderation_audit to service_role/);
assert.match(migration, /insert into public\.report_moderation_audit \(report_id, moderator_id, status\)/);
assert.match(migration, /moderated_at = pg_catalog\.now\(\)/);
assert.match(migration, /v_moderator_id is null or not public\.is_moderator\(\)/);

assert.match(listingDetail, /supabase\.rpc\('submit_report', reportPayload\)/);
assert.doesNotMatch(listingDetail, /supabase\.from\('reports'\)\.insert/);
assert.match(listingDetail, /isMissingReportsError\(error\) \|\| isMissingFunctionError\(error\)/);
assert.doesNotMatch(listingDetail, /select\('contact_info'\)/);

console.log('Rapporteringsherding: 26 statiske kontroller besto.');
