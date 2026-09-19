import { computeMatch, compareBestMatch, compareNearestSchool, matchesLocation } from './match.js?v=20260912-2';

// Local, explicitly fictional examples. Never insert these into the live database
// or give them a user_id: there is no landlord to contact or payment to start.
const examples = [
  { id: 'example-oslo', title: 'Lyst rom med plass til hverdagen', city: 'Oslo', area: 'Blindern', price: 7900, property_type: 'leilighet', room_size_m2: 14, _art: 'apartment', location_lat: 59.94, location_lon: 10.72, transit_minutes: 8, preferred_occupations: ['student'], lifestyle_tags: ['rolig-miljo', 'stort-kjokken'], amenities: ['matbutikk', 'kollektivtransport', 'grontomrade'], furnished: true, rent_includes: ['internett', 'vann'], description: 'Et oppdiktet rom i en lys leilighet med felles kjøkken og stue. Eksemplet passer for å prøve studentliv, budsjett og nærhet til Blindern.' },
  { id: 'example-bergen', title: 'Byliv og et kjøkken å samles på', city: 'Bergen', area: 'Sentrum', price: 9200, property_type: 'leilighet', room_size_m2: 17, _art: 'apartment', location_lat: 60.39, location_lon: 5.32, transit_minutes: 5, preferred_occupations: ['student', 'jobb'], lifestyle_tags: ['moderne-stil', 'nyoppusset-bad', 'stort-kjokken'], amenities: ['matbutikk', 'kollektivtransport', 'treningssenter'], furnished: true, rent_includes: ['strom', 'internett'], description: 'En oppdiktet delt leilighet med et ledig rom, felles spiseplass og korte avstander i sentrum. Prøv hvordan pris og fasiliteter påvirker matchen.' },
  { id: 'example-trondheim', title: 'Et enkelt studentrom nær campus', city: 'Trondheim', area: 'Gløshaugen', price: 5600, property_type: 'studentbolig', room_size_m2: 12, _art: 'apartment', location_lat: 63.42, location_lon: 10.40, transit_minutes: 5, preferred_occupations: ['student'], lifestyle_tags: ['rolig-miljo'], amenities: ['matbutikk', 'kollektivtransport'], furnished: false, rent_includes: ['strom', 'vann', 'internett'], description: 'Et oppdiktet studentrom med delt kjøkken. Dette rimeligere eksemplet gjør det lett å sammenligne budsjett, boligtype og skoleavstand.' },
  { id: 'example-tromso', title: 'Rom i et hus med hage', city: 'Tromsø', area: 'Tromsdalen', price: 6800, property_type: 'enebolig', room_size_m2: 18, _art: 'house', location_lat: 69.64, location_lon: 19.00, transit_minutes: 15, preferred_occupations: ['jobb', 'student'], lifestyle_tags: ['stort-rom', 'stort-kjokken', 'rolig-miljo'], amenities: ['kollektivtransport', 'grontomrade'], furnished: true, rent_includes: ['internett'], description: 'Et oppdiktet rom i et delt hus med hage og romslige fellesarealer. Prøv å prioritere ro, grøntområder og plass.' },
  { id: 'example-stavanger', title: 'Rolig hjem med plass til flere', city: 'Stavanger', area: 'Hundvåg', price: 6200, property_type: 'rekkehus', room_size_m2: 15, _art: 'house', location_lat: 58.99, location_lon: 5.73, transit_minutes: 20, preferred_occupations: [], lifestyle_tags: ['rolig-miljo', 'stort-rom'], amenities: ['grontomrade', 'matbutikk'], furnished: false, rent_includes: ['oppvarming'], description: 'Et oppdiktet rom i et rekkehus utenfor sentrum. Eksemplet har ingen preferanse for om den som flytter inn studerer eller jobber.' },
  { id: 'example-lillehammer', title: 'En liten hytte nær skog og stillhet', city: 'Lillehammer', area: 'Nordseter', price: 8500, property_type: 'hytte', room_size_m2: 35, _art: 'cabin', location_lat: 61.18, location_lon: 10.61, transit_minutes: 30, preferred_occupations: [], lifestyle_tags: ['rolig-miljo'], amenities: ['grontomrade'], furnished: true, rent_includes: ['internett', 'vann'], description: 'En oppdiktet hytte for et lengre opphold, med et lite kjøkken og natur i nærheten. Prøv å sammenligne ro og plass med avstand til kollektivtransport.' },
];

function materialize(example) {
  return { ...example, _example: true, user_id: null, status: 'example', move_in_date: null,
    deposit_amount: example.price, roommates_info: 'Ingen ekte beboere. Dette er en eksempelbolig.',
    created_at: '2026-09-07T00:00:00Z', updated_at: '2026-09-07T00:00:00Z',
    location_precision: 'area', images: [], is_featured: false,
    grocery_nearby: example.amenities.includes('matbutikk'),
    gym_nearby: example.amenities.includes('treningssenter'),
    green_areas_nearby: example.amenities.includes('grontomrade') };
}

export function getExampleListing(id) {
  const example = examples.find((item) => item.id === id);
  return example ? materialize(example) : null;
}

export function selectExampleListings(filters = {}, preferences = {}, school = null) {
  const listings = examples.map(materialize).filter((listing) => {
    if (filters.city && !matchesLocation(filters.city, [listing.city, listing.area])) return false;
    if (String(filters.maxPrice ?? '').trim() && Number.isFinite(Number(filters.maxPrice)) && listing.price > Number(filters.maxPrice)) return false;
    if (filters.propertyType && listing.property_type !== filters.propertyType) return false;
    if (filters.preferredOccupation && listing.preferred_occupations.length && !listing.preferred_occupations.includes(filters.preferredOccupation)) return false;
    if (String(filters.maxTransitMinutes ?? '').trim() && listing.transit_minutes > Number(filters.maxTransitMinutes)) return false;
    if (filters.amenities?.some((value) => !listing.amenities.includes(value))) return false;
    if (filters.lifestyleTags?.some((value) => !listing.lifestyle_tags.includes(value))) return false;
    return true;
  }).map((listing) => ({ ...listing, _match: computeMatch(listing, preferences, { school }), _schoolName: school?.name || '' }));
  if (filters.sortBy === 'price_low') listings.sort((a, b) => a.price - b.price);
  else if (filters.sortBy === 'price_high') listings.sort((a, b) => b.price - a.price);
  else if (filters.sortBy === 'nearest_school' && school) listings.sort(compareNearestSchool);
  else if (!filters.sortBy || filters.sortBy === 'best_match') listings.sort(compareBestMatch);
  return listings;
}
