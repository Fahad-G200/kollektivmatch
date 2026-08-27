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

function locationParts(value) {
  const rawParts = String(value || '').split(/[,/]/);
  const normalized = rawParts.map(normalizeLocation).filter(Boolean);
  const full = normalizeLocation(value);
  return [...new Set([full, ...normalized].filter(Boolean))];
}

function locationMatchRatio(wantedLocation, listingLocations) {
  const wantedParts = locationParts(wantedLocation);
  const availableParts = listingLocations.flatMap(locationParts);
  if (!wantedParts.length || !availableParts.length) return 0;

  return wantedParts.some((wanted) => availableParts.some((available) => {
    if (wanted === available) return true;
    const shorterLength = Math.min(wanted.length, available.length);
    if (shorterLength >= 3 && (wanted.includes(available) || available.includes(wanted))) return true;
    const wantedTokens = new Set(wanted.split(' ').filter((token) => token.length >= 2));
    return available.split(' ').some((token) => wantedTokens.has(token));
  })) ? 1 : 0;
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
  const filterTags = selectedValues([
    ...selectedValues(filters.amenities),
    ...selectedValues(filters.lifestyleTags),
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

function addCriterion(state, weight, ratio, explanation, alwaysExplain = false) {
  state.weight += weight;
  state.points += weight * Math.max(0, Math.min(1, ratio));
  if ((ratio >= 0.99 || alwaysExplain) && explanation) state.explanations.push(explanation);
}

export function schoolProximityRatio(distanceKm) {
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

  const state = { points: 0, weight: 0, criteria: 0, explanations: [] };

  const wantedLocation = String(preferences.search_location || '').trim();
  const listingLocations = [listing.city, listing.area]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (wantedLocation && listingLocations.length) {
    addCriterion(state, 25, locationMatchRatio(wantedLocation, listingLocations), 'Riktig område');
    state.criteria += 1;
  }

  if (Number(preferences.monthly_budget_max) > 0 && Number(listing.price) > 0) {
    const budget = Number(preferences.monthly_budget_max);
    const price = Number(listing.price);
    const ratio = price <= budget ? 1 : Math.max(0, 1 - ((price - budget) / budget) / 0.5);
    addCriterion(state, 35, ratio, 'Innenfor budsjett');
    state.criteria += 1;
  }

  const preferredTypes = Array.isArray(preferences.preferred_property_types)
    ? preferences.preferred_property_types.filter(Boolean)
    : [];
  if (preferredTypes.length && listing.property_type) {
    addCriterion(state, 25, preferredTypes.includes(listing.property_type) ? 1 : 0, 'Riktig boligtype');
    state.criteria += 1;
  }

  if (preferences.occupation) {
    const accepted = Array.isArray(listing.preferred_occupations) ? listing.preferred_occupations : [];
    addCriterion(state, 15, !accepted.length || accepted.includes(preferences.occupation) ? 1 : 0, 'Passer din hverdag');
    state.criteria += 1;
  }

  if (preferences.desired_move_in_date && (listing.move_in_date || listing.move_in_date === null)) {
    const desired = new Date(`${preferences.desired_move_in_date}T00:00:00`);
    const available = listing.move_in_date ? new Date(`${listing.move_in_date}T00:00:00`) : null;
    const ratio = !available || available <= desired ? 1 : 0;
    addCriterion(state, 15, ratio, 'Passer innflyttingen');
    state.criteria += 1;
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
    addCriterion(state, 20, ratio, 'Kort vei til kollektivtransport');
    state.criteria += 1;
  }

  const priorities = Array.isArray(preferences.priority_tags) ? preferences.priority_tags.filter(Boolean) : [];
  const listingTags = [
    ...(Array.isArray(listing.lifestyle_tags) ? listing.lifestyle_tags : []),
    ...(Array.isArray(listing.amenities) ? listing.amenities : []),
  ];
  if (priorities.length && listingTags.length) {
    const matches = priorities.filter((tag) => listingTags.includes(tag)).length;
    addCriterion(state, 30, matches / priorities.length, `${matches} av ${priorities.length} ønsker oppfylt`);
    state.criteria += 1;
  }

  let schoolDistanceKm = null;
  if (school && Number.isFinite(Number(school.latitude)) && Number.isFinite(Number(school.longitude))) {
    schoolDistanceKm = haversineKm(
      { latitude: listing.location_lat, longitude: listing.location_lon },
      { latitude: school.latitude, longitude: school.longitude },
    );
    const proximityRatio = schoolProximityRatio(schoolDistanceKm);
    if (proximityRatio !== null) {
      const roundedDistance = schoolDistanceKm < 10
        ? schoolDistanceKm.toLocaleString('nb-NO', { maximumFractionDigits: 1 })
        : Math.round(schoolDistanceKm).toLocaleString('nb-NO');
      addCriterion(state, 40, proximityRatio, `${roundedDistance} km fra ${school.name || 'valgt skole'}`, true);
      state.criteria += 1;
    }
  }

  const minimumCriteria = schoolDistanceKm !== null ? 1 : 2;
  if (state.criteria < minimumCriteria || state.weight < (minimumCriteria === 1 ? 20 : 35)) return null;

  const confidence = state.criteria >= 5 ? 'high' : state.criteria >= 3 ? 'medium' : 'limited';

  return {
    score: Math.round((state.points / state.weight) * 100),
    explanation: state.explanations.slice(0, 3).join(' · '),
    criteria: state.criteria,
    confidence,
    isSchoolOnly: state.criteria === 1 && schoolDistanceKm !== null,
    schoolDistanceKm,
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
