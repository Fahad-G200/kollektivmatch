import assert from 'node:assert/strict';
import fs from 'node:fs';
import { haversineKm, formatDistance, schoolSearchQueries, searchSchools } from '../location-utils.js';

const migration = fs.readFileSync(new URL('../migrations/2026-08-25_school_proximity.sql', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const feed = fs.readFileSync(new URL('../feed.js', import.meta.url), 'utf8');
const createListing = fs.readFileSync(new URL('../create-listing.js', import.meta.url), 'utf8');
const locationUtils = fs.readFileSync(new URL('../location-utils.js', import.meta.url), 'utf8');

const osloToBergen = haversineKm(
  { latitude: 59.9139, longitude: 10.7522 },
  { latitude: 60.3913, longitude: 5.3221 },
);
assert.ok(osloToBergen > 300 && osloToBergen < 310, 'Haversine-avstanden må være realistisk');
assert.equal(haversineKm(
  { latitude: null, longitude: null },
  { latitude: 59.9375, longitude: 10.71905 },
), null, 'Manglende annonsekoordinater skal ikke bli tolket som 0,0');
assert.match(formatDistance(0.42), /400 m|450 m/);
assert.match(formatDistance(3.25), /3,3 km/);
assert.deepEqual(schoolSearchQueries('UiO').slice(0, 2), ['Universitetet i Oslo', 'UiO']);
assert.ok(schoolSearchQueries('Oslo').includes('Universitetet i Oslo'), 'Søk på Oslo skal også lete etter UiO');
assert.ok(schoolSearchQueries('Oslo').some((query) => query.startsWith('OsloMet')), 'Søk på Oslo skal fortsatt finne OsloMet');

const originalFetch = globalThis.fetch;
const requestedSearches = [];
globalThis.fetch = async (url) => {
  const search = new URL(url).searchParams.get('sok');
  requestedSearches.push(search);
  const isUiO = search?.startsWith('Universitetet i Oslo');
  return {
    ok: true,
    async json() {
      return { navn: isUiO ? [{
        stedsnummer: 84823,
        skrivemåte: 'Universitetet i Oslo',
        navneobjekttype: 'Universitet/høgskole',
        representasjonspunkt: { nord: 59.9375, øst: 10.71905 },
        kommuner: [{ kommunenavn: 'Oslo' }],
        fylker: [{ fylkesnavn: 'Oslo' }],
      }] : [] };
    },
  };
};
try {
  const aliasResults = await searchSchools('UiO', { limit: 8, timeoutMs: 100 });
  assert.equal(aliasResults[0]?.name, 'Universitetet i Oslo', 'UiO-forkortelsen skal gi riktig universitet');
  assert.equal(requestedSearches.length, 0, 'Kjente universiteter skal vises umiddelbart uten nettverksventing');
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.fetch = async () => { throw new Error('nettverket er utilgjengelig'); };
try {
  const fallbackResults = await searchSchools('NTNU', { limit: 8, timeoutMs: 100 });
  assert.equal(fallbackResults[0]?.name, 'NTNU Gløshaugen', 'Kjente universiteter skal virke uten Kartverket');
  assert.ok(Number.isFinite(fallbackResults[0]?.latitude));
  assert.ok(Number.isFinite(fallbackResults[0]?.longitude));
} finally {
  globalThis.fetch = originalFetch;
}
assert.match(locationUtils, /api\.kartverket\.no\/stedsnavn\/v1\/navn/);
assert.match(locationUtils, /SCHOOL_TYPES = new Set\(\['Skole', 'Universitet\/høgskole'\]\)/);
assert.match(index, /id="f-school"[\s\S]+id="school-suggestions"/);
assert.match(index, /value="nearest_school"/);
assert.match(app, /searchSchools[\s\S]+ensureSchoolSelection/);
assert.match(feed, /location_lat, location_lon, location_precision/);
assert.match(feed, /compareNearestSchool/);
assert.match(feed, /MAX_CLIENT_RANKED_RESULTS = 500/);
assert.match(feed, /data = data\.slice\(page \* PAGE_SIZE, \(page \+ 1\) \* PAGE_SIZE\)/);
assert.match(createListing, /geocodeListingArea/);
assert.match(createListing, /location_lat: approximateLocation\?\.latitude/);
assert.match(migration, /add column if not exists location_lat double precision/i);
assert.match(migration, /location_precision in \('area', 'city'\)/i);
assert.match(migration, /grant select \(location_lat, location_lon, location_precision\)[\s\S]+to anon, authenticated/i);

console.log('Skolenærhet: 23 tester besto.');
