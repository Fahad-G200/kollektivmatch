import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildAutomaticSearchPayload,
  externalPreferencesFromFilters,
  formatAutomaticResultLine,
  normalizeAutomaticResult,
  preferencePresentation,
  safeImageUrl,
  safeResultUrl,
} from '../external-listing-check.js';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const edgeSource = read('supabase/functions/find-listing-matches/index.ts');
const quotaMigration = read('migrations/2026-09-20_automatic_listing_search.sql');
const retentionMigration = read('migrations/2026-09-20_automatic_listing_search_retention_cron.sql');
const clientSource = read('external-listing-check.js');
const indexSource = read('index.html');

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

test('alle valgte kontrollområder følger med til automatisk søk', () => {
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

test('én preferanse er nok, men et uvalgt skoleforslag blokkeres tydelig', () => {
  const onePreference = preferencePresentation({ city: 'Bodø' });
  assert.equal(onePreference.hasScoreBasis, true);
  assert.equal(onePreference.schoolNeedsSelection, false);

  const unresolvedSchool = preferencePresentation({ city: 'Bodø', schoolName: 'Nord universitet' });
  assert.equal(unresolvedSchool.hasScoreBasis, true);
  assert.equal(unresolvedSchool.schoolNeedsSelection, true);
  assert.equal(unresolvedSchool.preferences.school, null);
});

test('klienten sender bare preferanser og aldri brukeroppgitt annonse eller bilde', () => {
  const payload = buildAutomaticSearchPayload(filters);
  assert.equal(payload.schema_version, 'automatic-listing-search-v1');
  assert.equal(payload.preferences.city, 'Oslo');
  for (const forbidden of ['source_url', 'address', 'monthly_price', 'images', 'advertised_claims']) {
    assert.equal(forbidden in payload, false, forbidden);
  }
  assert.match(indexSource, /id="external-auto-search-submit"/);
  assert.match(indexSource, /Ingen adresse eller lenke å lime inn/);
  assert.doesNotMatch(indexSource, /id="legacy-external-listing-check"/);
  assert.doesNotMatch(indexSource, /id="external-source-url"|id="external-address"|id="external-images"/);
});

test('boligbilder feiler lukket og krever en eksplisitt servergodkjent vert', () => {
  assert.equal(safeImageUrl('https://bilder.bolig.example.no/123.jpg', []), null);
  assert.equal(
    safeImageUrl('https://bilder.bolig.example.no/123.jpg', ['bilder.bolig.example.no']),
    'https://bilder.bolig.example.no/123.jpg',
  );
  assert.equal(safeImageUrl('https://evil.example/123.jpg', ['bilder.bolig.example.no']), null);
  assert.equal(safeImageUrl('http://bilder.bolig.example.no/123.jpg', ['bilder.bolig.example.no']), null);
});

test('resultatlenker må være HTTPS på servergodkjent domene', () => {
  const domains = ['bolig.example.no'];
  assert.equal(
    safeResultUrl('https://bolig.example.no/annonse/123#bilder', domains),
    'https://bolig.example.no/annonse/123',
  );
  assert.equal(safeResultUrl('https://under.bolig.example.no/annonse/123', domains), 'https://under.bolig.example.no/annonse/123');
  for (const value of [
    'http://bolig.example.no/annonse/123',
    'https://bolig.example.no.evil.test/annonse/123',
    'https://user@bolig.example.no/annonse/123',
    'https://bolig.example.no:444/annonse/123',
    'https://annen.example.no/annonse/123',
  ]) assert.equal(safeResultUrl(value, domains), null, value);
});

test('hver forslaglinje viser prosent, matcher, mangler og ukjent', () => {
  const line = formatAutomaticResultLine({
    title: 'Leilighet ved BI',
    score: { percent: 78 },
    has: ['Område', 'Skoleavstand'],
    missing: ['Pris'],
    unknown: ['Fint / moderne bad'],
  });
  assert.equal(
    line,
    '78 % · Leilighet ved BI · Matcher: Område, Skoleavstand · Mangler: Pris · Ukjent: Fint / moderne bad',
  );
});

test('et manglende valgt kriterium blir synlig som ukjent og skjuler misvisende prosent', () => {
  const result = normalizeAutomaticResult({
    title: 'Nær BI',
    score: { percent: 92 },
    criteria: [{ key: 'city', label: 'Område: Oslo', status: 'met', evidence: 'Oslo' }],
  }, [
    { key: 'city', label: 'Område: Oslo' },
    { key: 'school', label: 'Skole: BI' },
  ]);

  assert.equal(result.score.percent, null);
  assert.equal(result.score.criteria_complete, false);
  assert.deepEqual(result.has, ['Område: Oslo']);
  assert.deepEqual(result.unknown, ['Skole: BI']);
  assert.match(result.criteria[1].evidence, /ikke regnet som oppfylt/);
});

test('serverfunksjonen er JSON-, auth-, kvote- og no-store-beskyttet', () => {
  assert.match(edgeSource, /readJsonObject\(request, MAX_REQUEST_BYTES\)/);
  assert.match(edgeSource, /requireAllowedOrigin\(request\)/);
  assert.match(edgeSource, /requireUser\(request\)/);
  assert.match(edgeSource, /EMAIL_VERIFICATION_REQUIRED/);
  assert.match(edgeSource, /consume_automatic_listing_search_quota/);
  assert.match(edgeSource, /store: false/);
  assert.match(edgeSource, /safety_identifier/);
  assert.match(quotaMigration, /security invoker/);
  assert.match(quotaMigration, /set search_path = ''/);
  assert.match(quotaMigration, /v_count >= 2/);
  assert.match(quotaMigration, /v_count >= 6/);
  assert.match(retentionMigration, /interval '25 hours'/);
});

test('automatisk søk har globalt tidsbudsjett og beholder delresultater', () => {
  assert.match(edgeSource, /REQUEST_TIME_BUDGET_MS = 115_000/);
  assert.match(edgeSource, /RESPONSE_TIME_RESERVE_MS = 5_000/);
  assert.match(edgeSource, /MAP_TIME_RESERVE_MS = 30_000/);
  assert.match(edgeSource, /RequestBudgetExceededError/);
  assert.match(edgeSource, /controller\.signal\.aborted && constrainedByBudget/);
  assert.match(edgeSource, /partial_due_to_time_budget: requestBudget\.limited/);
  assert.match(edgeSource, /deadline_limited: requestBudget\.limited/);
  assert.match(edgeSource, /Tidsbudsjettet begrenset minst ett eksternt oppslag/);
});

test('OpenAI-søket bruker domenegrense, tekst, bilder og faktiske kilder', () => {
  assert.match(edgeSource, /type: 'web_search'/);
  assert.match(edgeSource, /filters: \{ allowed_domains: domains \}/);
  assert.match(edgeSource, /search_content_types: \['text', 'image'\]/);
  assert.match(edgeSource, /image_settings: \{ max_results: 20, caption: true \}/);
  assert.match(edgeSource, /web_search_call\.action\.sources/);
  assert.match(edgeSource, /web_search_call\.results/);
  assert.match(edgeSource, /sources\.has\(url\)/);
  assert.match(edgeSource, /source_website_url/);
  assert.match(edgeSource, /image\.sourceWebsiteUrl === candidate\.url/);
});

test('søket beholder nesten-treff og utvider seg i stedet for å kreve eksakt treff', () => {
  assert.match(edgeSource, /Preferansene er rangering, ikke harde filtre/);
  assert.match(edgeSource, /utvid søket trinnvis/);
  assert.match(edgeSource, /Returner aldri null bare fordi et mykt krav mangler/);
  assert.match(edgeSource, /search_mode.*broadened/s);
  assert.match(edgeSource, /firstCandidates\.length < 3/);
  assert.match(edgeSource, /callSearch\([\s\S]+?'broadened'/);
  assert.match(edgeSource, /mergeCandidates\(firstCandidates, secondCandidates\)/);
  assert.match(clientSource, /Søket ble utvidet for å finne de nærmeste alternativene/);
});

test('bilde vises og brukes bare når det er sikkert knyttet til samme annonse', () => {
  assert.match(clientSource, /verified_same_listing === true/);
  assert.match(clientSource, /Bilde kunne ikke knyttes sikkert til annonsen/);
  assert.match(edgeSource, /visual && !image/);
  assert.match(edgeSource, /image\.sourceWebsiteUrl === candidate\.url/);
  assert.match(edgeSource, /image\.imageUrl === requestedUrl \|\| image\.thumbnailUrl === requestedUrl/);
  assert.match(edgeSource, /Fant ikke et bilde som sikkert tilhører denne annonselenken/);
});

test('poenggivende annonsefelt krever konkret tekstbevis fra annonsen', () => {
  assert.match(edgeSource, /hasSupportedTextEvidence/);
  for (const key of ['address', 'price', 'property_type', 'move_in', 'occupation']) {
    assert.match(edgeSource, new RegExp(`hasSupportedTextEvidence\\(descriptionEvidence, '${key}'\\)`));
  }
  assert.match(edgeSource, /count < 1/);
});

test('serverpoeng dekker område, bolig, transport, fasiliteter, kvalitet og skole', () => {
  for (const marker of [
    "'area'", "'budget'", "'property_type'", "'occupation'", "'move_in'",
    "'transit'", "'amenity:' + key", "'lifestyle:' + key", "'school'",
  ]) assert.match(edgeSource, new RegExp(marker.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')), marker);
  assert.match(edgeSource, /analyzeMap/);
  assert.match(edgeSource, /searchNearby/);
  assert.match(edgeSource, /computeRoute/);
  assert.match(edgeSource, /method: 'deterministic-automatic-v1'/);
});

test('ukjent står i nevneren med null poeng og egen dekningsprosent', () => {
  assert.match(edgeSource, /selectedWeight = criteria\.reduce/);
  assert.match(edgeSource, /item\.percentage \?\? 0/);
  assert.match(edgeSource, /item\.status !== 'unknown'/);
  assert.match(edgeSource, /coverage_percent/);
  assert.match(edgeSource, /unknown: criteria\.filter/);
});

test('serveren åpner ikke modellens kandidatlenker direkte', () => {
  assert.doesNotMatch(edgeSource, /fetchWithTimeout\(candidate\.(?:url|address)/);
  assert.doesNotMatch(edgeSource, /fetch\(candidate\.url/);
  assert.match(edgeSource, /OPENAI_RESPONSES_URL/);
  assert.match(edgeSource, /GOOGLE_TEXT_SEARCH_URL/);
});
