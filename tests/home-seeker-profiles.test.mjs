import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeMatch } from '../match.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('migrations/2026-08-26_home_seeker_profiles.sql');
const page = read('home-seekers.html');
const script = read('home-seekers.js');
const dashboard = read('dashboard.html');
const privacy = read('privacy.html');
const feed = read('feed.js');

assert.match(migration, /home_seeker_visible boolean not null default false/);
assert.match(migration, /Du må eie en aktiv annonse for å se boligsøkere/);
assert.match(migration, /p\.home_seeker_visible = true/);
assert.match(migration, /grant execute on function public\.get_home_seekers\(uuid\) to authenticated/);
assert.match(migration, /contact_home_seeker/);
assert.doesNotMatch(migration.match(/returns table \([\s\S]*?\)\nlanguage/)?.[0] || '', /income_amount|email|phone/i);
assert.match(dashboard, /Vis meg som boligsøker/);
assert.match(dashboard, /E-post, telefon og inntekt vises aldri/);
assert.match(page, /Privat oversikt for annonsøren/);
assert.match(script, /supabase\.rpc\('get_home_seekers'/);
assert.match(script, /supabase\.rpc\('contact_home_seeker'/);
assert.match(feed, /data-share-listing/);
assert.match(privacy, /Du kan slå synligheten av igjen/);

const listing = {
  price: 8000,
  city: 'Oslo',
  area: 'Majorstuen',
  property_type: 'leilighet',
  preferred_occupations: ['student'],
  move_in_date: '2026-09-01',
  lifestyle_tags: ['rolig-miljo'],
  amenities: [],
};
const seeker = {
  monthly_budget_max: 8500,
  search_location: 'Oslo',
  preferred_property_types: ['leilighet'],
  occupation: 'student',
  desired_move_in_date: '2026-09-01',
  priority_tags: ['rolig-miljo'],
};
assert.equal(computeMatch(listing, seeker)?.score, 100, 'Utleiers annonse skal kunne matches mot en frivillig boligsøkerprofil');

console.log('Frivillige boligsøkerprofiler: 14 kontroller besto.');
