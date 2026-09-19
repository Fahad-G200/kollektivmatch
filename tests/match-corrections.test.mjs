import assert from 'node:assert/strict';
import test from 'node:test';
import { computeMatch, buildMatchPreferences, matchesLocation } from '../match.js';
import { getExampleListing, selectExampleListings } from '../example-listings.js';

test('Two documented preferences give a score, including occupation and date', () => {
  const result = computeMatch({ preferred_occupations: ['student'], move_in_date: null }, { occupation: 'student', desired_move_in_date: '2026-10-01' });
  assert.equal(result.score, 100);
  assert.equal(result.criteria, 2);
  assert.equal(result.confidence, 'limited');
  const singleCriterion = computeMatch({ preferred_occupations: [] }, { occupation: 'student' });
  assert.equal(singleCriterion.score, null);
  assert.equal(singleCriterion.criteria, 1);
  assert.equal(singleCriterion.hasScoreBasis, false);
  assert.equal(singleCriterion.breakdown[0].label, 'Hverdag');
});

test('Missing occupation data is unknown; an explicit empty list welcomes everyone', () => {
  const preferences = { monthly_budget_max: 8000, occupation: 'student' };
  for (const preferred_occupations of [undefined, null]) {
    const result = computeMatch({ price: 7000, preferred_occupations }, preferences);
    const occupation = result.breakdown.find(({ label }) => label === 'Hverdag');
    assert.equal(result.unknownCriteria, 1);
    assert.equal(result.verificationCoverage, 50);
    assert.equal(occupation.status, 'unknown');
    assert.equal(occupation.percentage, null);
    assert.ok(result.score < 100, 'Manglende yrkesdata skal ikke behandles som oppfylt');
  }
  assert.equal(computeMatch({ price: 7000, preferred_occupations: [] }, preferences).score, 100);
  assert.equal(computeMatch({ price: 7000, preferred_occupations: ['jobb'] }, preferences).score, 70);
});

test('The explanation agrees with budget and property mismatches, including partial scores', () => {
  const preferences = { monthly_budget_max: 8000, preferred_property_types: ['hybel'] };
  const mismatch = computeMatch({ price: 16000, property_type: 'leilighet' }, preferences);
  assert.equal(mismatch.score, 0);
  assert.doesNotMatch(mismatch.breakdown.map(x => x.detail).join(' '), /Innenfor|Riktig boligtype/);
  assert.match(mismatch.breakdown[0].detail, /over månedsbudsjettet/);
  const partial = computeMatch({ price: 9000, property_type: 'hybel' }, preferences);
  assert.equal(partial.score, 85);
  assert.equal(partial.breakdown[0].percentage, 75);
  assert.match(partial.breakdown[0].detail, /over månedsbudsjettet/);
});

test('Amenities and lifestyle preferences remain separate while filters override their own group', () => {
  const profile = { priority_tags: ['rolig-miljo'] };
  const amenitiesOnly = buildMatchPreferences(profile, { amenities: ['matbutikk'] });
  assert.deepEqual(amenitiesOnly.priority_tags, ['rolig-miljo']);
  assert.deepEqual(amenitiesOnly.preferred_amenities, ['matbutikk']);
  assert.deepEqual(amenitiesOnly.preferred_lifestyle_tags, ['rolig-miljo']);

  const bothGroups = buildMatchPreferences(profile, {
    lifestyleTags: ['stort-rom'],
    amenities: ['matbutikk'],
  });
  assert.deepEqual(bothGroups.priority_tags, ['stort-rom']);
  assert.deepEqual(bothGroups.preferred_amenities, ['matbutikk']);
  assert.deepEqual(bothGroups.preferred_lifestyle_tags, ['stort-rom']);
});

test('Compound locations require every named area, without unrelated word matches', () => {
  assert.equal(matchesLocation('Majorstuen, Oslo', ['Oslo', 'Majorstuen']), true);
  assert.equal(matchesLocation('Majorstuen, Oslo', ['Oslo', 'Grünerløkka']), false);
  assert.equal(matchesLocation('Sentrum, Bergen', ['Trondheim', 'Sentrum']), false);
  assert.equal(matchesLocation('As', ['Ås']), true);
  assert.equal(matchesLocation('Bergen', ['Bergensveien']), false);
});

test('Unknown examples never become real listings; six examples include a house and cabin', () => {
  assert.equal(getExampleListing('00000000-0000-4000-8000-000000000001'), null);
  const examples = selectExampleListings();
  assert.equal(examples.length, 6);
  assert.ok(examples.some(x => x.property_type === 'hytte'));
  assert.ok(examples.some(x => x.property_type === 'enebolig'));
  for (const example of examples) {
    assert.equal(example._example, true);
    assert.equal(example.user_id, null);
    assert.equal(example.is_featured, false);
    assert.equal(example.grocery_nearby, example.amenities.includes('matbutikk'));
    assert.equal(example.green_areas_nearby, example.amenities.includes('grontomrade'));
  }
});

test('Examples filter, rank and compute scores with the same matching function', () => {
  const filters = { city: 'Oslo', maxPrice: '8000', sortBy: 'best_match' };
  const preferences = buildMatchPreferences(null, filters);
  const [oslo] = selectExampleListings(filters, preferences);
  assert.equal(oslo.id, 'example-oslo');
  assert.deepEqual(oslo._match, computeMatch(oslo, preferences));
  assert.equal(oslo._match.score, 100);
  assert.equal(selectExampleListings({ city: 'Oslo', maxPrice: '1000' }).length, 0);
  assert.equal(selectExampleListings({ maxPrice: '0' }).length, 0);
  const school = { name: 'Blindern', latitude: 59.94, longitude: 10.72 };
  const ranked = selectExampleListings({ sortBy: 'nearest_school' }, {}, school);
  assert.equal(ranked[0].id, 'example-oslo');
  assert.equal(ranked[0]._match.isSchoolOnly, true);
});
