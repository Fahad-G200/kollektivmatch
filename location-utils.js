const KARTVERKET_API = 'https://api.kartverket.no/stedsnavn/v1/navn';
const SCHOOL_TYPES = new Set(['Skole', 'Universitet/høgskole']);
const DEFAULT_TIMEOUT_MS = 4500;
const HIGHER_EDUCATION_SEARCHES = [
  { query: 'Universitetet i Oslo', aliases: ['uio', 'universitetet oslo', 'oslo universitet'] },
  { query: 'Universitetet i Bergen', aliases: ['uib', 'bergen universitet'] },
  { query: 'UiT Norges arktiske universitet', aliases: ['uit', 'tromso universitet', 'tromsø universitet'] },
  { query: 'NTNU', aliases: ['ntnu', 'trondheim universitet'] },
  { query: 'Norges miljø- og biovitenskapelige universitet', aliases: ['nmbu', 'as universitet', 'ås universitet'] },
  { query: 'Universitetet i Agder', aliases: ['uia', 'agder universitet'] },
  { query: 'Universitetet i Sørøst-Norge', aliases: ['usn', 'sorost norge universitet', 'sørøst norge universitet'] },
  { query: 'Universitetet i Innlandet', aliases: ['inn', 'innlandet universitet'] },
  { query: 'Nord universitet', aliases: ['nord universitet'] },
  { query: 'OsloMet - storbyuniversitetet', aliases: ['oslomet', 'oslo met', 'storbyuniversitetet'] },
  { query: 'Norges Handelshøyskole', aliases: ['nhh', 'handelshoyskolen bergen', 'handelshøyskolen bergen'] },
  { query: 'Høgskulen på Vestlandet', aliases: ['hvl', 'vestlandet hogskule', 'vestlandet høgskule'] },
  { query: 'Høgskolen i Molde', aliases: ['himolde', 'him', 'molde hogskole', 'molde høgskole'] },
  { query: 'Kunsthøgskolen i Oslo', aliases: ['khio', 'kunsthogskolen oslo', 'kunsthøgskolen oslo'] },
  { query: 'VID vitenskapelige høgskole', aliases: ['vid', 'vid hogskole', 'vid høgskole'] },
  { query: 'Høyskolen Kristiania', aliases: ['kristiania', 'hoyskolen kristiania', 'høyskolen kristiania'] },
];

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

export function schoolSearchQueries(query, maxQueries = 4) {
  const cleaned = String(query || '').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  const normalized = normalizeText(cleaned);
  if (normalized.length < 2) return [];

  const expanded = HIGHER_EDUCATION_SEARCHES
    .map((entry) => ({
      ...entry,
      terms: [entry.query, ...entry.aliases].map(normalizeText),
    }))
    .filter((entry) => entry.terms.some((term) => term === normalized
      || term.startsWith(normalized)
      || (normalized.length >= 3 && term.includes(normalized))))
    .sort((first, second) => {
      const firstExact = first.terms.includes(normalized) ? 1 : 0;
      const secondExact = second.terms.includes(normalized) ? 1 : 0;
      return secondExact - firstExact;
    })
    .map((entry) => entry.query);

  return [...new Set([...expanded, cleaned])].slice(0, Math.max(1, maxQueries));
}

function schoolRelevance(place, originalQuery, searches) {
  const name = normalizeText(place.name);
  const original = normalizeText(originalQuery);
  let score = 0;
  if (name === original) score += 500;
  else if (name.startsWith(original)) score += 320;
  else if (original.length >= 3 && name.includes(original)) score += 220;

  searches.forEach((search, index) => {
    const expanded = normalizeText(search);
    const priority = Math.max(0, 40 - (index * 5));
    if (name === expanded) score += 400 + priority;
    else if (name.startsWith(expanded)) score += 260 + priority;
    else if (expanded.length >= 3 && name.includes(expanded)) score += 160 + priority;
  });
  return score;
}

export async function searchSchools(query, options = {}) {
  const searches = schoolSearchQueries(query);
  if (!searches.length) return [];
  const resultSets = await Promise.all(searches.map(async (search) => {
    try {
      return await fetchPlaces(search, { ...options, limit: 50 });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return [];
    }
  }));
  const seen = new Set();
  return resultSets.flat()
    .filter((place) => SCHOOL_TYPES.has(place.type))
    .sort((first, second) => schoolRelevance(second, query, searches) - schoolRelevance(first, query, searches))
    .filter((place) => {
      const key = `${normalizeText(place.name)}|${normalizeText(place.municipality)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, options.limit || 8);
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
