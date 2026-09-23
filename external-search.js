const FINN_RENTAL_SEARCH_URL = 'https://www.finn.no/realestate/lettings/search.html';

const PROPERTY_TYPE_TERMS = {
  leilighet: 'leilighet',
  hybel: 'hybel',
  enebolig: 'enebolig',
  rekkehus: 'rekkehus',
  studentbolig: 'studentbolig',
  hytte: 'hytte',
  annet: 'bolig',
};

const FINN_PROPERTY_TYPE_CODES = {
  enebolig: '1',
  leilighet: '3',
  rekkehus: '4',
  hytte: '12',
  hybel: '16',
  annet: '18',
};

const FINN_SORT_VALUES = {
  newest: 'PUBLISHED_DESC',
  price_low: 'RENT_ASC',
  price_high: 'RENT_DESC',
};

const PROPERTY_TYPE_LABELS = {
  leilighet: 'leilighet',
  hybel: 'hybel',
  enebolig: 'enebolig',
  rekkehus: 'rekkehus',
  studentbolig: 'studentbolig eller rom i bofellesskap',
  hytte: 'hytte',
  annet: 'bolig',
};

const OCCUPATION_LABELS = {
  student: 'passer for student',
  jobb: 'passer for noen i jobb',
  annet: 'uten krav til hverdag',
};

const PREFERENCE_LABELS = {
  city: 'sted',
  maxPrice: 'makspris',
  moveInDate: 'innflyttingsmåned',
  propertyType: 'boligtype',
  preferredOccupation: 'ønsket hverdag',
  maxTransitMinutes: 'tid til kollektivtransport',
  schoolName: 'avstand til skole',
  amenities: 'fasiliteter',
  lifestyleTags: 'boligkvaliteter',
  sortBy: 'sortering',
};

const FINN_SUPPORTED_PREFERENCES = new Set(['city', 'maxPrice', 'moveInDate', 'propertyType', 'sortBy']);

const AMENITY_LABELS = {
  matbutikk: 'nær matbutikk',
  kollektivtransport: 'nær kollektivtransport',
  treningssenter: 'nær treningssenter',
  grontomrade: 'nær grøntområde',
};

const LIFESTYLE_LABELS = {
  'nyoppusset-bad': 'pent bad',
  'moderne-stil': 'moderne stil',
  'stort-kjokken': 'sosiale soner',
  'rolig-miljo': 'rolig miljø',
  'stort-rom': 'stort rom',
};

function cleanText(value, maxLength = 100) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function selectedValues(values) {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => cleanText(value, 60)).filter(Boolean))]
    : [];
}

function validPositiveNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function validNonNegativeNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function rentMonth(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${match[1]}${match[2]}`;
}

function activePreferences(filters = {}) {
  const values = [];
  if (cleanText(filters.city)) values.push('city');
  if (validPositiveNumber(filters.maxPrice) !== null) values.push('maxPrice');
  if (rentMonth(filters.moveInDate)) values.push('moveInDate');
  if (PROPERTY_TYPE_TERMS[cleanText(filters.propertyType)]) values.push('propertyType');
  if (cleanText(filters.preferredOccupation)) values.push('preferredOccupation');
  if (validNonNegativeNumber(filters.maxTransitMinutes) !== null) values.push('maxTransitMinutes');
  if (cleanText(filters.schoolName)) values.push('schoolName');
  if (selectedValues(filters.amenities).length) values.push('amenities');
  if (selectedValues(filters.lifestyleTags).length) values.push('lifestyleTags');
  const sortBy = cleanText(filters.sortBy);
  if (sortBy && sortBy !== 'best_match') values.push('sortBy');
  return values;
}

function formatDate(value) {
  if (!rentMonth(value)) return '';
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
}

function joinLabels(keys) {
  return keys.map((key) => PREFERENCE_LABELS[key]).filter(Boolean).join(', ');
}

function verificationItem(key, filters) {
  const amenities = selectedValues(filters.amenities).map((value) => AMENITY_LABELS[value] || value);
  const lifestyle = selectedValues(filters.lifestyleTags).map((value) => LIFESTYLE_LABELS[value] || value);
  const values = {
    city: cleanText(filters.city),
    propertyType: PROPERTY_TYPE_LABELS[cleanText(filters.propertyType)] || cleanText(filters.propertyType),
    preferredOccupation: OCCUPATION_LABELS[cleanText(filters.preferredOccupation)] || cleanText(filters.preferredOccupation),
    maxTransitMinutes: validNonNegativeNumber(filters.maxTransitMinutes) === null
      ? ''
      : `maks ${Math.round(validNonNegativeNumber(filters.maxTransitMinutes))} min`,
    schoolName: cleanText(filters.schoolName),
    amenities: amenities.join(', '),
    lifestyleTags: lifestyle.join(', '),
  };
  const labels = {
    city: 'Område',
    propertyType: 'Boligtype',
    preferredOccupation: 'Hverdag',
    maxTransitMinutes: 'Kollektivtransport',
    schoolName: 'Skoleavstand',
    amenities: 'Fasiliteter',
    lifestyleTags: 'Boligkvaliteter',
  };
  return labels[key] && values[key] ? { key, label: labels[key], value: values[key] } : null;
}

export function buildFinnSearchUrl(filters = {}) {
  const url = new URL(FINN_RENTAL_SEARCH_URL);
  const queryParts = [];
  const city = cleanText(filters.city);
  const propertyType = cleanText(filters.propertyType);
  const propertyTypeCode = FINN_PROPERTY_TYPE_CODES[propertyType];
  const maxPrice = validPositiveNumber(filters.maxPrice);
  const availableMonth = rentMonth(filters.moveInDate);

  if (city) queryParts.push(city);
  if (PROPERTY_TYPE_TERMS[propertyType] && !propertyTypeCode) queryParts.push(PROPERTY_TYPE_TERMS[propertyType]);
  if (queryParts.length) url.searchParams.set('q', queryParts.join(' '));
  if (propertyTypeCode) url.searchParams.set('property_type', propertyTypeCode);
  if (maxPrice !== null) url.searchParams.set('price_to', String(Math.round(maxPrice)));
  if (availableMonth) url.searchParams.set('start_month', availableMonth);
  const finnSort = FINN_SORT_VALUES[cleanText(filters.sortBy)];
  if (finnSort) url.searchParams.set('sort', finnSort);

  return url.toString();
}

export function buildExternalSearchPhrase(filters = {}) {
  const propertyType = cleanText(filters.propertyType);
  const city = cleanText(filters.city);
  const school = cleanText(filters.schoolName);
  const price = validPositiveNumber(filters.maxPrice);
  const transit = validNonNegativeNumber(filters.maxTransitMinutes);
  const occupation = OCCUPATION_LABELS[cleanText(filters.preferredOccupation)];
  const amenities = selectedValues(filters.amenities).map((value) => AMENITY_LABELS[value] || value);
  const lifestyle = selectedValues(filters.lifestyleTags).map((value) => LIFESTYLE_LABELS[value] || value);
  const parts = [];

  parts.push(`${PROPERTY_TYPE_LABELS[propertyType] || 'bolig'} til leie${city ? ` i ${city}` : ''}`);
  if (price !== null) parts.push(`maks ${Math.round(price).toLocaleString('nb-NO')} kr per måned`);
  if (formatDate(filters.moveInDate)) parts.push(`ønsket innflytting ${formatDate(filters.moveInDate)}`);
  if (school) parts.push(`nær ${school}`);
  if (occupation) parts.push(occupation);
  if (transit !== null) parts.push(`maks ${Math.round(transit)} min til kollektivtransport`);
  parts.push(...amenities, ...lifestyle);

  return parts.join(', ').slice(0, 320);
}

export function buildFacebookMarketplaceUrl(filters = {}) {
  void filters;
  return 'https://www.facebook.com/marketplace/category/propertyrentals/';
}

export function buildFinnFallbackSearches(filters = {}) {
  const candidates = [];
  const maxPrice = validPositiveNumber(filters.maxPrice);
  const propertyType = cleanText(filters.propertyType);
  const moveInDate = rentMonth(filters.moveInDate);

  if (moveInDate) {
    candidates.push({
      key: 'flexible-move-in',
      label: 'Fleksibel innflytting',
      url: buildFinnSearchUrl({ ...filters, moveInDate: '' }),
    });
  }
  if (propertyType) {
    candidates.push({
      key: 'all-property-types',
      label: 'Flere boligtyper',
      url: buildFinnSearchUrl({ ...filters, propertyType: '' }),
    });
  }
  if (maxPrice !== null) {
    candidates.push({
      key: 'higher-price',
      label: `Maks ${Math.round(maxPrice * 1.25).toLocaleString('nb-NO')} kr`,
      url: buildFinnSearchUrl({ ...filters, maxPrice: Math.round(maxPrice * 1.25) }),
    });
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  }).slice(0, 3);
}

export function buildExternalSearchModel(filters = {}) {
  const active = activePreferences(filters);
  const transferred = active.filter((key) => (
    FINN_SUPPORTED_PREFERENCES.has(key)
    && (key !== 'sortBy' || Boolean(FINN_SORT_VALUES[cleanText(filters.sortBy)]))
  ));
  const remaining = active.filter((key) => !transferred.includes(key));
  const propertyType = cleanText(filters.propertyType);
  const filtered = transferred.filter((key) => key !== 'city' && !(key === 'propertyType' && !FINN_PROPERTY_TYPE_CODES[propertyType]));
  const keywords = transferred.filter((key) => !filtered.includes(key));
  const listingVerificationKeys = active.filter((key) => key !== 'sortBy' && !filtered.includes(key));
  const verificationItems = listingVerificationKeys
    .map((key) => verificationItem(key, filters))
    .filter(Boolean);

  return {
    finnUrl: buildFinnSearchUrl(filters),
    facebookUrl: buildFacebookMarketplaceUrl(filters),
    searchPhrase: buildExternalSearchPhrase(filters),
    activeCount: active.length,
    transferredCount: transferred.length,
    filteredCount: filtered.length,
    keywordCount: keywords.length,
    verificationCount: verificationItems.length,
    verificationItems,
    transferredLabel: joinLabels(transferred),
    filteredLabel: joinLabels(filtered),
    keywordLabel: joinLabels(keywords),
    remainingLabel: joinLabels(remaining),
  };
}

export function renderExternalSearch(filters = {}, documentRef = document) {
  const model = buildExternalSearchModel(filters);
  const finnLink = documentRef.getElementById('external-finn-link');
  const facebookLink = documentRef.getElementById('external-facebook-link');
  const copyButton = documentRef.getElementById('copy-external-search');
  const summary = documentRef.getElementById('external-search-summary');
  const detail = documentRef.getElementById('external-search-detail');
  const fallbackSearches = documentRef.getElementById('external-fallback-searches');
  const fallbackLinks = documentRef.getElementById('external-fallback-links');
  const fallbacks = buildFinnFallbackSearches(filters);

  if (finnLink) finnLink.href = model.finnUrl;
  if (facebookLink) facebookLink.href = model.facebookUrl;
  if (copyButton) copyButton.dataset.searchText = model.searchPhrase;
  if (fallbackLinks) {
    fallbackLinks.replaceChildren();
    fallbacks.forEach((fallback) => {
      const link = documentRef.createElement('a');
      link.href = fallback.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `${fallback.label} ↗`;
      fallbackLinks.append(link);
    });
  }
  fallbackSearches?.classList.toggle('hidden', fallbacks.length === 0);

  if (!model.activeCount) {
    if (summary) summary.textContent = 'Velg minst én preferanse for å finne og rangere boligforslag.';
    if (detail) detail.textContent = 'Den eksterne FINN-lenken er tilgjengelig som et manuelt alternativ.';
    return model;
  }

  if (summary) {
    summary.textContent = `${model.activeCount} preferanser er klare for automatisk kontroll og rangering.`;
  }
  if (detail) {
    detail.textContent = 'AI-søket bruker alle valgene. FINN-knappen er et separat, manuelt søkealternativ.';
  }
  return model;
}
