import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMatchPreferences, computeMatch, compareBestMatch, compareNearestSchool } from '../match.js';

const baseListing = {
  id: 'a',
  price: 7000,
  property_type: 'leilighet',
  preferred_occupations: [],
  move_in_date: null,
  lifestyle_tags: ['rolig-miljo', 'stort-rom'],
  amenities: [],
  location_lat: 59.9375,
  location_lon: 10.71905,
  created_at: '2026-08-20T12:00:00Z',
};

assert.equal(computeMatch(baseListing, {}) , null, 'Manglende profil skal ikke gi gratis poeng');

const complete = computeMatch(baseListing, {
  monthly_budget_max: 7500,
  preferred_property_types: ['leilighet'],
  occupation: 'student',
  desired_move_in_date: '2026-09-01',
  priority_tags: ['rolig-miljo', 'stort-rom'],
});
assert.equal(complete.score, 100);
assert.match(complete.explanation, /Innenfor budsjett/);

const missingListingData = computeMatch(
  { ...baseListing, property_type: null, lifestyle_tags: [], amenities: [] },
  { monthly_budget_max: 7500, preferred_property_types: ['hybel'], priority_tags: ['stort-rom'] },
);
assert.equal(missingListingData, null, 'Manglende annonsedata skal ikke telle positivt eller negativt');

const unrestricted = computeMatch(baseListing, { monthly_budget_max: 7500, occupation: 'student' });
assert.equal(unrestricted.score, 100, 'Tom yrkesliste betyr alle er velkomne');

const olderBetter = { ...baseListing, _match: { score: 95 }, created_at: '2026-01-01T00:00:00Z' };
const newerWorse = { ...baseListing, id: 'b', _match: { score: 80 }, created_at: '2026-08-22T00:00:00Z' };
assert.ok(compareBestMatch(olderBetter, newerWorse) < 0, 'Alder skal ikke overstyre en bedre matchscore');

const schoolOnly = computeMatch(baseListing, null, {
  school: { name: 'Universitetet i Oslo', latitude: 59.9375, longitude: 10.71905 },
});
assert.equal(schoolOnly.score, 100, 'Valgt skole skal alene kunne gi en tydelig nærhetsmatch');
assert.equal(schoolOnly.schoolDistanceKm, 0);

const fartherListing = {
  ...baseListing,
  id: 'far',
  location_lat: 60.3913,
  location_lon: 5.3221,
  _match: { score: 0, schoolDistanceKm: 305 },
};
const nearerListing = { ...baseListing, _match: schoolOnly };
assert.ok(compareNearestSchool(nearerListing, fartherListing) < 0, 'Nærmeste skoleavstand skal sorteres først');

const filteredPreferences = buildMatchPreferences({
  monthly_budget_max: 5000,
  preferred_property_types: ['hybel'],
  priority_tags: ['stort-rom'],
}, {
  city: 'Oslo',
  maxPrice: '8000',
  propertyType: 'leilighet',
  maxTransitMinutes: '5',
  amenities: ['treningssenter'],
  lifestyleTags: ['rolig-miljo'],
});
assert.deepEqual({
  budget: filteredPreferences.monthly_budget_max,
  types: filteredPreferences.preferred_property_types,
  tags: filteredPreferences.priority_tags,
  transit: filteredPreferences.max_transit_minutes,
  location: filteredPreferences.search_location,
}, {
  budget: 8000,
  types: ['leilighet'],
  tags: ['treningssenter', 'rolig-miljo'],
  transit: 5,
  location: 'Oslo',
}, 'Aktive filtre skal overstyre tilsvarende lagrede preferanser');

const filteredMatch = computeMatch({
  ...baseListing,
  city: 'Oslo',
  transit_minutes: 3,
  amenities: ['treningssenter'],
}, filteredPreferences);
assert.equal(filteredMatch.score, 100, 'En annonse som oppfyller alle valgte filtre skal få korrekt full match');

const filterMismatch = computeMatch({
  ...baseListing,
  city: 'Bergen',
  property_type: 'hybel',
  price: 9000,
  transit_minutes: 15,
  amenities: [],
  lifestyle_tags: [],
}, filteredPreferences);
assert.ok(filterMismatch.score < filteredMatch.score, 'Avvik fra de aktive filtrene skal redusere matchprosenten');

const missingTransit = computeMatch(
  { ...baseListing, transit_minutes: null },
  { monthly_budget_max: 8000, max_transit_minutes: 5 },
);
assert.equal(missingTransit, null, 'Manglende kollektivdata skal ikke feilaktig behandles som 0 minutter');

const feedSource = readFileSync(new URL('../feed.js', import.meta.url), 'utf8');
assert.match(feedSource, /rankAllMatchResults[\s\S]+MAX_CLIENT_RANKED_RESULTS[\s\S]+data\.sort\(compareBestMatch\)[\s\S]+data = data\.slice/, 'Beste match skal rangeres før paginering');

console.log('Smart Match: 13 tester besto.');
