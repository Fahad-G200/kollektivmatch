import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildExternalAnalysisPayload,
  externalPreferencesFromFilters,
  preferencePresentation,
  validateFinnListingUrl,
} from '../external-listing-check.js';

const edgeSource = readFileSync(new URL('../supabase/functions/analyze-external-listing/index.ts', import.meta.url), 'utf8');

test('FINN-annonselenken canonicaliseres uten å hente siden', () => {
  assert.equal(
    validateFinnListingUrl('https://www.finn.no/realestate/lettings/ad.html?finnkode=123456789&utm_source=test#bilder'),
    'https://www.finn.no/realestate/lettings/ad.html?finnkode=123456789',
  );
  assert.equal(
    validateFinnListingUrl('https://finn.no/realestate/lettings/ad.html?finnkode=987654321'),
    'https://www.finn.no/realestate/lettings/ad.html?finnkode=987654321',
  );
});

test('lookalike-domener, http og søkesider avvises', () => {
  for (const value of [
    'https://finn.no.example.com/realestate/lettings/ad.html?finnkode=123456789',
    'http://www.finn.no/realestate/lettings/ad.html?finnkode=123456789',
    'https://user@www.finn.no/realestate/lettings/ad.html?finnkode=123456789',
    'https://www.finn.no/realestate/lettings/search.html?q=Oslo',
    'https://www.finn.no/realestate/lettings/ad.html?finnkode=abc',
  ]) assert.equal(validateFinnListingUrl(value), null, value);
});

test('alle valgte kontrollområder følger med til ekstern analyse', () => {
  const filters = {
    city: 'Oslo',
    maxPrice: '8000',
    moveInDate: '2027-07-27',
    propertyType: 'leilighet',
    preferredOccupation: 'student',
    maxTransitMinutes: '5',
    amenities: ['matbutikk', 'treningssenter'],
    lifestyleTags: ['nyoppusset-bad'],
    schoolName: 'Handelshøyskolen BI',
    schoolLat: '59.9498',
    schoolLon: '10.7685',
  };
  const preferences = externalPreferencesFromFilters(filters);
  assert.equal(preferences.city, 'Oslo');
  assert.equal(preferences.max_price, 8000);
  assert.equal(preferences.max_transit_minutes, 5);
  assert.deepEqual(preferences.amenities, ['matbutikk', 'treningssenter']);
  assert.deepEqual(preferences.lifestyle_tags, ['nyoppusset-bad']);
  assert.deepEqual(preferences.school, {
    name: 'Handelshøyskolen BI', latitude: 59.9498, longitude: 10.7685,
  });

  const presentation = preferencePresentation(filters);
  assert.equal(presentation.hasScoreBasis, true);
  assert.equal(presentation.needsImages, true);
  for (const expected of ['Område', 'Kollektivt', 'Matbutikk', 'Treningssenter', 'Fint / moderne bad', 'Skole']) {
    assert.ok(presentation.items.some((item) => item.label.includes(expected)), expected);
  }
});

test('analysepayload inneholder bare manuelt oppgitte annonsefelt og valgte faste påstander', () => {
  const payload = buildExternalAnalysisPayload({ city: 'Oslo', maxPrice: '9000', lifestyleTags: ['nyoppusset-bad'] }, {
    sourceUrl: 'https://www.finn.no/realestate/lettings/ad.html?finnkode=123456789',
    address: 'Nydalsveien 37, 0484 Oslo',
    monthlyPrice: '8500',
    propertyType: 'leilighet',
    moveInDate: '2026-10-01',
    acceptedOccupation: 'student',
    advertisedClaims: ['nyoppusset-bad', 'ukjent'],
    analysisConsent: true,
  });

  assert.equal(payload.monthly_price, 8500);
  assert.equal(payload.property_type, 'leilighet');
  assert.equal(payload.analysis_consent, true);
  assert.deepEqual(payload.advertised_claims, ['nyoppusset-bad']);
  assert.equal('description' in payload, false);
});

test('serverfunksjonen er multipart-, auth-, kvote- og no-store-beskyttet', () => {
  assert.match(edgeSource, /requireAllowedOrigin\(request\)/);
  assert.match(edgeSource, /requireUser\(request\)/);
  assert.match(edgeSource, /EMAIL_VERIFICATION_REQUIRED/);
  assert.match(edgeSource, /multipart\\\/form-data/);
  assert.match(edgeSource, /MAX_REQUEST_BYTES = 7 \* 1024 \* 1024/);
  assert.match(edgeSource, /MAX_IMAGES = 3/);
  assert.match(edgeSource, /consume_external_listing_analysis_quota/);
  assert.match(edgeSource, /store: false/);
  assert.match(edgeSource, /method: 'deterministic-v1'/);
  assert.match(edgeSource, /analysis_consent !== true/);
});

test('serveren henter aldri FINN-lenken eller godtar eksterne bilde-URL-er', () => {
  assert.doesNotMatch(edgeSource, /fetch(?:WithTimeout)?\(\s*(?:input\.)?sourceUrl/);
  assert.doesNotMatch(edgeSource, /input_image[^\n]+https?:\/\//);
  assert.match(edgeSource, /bytesToDataUrl/);
  assert.match(edgeSource, /reference_status: 'format_valid_only'/);
  assert.match(edgeSource, /FINN-lenken[\s\S]*ikke hentet eller verifisert/);
});

test('ukjent står i valgt vekt, men ikke i opptjent eller kontrollert vekt', () => {
  assert.match(edgeSource, /selectedWeight = criteria\.reduce/);
  assert.match(edgeSource, /earned: ratio === null \? 0/);
  assert.match(edgeSource, /verified = criteria\.filter\(\(item\) => item\.status !== 'unknown'\)/);
  assert.match(edgeSource, /earnedWeight \/ selectedWeight/);
});

test('serverpoeng dekker område, boligfelt, transport, fasiliteter, kvalitet og skole', () => {
  for (const marker of [
    "key: 'area'",
    "key: 'budget'",
    "key: 'property_type'",
    "key: 'occupation'",
    "key: 'move_in'",
    "key: 'transit'",
    'key: `amenity:${key}`',
    'key: `lifestyle:${key}`',
    "key: 'school'",
  ]) assert.match(edgeSource, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), marker);
  assert.match(edgeSource, /maps\.amenities\.find/);
  assert.match(edgeSource, /images\.observations\.find/);
  assert.match(edgeSource, /schoolProximityRatio/);
});
