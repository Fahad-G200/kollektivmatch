import { haversineKm } from './location-utils.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function selectedValues(values) {
  return Array.isArray(values) ? [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))] : [];
}

function normalizeLocation(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('nb-NO')
    .replace(/[æ]/g, 'ae')
    .replace(/[ø]/g, 'o')
    .replace(/[å]/g, 'a')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function locationSearchParts(value) {
  return [...new Set(String(value || '').split(/[,/]/).map(part => part.trim()).filter(Boolean))];
}

export function matchesLocation(wantedLocation, listingLocations) {
  const wantedParts = locationSearchParts(wantedLocation).map(normalizeLocation).filter(Boolean);
  const availableParts = listingLocations.map(normalizeLocation).filter(Boolean);
  if (!wantedParts.length || !availableParts.length) return false;
  return wantedParts.every(wanted => availableParts.some(available =>
    wanted === available || ` ${available} `.includes(` ${wanted} `)
  ));
}

function locationMatchRatio(wantedLocation, listingLocations) {
  return matchesLocation(wantedLocation, listingLocations) ? 1 : 0;
}

/**
 * Feltet er «by / område». Når brukeren limer inn «område, by», søker vi på
 * den mest presise første delen i databasen. Hele teksten brukes fortsatt i
 * selve matchberegningen.
 */
export function primaryLocationSearchTerm(value) {
  return String(value || '').split(/[,/]/).map((part) => part.trim()).find(Boolean) || '';
}

/**
 * Gjør det aktive søket til en del av Smart Match-grunnlaget. Et eksplisitt
 * filter overstyrer samme lagrede profilpreferanse, mens øvrige preferanser
 * fortsatt kan skille resultatene fra hverandre.
 */
export function buildMatchPreferences(profile, filters = {}) {
  const preferences = { ...(profile || {}) };
  const maxPrice = Number(filters.maxPrice);
  const maxTransitMinutes = Number(filters.maxTransitMinutes);
  const lifestyleTags = selectedValues(filters.lifestyleTags);
  const amenityTags = selectedValues(filters.amenities);
  const amenityValues = new Set(['matbutikk', 'kollektivtransport', 'treningssenter', 'grontomrade']);
  const savedTags = selectedValues(preferences.priority_tags);
  const filterTags = selectedValues([
    ...(amenityTags.length ? amenityTags : savedTags.filter(tag => amenityValues.has(tag))),
    ...(lifestyleTags.length ? lifestyleTags : savedTags.filter(tag => !amenityValues.has(tag))),
  ]);

  if (String(filters.maxPrice ?? '').trim() && Number.isFinite(maxPrice) && maxPrice > 0) {
    preferences.monthly_budget_max = maxPrice;
  }
  if (filters.propertyType) preferences.preferred_property_types = [String(filters.propertyType)];
  if (filters.preferredOccupation) preferences.occupation = String(filters.preferredOccupation);
  if (filters.moveInDate) preferences.desired_move_in_date = String(filters.moveInDate);
  if (filterTags.length) preferences.priority_tags = filterTags;
  if (String(filters.maxTransitMinutes ?? '').trim() && Number.isFinite(maxTransitMinutes) && maxTransitMinutes >= 0) {
    preferences.max_transit_minutes = maxTransitMinutes;
  }
  if (String(filters.city || '').trim()) preferences.search_location = String(filters.city).trim();

  return preferences;
}

function addCriterion(state, weight, ratio, label, detail = '', alwaysExplain = false) {
  const normalizedRatio = Math.max(0, Math.min(1, ratio));
  state.weight += weight;
  state.points += weight * normalizedRatio;
  state.breakdown.push({
    label,
    detail: detail || label,
    percentage: Math.round(normalizedRatio * 100),
    weight,
  });
  if ((normalizedRatio >= 0.99 || alwaysExplain) && (detail || label)) {
    state.explanations.push(detail || label);
  }
}

export function schoolProximityRatio(distanceKm) {
  if (distanceKm === null || distanceKm === undefined || String(distanceKm).trim() === '') return null;
  const distance = Number(distanceKm);
  if (!Number.isFinite(distance) || distance < 0) return null;
  if (distance <= 1) return 1;
  if (distance <= 2) return 1 - ((distance - 1) * 0.1);
  if (distance <= 5) return 0.9 - ((distance - 2) * (0.2 / 3));
  if (distance <= 10) return 0.7 - ((distance - 5) * 0.05);
  if (distance <= 20) return 0.45 - ((distance - 10) * 0.025);
  if (distance <= 30) return 0.2 - ((distance - 20) * 0.02);
  return 0;
}

/**
 * Beregner match kun fra kriterier brukeren faktisk har fylt ut og som
 * annonsen har nok data til å vurdere. Returnerer null ved for tynt grunnlag.
 */
export function computeMatch(listing, profile, context = {}) {
  const school = context?.school;
  if (!listing || (!profile && !school)) return null;
  const preferences = profile || {};

  const state = { points: 0, weight: 0, criteria: 0, explanations: [], breakdown: [] };

  const wantedLocation = String(preferences.search_location || '').trim();
  const listingLocations = [listing.city, listing.area]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (wantedLocation && listingLocations.length) {
    const ratio = locationMatchRatio(wantedLocation, listingLocations);
    addCriterion(state, 25, ratio, 'Område', ratio === 1 ? 'Riktig område' : 'Utenfor ønsket område');
    state.criteria += 1;
  }

  if (Number.isFinite(Number(preferences.monthly_budget_max)) && Number(preferences.monthly_budget_max) > 0
      && Number.isFinite(Number(listing.price)) && Number(listing.price) > 0) {
    const budget = Number(preferences.monthly_budget_max);
    const price = Number(listing.price);
    const ratio = price <= budget ? 1 : Math.max(0, 1 - ((price - budget) / budget) / 0.5);
    addCriterion(state, 35, ratio, 'Budsjett', price <= budget
      ? 'Innenfor budsjett'
      : `${(price - budget).toLocaleString('nb-NO')} kr over månedsbudsjettet`);
    state.criteria += 1;
  }

  const preferredTypes = Array.isArray(preferences.preferred_property_types)
    ? preferences.preferred_property_types.filter(Boolean)
    : [];
  if (preferredTypes.length && listing.property_type) {
    const matches = preferredTypes.includes(listing.property_type);
    addCriterion(state, 25, matches ? 1 : 0, 'Boligtype', matches ? 'Riktig boligtype' : 'En annen boligtype enn du ønsker');
    state.criteria += 1;
  }

  if (preferences.occupation && Array.isArray(listing.preferred_occupations)) {
    const accepted = listing.preferred_occupations;
    const matches = !accepted.length || accepted.includes(preferences.occupation);
    addCriterion(state, 15, matches ? 1 : 0, 'Hverdag', matches ? 'Passer din hverdag' : 'Annonsøren ønsker en annen hverdag');
    state.criteria += 1;
  }

  if (preferences.desired_move_in_date && (listing.move_in_date || listing.move_in_date === null)) {
    const desired = new Date(`${preferences.desired_move_in_date}T00:00:00`);
    const available = listing.move_in_date ? new Date(`${listing.move_in_date}T00:00:00`) : null;
    if (Number.isFinite(desired.getTime()) && (!available || Number.isFinite(available.getTime()))) {
      const ratio = !available || available <= desired ? 1 : 0;
      addCriterion(state, 15, ratio, 'Innflytting', ratio === 1 ? 'Passer innflyttingen' : 'Ledig senere enn ønsket innflytting');
      state.criteria += 1;
    }
  }

  const hasTransitPreference = String(preferences.max_transit_minutes ?? '').trim() !== '';
  const hasListingTransit = String(listing.transit_minutes ?? '').trim() !== '';
  const maxTransitMinutes = Number(preferences.max_transit_minutes);
  const transitMinutes = Number(listing.transit_minutes);
  if (hasTransitPreference && hasListingTransit
      && Number.isFinite(maxTransitMinutes) && maxTransitMinutes >= 0
      && Number.isFinite(transitMinutes) && transitMinutes >= 0) {
    const ratio = transitMinutes <= maxTransitMinutes
      ? 1
      : Math.max(0, 1 - ((transitMinutes - maxTransitMinutes) / Math.max(maxTransitMinutes, 5)));
    addCriterion(state, 20, ratio, 'Kollektivtransport', transitMinutes <= maxTransitMinutes
      ? 'Kort vei til kollektivtransport'
      : `${transitMinutes} min til kollektivtransport · du ønsker maks ${maxTransitMinutes} min`);
    state.criteria += 1;
  }

  const priorities = Array.isArray(preferences.priority_tags) ? preferences.priority_tags.filter(Boolean) : [];
  const listingTags = [
    ...(Array.isArray(listing.lifestyle_tags) ? listing.lifestyle_tags : []),
    ...(Array.isArray(listing.amenities) ? listing.amenities : []),
  ];
  if (priorities.length && listingTags.length) {
    const matches = priorities.filter((tag) => listingTags.includes(tag)).length;
    addCriterion(state, 30, matches / priorities.length, 'Ønsker', `${matches} av ${priorities.length} ønsker oppfylt`);
    state.criteria += 1;
  }

  let schoolDistanceKm = null;
  if (school && Number.isFinite(Number(school.latitude)) && Number.isFinite(Number(school.longitude))) {
    schoolDistanceKm = haversineKm(
      { latitude: listing.location_lat, longitude: listing.location_lon },
      { latitude: school.latitude, longitude: school.longitude },
    );
    const proximityRatio = schoolDistanceKm === null ? null : schoolProximityRatio(schoolDistanceKm);
    if (proximityRatio !== null) {
      const roundedDistance = schoolDistanceKm < 10
        ? schoolDistanceKm.toLocaleString('nb-NO', { maximumFractionDigits: 1 })
        : Math.round(schoolDistanceKm).toLocaleString('nb-NO');
      addCriterion(
        state,
        40,
        proximityRatio,
        'Skoleavstand',
        `${roundedDistance} km fra ${school.name || 'valgt skole'}`,
        true,
      );
      state.criteria += 1;
    }
  }

  const minimumCriteria = schoolDistanceKm !== null ? 1 : 2;
  if (state.criteria < minimumCriteria) return null;

  const confidence = state.criteria >= 5 ? 'high' : state.criteria >= 3 ? 'medium' : 'limited';

  return {
    score: Math.round((state.points / state.weight) * 100),
    explanation: state.explanations.slice(0, 3).join(' · '),
    criteria: state.criteria,
    confidence,
    isSchoolOnly: state.criteria === 1 && schoolDistanceKm !== null,
    schoolDistanceKm,
    breakdown: state.breakdown,
  };
}

export function compareBestMatch(a, b) {
  const aScore = a._match?.score;
  const bScore = b._match?.score;
  if (typeof aScore === 'number' || typeof bScore === 'number') {
    const scoreDiff = (bScore ?? -1) - (aScore ?? -1);
    if (scoreDiff) return scoreDiff;
    const criteriaDiff = (b._match?.criteria ?? 0) - (a._match?.criteria ?? 0);
    if (criteriaDiff) return criteriaDiff;
  }
  const ageDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  if (Math.abs(ageDiff) >= DAY_MS || ageDiff !== 0) return ageDiff;
  return String(a.id).localeCompare(String(b.id));
}

export function compareNearestSchool(a, b) {
  const aDistance = a._match?.schoolDistanceKm;
  const bDistance = b._match?.schoolDistanceKm;
  if (Number.isFinite(aDistance) || Number.isFinite(bDistance)) {
    const distanceDiff = (aDistance ?? Number.POSITIVE_INFINITY) - (bDistance ?? Number.POSITIVE_INFINITY);
    if (distanceDiff) return distanceDiff;
  }
  return compareBestMatch(a, b);
}
