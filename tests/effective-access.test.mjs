import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const migrationNames = readdirSync(join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort();
const migrations = migrationNames.map((name) => ({ name, source: read(`migrations/${name}`) }));
const allMigrations = migrations.map(({ source }) => source).join('\n');
const base = read('migrations/2026-08-23_kollektivmatch_hardening.sql');
const advisor = read('migrations/2026-08-25_security_advisor_fixes.sql');
const contact = read('migrations/2026-08-31_contact_privacy_hardening.sql');
const reporting = read('migrations/2026-09-01_reporting_hardening.sql');
const payment = read('migrations/2026-08-28_payment_and_storage_followup.sql');
const schema = read('schema.sql');

for (const { name, source } of migrations) {
  for (const match of source.matchAll(/^\s*security definer\s*$/gim)) {
    assert.match(
      source.slice(match.index, match.index + 140),
      /set search_path = pg_catalog(?:, [a-z_]+)*/i,
      `${name}: SECURITY DEFINER mangler fast search_path`,
    );
  }
}

assert.match(advisor, /where n\.nspname = 'public' and p\.prosecdef[\s\S]+revoke execute on function %I\.%I\(%s\) from public/i);

const publicProfileGrant = base.match(/grant select \(([^)]*)\)\s+on public\.profiles to anon, authenticated/i)?.[1] || '';
assert.ok(publicProfileGrant);
assert.doesNotMatch(publicProfileGrant, /income|budget|institution|occupation|seeker|search_location|terms/i);

assert.match(contact, /revoke select on table public\.listings from authenticated/i);
const authenticatedListingGrant = contact.match(/grant select \(([^)]*)\) on public\.listings to authenticated/i)?.[1] || '';
assert.ok(authenticatedListingGrant);
assert.doesNotMatch(authenticatedListingGrant, /contact_info/i);

assert.match(base, /revoke insert, update, delete on public\.messages from anon, authenticated/i);
assert.match(base, /grant select on public\.messages to authenticated/i);
assert.match(reporting, /revoke select on public\.messages from public, anon/i);
assert.match(payment, /revoke all on function public\.send_message\(uuid, uuid, text\) from public, anon, authenticated/i);
assert.match(payment, /grant execute on function public\.send_message\(uuid, uuid, text\) to authenticated/i);

assert.match(reporting, /revoke insert on public\.reports from public, anon, authenticated/i);
assert.match(reporting, /grant execute on function public\.submit_report\(uuid, text, text\) to authenticated/i);
assert.match(reporting, /revoke all on table public\.report_moderation_audit from public, anon, authenticated/i);

assert.match(allMigrations, /revoke all on public\.boost_payment_admin_export from public, anon, authenticated/i);
assert.match(allMigrations, /grant select on public\.boost_payment_admin_export to service_role/i);
assert.match(payment, /revoke all on function public\.create_boost_order\(uuid, uuid, text, text, text\)[\s\S]+to service_role/i);

assert.match(schema, /2026-08-31_contact_privacy_hardening\.sql[\s\S]+2026-09-01_reporting_hardening\.sql/);

console.log(`Effektiv tilgang: ${migrationNames.length + 16} statiske kontroller besto.`);
