import { haversineKm } from './location-utils.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const AMENITY_VALUES = new Set(['matbutikk', 'kollektivtransport', 'treningssenter', 'grontomrade']);

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
  const savedTags = selectedValues(preferences.priority_tags);
  const savedAmenities = selectedValues(preferences.preferred_amenities);
  const effectiveAmenities = amenityTags.length
    ? amenityTags
    : savedAmenities;
  const effectiveLifestyle = lifestyleTags.length
    ? lifestyleTags
    : savedTags.filter((tag) => !AMENITY_VALUES.has(tag));

  if (String(filters.maxPrice ?? '').trim() && Number.isFinite(maxPrice) && maxPrice > 0) {
    preferences.monthly_budget_max = maxPrice;
  }
  if (filters.propertyType) preferences.preferred_property_types = [String(filters.propertyType)];
  if (filters.preferredOccupation) preferences.occupation = String(filters.preferredOccupation);
  if (filters.moveInDate) preferences.desired_move_in_date = String(filters.moveInDate);
  if (effectiveLifestyle.length || Array.isArray(preferences.priority_tags)) preferences.priority_tags = effectiveLifestyle;
  preferences.preferred_amenities = effectiveAmenities;
  preferences.preferred_lifestyle_tags = effectiveLifestyle;
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
  state.criteria += 1;
  state.verifiedCriteria += 1;
  state.breakdown.push({
    label,
    detail: detail || label,
    percentage: Math.round(normalizedRatio * 100),
    weight,
    status: normalizedRatio >= 0.99 ? 'matched' : normalizedRatio > 0 ? 'partial' : 'mismatch',
  });
  if ((normalizedRatio >= 0.99 || alwaysExplain) && (detail || label)) {
    state.explanations.push(detail || label);
  }
}

function addUnknownCriterion(state, weight, label, detail) {
  state.weight += weight;
  state.criteria += 1;
  state.unknownCriteria += 1;
  state.breakdown.push({
    label,
    detail,
    percentage: null,
    weight,
    status: 'unknown',
  });
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
 * Beregner match fra alle valgte kriterier. Manglende annonsedata vises som
 * «ikke oppgitt» og kan derfor ikke blåse opp prosenten som et gratis treff.
 */
export function computeMatch(listing, profile, context = {}) {
  const school = context?.school;
  if (!listing || (!profile && !school)) return null;
  const preferences = profile || {};
  const schoolLatitude = Number(school?.latitude);
  const schoolLongitude = Number(school?.longitude);
  const hasValidSchool = Boolean(school)
    && Number.isFinite(schoolLatitude) && schoolLatitude >= -90 && schoolLatitude <= 90
    && Number.isFinite(schoolLongitude) && schoolLongitude >= -180 && schoolLongitude <= 180;

  const state = {
    points: 0,
    weight: 0,
    criteria: 0,
    verifiedCriteria: 0,
    unknownCriteria: 0,
    explanations: [],
    breakdown: [],
  };

  const wantedLocation = String(preferences.search_location || '').trim();
  const listingLocations = [listing.city, listing.area]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (wantedLocation) {
    if (listingLocations.length) {
      const ratio = locationMatchRatio(wantedLocation, listingLocations);
      addCriterion(state, 25, ratio, 'Område', ratio === 1 ? 'Riktig område' : 'Utenfor ønsket område');
    } else {
      addUnknownCriterion(state, 25, 'Område', 'Område er ikke oppgitt i annonsen');
    }
  }

  if (Number.isFinite(Number(preferences.monthly_budget_max)) && Number(preferences.monthly_budget_max) > 0) {
    const budget = Number(preferences.monthly_budget_max);
    if (Number.isFinite(Number(listing.price)) && Number(listing.price) > 0) {
      const price = Number(listing.price);
      const ratio = price <= budget ? 1 : Math.max(0, 1 - ((price - budget) / budget) / 0.5);
      addCriterion(state, 35, ratio, 'Budsjett', price <= budget
        ? 'Innenfor budsjett'
        : `${(price - budget).toLocaleString('nb-NO')} kr over månedsbudsjettet`);
    } else {
      addUnknownCriterion(state, 35, 'Budsjett', 'Månedspris er ikke oppgitt i annonsen');
    }
  }

  const preferredTypes = Array.isArray(preferences.preferred_property_types)
    ? preferences.preferred_property_types.filter(Boolean)
    : [];
  if (preferredTypes.length) {
    if (listing.property_type) {
      const matches = preferredTypes.includes(listing.property_type);
      addCriterion(state, 25, matches ? 1 : 0, 'Boligtype', matches ? 'Riktig boligtype' : 'En annen boligtype enn du ønsker');
    } else {
      addUnknownCriterion(state, 25, 'Boligtype', 'Boligtype er ikke oppgitt i annonsen');
    }
  }

  if (preferences.occupation) {
    if (Array.isArray(listing.preferred_occupations)) {
      const accepted = listing.preferred_occupations;
      const matches = !accepted.length || accepted.includes(preferences.occupation);
      addCriterion(state, 15, matches ? 1 : 0, 'Hverdag', matches ? 'Passer din hverdag' : 'Annonsøren ønsker en annen hverdag');
    } else {
      addUnknownCriterion(state, 15, 'Hverdag', 'Ønsket hverdag er ikke oppgitt i annonsen');
    }
  }

  if (preferences.desired_move_in_date) {
    const desired = new Date(`${preferences.desired_move_in_date}T00:00:00`);
    if (Number.isFinite(desired.getTime())) {
      if (listing.move_in_date || listing.move_in_date === null) {
        const available = listing.move_in_date ? new Date(`${listing.move_in_date}T00:00:00`) : null;
        if (!available || Number.isFinite(available.getTime())) {
          const ratio = !available || available <= desired ? 1 : 0;
          addCriterion(state, 15, ratio, 'Innflytting', ratio === 1 ? 'Passer innflyttingen' : 'Ledig senere enn ønsket innflytting');
        } else {
          addUnknownCriterion(state, 15, 'Innflytting', 'Innflyttingsdatoen i annonsen er ugyldig');
        }
      } else {
        addUnknownCriterion(state, 15, 'Innflytting', 'Innflyttingsdato er ikke oppgitt i annonsen');
      }
    }
  }

  const hasTransitPreference = String(preferences.max_transit_minutes ?? '').trim() !== '';
  const hasListingTransit = String(listing.transit_minutes ?? '').trim() !== '';
  const maxTransitMinutes = Number(preferences.max_transit_minutes);
  const transitMinutes = Number(listing.transit_minutes);
  if (hasTransitPreference && Number.isFinite(maxTransitMinutes) && maxTransitMinutes >= 0) {
    if (hasListingTransit && Number.isFinite(transitMinutes) && transitMinutes >= 0) {
      const ratio = transitMinutes <= maxTransitMinutes
        ? 1
        : Math.max(0, 1 - ((transitMinutes - maxTransitMinutes) / Math.max(maxTransitMinutes, 5)));
      addCriterion(state, 20, ratio, 'Kollektivtransport', transitMinutes <= maxTransitMinutes
        ? 'Kort vei til kollektivtransport'
        : `${transitMinutes} min til kollektivtransport · du ønsker maks ${maxTransitMinutes} min`);
    } else {
      addUnknownCriterion(state, 20, 'Kollektivtransport', 'Tid til kollektivtransport er ikke oppgitt i annonsen');
    }
  }

  const priorities = Array.isArray(preferences.priority_tags) ? preferences.priority_tags.filter(Boolean) : [];
  const wantedAmenities = Array.isArray(preferences.preferred_amenities)
    ? selectedValues(preferences.preferred_amenities)
    : selectedValues(priorities.filter((tag) => AMENITY_VALUES.has(tag)));
  const wantedLifestyle = Array.isArray(preferences.preferred_lifestyle_tags)
    ? selectedValues(preferences.preferred_lifestyle_tags)
    : selectedValues(priorities.filter((tag) => !AMENITY_VALUES.has(tag)));
  const tagGroupCount = Number(wantedAmenities.length > 0) + Number(wantedLifestyle.length > 0);
  const tagGroupWeight = tagGroupCount ? 30 / tagGroupCount : 0;

  if (wantedAmenities.length) {
    if (Array.isArray(listing.amenities)) {
      const matches = wantedAmenities.filter((tag) => listing.amenities.includes(tag)).length;
      addCriterion(state, tagGroupWeight, matches / wantedAmenities.length, 'Fasiliteter', `${matches} av ${wantedAmenities.length} valgte fasiliteter oppfylt`);
    } else {
      addUnknownCriterion(state, tagGroupWeight, 'Fasiliteter', 'Fasiliteter er ikke oppgitt i annonsen');
    }
  }

  if (wantedLifestyle.length) {
    if (Array.isArray(listing.lifestyle_tags)) {
      const matches = wantedLifestyle.filter((tag) => listing.lifestyle_tags.includes(tag)).length;
      addCriterion(state, tagGroupWeight, matches / wantedLifestyle.length, 'Boligkvaliteter', `${matches} av ${wantedLifestyle.length} valgte boligkvaliteter oppfylt`);
    } else {
      addUnknownCriterion(state, tagGroupWeight, 'Boligkvaliteter', 'Boligkvaliteter er ikke oppgitt i annonsen');
    }
  }

  let schoolDistanceKm = null;
  if (hasValidSchool) {
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
    } else {
      addUnknownCriterion(state, 40, 'Skoleavstand', 'Annonsen mangler områdekoordinater, så skoleavstanden kan ikke beregnes');
    }
  }

  if (!state.criteria) return null;
  const hasScoreBasis = hasValidSchool || state.criteria >= 2;

  const verificationCoverage = state.criteria
    ? Math.round((state.verifiedCriteria / state.criteria) * 100)
    : 0;
  const confidence = state.verifiedCriteria >= 5 && verificationCoverage >= 80
    ? 'high'
    : state.verifiedCriteria >= 3 && verificationCoverage >= 60
      ? 'medium'
      : 'limited';

  return {
    score: hasScoreBasis && state.verifiedCriteria ? Math.round((state.points / state.weight) * 100) : null,
    explanation: state.explanations.slice(0, 3).join(' · '),
    criteria: state.criteria,
    verifiedCriteria: state.verifiedCriteria,
    unknownCriteria: state.unknownCriteria,
    verificationCoverage,
    confidence,
    hasScoreBasis,
    isSchoolOnly: state.criteria === 1 && hasValidSchool,
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
