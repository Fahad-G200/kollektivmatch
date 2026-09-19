import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const feed = read('feed.js');
const filterSource = feed.match(/function sanitizeSearchTerm[\s\S]+?(?=\n\nfunction applySorting)/)?.[0] || '';
const applyFilters = Function('locationSearchParts', `${filterSource}; return applyFilters;`)(
  (value) => [...new Set(String(value || '').split(/[,/]/).map((part) => part.trim()).filter(Boolean))],
);

class QueryProbe {
  constructor() {
    this.orCalls = [];
    this.lteCalls = [];
    this.containsCalls = [];
  }

  or(value) { this.orCalls.push(value); return this; }
  lte(field, value) { this.lteCalls.push([field, value]); return this; }
  eq() { return this; }
  contains(field, value) { this.containsCalls.push([field, value]); return this; }
}

test('område, transport, fasiliteter og boligkvaliteter blir brukt som faktiske interne filtre', () => {
  const query = applyFilters(new QueryProbe(), {
    city: 'Majorstuen, Oslo',
    maxTransitMinutes: '7',
    amenities: ['matbutikk', 'kollektivtransport'],
    lifestyleTags: ['rolig-miljo', 'stort-kjokken'],
  });

  assert.deepEqual(query.orCalls, [
    'city.ilike.Majorstuen,area.ilike.Majorstuen',
    'city.ilike.Oslo,area.ilike.Oslo',
  ]);
  assert.deepEqual(query.lteCalls, [['transit_minutes', 7]]);
  assert.deepEqual(query.containsCalls, [
    ['amenities', ['matbutikk', 'kollektivtransport']],
    ['lifestyle_tags', ['rolig-miljo', 'stort-kjokken']],
  ]);
});

test('grensesnittet forklarer femdelte kontroller og ekstern manuell verifisering', () => {
  const index = read('index.html');
  const external = read('external-search.js');
  const match = read('match.js');

  for (const label of ['Område', 'Kollektivtransport', 'Fasiliteter', 'Boligkvaliteter', 'Skoleavstand']) {
    assert.match(match, new RegExp(`['\"]${label}['\"]`));
  }
  assert.match(index, /Alle valgte kriterier tas med/);
  assert.match(index, /id="external-verification-list"/);
  assert.match(external, /state\.textContent = 'Må bekreftes'/);
  assert.doesNotMatch(external, /coverage\s*:/);
});
