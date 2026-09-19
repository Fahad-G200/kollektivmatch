import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  analysisFiltersFromSearch,
  analysisRequestBody,
  formatMeters,
  selectedSchoolFromFilters,
} from '../listing-analysis.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const edgeFunction = read('supabase/functions/analyze-listing-fit/index.ts');
const migration = read('migrations/2026-09-12_ai_listing_checks.sql');
const retentionMigration = read('migrations/2026-09-12_ai_listing_retention_cron.sql');
const detailHtml = read('listing-detail.html');
const detailScript = read('listing-detail.js');
const createHtml = read('create-listing.html');
const createScript = read('create-listing.js');
const indexHtml = read('index.html');
const privacy = read('privacy.html');

test('active area, transport, amenity, housing-quality and school choices reach the detail control', () => {
  const filters = analysisFiltersFromSearch('?city=Trondheim&maxPrice=8000&propertyType=hybel&maxTransitMinutes=7&amenities=matbutikk&amenities=grontomrade&lifestyleTags=stort-kjokken&schoolName=NTNU&schoolLat=63.4195&schoolLon=10.4021');
  assert.equal(filters.city, 'Trondheim');
  assert.equal(filters.maxPrice, '8000');
  assert.equal(filters.propertyType, 'hybel');
  assert.equal(filters.maxTransitMinutes, '7');
  assert.deepEqual(filters.amenities, ['matbutikk', 'grontomrade']);
  assert.deepEqual(filters.lifestyleTags, ['stort-kjokken']);
  assert.deepEqual(selectedSchoolFromFilters(filters), { name: 'NTNU', latitude: 63.4195, longitude: 10.4021 });
});

test('the server request contains only normalized preferences and a valid school', () => {
  const body = analysisRequestBody('d9428888-122b-4b41-b6c2-7a6518477477', {
    priority_tags: ['stort-rom', 'ukjent'],
    preferred_amenities: ['matbutikk', 'matbutikk', 'annet'],
    max_transit_minutes: 0,
  }, { name: 'UiO', latitude: 59.9399, longitude: 10.7219 });
  assert.deepEqual(body, {
    listing_id: 'd9428888-122b-4b41-b6c2-7a6518477477',
    lifestyle_tags: ['stort-rom'],
    amenities: ['matbutikk'],
    max_transit_minutes: 0,
    school: { name: 'UiO', latitude: 59.9399, longitude: 10.7219 },
  });
  assert.equal(analysisRequestBody(body.listing_id, {}, { name: 'Ugyldig', latitude: null, longitude: 10 }).school, null);
  assert.equal(formatMeters(850), '850 m');
});

test('the Edge Function authenticates, rate-limits and never accepts arbitrary image URLs', () => {
  assert.match(edgeFunction, /requireAllowedOrigin\(request\)/);
  assert.match(edgeFunction, /requireUser\(request\)/);
  assert.match(edgeFunction, /UUID_PATTERN\.test\(listingId\)/);
  assert.match(edgeFunction, /readJsonObject\(request, 8 \* 1024\)/);
  assert.match(edgeFunction, /consume_listing_analysis_quota/);
  assert.match(edgeFunction, /const MAX_IMAGES = 6/);
  assert.match(edgeFunction, /safeListingImages\(listing/);
  assert.match(edgeFunction, /url\.origin !== storageOrigin/);
  assert.match(edgeFunction, /segments\[0\] !== listing\.user_id/);
  assert.doesNotMatch(edgeFunction, /body\.(?:image|image_url|images|url)/);
});

test('image analysis is owner-opted-in, generic, structured and excluded from Smart Match', () => {
  assert.match(migration, /ai_image_analysis_allowed boolean not null default false/);
  assert.match(migration, /ai_image_analysis_allowed_at timestamptz/);
  assert.match(migration, /purge_stale_listing_image_analysis_trigger/);
  assert.match(createHtml, /name="ai_image_analysis_allowed"/);
  assert.match(createScript, /ai_image_analysis_allowed: data\.get\('ai_image_analysis_allowed'\) === 'on'/);
  assert.match(edgeFunction, /if \(!listing\.ai_image_analysis_allowed\)/);
  assert.match(edgeFunction, /store: false/);
  assert.match(edgeFunction, /safety_identifier: safetyIdentifier/);
  assert.match(edgeFunction, /type: 'json_schema'/);
  assert.match(edgeFunction, /Ikke identifiser, beskriv eller utled noe om personer/);
  assert.match(edgeFunction, /Ingen boligkvaliteter er valgt, så bildene ble ikke sendt til OpenAI/);
  assert.match(edgeFunction, /analyzeImages\(admin, listing, safetyIdentifier, lifestyleTags\)/);
  assert.match(edgeFunction, /affects_match_score: false/);
});

test('Google Places and Routes checks are server-side and return partial states', () => {
  assert.match(edgeFunction, /GOOGLE_MAPS_API_KEY/);
  assert.match(edgeFunction, /https:\/\/places\.googleapis\.com\/v1\/places:searchNearby/);
  assert.match(edgeFunction, /https:\/\/routes\.googleapis\.com\/directions\/v2:computeRoutes/);
  assert.match(edgeFunction, /X-Goog-FieldMask/);
  assert.match(edgeFunction, /includedTypes: config\.types/);
  assert.match(edgeFunction, /travelMode/);
  assert.match(edgeFunction, /Promise\.allSettled/);
  assert.match(edgeFunction, /status: failedPlaces === 0 \? 'complete'/);
  assert.match(edgeFunction, /location_precision/);
});

test('cache and quota tables are private and the quota is serialized', () => {
  assert.match(migration, /listing_image_analysis_cache[\s\S]+enable row level security/);
  assert.match(migration, /revoke all on public\.listing_image_analysis_cache from public, anon, authenticated/);
  assert.match(migration, /listing_analysis_requests[\s\S]+enable row level security/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /v_hour_count >= 6/);
  assert.match(migration, /v_day_count >= 20/);
  assert.match(migration, /grant execute on function public\.consume_listing_analysis_quota\(uuid, uuid\)[\s\S]+to service_role/);
  assert.match(migration, /listing_analysis_requests_retention_idx/);
  assert.match(retentionMigration, /to_regprocedure\('cron\.schedule\(text,text,text\)'\)/);
  assert.match(retentionMigration, /cron\.schedule\([\s\S]+'purge-listing-analysis-requests'/);
  assert.match(retentionMigration, /requested_at < now\(\) - interval '7 days'/);
});

test('the detail UI always separates the five required control areas and their sources', () => {
  assert.match(detailHtml, /id="listing-field-match"/);
  assert.match(detailHtml, /id="listing-area-analysis"/);
  assert.match(detailHtml, /id="listing-transport-field-analysis"/);
  assert.match(detailHtml, /id="listing-image-analysis"/);
  assert.match(detailHtml, /id="listing-quality-field-analysis"/);
  assert.match(detailHtml, /id="listing-amenity-analysis"/);
  assert.match(detailHtml, /id="listing-amenity-field-analysis"/);
  assert.match(detailHtml, /id="listing-route-analysis"/);
  assert.match(detailHtml, /id="listing-school-field-analysis"/);
  assert.match(detailHtml, /id="listing-school-route-analysis"/);
  for (const label of ['1. Område', '2. Transport', '3. Fasiliteter', '4. Boligkvalitet', '5. Skole']) {
    assert.match(detailHtml, new RegExp(label.replace('.', '\\.')));
  }
  assert.match(detailScript, /computeMatch\(listing, effectiveAnalysisPreferences/);
  assert.match(detailScript, /renderRequiredControlAreas\(match\)/);
  assert.match(detailScript, /Kontrollgrunnlag: \$\{match\.criteria\}/);
  assert.match(detailScript, /Ingen AI- eller kartfunn er lagt inn i Smart Match-prosenten/);
  assert.match(detailScript, /supabase\.functions\.invoke\('analyze-listing-fit'/);
});

test('Google Maps links use an exact host allowlist', () => {
  assert.match(detailScript, /\['www\.google\.com', 'www\.google\.no'\]\.includes\(url\.hostname\)/);
  assert.match(edgeFunction, /\['www\.google\.com', 'www\.google\.no'\]\.includes\(url\.hostname\)/);
  assert.doesNotMatch(detailScript, /\^www\\\.google\\\./);
  assert.doesNotMatch(edgeFunction, /\^www\\\.google\\\./);
});

test('external marketplaces remain link-only and privacy text documents providers', () => {
  assert.match(indexHtml, /Vi leser ikke bilder eller annonsetekst automatisk fra FINN, Hybel\.no eller Facebook/);
  assert.match(privacy, /kan OpenAI brukes til bildeobservasjoner/);
  assert.match(privacy, /<span translate="no">Google Maps Platform<\/span>/);
  assert.match(privacy, /Google-treff og ruter lagres ikke i databasen/);
});
