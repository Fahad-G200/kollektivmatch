import assert from 'node:assert/strict';
import { buildPowerPriceUrl, summarizePowerPrices } from '../power-prices.js';

const localDate = new Date(2026, 7, 27, 12, 0, 0);
assert.equal(
  buildPowerPriceUrl(localDate, 'NO1'),
  'https://www.hvakosterstrommen.no/api/v1/prices/2026/08-27_NO1.json',
  'API-adressen skal bruke lokal dato og valgt norsk prisområde',
);
assert.throws(() => buildPowerPriceUrl(localDate, 'NO9'), /Ugyldig prisområde/);

const summary = summarizePowerPrices([
  { NOK_per_kWh: -0.1, time_start: '2026-08-27T10:00:00+02:00', time_end: '2026-08-27T11:00:00+02:00' },
  { NOK_per_kWh: 0.5, time_start: '2026-08-27T11:00:00+02:00', time_end: '2026-08-27T12:00:00+02:00' },
  { NOK_per_kWh: 1.1, time_start: '2026-08-27T12:00:00+02:00', time_end: '2026-08-27T13:00:00+02:00' },
], new Date('2026-08-27T11:30:00+02:00'));

assert.equal(summary.current, 0.5);
assert.equal(summary.average, 0.5);
assert.equal(summary.minimum, -0.1, 'Negative spotpriser er gyldige data og skal ikke fjernes');
assert.equal(summary.maximum, 1.1);
assert.equal(summary.count, 3);
assert.throws(() => summarizePowerPrices([]), /Prisdata mangler/);

console.log('Strømpris: 8 tester besto.');
