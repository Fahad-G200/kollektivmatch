import { supabase } from './supabase-config.js';
import { showToast } from './ui.js';
import { selectExampleListings } from './example-listings.js';
import { buildMatchPreferences, computeMatch, compareBestMatch, compareNearestSchool, primaryLocationSearchTerm, locationSearchParts } from './match.js?v=20260827-1';
import { formatDistance } from './location-utils.js?v=20260825-1';
import {
  LISTING_IMAGES_BUCKET,
  PROFILE_AVATARS_BUCKET,
  installImageFallback,
  safePublicMediaUrl,
} from './storage-utils.js?v=20260828-1';

const grid = document.getElementById('listings-grid');
const featuredSection = document.getElementById('featured-results');
const featuredGrid = document.getElementById('featured-listings-grid');
const exampleSection = document.getElementById('example-results');
const exampleGrid = document.getElementById('example-listings-grid');
const loadMoreButton = document.getElementById('load-more-btn');
const PLACEHOLDER_IMG = 'assets/placeholder.svg';
const PAGE_SIZE = 12;
const MAX_CLIENT_RANKED_RESULTS = 500;
let currentFilters = {};
let currentPage = 0;
let requestSequence = 0;
let featuredListingIds = [];

const PROPERTY_LABELS = {
  leilighet: 'Leilighet', hybel: 'Hybel', enebolig: 'Enebolig',
  rekkehus: 'Rekkehus', studentbolig: 'Studentbolig', hytte: 'Hytte', annet: 'Annet',
};

const PIN_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s7-7.58 7-12A7 7 0 0 0 5 10c0 4.42 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>`;
const STAR_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.8L5.7 21l1.7-7L2 9.2l7.1-.6L12 2z"/></svg>`;
const SEARCH_ICON = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="20" y1="20" x2="15.3" y2="15.3"/></svg>`;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character]));
}

function formatPrice(price) {
  return `${new Intl.NumberFormat('nb-NO').format(price)} kr/mnd`;
}

function formatMoveIn(dateString) {
  if (!dateString) return 'Fleksibel innflytting';
  return new Date(`${dateString}T00:00:00`).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isEffectivelyFeatured(listing) {
  return Boolean(listing.is_featured && (!listing.featured_until || new Date(listing.featured_until) > new Date()));
}

function matchLevel(percentage) {
  if (percentage >= 95) return 'Oppfylt';
  if (percentage >= 60) return 'Delvis';
  return 'Lite samsvar';
}

function matchBreakdownTemplate(match) {
  if (!Array.isArray(match?.breakdown) || !match.breakdown.length) return '';
  const rows = match.breakdown.map((item) => {
    const percentage = Math.max(0, Math.min(100, Number(item.percentage) || 0));
    return `
      <li class="match-breakdown-row">
        <div class="match-breakdown-label">
          <span>${escapeHtml(item.label)}</span>
          <span>${percentage}% · ${matchLevel(percentage)}</span>
        </div>
        <progress class="match-breakdown-progress" max="100" value="${percentage}" aria-label="${escapeHtml(item.label)}: ${percentage} prosent"></progress>
        <p>${escapeHtml(item.detail)}</p>
      </li>`;
  }).join('');

  return `
    <details class="match-breakdown-card">
      <summary>Hvorfor ${Number(match.score)} %?</summary>
      <p class="match-breakdown-intro">Prosenten beregnes bare fra opplysninger både du og annonsen har fylt ut.</p>
      <ul>${rows}</ul>
    </details>`;
}

function hasEnoughPreferences(profile) {
  if (!profile) return false;
  return [
    Number(profile.monthly_budget_max) > 0,
    Array.isArray(profile.preferred_property_types) && profile.preferred_property_types.length > 0,
    Boolean(profile.occupation),
    Boolean(profile.desired_move_in_date),
    Array.isArray(profile.priority_tags) && profile.priority_tags.length > 0,
    Boolean(profile.search_location),
    String(profile.max_transit_minutes ?? '').trim() !== ''
      && Number.isFinite(Number(profile.max_transit_minutes)) && Number(profile.max_transit_minutes) >= 0,
  ].filter(Boolean).length >= 2;
}

function renderSkeletons(count = 6) {
  grid.innerHTML = Array.from({ length: count }).map(() => `
    <div class="animate-pulse bg-white rounded-2xl overflow-hidden border border-line" aria-hidden="true">
      <div class="h-44 bg-primary-50"></div>
      <div class="p-4 space-y-3"><div class="h-4 bg-primary-50 rounded-full w-3/4"></div><div class="h-4 bg-primary-50 rounded-full w-1/2"></div></div>
    </div>
  `).join('');
}

function hasActiveFilters(filters = {}) {
  return Boolean(
    filters.city || filters.maxPrice || filters.moveInDate || filters.propertyType
    || filters.preferredOccupation || filters.maxTransitMinutes || filters.schoolName
    || filters.amenities?.length || filters.lifestyleTags?.length,
  );
}

function renderEmptyState(filters) {
  const filtered = hasActiveFilters(filters);
  grid.innerHTML = `
    <div class="col-span-full flex flex-col items-center text-center py-6 text-mist">
      ${SEARCH_ICON}
      <p class="mt-4 font-medium text-ink">${filtered ? 'Fant ingen rom som matcher søket' : 'Ingen aktive annonser akkurat nå'}</p>
      <p class="text-sm mt-1 max-w-md">${filtered
        ? 'Fjern ett eller flere filtre, eller nullstill søket og prøv igjen.'
        : 'KollektivMatch er klar for de første annonsene. Har du et ledig rom, kan du publisere gratis.'}</p>
      <div class="mt-4 flex flex-wrap justify-center gap-2">
        ${filtered
          ? '<a href="index.html#feed" class="px-4 py-2 rounded-xl bg-primary-50 text-primary-700 text-sm font-semibold hover:bg-primary-100">Nullstill alle filtre</a>'
          : '<a href="create-listing.html" class="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700">Legg ut den første annonsen</a>'}
      </div>
    </div>
  `;
}

function cardTemplate(listing) {
  const featuredBadge = isEffectivelyFeatured(listing) ? `
    <span class="absolute top-3 left-3 z-10 bg-primary-600 text-white text-[11px] font-semibold pl-2 pr-2.5 py-1 rounded-full shadow-sm flex items-center gap-1">${STAR_ICON} Fremhevet · kjøpt</span>` : '';
  const matchCriteria = Number(listing._match?.criteria) || 0;
  const matchCriteriaLabel = matchCriteria === 1 ? '1 kriterium' : `${matchCriteria} kriterier`;
  const matchLabel = listing._match?.isSchoolOnly ? 'nærhetsmatch' : 'match';
  const matchTitle = [
    matchCriteria ? `Basert på ${matchCriteriaLabel}` : '',
    listing._match?.confidence === 'limited' ? 'Begrenset grunnlag' : '',
    listing._match?.explanation || '',
  ].filter(Boolean).join(' · ');
  const matchBadge = typeof listing._match?.score === 'number' ? `
    <span class="absolute top-3 right-3 z-10 bg-white/95 text-primary-700 text-[11px] font-semibold px-2.5 py-1 rounded-full shadow-sm" title="${escapeHtml(matchTitle)}">${listing._match.score}% ${matchLabel}</span>` : '';
  const preferencePrompt = listing._needsPreferences ? `
    <a href="dashboard.html#preferences" class="inline-block text-xs font-semibold text-primary-700 hover:underline mt-2">Fullfør preferansene dine</a>` : '';
  const visibleExplanation = String(listing._match?.explanation || '')
    .split(' · ')
    .filter((item) => !item.includes(' km fra '))
    .join(' · ');
  const explanation = visibleExplanation ? `<p class="text-xs text-mist mt-2 line-clamp-2">${escapeHtml(visibleExplanation)}</p>` : '';
  const matchBasis = matchCriteria ? `<p class="mt-1 text-[11px] text-mist/80">Basert på ${escapeHtml(matchCriteriaLabel)}${listing._match?.confidence === 'limited' ? ' · begrenset grunnlag' : ''}</p>` : '';
  const schoolDistance = Number.isFinite(listing._match?.schoolDistanceKm) ? `
    <p class="mt-2 inline-flex items-center gap-1 rounded-lg bg-[#EAF8F0] px-2 py-1 text-[11px] font-semibold text-[#207A45]" title="Omtrentlig luftlinje fra området i annonsen, ikke reisetid">
      ${PIN_ICON}<span>${escapeHtml(formatDistance(listing._match.schoolDistanceKm))} fra ${escapeHtml(listing._schoolName || 'valgt skole')}</span>
    </p>` : '';
  const image = escapeHtml(safePublicMediaUrl(
    listing.images?.[0] || listing.image_url,
    LISTING_IMAGES_BUCKET,
    PLACEHOLDER_IMG,
  ));
  const title = escapeHtml(listing.title);
  const city = escapeHtml(listing.city);
  const area = listing.area ? `${escapeHtml(listing.area)}, ` : '';
  const propertyType = listing.property_type ? `<span class="text-xs text-mist">${escapeHtml(PROPERTY_LABELS[listing.property_type] || listing.property_type)}</span>` : '';
  const ownerName = escapeHtml(listing._ownerProfile?.full_name || 'KollektivMatch-bruker');
  const ownerInitials = escapeHtml((listing._ownerProfile?.full_name || 'KM').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'KM');
  const ownerPhotoUrl = safePublicMediaUrl(listing._ownerProfile?.avatar_url, PROFILE_AVATARS_BUCKET);
  const ownerPhoto = ownerPhotoUrl
    ? `<img src="${escapeHtml(ownerPhotoUrl)}" class="listing-owner-photo w-full h-full object-cover" alt="Profilbilde av ${ownerName}" /><span class="listing-owner-initials hidden" aria-hidden="true">${ownerInitials}</span>`
    : `<span class="listing-owner-initials" aria-hidden="true">${ownerInitials}</span>`;
  const verified = [
    listing._ownerProfile?.is_verified
      ? '<span class="text-[10px] font-semibold text-[#5A3EC2] bg-[#F4F2FF] px-2 py-0.5 rounded-full">✓ Utdannings-e-post</span>' : '',
  ].join('');
  const matchBreakdown = matchBreakdownTemplate(listing._match);

  return `
    <article class="listing-card bg-white rounded-2xl overflow-hidden border border-line hover:shadow-lg hover:shadow-ink/5 transition-all relative">
      ${listing._example ? '<span class="example-badge">Eksempel</span>' : featuredBadge}${matchBadge}
      <a href="listing-detail.html?id=${encodeURIComponent(listing.id)}" class="group block">
        <div class="h-44 overflow-hidden bg-primary-50">
          ${listing._example
            ? `<div class="w-full h-full" data-property-art="${escapeHtml(listing._art)}" role="img" aria-label="Illustrasjonsbilde av en eksempelbolig"></div>`
            : `<img src="${image}" alt="${title}" loading="lazy" class="listing-card-image w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-300" />`}
        </div>
        <div class="p-4">
          <div class="flex items-start justify-between gap-2"><h3 class="listing-card-title text-ink">${title}</h3>${propertyType}</div>
          <p class="listing-card-price text-primary-600 font-bold mt-1">${formatPrice(listing.price)}</p>
          <div class="flex items-center gap-1.5 mt-3 text-sm text-mist">${PIN_ICON}<span>${area}${city}</span></div>
          <p class="text-xs text-mist/80 mt-1">Innflytting: ${formatMoveIn(listing.move_in_date)}</p>
          ${schoolDistance}
          ${explanation}
          ${matchBasis}
          ${listing._example ? '<p class="mt-4 pt-3 border-t border-line text-sm text-mist">Oppdiktet bolig · kan ikke leies</p>' : `<div class="listing-owner-row mt-4 pt-3 border-t border-line/80 flex items-center gap-2.5">
            <span class="listing-owner-avatar">${ownerPhoto}</span>
            <span class="min-w-0 text-xs font-semibold text-ink truncate">${ownerName}</span>
            ${verified}
          </div>`}
        </div>
      </a>
      ${matchBreakdown}
      <div class="px-4 pb-4 flex items-center justify-between gap-3">
        <span>${listing._example && !listing._match ? '<a href="#filter-form" class="text-sm text-primary-700 font-semibold">Velg preferanser for match</a>' : preferencePrompt}</span>
        <button type="button" data-share-example="${listing._example === true}" data-share-listing="${escapeHtml(listing.id)}" data-share-title="${title}" data-share-city="${city}" data-share-price="${escapeHtml(listing.price)}" class="listing-share-button" aria-label="Del ${title}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>
          Del
        </button>
      </div>
    </article>
  `;
}

function renderExamples(filters, preferences, school) {
  if (!exampleSection || !exampleGrid) return;
  const examples = selectExampleListings(filters, preferences, school);
  exampleSection.classList.remove('hidden');
  document.getElementById('example-count').textContent = `${examples.length} ${examples.length === 1 ? 'eksempel' : 'eksempler'}`;
  exampleGrid.innerHTML = examples.length ? examples.map(cardTemplate).join('')
    : '<p class="col-span-full py-4 text-sm text-mist">Ingen eksempelboliger passer alle filtrene. Prøv et større budsjett eller færre filtre.</p>';
}

async function shareListing(button) {
  const shareUrl = new URL(`listing-detail.html?id=${encodeURIComponent(button.dataset.shareListing)}`, document.baseURI).toString();
  const title = button.dataset.shareTitle || 'Boligannonse';
  const examplePrefix = button.dataset.shareExample === 'true' ? 'Eksempelbolig – kan ikke leies. ' : '';
  const city = button.dataset.shareCity || '';
  const price = Number(button.dataset.sharePrice);
  const shareData = {
    title: `${examplePrefix}${title} – KollektivMatch`,
    text: `${examplePrefix}${title}${city ? ` i ${city}` : ''}${Number.isFinite(price) ? ` · ${new Intl.NumberFormat('nb-NO').format(price)} kr/mnd` : ''}`,
    url: shareUrl,
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
    await navigator.clipboard.writeText(shareUrl);
    showToast('Lenken til annonsen er kopiert.', 'success');
  } catch (error) {
    if (error?.name !== 'AbortError') showToast('Kunne ikke dele annonsen. Åpne annonsen og kopier adressen.', 'error');
  }
}

function installShareHandler(root) {
  root?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-share-listing]');
    if (button) shareListing(button);
  });
}

installShareHandler(grid);
installShareHandler(featuredGrid);
installShareHandler(exampleGrid);

function installOwnerAvatarFallbacks(root) {
  root.querySelectorAll('.listing-owner-photo').forEach((image) => {
    image.addEventListener('error', () => {
      image.classList.add('hidden');
      image.nextElementSibling?.classList.remove('hidden');
    }, { once: true });
  });
}

async function attachOwnerProfiles(listings) {
  const userIds = [...new Set(listings.map((listing) => listing.user_id).filter(Boolean))];
  if (!userIds.length) return;
  let { data, error } = await supabase.from('profiles').select('id, full_name, avatar_url, is_verified').in('id', userIds);
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', userIds));
  }
  if (error) {
    console.warn('Kunne ikke hente offentlige profilbilder:', error.message);
    return;
  }
  const profiles = new Map((data || []).map((profile) => [profile.id, profile]));
  listings.forEach((listing) => { listing._ownerProfile = profiles.get(listing.user_id) || null; });
}

function sanitizeSearchTerm(value) {
  return String(value || '').replace(/[,()%_"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function applyFilters(query, filters) {
  for (const part of locationSearchParts(filters.city)) {
    const locationTerm = sanitizeSearchTerm(part);
    if (locationTerm) query = query.or(`city.ilike.%${locationTerm}%,area.ilike.%${locationTerm}%`);
  }
  if (filters.maxPrice) query = query.lte('price', Number(filters.maxPrice));
  if (filters.moveInDate) query = query.or(`move_in_date.is.null,move_in_date.lte.${filters.moveInDate}`);
  if (filters.propertyType) query = query.eq('property_type', filters.propertyType);
  if (filters.preferredOccupation && ['student', 'jobb', 'annet'].includes(filters.preferredOccupation)) {
    query = query.or(`preferred_occupations.eq.{},preferred_occupations.cs.{${filters.preferredOccupation}}`);
  }
  if (filters.maxTransitMinutes) query = query.lte('transit_minutes', Number(filters.maxTransitMinutes));
  if (filters.amenities?.length) query = query.contains('amenities', filters.amenities);
  if (filters.lifestyleTags?.length) query = query.contains('lifestyle_tags', filters.lifestyleTags);
  return query;
}

function applySorting(query, sortBy) {
  switch (sortBy) {
    case 'price_low': return query.order('price', { ascending: true }).order('created_at', { ascending: false });
    case 'price_high': return query.order('price', { ascending: false }).order('created_at', { ascending: false });
    case 'move_in_soon': return query.order('move_in_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
    case 'nearest_school': return query.order('created_at', { ascending: false });
    default: return query.order('created_at', { ascending: false });
  }
}

function isMissingColumnError(error) {
  return error?.code === 'PGRST204'
    || error?.code === '42703'
    || /column.+does not exist|could not find.+column.+schema cache/i.test(error?.message || '');
}

function applyLegacyFilters(query, filters) {
  const legacyFilters = {
    ...filters,
    propertyType: '',
    preferredOccupation: '',
    maxTransitMinutes: '',
    amenities: [],
    lifestyleTags: [],
  };
  return applyFilters(query, legacyFilters);
}

async function fetchPage(filters, page, append) {
  const sequence = ++requestSequence;
  let pageFeaturedIds = append ? [...featuredListingIds] : [];
  const school = filters.schoolName && Number.isFinite(Number(filters.schoolLat)) && Number.isFinite(Number(filters.schoolLon))
    ? { name: filters.schoolName, latitude: Number(filters.schoolLat), longitude: Number(filters.schoolLon) }
    : null;
  let propertyTypeUnavailable = false;
  if (!append) {
    renderSkeletons();
    renderExamples(filters, buildMatchPreferences(null, filters), school);
    featuredSection.classList.add('hidden');
    featuredGrid.innerHTML = '';
  }
  loadMoreButton.disabled = true;
  loadMoreButton.textContent = append ? 'Laster...' : 'Vis flere';

  let user = null;
  try { ({ data: { user } } = await supabase.auth.getUser()); }
  catch { /* Browsing and local examples remain available without an auth response. */ }
  let profile = null;
  if (user) {
    const { data: profileData } = await supabase.rpc('get_my_profile');
    profile = Array.isArray(profileData) ? profileData[0] : profileData;
  }
  if (sequence !== requestSequence) return { stale: true };
  const matchPreferences = buildMatchPreferences(profile, filters);
  if (!append) renderExamples(filters, matchPreferences, school);
  const profileComplete = hasEnoughPreferences(profile);
  const matchPreferencesComplete = hasEnoughPreferences(matchPreferences);
  const bestMatchSorting = !filters.sortBy || filters.sortBy === 'best_match';
  const rankAllSchoolResults = Boolean(school && (bestMatchSorting || filters.sortBy === 'nearest_school'));
  const rankAllMatchResults = Boolean(bestMatchSorting && (matchPreferencesComplete || school));
  const rankAllResults = rankAllSchoolResults || rankAllMatchResults;

  const columns = 'id, user_id, title, description, price, city, area, location_lat, location_lon, location_precision, move_in_date, images, image_url, roommates_info, lifestyle_tags, amenities, preferred_occupations, transit_minutes, grocery_nearby, gym_nearby, green_areas_nearby, property_type, room_size_m2, deposit_amount, furnished, rent_includes, is_featured, featured_until, created_at, updated_at';
  const legacyColumns = 'id, user_id, title, description, price, city, area, move_in_date, image_url, roommates_info, is_featured, featured_until, created_at';
  let featuredData = [];
  if (!append && (!filters.sortBy || filters.sortBy === 'best_match')) {
    let featuredQuery = supabase.from('listings').select(columns).eq('status', 'active')
      .eq('is_featured', true).gt('featured_until', new Date().toISOString());
    featuredQuery = applyFilters(featuredQuery, filters).order('featured_until', { ascending: false }).limit(6);
    const featuredResult = await featuredQuery;
    if (sequence !== requestSequence) return { stale: true };
    if (!featuredResult.error) {
      featuredData = featuredResult.data || [];
      pageFeaturedIds = featuredData.map((listing) => listing.id);
    } else {
      pageFeaturedIds = [];
    }
  } else if (!append) {
    pageFeaturedIds = [];
  }

  let query = supabase.from('listings').select(columns, { count: 'exact' }).eq('status', 'active');
  query = applyFilters(query, filters);
  if (pageFeaturedIds.length) query = query.not('id', 'in', `(${pageFeaturedIds.join(',')})`);
  query = applySorting(query, filters.sortBy);
  query = rankAllResults
    ? query.range(0, MAX_CLIENT_RANKED_RESULTS - 1)
    : query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

  let { data, error, count } = await query;
  if (error && isMissingColumnError(error)) {
    propertyTypeUnavailable = true;
    let legacyQuery = supabase.from('listings').select(legacyColumns, { count: 'exact' }).eq('status', 'active');
    legacyQuery = applyLegacyFilters(legacyQuery, filters);
    legacyQuery = applySorting(legacyQuery, filters.sortBy);
    legacyQuery = rankAllResults
      ? legacyQuery.range(0, MAX_CLIENT_RANKED_RESULTS - 1)
      : legacyQuery.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    ({ data, error, count } = await legacyQuery);
    featuredData = [];
    pageFeaturedIds = [];
  }
  if (sequence !== requestSequence) return { stale: true };

  loadMoreButton.disabled = false;
  loadMoreButton.textContent = 'Vis flere';

  if (error) {
    console.error('Kunne ikke hente annonser:', error.message);
    showToast('Klarte ikke å hente annonser. Prøv igjen.', 'error');
    if (!append) grid.innerHTML = '<p class="col-span-full text-center text-mist py-12">Noe gikk galt underveis. Prøv å laste siden på nytt.</p>';
    const resultSummary = document.getElementById('results-summary');
    if (resultSummary && !append) resultSummary.textContent = 'Kunne ikke hente annonser';
    return { error: true, propertyTypeUnavailable };
  }

  (data || []).forEach((listing) => {
    if (matchPreferencesComplete || school) listing._match = computeMatch(listing, matchPreferences, { school });
    listing._schoolName = school?.name || '';
    listing._needsPreferences = Boolean(user && !profileComplete);
  });
  featuredData.forEach((listing) => {
    if (matchPreferencesComplete || school) listing._match = computeMatch(listing, matchPreferences, { school });
    listing._schoolName = school?.name || '';
    listing._needsPreferences = Boolean(user && !profileComplete);
  });

  if (bestMatchSorting && (matchPreferencesComplete || school)) data.sort(compareBestMatch);
  if (filters.sortBy === 'nearest_school' && school) data.sort(compareNearestSchool);
  if (rankAllResults) data = data.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  await attachOwnerProfiles([...(data || []), ...featuredData]);
  if (sequence !== requestSequence) return { stale: true };
  featuredListingIds = pageFeaturedIds;

  if (!append) {
    exampleSection?.classList.toggle('hidden', data.length > 0 || featuredData.length > 0);
    featuredSection.classList.toggle('hidden', featuredData.length === 0);
    featuredGrid.innerHTML = featuredData.map(cardTemplate).join('');
    featuredGrid.querySelectorAll('.listing-card-image').forEach((image) => installImageFallback(image, PLACEHOLDER_IMG));
    installOwnerAvatarFallbacks(featuredGrid);
  }

  if (!append && !data.length && !featuredData.length) {
    renderEmptyState(filters);
  } else if (!append && !data.length) {
    grid.innerHTML = '<p class="col-span-full text-center text-sm text-mist py-8">Ingen flere ordinære annonser matcher søket.</p>';
  } else if (append) {
    grid.insertAdjacentHTML('beforeend', data.map(cardTemplate).join(''));
  } else {
    grid.innerHTML = data.map(cardTemplate).join('');
  }

  grid.querySelectorAll('.listing-card-image').forEach((image) => installImageFallback(image, PLACEHOLDER_IMG));
  installOwnerAvatarFallbacks(grid);
  const resultSummary = document.getElementById('results-summary');
  const totalCount = (count || 0) + pageFeaturedIds.length;
  const rankingIsCapped = rankAllResults && (count || 0) > MAX_CLIENT_RANKED_RESULTS;
  if (resultSummary) {
    resultSummary.textContent = rankingIsCapped
      ? `${totalCount} annonser · Smart Match rangerer de ${MAX_CLIENT_RANKED_RESULTS} nyeste ordinære treffene`
      : `${totalCount} ${totalCount === 1 ? 'annonse' : 'annonser'}`;
  }
  const availableCount = rankAllResults ? Math.min(count || 0, MAX_CLIENT_RANKED_RESULTS) : (count || 0);
  loadMoreButton.classList.toggle('hidden', (page + 1) * PAGE_SIZE >= availableCount);
  return { propertyTypeUnavailable };
}

export async function loadListings(filters = {}) {
  currentFilters = { ...filters, sortBy: filters.sortBy || 'best_match' };
  currentPage = 0;
  const result = await fetchPage(currentFilters, currentPage, false);
  if (result?.propertyTypeUnavailable) currentFilters.propertyType = '';
  return result;
}

export async function loadMoreListings() {
  const nextPage = currentPage + 1;
  const result = await fetchPage(currentFilters, nextPage, true);
  if (!result?.error && !result?.stale) currentPage = nextPage;
  return result;
}

export async function populateCitySuggestions() {
  const datalist = document.getElementById('city-suggestions');
  if (!datalist) return;
  const commonCities = ['Oslo', 'Bergen', 'Trondheim', 'Stavanger', 'Tromsø', 'Kristiansand', 'Ås', 'Bodø', 'Drammen', 'Fredrikstad'];
  let { data, error } = await supabase.from('listings').select('city').eq('status', 'active').limit(500);
  if (error && isMissingColumnError(error)) {
    ({ data } = await supabase.from('listings').select('city').limit(500));
  }
  const cities = [...new Set([...commonCities, ...(data || []).map((row) => row.city).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'nb'));
  datalist.innerHTML = cities.map((city) => `<option value="${escapeHtml(city)}"></option>`).join('');
}
