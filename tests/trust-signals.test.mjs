import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const dashboard = read('dashboard.js');
const dashboardHtml = read('dashboard.html');
const feed = read('feed.js');
const chat = read('chat.js');
const terms = read('terms.html');
const securityMigration = read('migrations/2026-08-25_security_advisor_fixes.sql');

assert.match(dashboardHtml, /Andre trygghetssignaler/);
assert.match(dashboard, /email_confirmed_at/);
assert.match(dashboard, /currentProfile\?\.is_verified === true/);
assert.match(feed, /vipps_verified, is_verified/);
assert.match(feed, /Utdannings-e-post/);
assert.match(chat, /vipps_verified, is_verified/);
assert.match(terms, /ikke BankID, elektronisk ID/);
assert.doesNotMatch(dashboardHtml, /identiteten din er bekreftet/i);
assert.match(securityMigration, /to authenticated[\s\S]+storage\.foldername\(name\)/);
assert.match(securityMigration, /where n\.nspname = 'public' and p\.prosecdef/);
assert.match(securityMigration, /revoke execute on function public\.validate_listing_write\(\)/);

console.log('Trygghetssignaler og Advisor-herding: 11 kontroller besto.');
