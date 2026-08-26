const KARTVERKET_API = 'https://api.kartverket.no/stedsnavn/v1/navn';
const SCHOOL_TYPES = new Set(['Skole', 'Universitet/høgskole']);
const DEFAULT_TIMEOUT_MS = 4500;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('nb-NO')
    .replace(/[^a-z0-9æøå]+/g, ' ')
    .trim();
}

function isValidCoordinate(latitude, longitude) {
  if (latitude === null || latitude === undefined || String(latitude).trim() === '') return false;
  if (longitude === null || longitude === undefined || String(longitude).trim() === '') return false;
  return Number.isFinite(Number(latitude))
    && Number.isFinite(Number(longitude))
    && Number(latitude) >= -90
    && Number(latitude) <= 90
    && Number(longitude) >= -180
    && Number(longitude) <= 180;
}

function toPlace(hit) {
  const latitude = Number(hit?.representasjonspunkt?.nord);
  const longitude = Number(hit?.representasjonspunkt?.øst);
  if (!isValidCoordinate(latitude, longitude)) return null;
  const municipality = hit?.kommuner?.[0]?.kommunenavn || '';
  const county = hit?.fylker?.[0]?.fylkesnavn || '';
  const name = String(hit?.skrivemåte || '').trim();
  if (!name) return null;
  return {
    id: String(hit.stedsnummer || `${name}-${latitude}-${longitude}`),
    name,
    municipality,
    county,
    type: String(hit.navneobjekttype || ''),
    latitude,
    longitude,
    label: [name, municipality].filter(Boolean).join(', '),
  };
}

async function fetchPlaces(query, { signal, limit = 30, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const cleaned = String(query || '').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (cleaned.length < 2) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const url = new URL(KARTVERKET_API);
    url.searchParams.set('sok', `${cleaned}*`);
    url.searchParams.set('fuzzy', 'true');
    url.searchParams.set('treffPerSide', String(Math.min(Math.max(limit, 1), 50)));
    url.searchParams.set('side', '1');
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Kartverket svarte med ${response.status}.`);
    const payload = await response.json();
    return (Array.isArray(payload?.navn) ? payload.navn : []).map(toPlace).filter(Boolean);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function searchSchools(query, options = {}) {
  const places = await fetchPlaces(query, { ...options, limit: 50 });
  const seen = new Set();
  return places.filter((place) => {
    if (!SCHOOL_TYPES.has(place.type)) return false;
    const key = `${place.name}|${place.municipality}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, options.limit || 8);
}

function placeRelevance(place, area, city) {
  const name = normalizeText(place.name);
  const municipality = normalizeText(place.municipality);
  const wantedArea = normalizeText(area);
  const wantedCity = normalizeText(city);
  let score = 0;
  if (wantedArea && name === wantedArea) score += 100;
  else if (wantedArea && name.startsWith(wantedArea)) score += 65;
  else if (wantedArea && name.includes(wantedArea)) score += 40;
  if (wantedCity && (municipality === wantedCity || name === wantedCity)) score += 45;
  if (['Bydel', 'Tettbebyggelse', 'By', 'Kommune', 'Boligfelt'].includes(place.type)) score += 12;
  return score;
}

/**
 * Finner bare et omtrentlig punkt for oppgitt område/by. Gateadresse sendes
 * aldri inn, og en utilgjengelig stedsnavntjeneste skal ikke stoppe publisering.
 */
export async function geocodeListingArea({ area, city }, options = {}) {
  const cleanedArea = String(area || '').trim();
  const cleanedCity = String(city || '').trim();
  if (!cleanedCity) return null;
  const queries = cleanedArea ? [`${cleanedArea} ${cleanedCity}`, cleanedArea, cleanedCity] : [cleanedCity];

  for (const query of [...new Set(queries)]) {
    try {
      const places = await fetchPlaces(query, { ...options, limit: 25 });
      const ranked = places
        .map((place) => ({ place, score: placeRelevance(place, cleanedArea, cleanedCity) }))
        .sort((a, b) => b.score - a.score);
      if (ranked[0]?.place && (ranked[0].score > 0 || !cleanedArea)) {
        return {
          latitude: ranked[0].place.latitude,
          longitude: ranked[0].place.longitude,
          precision: cleanedArea ? 'area' : 'city',
        };
      }
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      // Prøv neste, mindre spesifikke søk. Publisering fortsetter ved feil.
    }
  }
  return null;
}

export function haversineKm(first, second) {
  if (!isValidCoordinate(first?.latitude, first?.longitude) || !isValidCoordinate(second?.latitude, second?.longitude)) return null;
  const lat1 = Number(first?.latitude);
  const lon1 = Number(first?.longitude);
  const lat2 = Number(second?.latitude);
  const lon2 = Number(second?.longitude);
  const radians = (degrees) => degrees * (Math.PI / 180);
  const deltaLat = radians(lat2 - lat1);
  const deltaLon = radians(lon2 - lon1);
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function formatDistance(distanceKm) {
  const distance = Number(distanceKm);
  if (!Number.isFinite(distance)) return '';
  if (distance < 1) return `ca. ${Math.max(50, Math.round((distance * 1000) / 50) * 50)} m`;
  return `ca. ${distance.toLocaleString('nb-NO', { maximumFractionDigits: distance < 10 ? 1 : 0 })} km`;
}
