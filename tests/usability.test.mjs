import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => readFileSync(new URL(name, `file://${root}/`), 'utf8');
const index = read('index.html');
const app = read('app.js');
const feed = read('feed.js');
const createHtml = read('create-listing.html');
const createJs = read('create-listing.js');
const privacy = read('privacy.html');
const dashboard = read('dashboard.html');
const dashboardJs = read('dashboard.js');
const styles = read('css/style.css');
const movingIn = read('moving-in.html');
const movingInJs = read('moving-in.js');
const htmlFiles = readdirSync(root).filter((name) => name.endsWith('.html'));

htmlFiles.forEach((name) => {
  const html = read(name);
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com/, `${name} skal ikke hente Tailwind fra CDN`);
  assert.match(html, /css\/tailwind\.css/, `${name} skal laste den lokale Tailwind-filen`);
});

assert.match(index, /<details id="advanced-filters"/);
assert.match(index, /id="advanced-filter-count"/);
assert.match(app, /updateAdvancedFilterSummary\(\{ openWhenSelected: true \}\)/);
assert.match(app, /button\.dataset\.filterKey = key/);
assert.match(app, /aria-label', `Fjern filter:/);
assert.match(app, /active-filters[\s\S]+submitFilters\(\)/);

assert.match(feed, /Ingen aktive annonser akkurat nå/);
assert.match(feed, /Legg ut den første annonsen/);
assert.match(feed, /hasActiveFilters\(filters\)/);

assert.match(createHtml, /id="listing-progress-label"/);
assert.match(createHtml, /Lagre kladd på denne enheten/);
assert.match(createHtml, /Kontaktinfo, bilder og video lagres aldri/);
assert.match(createJs, /DRAFT_MAX_AGE = 30 \* 24 \* 60 \* 60 \* 1000/);
assert.match(createJs, /if \(!draftStorageEnabled \|\| editId\) return/);
assert.match(createJs, /removeStoredDraft\(\);[\s\S]{0,120}Annonsen er publisert/);
assert.doesNotMatch(createJs.match(/const DRAFT_SIMPLE_FIELDS = \[[\s\S]+?\];/)?.[0] || '', /contact_info|image|video/);
assert.match(privacy, /Lagre kladd på denne enheten[\s\S]+opptil 30 dager/);

assert.match(dashboard, /<nav class="dashboard-shortcuts mb-10" aria-label="Snarveier på Min side">/);
[
  ['#profile', 'Min konto'],
  ['#my-listings-section', 'Mine annonser'],
  ['#conversations', 'Meldinger'],
  ['#preferences', 'Søkepreferanser'],
  ['#privacy-account', 'Innstillinger'],
].forEach(([href, title]) => {
  assert.match(dashboard, new RegExp(`href="${href}"[\\s\\S]*?<span class="dashboard-shortcut-title">${title}<`));
});
assert.doesNotMatch(dashboard, /Mine kjøretøy|Jobbprofil|Fiks ferdig/);
assert.match(styles, /\.dashboard-shortcuts\s*\{[\s\S]{0,180}grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
assert.match(styles, /@media \(max-width: 440px\)[\s\S]{0,120}\.dashboard-shortcuts \{ grid-template-columns: 1fr; \}/);
assert.match(dashboardJs, /shortcutListingsSummary\.textContent = `\$\{myListings\.length\}/);
assert.match(dashboardJs, /shortcutConversationsSummary\.textContent = `\$\{conversations\.length\}[\s\S]{0,160}unreadCount/);
assert.doesNotMatch(dashboard, /Vipps|vipps/i);
assert.doesNotMatch(dashboardJs, /Vipps|vipps/i);

assert.match(movingIn, /id="power-area"[\s\S]+NO1 · Østlandet[\s\S]+NO5 · Vestlandet/);
assert.match(movingIn, /id="power-current-price"[\s\S]+id="power-average-price"[\s\S]+id="power-range-price"/);
assert.match(movingInJs, /buildPowerPriceUrl\(new Date\(\), area\)/);
assert.match(styles, /\.power-price-widget\s*\{/);

console.log(`Brukervennlighet: ${33 + (htmlFiles.length * 2)} statiske kontroller besto.`);
