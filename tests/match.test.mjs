import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMatchPreferences, computeMatch, compareBestMatch, compareNearestSchool, schoolProximityRatio } from '../match.js';

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
assert.deepEqual(
  complete.breakdown.map(({ label, percentage }) => ({ label, percentage })),
  [
    { label: 'Budsjett', percentage: 100 },
    { label: 'Boligtype', percentage: 100 },
    { label: 'Hverdag', percentage: 100 },
    { label: 'Innflytting', percentage: 100 },
    { label: 'Boligkvaliteter', percentage: 100 },
  ],
  'Alle vurderte kriterier skal følge resultatet som en forståelig forklaring',
);

const missingListingData = computeMatch(
  { ...baseListing, property_type: null, lifestyle_tags: [], amenities: [] },
  { monthly_budget_max: 7500, preferred_property_types: ['hybel'], priority_tags: ['stort-rom'] },
);
assert.equal(missingListingData.unknownCriteria, 1, 'Manglende annonsedata skal registreres som ukjent');
assert.deepEqual(
  missingListingData.breakdown.find(({ label }) => label === 'Boligtype'),
  {
    label: 'Boligtype',
    detail: 'Boligtype er ikke oppgitt i annonsen',
    percentage: null,
    weight: 25,
    status: 'unknown',
  },
  'Et manglende felt skal vises som ukjent og ikke som oppfylt',
);
assert.ok(missingListingData.score < 100, 'Manglende annonsedata skal ikke blåse opp matchprosenten');

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
assert.equal(schoolOnly.isSchoolOnly, true, 'Skole som eneste grunnlag skal merkes som nærhetsmatch');
assert.equal(schoolOnly.confidence, 'limited', 'Ett kriterium skal ikke presenteres som et sterkt datagrunnlag');

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
  amenities: filteredPreferences.preferred_amenities,
  lifestyle: filteredPreferences.preferred_lifestyle_tags,
  transit: filteredPreferences.max_transit_minutes,
  location: filteredPreferences.search_location,
}, {
  budget: 8000,
  types: ['leilighet'],
  tags: ['rolig-miljo'],
  amenities: ['treningssenter'],
  lifestyle: ['rolig-miljo'],
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
assert.equal(filteredMatch.confidence, 'high', 'Fem eller flere vurderte kriterier skal gi høyt datagrunnlag');

const fiveCriterionFilters = {
  city: 'Majorstuen, Oslo',
  maxTransitMinutes: '8',
  amenities: ['matbutikk', 'kollektivtransport'],
  lifestyleTags: ['rolig-miljo', 'stort-rom'],
};
const fiveCriterionPreferences = buildMatchPreferences(null, fiveCriterionFilters);
const selectedSchool = {
  name: 'Universitetet i Oslo',
  latitude: 59.9375,
  longitude: 10.71905,
};
const fiveCriterionListing = {
  city: 'Oslo',
  area: 'Majorstuen',
  transit_minutes: 5,
  amenities: ['matbutikk', 'kollektivtransport'],
  lifestyle_tags: ['rolig-miljo', 'stort-rom'],
  location_lat: 59.9375,
  location_lon: 10.71905,
};

assert.deepEqual(fiveCriterionPreferences.preferred_amenities, fiveCriterionFilters.amenities);
assert.deepEqual(fiveCriterionPreferences.preferred_lifestyle_tags, fiveCriterionFilters.lifestyleTags);

const fiveCriterionMatch = computeMatch(fiveCriterionListing, fiveCriterionPreferences, { school: selectedSchool });
assert.equal(fiveCriterionMatch.score, 100);
assert.equal(fiveCriterionMatch.criteria, 5);
assert.equal(fiveCriterionMatch.verifiedCriteria, 5);
assert.equal(fiveCriterionMatch.unknownCriteria, 0);
assert.deepEqual(
  fiveCriterionMatch.breakdown.map(({ label, percentage, status }) => ({ label, percentage, status })),
  [
    { label: 'Område', percentage: 100, status: 'matched' },
    { label: 'Kollektivtransport', percentage: 100, status: 'matched' },
    { label: 'Fasiliteter', percentage: 100, status: 'matched' },
    { label: 'Boligkvaliteter', percentage: 100, status: 'matched' },
    { label: 'Skoleavstand', percentage: 100, status: 'matched' },
  ],
  'Område, transport, fasiliteter, boligkvaliteter og skole skal vurderes separat',
);

const criterion = (match, label) => match.breakdown.find((item) => item.label === label);
assert.equal(
  criterion(computeMatch({ ...fiveCriterionListing, amenities: [] }, fiveCriterionPreferences, { school: selectedSchool }), 'Fasiliteter').percentage,
  0,
  'Manglende valgte fasiliteter skal slå ut uavhengig av boligkvalitetene',
);
assert.equal(
  criterion(computeMatch({ ...fiveCriterionListing, lifestyle_tags: [] }, fiveCriterionPreferences, { school: selectedSchool }), 'Boligkvaliteter').percentage,
  0,
  'Manglende valgte boligkvaliteter skal slå ut uavhengig av fasilitetene',
);
assert.equal(
  criterion(computeMatch({ ...fiveCriterionListing, area: 'Grünerløkka' }, fiveCriterionPreferences, { school: selectedSchool }), 'Område').percentage,
  0,
  'Feil delområde skal gi et eget områdeavvik',
);
assert.equal(
  criterion(computeMatch({ ...fiveCriterionListing, transit_minutes: 12 }, fiveCriterionPreferences, { school: selectedSchool }), 'Kollektivtransport').percentage,
  50,
  'Transporttid over ønsket grense skal gi en egen delscore',
);

const unknownFiveCriteria = computeMatch({}, fiveCriterionPreferences, { school: selectedSchool });
assert.equal(unknownFiveCriteria.score, null);
assert.equal(unknownFiveCriteria.criteria, 5);
assert.equal(unknownFiveCriteria.verifiedCriteria, 0);
assert.equal(unknownFiveCriteria.unknownCriteria, 5);
assert.equal(unknownFiveCriteria.verificationCoverage, 0);
assert.deepEqual(
  unknownFiveCriteria.breakdown.map(({ label, percentage, status }) => ({ label, percentage, status })),
  [
    { label: 'Område', percentage: null, status: 'unknown' },
    { label: 'Kollektivtransport', percentage: null, status: 'unknown' },
    { label: 'Fasiliteter', percentage: null, status: 'unknown' },
    { label: 'Boligkvaliteter', percentage: null, status: 'unknown' },
    { label: 'Skoleavstand', percentage: null, status: 'unknown' },
  ],
  'Ingen valgte kriterier skal forsvinne når annonsen mangler data',
);

const compoundLocation = computeMatch({
  ...baseListing,
  city: 'Oslo',
  area: 'Majorstuen',
}, {
  search_location: 'Majorstuen, Oslo',
  monthly_budget_max: 8000,
});
assert.equal(compoundLocation.score, 100, 'Område og by skrevet sammen skal matches mot annonsens separate stedsfelt');

const transliteratedLocation = computeMatch({ ...baseListing, city: 'Ås' }, {
  search_location: 'As',
  monthly_budget_max: 8000,
});
assert.equal(transliteratedLocation.score, 100, 'Norske bokstaver skal kunne matches med vanlig tastatur');

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
assert.ok(
  filterMismatch.breakdown.some(({ percentage }) => percentage < 100),
  'Delvise og svake treff skal vises i matchforklaringen, ikke skjules',
);

const missingTransit = computeMatch(
  { ...baseListing, transit_minutes: null },
  { monthly_budget_max: 8000, max_transit_minutes: 5 },
);
assert.equal(missingTransit.unknownCriteria, 1);
assert.equal(criterion(missingTransit, 'Kollektivtransport').status, 'unknown');
assert.equal(criterion(missingTransit, 'Kollektivtransport').percentage, null);
assert.ok(missingTransit.score < 100, 'Manglende kollektivdata skal ikke feilaktig behandles som 0 minutter');

const partiallyOverBudget = computeMatch(
  { ...baseListing, price: 9000 },
  { monthly_budget_max: 8000, preferred_property_types: ['leilighet'] },
);
assert.equal(partiallyOverBudget.score, 85, 'Budsjettavvik skal gi en kontrollert delscore, ikke et vilkårlig hopp');

const completeMismatch = computeMatch(
  { ...baseListing, price: 16000, property_type: 'leilighet' },
  { monthly_budget_max: 8000, preferred_property_types: ['hybel'] },
);
assert.equal(completeMismatch.score, 0, 'To vurderbare kriterier kan gi 0 prosent uten NaN eller falske poeng');

for (const budget of [1, 5000, 8000, 1000000]) {
  for (const price of [1, 5000, 8000, 1000000]) {
    const result = computeMatch(
      { ...baseListing, price },
      { monthly_budget_max: budget, preferred_property_types: ['leilighet'] },
    );
    assert.ok(Number.isInteger(result.score) && result.score >= 0 && result.score <= 100, 'Matchscore skal alltid være et heltall i intervallet 0–100');
  }
}

const invalidSchoolCoordinates = computeMatch(baseListing, {}, {
  school: { name: 'Ugyldig punkt', latitude: 91, longitude: 10 },
});
assert.equal(invalidSchoolCoordinates, null, 'Ugyldige skolekoordinater skal ikke gi en falsk nærhetsmatch');
assert.equal(schoolProximityRatio(null), null, 'Manglende avstand skal ikke tolkes som 0 km');
const missingSchoolCoordinates = computeMatch({ ...baseListing, location_lat: null, location_lon: null }, {}, {
  school: { name: 'Universitetet i Oslo', latitude: 59.9375, longitude: 10.71905 },
});
assert.equal(missingSchoolCoordinates.score, null);
assert.equal(missingSchoolCoordinates.unknownCriteria, 1);
assert.equal(criterion(missingSchoolCoordinates, 'Skoleavstand').status, 'unknown', 'Annonser uten koordinater skal ikke få falsk skolenærhet');

const duplicateFilterTags = buildMatchPreferences({}, {
  amenities: ['matbutikk', 'matbutikk'],
  lifestyleTags: ['rolig-miljo', 'rolig-miljo'],
});
assert.deepEqual(duplicateFilterTags.preferred_amenities, ['matbutikk']);
assert.deepEqual(duplicateFilterTags.preferred_lifestyle_tags, ['rolig-miljo']);
assert.deepEqual(duplicateFilterTags.priority_tags, ['rolig-miljo'], 'Duplikate filterverdier skal normaliseres innen riktig kategori');

const sameScoreThin = { ...baseListing, _match: { score: 100, criteria: 2 }, created_at: '2026-08-22T00:00:00Z' };
const sameScoreSolid = { ...baseListing, id: 'solid', _match: { score: 100, criteria: 6 }, created_at: '2026-01-01T00:00:00Z' };
assert.ok(compareBestMatch(sameScoreSolid, sameScoreThin) < 0, 'Lik prosent skal prioritere resultatet med sterkest datagrunnlag');

const feedSource = readFileSync(new URL('../feed.js', import.meta.url), 'utf8');
assert.match(feedSource, /rankAllMatchResults[\s\S]+MAX_CLIENT_RANKED_RESULTS[\s\S]+data\.sort\(compareBestMatch\)[\s\S]+data = data\.slice/, 'Beste match skal rangeres før paginering');
assert.match(feedSource, /rankingIsCapped[\s\S]+Smart Match rangerer de \$\{MAX_CLIENT_RANKED_RESULTS\} nyeste ordinære treffene/, 'Store resultatsett skal opplyse om rangeringsgrensen');

console.log('Smart Match-regresjoner besto.');
