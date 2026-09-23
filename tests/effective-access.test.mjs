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
const executeGrants = read('migrations/2026-09-08_security_definer_execute_grants.sql');
const schema = read('schema.sql');
const readme = read('README.md');

for (const { name, source } of migrations) {
  for (const match of source.matchAll(/^\s*security definer\s*$/gim)) {
    assert.match(
      source.slice(match.index, match.index + 140),
      /set search_path = (?:pg_catalog(?:, [a-z_]+)*|'')/i,
      `${name}: SECURITY DEFINER mangler fast search_path`,
    );
  }
}

assert.match(advisor, /where n\.nspname = 'public' and p\.prosecdef[\s\S]+revoke execute on function %I\.%I\(%s\) from public/i);

const publicProfileGrant = base.match(/grant select \(([^)]*)\)\s+on public\.profiles to anon, authenticated/i)?.[1] || '';
assert.ok(publicProfileGrant);
assert.doesNotMatch(publicProfileGrant, /income|budget|institution|occupation|seeker|search_location|terms/i);

assert.match(contact, /revoke select on table public\.listings from public, anon, authenticated/i);
assert.match(contact, /revoke select \(contact_info\) on table public\.listings from public, anon, authenticated/i);
const publicListingGrant = contact.match(/grant select \(([^)]*)\) on public\.listings to anon, authenticated/i)?.[1] || '';
assert.ok(publicListingGrant);
assert.doesNotMatch(publicListingGrant, /contact_info/i);

assert.match(base, /revoke insert, update, delete on public\.messages from anon, authenticated/i);
assert.match(base, /grant select on public\.messages to authenticated/i);
assert.match(reporting, /revoke select on public\.messages from public, anon/i);
assert.match(payment, /revoke all on function public\.send_message\(uuid, uuid, text\) from public, anon, authenticated/i);
assert.match(payment, /grant execute on function public\.send_message\(uuid, uuid, text\) to authenticated/i);

for (const signature of [
  'contact_home_seeker\\(uuid, uuid, text\\)',
  'delete_my_account\\(text\\)',
  'export_my_data\\(\\)',
  'get_home_seekers\\(uuid\\)',
  'get_listing_contact\\(uuid\\)',
  'get_my_listing\\(uuid\\)',
  'get_my_listings\\(\\)',
  'get_my_profile\\(\\)',
  'list_reports_for_moderation\\(\\)',
  'mark_messages_read\\(uuid, uuid\\)',
  'moderate_report\\(uuid, text\\)',
  'send_message\\(uuid, uuid, text\\)',
  'submit_report\\(uuid, text, text\\)',
]) {
  assert.match(
    executeGrants,
    new RegExp(`revoke all on function public\\.${signature}\\s+from public, anon, authenticated;`, 'i'),
  );
  assert.match(
    executeGrants,
    new RegExp(`grant execute on function public\\.${signature}\\s+to authenticated;`, 'i'),
  );
}
for (const signature of ['handle_new_user\\(\\)', 'sync_profile_email_verification\\(\\)']) {
  assert.match(
    executeGrants,
    new RegExp(`revoke all on function public\\.${signature}\\s+from public, anon, authenticated;`, 'i'),
  );
  assert.doesNotMatch(executeGrants, new RegExp(`grant execute on function public\\.${signature}`, 'i'));
}
assert.match(executeGrants, /revoke all on function public\.get_response_stats\(uuid\)\s+from public, anon, authenticated/i);
assert.match(executeGrants, /grant execute on function public\.get_response_stats\(uuid\)\s+to anon, authenticated/i);
assert.match(executeGrants, /alter default privileges in schema public[\s\S]+revoke execute on functions from public, anon, authenticated/i);

assert.match(reporting, /revoke insert on public\.reports from public, anon, authenticated/i);
assert.match(reporting, /grant execute on function public\.submit_report\(uuid, text, text\) to authenticated/i);
assert.match(reporting, /revoke all on table public\.report_moderation_audit from public, anon, authenticated/i);

assert.match(allMigrations, /revoke all on public\.boost_payment_admin_export from public, anon, authenticated/i);
assert.match(allMigrations, /grant select on public\.boost_payment_admin_export to service_role/i);
assert.match(payment, /revoke all on function public\.create_boost_order\(uuid, uuid, text, text, text\)[\s\S]+to service_role/i);

const migrationTail = /2026-09-01_reporting_hardening\.sql[\s\S]+2026-09-07_public_listing_access\.sql[\s\S]+2026-09-07_cabin_property_type\.sql[\s\S]+2026-09-08_security_definer_execute_grants\.sql[\s\S]+2026-09-11_match_preference_coverage\.sql[\s\S]+2026-09-12_ai_listing_checks\.sql[\s\S]+2026-09-12_external_listing_analysis\.sql[\s\S]+2026-09-12_ai_listing_retention_cron\.sql[\s\S]+2026-09-12_external_listing_analysis_retention_cron\.sql[\s\S]+2026-09-20_automatic_listing_search\.sql[\s\S]+2026-09-20_supabase_advisor_hardening\.sql[\s\S]+2026-09-20_automatic_listing_search_retention_cron\.sql/;
assert.match(schema, migrationTail);
assert.match(readme, migrationTail);

console.log(`Effektiv tilgang: ${migrationNames.length + 16} statiske kontroller besto.`);
