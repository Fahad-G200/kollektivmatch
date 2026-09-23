import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExternalSearchModel,
  buildExternalSearchPhrase,
  buildFacebookMarketplaceUrl,
  buildFinnFallbackSearches,
  buildFinnSearchUrl,
  renderExternalSearch,
} from '../external-search.js';

test('FINN-lenken overfører støttede utleiefiltre uten å lese FINN-data', () => {
  const result = new URL(buildFinnSearchUrl({
    city: 'Oslo',
    maxPrice: '12500',
    moveInDate: '2026-10-15',
    propertyType: 'leilighet',
    sortBy: 'newest',
  }));

  assert.equal(result.origin, 'https://www.finn.no');
  assert.equal(result.pathname, '/realestate/lettings/search.html');
  assert.equal(result.searchParams.get('q'), 'Oslo');
  assert.equal(result.searchParams.get('property_type'), '3');
  assert.equal(result.searchParams.get('price_to'), '12500');
  assert.equal(result.searchParams.get('start_month'), '202610');
  assert.equal(result.searchParams.has('rent_from'), false);
  assert.equal(result.searchParams.get('sort'), 'PUBLISHED_DESC');
});

test('ugyldige filterverdier blir ikke sendt til den eksterne lenken', () => {
  const result = new URL(buildFinnSearchUrl({
    city: '  Bergen\nSentrum  ',
    maxPrice: '-100',
    moveInDate: '2026-13-99',
    propertyType: 'ukjent',
  }));

  assert.equal(result.searchParams.get('q'), 'Bergen Sentrum');
  assert.equal(result.searchParams.has('price_to'), false);
  assert.equal(result.searchParams.has('start_month'), false);
});

test('overføringsstatus skiller mellom eksakte filtre, søkeord og manuell kontroll', () => {
  const model = buildExternalSearchModel({
    city: 'Trondheim',
    maxPrice: '9000',
    propertyType: 'hybel',
    preferredOccupation: 'student',
    maxTransitMinutes: '8',
    amenities: ['kollektivtransport'],
  });

  assert.equal(model.activeCount, 6);
  assert.equal(model.transferredCount, 3);
  assert.equal(model.filteredCount, 2);
  assert.equal(model.keywordCount, 1);
  assert.equal(model.verificationCount, 4);
  assert.match(model.transferredLabel, /sted/);
  assert.match(model.keywordLabel, /sted/);
  assert.match(model.filteredLabel, /boligtype/);
  assert.match(model.remainingLabel, /tid til kollektivtransport/);
  assert.match(model.remainingLabel, /fasiliteter/);
});

test('null minutter til kollektivtransport behandles som en valgt preferanse', () => {
  const model = buildExternalSearchModel({ maxTransitMinutes: '0' });

  assert.equal(model.activeCount, 1);
  assert.equal(model.transferredCount, 0);
  assert.equal(model.verificationCount, 1);
  assert.deepEqual(model.verificationItems, [
    { key: 'maxTransitMinutes', label: 'Kollektivtransport', value: 'maks 0 min' },
  ]);
  assert.match(model.searchPhrase, /maks 0 min til kollektivtransport/);
});

test('den automatiske søkemodellen inneholder område, skole, transport, fasiliteter og boligkvaliteter', () => {
  const filters = {
    city: 'Majorstuen, Oslo',
    maxTransitMinutes: '8',
    schoolName: 'Universitetet i Oslo',
    amenities: ['matbutikk', 'kollektivtransport'],
    lifestyleTags: ['rolig-miljo', 'stort-rom'],
  };
  const model = buildExternalSearchModel(filters);

  assert.equal(model.activeCount, 5);
  assert.equal(model.filteredCount, 0);
  assert.equal(model.keywordCount, 1);
  assert.equal(model.verificationCount, 5);
  assert.deepEqual(model.verificationItems, [
    { key: 'city', label: 'Område', value: 'Majorstuen, Oslo' },
    { key: 'maxTransitMinutes', label: 'Kollektivtransport', value: 'maks 8 min' },
    { key: 'schoolName', label: 'Skoleavstand', value: 'Universitetet i Oslo' },
    { key: 'amenities', label: 'Fasiliteter', value: 'nær matbutikk, nær kollektivtransport' },
    { key: 'lifestyleTags', label: 'Boligkvaliteter', value: 'rolig miljø, stort rom' },
  ]);
  assert.match(model.keywordLabel, /sted/);
  for (const expected of [
    'Majorstuen, Oslo',
    'Universitetet i Oslo',
    'maks 8 min til kollektivtransport',
    'nær matbutikk',
    'rolig miljø',
    'stort rom',
  ]) {
    assert.match(model.searchPhrase, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const summary = { textContent: '' };
  const detail = { textContent: '' };
  const documentRef = {
    getElementById(id) {
      return {
        'external-search-summary': summary,
        'external-search-detail': detail,
      }[id] || null;
    },
  };

  renderExternalSearch(filters, documentRef);
  assert.equal(summary.textContent, '5 preferanser er klare for automatisk kontroll og rangering.');
  assert.match(detail.textContent, /AI-søket bruker alle valgene/);
});

test('søkefrasen inkluderer hytte og alle valgte preferanser', () => {
  const phrase = buildExternalSearchPhrase({
    city: 'Trysil',
    propertyType: 'hytte',
    maxPrice: '14000',
    schoolName: 'Trysil videregående skole',
    lifestyleTags: ['rolig-miljo'],
  });

  assert.match(phrase, /^hytte til leie i Trysil/);
  assert.match(phrase, /14[\s\u00a0]000 kr per måned/);
  assert.match(phrase, /Trysil videregående skole/);
  assert.match(phrase, /rolig miljø/);
});

test('Facebook-lenken er generell og henter ikke Marketplace-data', () => {
  assert.equal(
    buildFacebookMarketplaceUrl({ city: 'Ås sentrum' }),
    'https://www.facebook.com/marketplace/category/propertyrentals/',
  );
  assert.equal(
    buildFacebookMarketplaceUrl({}),
    'https://www.facebook.com/marketplace/category/propertyrentals/',
  );
});

test('FINN-lenken bruker eksakt hyttetype og støttede prissorteringer', () => {
  const result = new URL(buildFinnSearchUrl({
    city: 'Trysil',
    propertyType: 'hytte',
    sortBy: 'price_low',
  }));

  assert.equal(result.searchParams.get('q'), 'Trysil');
  assert.equal(result.searchParams.get('property_type'), '12');
  assert.equal(result.searchParams.get('sort'), 'RENT_ASC');
});

test('sortering som FINN ikke støtter markeres for manuell kontroll', () => {
  const model = buildExternalSearchModel({ city: 'Oslo', sortBy: 'nearest_school' });

  assert.equal(model.activeCount, 2);
  assert.equal(model.transferredCount, 1);
  assert.equal(model.keywordCount, 1);
  assert.equal(model.verificationCount, 1);
  assert.match(model.remainingLabel, /sortering/);
});

test('bredere FINN-søk fjerner én streng begrensning om gangen', () => {
  const fallbacks = buildFinnFallbackSearches({
    city: 'Oslo',
    maxPrice: '8000',
    moveInDate: '2027-07-27',
    propertyType: 'leilighet',
    sortBy: 'price_low',
  });

  assert.deepEqual(fallbacks.map((item) => item.key), [
    'flexible-move-in', 'all-property-types', 'higher-price',
  ]);
  const flexible = new URL(fallbacks[0].url);
  const allTypes = new URL(fallbacks[1].url);
  const higherPrice = new URL(fallbacks[2].url);
  assert.equal(flexible.searchParams.has('start_month'), false);
  assert.equal(flexible.searchParams.get('property_type'), '3');
  assert.equal(allTypes.searchParams.has('property_type'), false);
  assert.equal(allTypes.searchParams.get('start_month'), '202707');
  assert.equal(higherPrice.searchParams.get('price_to'), '10000');
  assert.equal(higherPrice.searchParams.get('q'), 'Oslo');
});
