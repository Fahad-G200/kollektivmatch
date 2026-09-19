const LIFESTYLE_VALUES = new Set(['stort-rom', 'moderne-stil', 'nyoppusset-bad', 'rolig-miljo', 'stort-kjokken']);
const AMENITY_VALUES = new Set(['matbutikk', 'kollektivtransport', 'treningssenter', 'grontomrade']);

function selected(values, allowed) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter((value) => allowed.has(value)))];
}

function coordinate(value, min, max) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function analysisFiltersFromSearch(search = '') {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const latitude = coordinate(params.get('schoolLat'), -90, 90);
  const longitude = coordinate(params.get('schoolLon'), -180, 180);
  const schoolName = String(params.get('schoolName') || '').trim().slice(0, 160);
  const maxTransit = params.has('maxTransitMinutes') ? Number(params.get('maxTransitMinutes')) : null;
  return {
    city: String(params.get('city') || '').trim().slice(0, 100),
    maxPrice: String(params.get('maxPrice') || ''),
    moveInDate: String(params.get('moveInDate') || ''),
    propertyType: String(params.get('propertyType') || ''),
    preferredOccupation: String(params.get('preferredOccupation') || ''),
    maxTransitMinutes: Number.isInteger(maxTransit) && maxTransit >= 0 && maxTransit <= 600 ? String(maxTransit) : '',
    amenities: selected(params.getAll('amenities'), AMENITY_VALUES),
    lifestyleTags: selected(params.getAll('lifestyleTags'), LIFESTYLE_VALUES),
    schoolName: latitude !== null && longitude !== null ? schoolName : '',
    schoolLat: latitude ?? '',
    schoolLon: longitude ?? '',
  };
}

export function selectedSchoolFromFilters(filters = {}) {
  const latitude = coordinate(filters.schoolLat, -90, 90);
  const longitude = coordinate(filters.schoolLon, -180, 180);
  const name = String(filters.schoolName || '').trim().slice(0, 160);
  return name && latitude !== null && longitude !== null ? { name, latitude, longitude } : null;
}

export function analysisRequestBody(listingId, preferences = {}, school = null) {
  const lifestyle = selected(
    preferences.preferred_lifestyle_tags || preferences.priority_tags,
    LIFESTYLE_VALUES,
  );
  const amenities = selected(preferences.preferred_amenities, AMENITY_VALUES);
  const transit = coordinate(preferences.max_transit_minutes, 0, 600);
  const schoolLatitude = coordinate(school?.latitude, -90, 90);
  const schoolLongitude = coordinate(school?.longitude, -180, 180);
  const schoolName = String(school?.name || '').trim().slice(0, 160);
  const validSchool = schoolName && schoolLatitude !== null && schoolLongitude !== null;
  return {
    listing_id: String(listingId || ''),
    lifestyle_tags: lifestyle,
    amenities,
    max_transit_minutes: transit,
    school: validSchool ? { name: schoolName, latitude: schoolLatitude, longitude: schoolLongitude } : null,
  };
}

export function formatMeters(value) {
  const meters = Number(value);
  if (!Number.isFinite(meters) || meters < 0) return 'ukjent avstand';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toLocaleString('nb-NO', { maximumFractionDigits: 1 })} km`;
}
