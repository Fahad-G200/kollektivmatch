const PROPERTY_TYPES = new Set(['leilighet', 'hybel', 'enebolig', 'rekkehus', 'studentbolig', 'hytte', 'annet']);
const AMENITIES = new Set(['matbutikk', 'kollektivtransport', 'treningssenter', 'grontomrade']);
const LIFESTYLE = new Set(['stort-rom', 'moderne-stil', 'nyoppusset-bad', 'rolig-miljo', 'stort-kjokken']);
const VISUAL_LIFESTYLE = new Set(['stort-rom', 'moderne-stil', 'nyoppusset-bad', 'stort-kjokken']);

const PROPERTY_LABELS = {
  leilighet: 'Leilighet', hybel: 'Hybel', enebolig: 'Enebolig', rekkehus: 'Rekkehus',
  studentbolig: 'Studentbolig / rom', hytte: 'Hytte', annet: 'Annet',
};
const AMENITY_LABELS = {
  matbutikk: 'Matbutikk i nærheten', kollektivtransport: 'Kollektivtransport i nærheten',
  treningssenter: 'Treningssenter i nærheten', grontomrade: 'Grøntområde i nærheten',
};
const LIFESTYLE_LABELS = {
  'stort-rom': 'Stort rom', 'moderne-stil': 'Moderne stil',
  'nyoppusset-bad': 'Fint / moderne bad', 'rolig-miljo': 'Rolig miljø',
  'stort-kjokken': 'Stort kjøkken / sosial sone',
};
const SOURCE_LABELS = {
  listing_text: 'Annonsetekst', listing_image: 'Bilde fra annonsen',
  google_maps: 'Google Maps', source_page: 'Kildeside',
};

let supabasePromise;
function getSupabase() {
  supabasePromise ||= import('./supabase-config.js').then((module) => module.supabase);
  return supabasePromise;
}

function cleanText(value, maxLength = 180) {
  return String(value || '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function selectedValues(values, allowed) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanText(value, 40)).filter((value) => allowed.has(value)))];
}

function positiveInteger(value, min, max) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return '';
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isFinite(date.getTime())
    && date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]) ? match[0] : '';
}

function validSchool(filters = {}) {
  const name = cleanText(filters.schoolName, 160);
  const latitude = Number(filters.schoolLat);
  const longitude = Number(filters.schoolLon);
  return name && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    ? { name, latitude, longitude } : null;
}

export function externalPreferencesFromFilters(filters = {}) {
  const propertyType = cleanText(filters.propertyType, 40);
  const preferredOccupation = cleanText(filters.preferredOccupation, 40);
  return {
    city: cleanText(filters.city, 100),
    max_price: positiveInteger(filters.maxPrice, 1, 10_000_000),
    desired_move_in_date: validDate(filters.moveInDate) || null,
    property_type: PROPERTY_TYPES.has(propertyType) ? propertyType : null,
    preferred_occupation: ['student', 'jobb', 'annet'].includes(preferredOccupation) ? preferredOccupation : null,
    max_transit_minutes: positiveInteger(filters.maxTransitMinutes, 0, 600),
    amenities: selectedValues(filters.amenities, AMENITIES),
    lifestyle_tags: selectedValues(filters.lifestyleTags, LIFESTYLE),
    school: validSchool(filters),
  };
}

export function preferencePresentation(filters = {}) {
  const preferences = externalPreferencesFromFilters(filters);
  const requestedSchoolName = cleanText(filters.schoolName, 160);
  const items = [];
  if (preferences.city) items.push({ key: 'city', label: `Område: ${preferences.city}` });
  if (preferences.max_price !== null) items.push({ key: 'max_price', label: `Makspris: ${preferences.max_price.toLocaleString('nb-NO')} kr` });
  if (preferences.desired_move_in_date) items.push({ key: 'move_in', label: `Innflytting: ${preferences.desired_move_in_date}` });
  if (preferences.property_type) items.push({ key: 'property_type', label: `Boligtype: ${PROPERTY_LABELS[preferences.property_type]}` });
  if (preferences.preferred_occupation) items.push({ key: 'occupation', label: `Hverdag: ${preferences.preferred_occupation === 'jobb' ? 'i jobb' : preferences.preferred_occupation}` });
  if (preferences.max_transit_minutes !== null) items.push({ key: 'transit', label: `Kollektivt: maks ${preferences.max_transit_minutes} min` });
  preferences.amenities.forEach((key) => items.push({ key: `amenity:${key}`, label: AMENITY_LABELS[key] }));
  preferences.lifestyle_tags.forEach((key) => items.push({ key: `lifestyle:${key}`, label: LIFESTYLE_LABELS[key] }));
  if (preferences.school) items.push({ key: 'school', label: `Skole: ${preferences.school.name}` });
  return {
    preferences,
    items,
    hasScoreBasis: items.length >= 1,
    needsImages: preferences.lifestyle_tags.some((key) => VISUAL_LIFESTYLE.has(key)),
    schoolNeedsSelection: Boolean(requestedSchoolName && !preferences.school),
  };
}

export function buildAutomaticSearchPayload(filters = {}) {
  return {
    schema_version: 'automatic-listing-search-v1',
    preferences: externalPreferencesFromFilters(filters),
  };
}

function hostAllowed(hostname, domains) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return domains.some((domain) => {
    const allowed = cleanText(domain, 253).toLowerCase().replace(/^\.+|\.+$/g, '');
    return allowed && (host === allowed || host.endsWith(`.${allowed}`));
  });
}

export function safeResultUrl(value, allowedDomains = []) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hostAllowed(url.hostname, allowedDomains)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function safeImageUrl(value, allowedHosts = []) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!allowedHosts.length || !hostAllowed(url.hostname, allowedHosts)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function activeStatusText(value) {
  if (value === 'likely_active' || value === 'active') return 'Trolig aktiv annonse';
  if (value === 'inactive') return 'Kan være utløpt';
  return 'Aktiv status ukjent';
}

function listLabels(value) {
  return (Array.isArray(value) ? value : []).slice(0, 12)
    .map((entry) => cleanText(typeof entry === 'string' ? entry : entry?.label, 120)).filter(Boolean);
}

export function formatAutomaticResultLine(result = {}) {
  const percent = Number.isInteger(result?.score?.percent) ? `${result.score.percent} %` : 'Ukjent match';
  const title = cleanText(result.title, 140) || 'Boligforslag';
  const matched = listLabels(result.has);
  const missing = listLabels(result.missing);
  const unknown = listLabels(result.unknown);
  return `${percent} · ${title} · Matcher: ${matched.join(', ') || 'ingen bekreftet'} · Mangler: ${missing.join(', ') || 'ingen bekreftet'} · Ukjent: ${unknown.join(', ') || 'ingen'}`;
}

export function normalizeAutomaticResult(result = {}, expectedItems = []) {
  const criteria = Array.isArray(result.criteria) ? result.criteria.map((item) => ({ ...item })) : [];
  const seen = new Set(criteria.map((item) => cleanText(item?.key, 80)).filter(Boolean));
  const missingExpected = [];
  for (const expected of Array.isArray(expectedItems) ? expectedItems : []) {
    const key = cleanText(expected?.key, 80);
    if (!key || seen.has(key)) continue;
    missingExpected.push(key);
    criteria.push({
      key,
      label: cleanText(expected?.label, 120) || 'Valgt preferanse',
      status: 'unknown',
      evidence: 'Kontrollgrunnlaget manglet dette valgte kravet, så det er ikke regnet som oppfylt.',
      source: 'unknown',
      confidence: 'ukjent',
    });
  }
  const has = criteria.filter((item) => item?.status === 'met').map((item) => item.label);
  const missing = criteria.filter((item) => item?.status === 'not_met' || item?.status === 'partial').map((item) => item.label);
  const unknown = criteria.filter((item) => !['met', 'not_met', 'partial'].includes(item?.status)).map((item) => item.label);
  return {
    ...result,
    criteria,
    has: criteria.length ? has : result.has,
    missing: criteria.length ? missing : result.missing,
    unknown: criteria.length ? unknown : result.unknown,
    score: {
      ...(result.score || {}),
      percent: missingExpected.length ? null : result?.score?.percent,
      criteria_complete: missingExpected.length === 0,
    },
  };
}

function formatPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? `${Math.round(price).toLocaleString('nb-NO')} kr/mnd.` : 'Pris ukjent';
}

function formatDistance(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance) || distance < 0) return null;
  return distance < 1 ? `${Math.round(distance * 1000)} m til skole` : `${distance.toLocaleString('nb-NO', { maximumFractionDigits: 1 })} km til skole`;
}

function resultFact(text, documentRef) {
  const item = documentRef.createElement('span');
  item.textContent = text;
  return item;
}

function evidenceRow(criterion, documentRef) {
  const item = documentRef.createElement('li');
  item.className = `external-auto-evidence is-${cleanText(criterion?.status, 20) || 'unknown'}`;
  const header = documentRef.createElement('div');
  const label = documentRef.createElement('strong');
  label.textContent = cleanText(criterion?.label, 120) || 'Kriterium';
  const state = documentRef.createElement('span');
  state.textContent = criterion?.status === 'met' ? 'Matcher'
    : criterion?.status === 'not_met' ? 'Mangler'
      : criterion?.status === 'partial' ? 'Delvis' : 'Ukjent';
  header.append(label, state);
  const explanation = documentRef.createElement('p');
  explanation.textContent = cleanText(criterion?.evidence, 360) || 'Ingen pålitelig dokumentasjon funnet.';
  const source = documentRef.createElement('small');
  source.textContent = SOURCE_LABELS[criterion?.source] || 'Grunnlag ikke oppgitt';
  if (criterion?.confidence) source.textContent += ` · ${cleanText(criterion.confidence, 20)} sikkerhet`;
  item.append(header, explanation, source);
  return item;
}

function resultCard(result, allowedDomains, allowedImageHosts, documentRef) {
  const url = safeResultUrl(result?.url, allowedDomains);
  if (!url) return null;
  const card = documentRef.createElement('article');
  card.className = 'external-auto-card';

  const media = documentRef.createElement('div');
  media.className = 'external-auto-card-media';
  const imageUrl = result?.image?.verified_same_listing === true
    ? safeImageUrl(result.image.thumbnail_url || result.image.url, allowedImageHosts) : null;
  if (imageUrl) {
    const image = documentRef.createElement('img');
    image.src = imageUrl;
    image.alt = cleanText(result.image.alt, 180) || `Boligbilde for ${cleanText(result.title, 100)}`;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      const placeholder = documentRef.createElement('div');
      placeholder.className = 'external-auto-image-missing';
      placeholder.textContent = 'Boligbildet kunne ikke lastes';
      image.replaceWith(placeholder);
    }, { once: true });
    media.append(image);
  } else {
    const placeholder = documentRef.createElement('div');
    placeholder.className = 'external-auto-image-missing';
    placeholder.textContent = 'Bilde kunne ikke knyttes sikkert til annonsen';
    media.append(placeholder);
  }
  const score = documentRef.createElement('div');
  score.className = 'external-auto-score';
  const scoreValue = Number.isInteger(result?.score?.percent) ? result.score.percent : null;
  const scoreStrong = documentRef.createElement('strong');
  scoreStrong.textContent = scoreValue === null ? '–' : String(scoreValue);
  const scoreLabel = documentRef.createElement('span');
  scoreLabel.textContent = scoreValue === null ? 'match ukjent' : '% match';
  score.append(scoreStrong, scoreLabel);
  media.append(score);

  const body = documentRef.createElement('div');
  body.className = 'external-auto-card-body';
  const provider = documentRef.createElement('p');
  provider.className = 'external-auto-provider';
  provider.textContent = cleanText(result.provider, 80) || new URL(url).hostname;
  const title = documentRef.createElement('h4');
  title.textContent = cleanText(result.title, 160) || 'Boligforslag';
  const location = documentRef.createElement('p');
  location.className = 'external-auto-location';
  location.textContent = cleanText(result.location, 180) || 'Beliggenhet ikke sikkert oppgitt';

  const facts = documentRef.createElement('div');
  facts.className = 'external-auto-facts';
  facts.append(resultFact(formatPrice(result.price_nok), documentRef));
  facts.append(resultFact(activeStatusText(result.active_status), documentRef));
  const transit = Number(result.transit_minutes);
  if (Number.isFinite(transit) && transit >= 0) facts.append(resultFact(`${Math.round(transit)} min til kollektivt`, documentRef));
  const distance = formatDistance(result.distance_to_school_km);
  if (distance) facts.append(resultFact(distance, documentRef));
  const coverage = Number(result?.score?.coverage_percent);
  if (Number.isFinite(coverage)) facts.append(resultFact(`${Math.round(coverage)} % kontrollert`, documentRef));

  const quick = documentRef.createElement('div');
  quick.className = 'external-auto-quick';
  [['Matcher', result.has, 'is-met'], ['Mangler', result.missing, 'is-missing'], ['Ukjent', result.unknown, 'is-unknown']].forEach(([heading, entries, className]) => {
    const section = documentRef.createElement('section');
    section.className = className;
    const strong = documentRef.createElement('strong');
    strong.textContent = heading;
    const text = documentRef.createElement('p');
    text.textContent = listLabels(entries).join(' · ') || (heading === 'Ukjent' ? 'Ingen' : 'Ingen bekreftet');
    section.append(strong, text);
    quick.append(section);
  });

  const details = documentRef.createElement('details');
  details.className = 'external-auto-details';
  const detailsSummary = documentRef.createElement('summary');
  detailsSummary.textContent = 'Se kontroll av alle preferanser';
  const criteria = documentRef.createElement('ul');
  (Array.isArray(result.criteria) ? result.criteria : []).forEach((criterion) => criteria.append(evidenceRow(criterion, documentRef)));
  details.append(detailsSummary, criteria);

  const link = documentRef.createElement('a');
  link.className = 'external-auto-source-link';
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `Åpne annonsen hos ${cleanText(result.provider, 80) || 'kilden'} ↗`;
  link.setAttribute('aria-label', `${link.textContent} – ${scoreValue === null ? 'match ukjent' : `${scoreValue} prosent match`} – åpnes i ny fane`);

  const line = documentRef.createElement('p');
  line.className = 'external-auto-readable-line';
  line.textContent = formatAutomaticResultLine(result);
  body.append(provider, title, location, facts, quick, details, link, line);
  card.append(media, body);
  return card;
}

export function renderAutomaticSearchResults(payload, documentRef = document, expectedItems = []) {
  const section = documentRef.getElementById('external-auto-result');
  const resultsTarget = documentRef.getElementById('external-auto-results');
  const summary = documentRef.getElementById('external-auto-summary');
  const searchedAt = documentRef.getElementById('external-auto-searched-at');
  const warningsTarget = documentRef.getElementById('external-auto-warnings');
  if (!section || !resultsTarget) return 0;
  const allowedDomains = Array.isArray(payload?.allowed_source_domains) ? payload.allowed_source_domains : [];
  const allowedImageHosts = Array.isArray(payload?.allowed_image_hosts) ? payload.allowed_image_hosts : [];
  const results = (Array.isArray(payload?.results) ? payload.results : [])
    .map((result) => normalizeAutomaticResult(result, expectedItems))
    .slice(0, 8)
    .sort((a, b) => Number(b?.score?.percent || 0) - Number(a?.score?.percent || 0));
  resultsTarget.replaceChildren();
  let rendered = 0;
  results.forEach((result) => {
    const card = resultCard(result, allowedDomains, allowedImageHosts, documentRef);
    if (!card) return;
    resultsTarget.append(card);
    rendered += 1;
  });
  if (!rendered) {
    const empty = documentRef.createElement('div');
    empty.className = 'external-auto-empty';
    empty.textContent = 'Ingen sikre annonselenker ble funnet denne gangen. Prøv et større område eller en litt høyere makspris.';
    resultsTarget.append(empty);
  }
  if (summary) {
    const checked = Number(payload?.searched_count || results.length);
    const relaxed = payload?.search_mode === 'broadened' ? ' Søket ble utvidet for å finne de nærmeste alternativene.' : '';
    summary.textContent = `${rendered} forslag vist av ${Math.max(checked, rendered)} kontrollerte kildelenker.${relaxed}`;
  }
  if (searchedAt) {
    const date = new Date(payload?.searched_at || '');
    searchedAt.textContent = Number.isFinite(date.getTime())
      ? `Sjekket ${date.toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' })}` : '';
  }
  if (warningsTarget) {
    warningsTarget.replaceChildren();
    const warnings = [...(Array.isArray(payload?.warnings) ? payload.warnings : [])];
    if (results.some((result) => result?.score?.criteria_complete === false)) {
      warnings.unshift('Minst ett forslag manglet kontroll av et valgt krav. Matchprosenten er derfor skjult for det forslaget.');
    }
    warnings.slice(0, 6).forEach((warning) => {
      const row = documentRef.createElement('p');
      row.textContent = cleanText(warning, 360);
      warningsTarget.append(row);
    });
  }
  section.classList.remove('hidden');
  section.focus({ preventScroll: true });
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return rendered;
}

function renderPreferenceList(filters, documentRef = document) {
  const model = preferencePresentation(filters);
  const list = documentRef.getElementById('automatic-check-preference-list');
  const status = documentRef.getElementById('automatic-check-preference-status');
  if (list) {
    list.replaceChildren();
    model.items.forEach((item) => {
      const row = documentRef.createElement('li');
      row.textContent = item.label;
      list.append(row);
    });
  }
  if (status) {
    status.textContent = model.schoolNeedsSelection
      ? 'Velg skolen fra forslagslisten slik at avstanden kan kontrolleres.'
      : model.hasScoreBasis
      ? `${model.items.length} ${model.items.length === 1 ? 'kriterium kontrolleres' : 'kriterier kontrolleres'} per forslag. Krav uten sikkert bevis vises som «Ukjent».`
      : 'Velg minst én preferanse i søket over.';
  }
  return model;
}

async function functionErrorMessage(error, data) {
  if (data?.message) return cleanText(data.message, 260);
  const response = error?.context;
  if (response && typeof response.clone === 'function') {
    try {
      const payload = await response.clone().json();
      if (payload?.message) return cleanText(payload.message, 260);
    } catch {
      // Rå leverandørrespons skal ikke vises i klienten.
    }
  }
  return 'Boligsøket kunne ikke fullføres akkurat nå. Prøv igjen litt senere.';
}

export function initExternalListingSearch({ getFilters, openLogin, showToast, documentRef = document } = {}) {
  const panel = documentRef.getElementById('external-listing-check');
  const submitButton = documentRef.getElementById('external-auto-search-submit');
  const status = documentRef.getElementById('external-auto-status');
  let signedInUser = null;

  const refreshPreferences = () => renderPreferenceList(getFilters?.() || {}, documentRef);
  panel?.addEventListener('toggle', () => { if (panel.open) refreshPreferences(); });
  const startSearch = async () => {
    if (!signedInUser) {
      if (status) status.textContent = 'Logg inn for å la AI finne og kontrollere boligforslag.';
      openLogin?.();
      return;
    }
    const model = refreshPreferences();
    if (model.schoolNeedsSelection) {
      if (status) status.textContent = 'Velg skolen fra forslagslisten før du starter, så skoleavstanden blir med.';
      documentRef.getElementById('f-school')?.focus();
      return;
    }
    if (!model.hasScoreBasis) {
      if (status) status.textContent = 'Velg minst én preferanse før du starter.';
      documentRef.getElementById('filter-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = 'Finner og kontrollerer …';
    if (status) status.textContent = 'Søker først presist og utvider automatisk hvis det er få treff. Dette kan ta litt tid.';
    documentRef.getElementById('external-auto-result')?.classList.add('hidden');
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase.functions.invoke('find-listing-matches', {
        body: buildAutomaticSearchPayload(getFilters?.() || {}),
      });
      if (error || !data) {
        if (status) status.textContent = await functionErrorMessage(error, data);
        return;
      }
      const rendered = renderAutomaticSearchResults(data, documentRef, model.items);
      if (status) status.textContent = rendered
        ? `${rendered} boligforslag er rangert. Åpne detaljene for hele kontrollen.`
        : 'Ingen sikre lenker denne gangen. Prøv et litt bredere område eller en høyere makspris.';
      showToast?.(rendered ? `${rendered} boligforslag funnet og kontrollert.` : 'Ingen sikre boliglenker funnet.', rendered ? 'success' : 'error');
    } catch (error) {
      if (status) status.textContent = cleanText(error?.message, 260) || 'Boligsøket kunne ikke fullføres.';
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Finn og sjekk boligforslag';
    }
  };
  submitButton?.addEventListener('click', startSearch);
  refreshPreferences();

  return {
    refreshPreferences,
    startSearch,
    setUser(user) {
      signedInUser = user || null;
      if (status) status.textContent = signedInUser
        ? 'Klar. Søket finner også nære alternativer og rangerer dem etter alle valgte krav.'
        : 'Du må være logget inn. Resultater og kilder vises rett under knappen.';
    },
  };
}

// Alias så eldre sider ikke bryter mens frontend og server oppdateres sammen.
export const initExternalListingCheck = initExternalListingSearch;
