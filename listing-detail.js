import { supabase } from './supabase-config.js';
import { rememberReturnTo } from './auth.js';
import { showToast } from './ui.js';
import { getExampleListing } from './example-listings.js';
import { buildMatchPreferences, computeMatch } from './match.js?v=20260912-2';
import {
  analysisFiltersFromSearch,
  analysisRequestBody,
  formatMeters,
  selectedSchoolFromFilters,
} from './listing-analysis.js?v=20260912-1';
import {
  LISTING_IMAGES_BUCKET,
  LISTING_VIDEOS_BUCKET,
  PROFILE_AVATARS_BUCKET,
  installImageFallback,
  safePublicMediaUrl,
} from './storage-utils.js?v=20260828-1';

const id = new URLSearchParams(window.location.search).get('id');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLACEHOLDER_IMG = 'assets/placeholder.svg';
const PROPERTY_LABELS = { leilighet: 'Leilighet', hybel: 'Hybel', enebolig: 'Enebolig', rekkehus: 'Rekkehus', studentbolig: 'Studentbolig', hytte: 'Hytte', annet: 'Annet' };
const TAG_LABELS = { 'stort-rom': 'Stort rom / plass', 'moderne-stil': 'Moderne stil', 'nyoppusset-bad': 'Nyoppusset bad', 'rolig-miljo': 'Rolig miljø', 'stort-kjokken': 'Stort kjøkken / sosiale soner' };
const AMENITY_LABELS = { matbutikk: 'Matbutikk', kollektivtransport: 'Kollektivtransport', treningssenter: 'Treningssenter', grontomrade: 'Grøntområder' };
const INCLUDED_LABELS = { strom: 'Strøm', internett: 'Internett', oppvarming: 'Oppvarming', vann: 'Vann' };
const analysisFilters = analysisFiltersFromSearch(window.location.search);
const analysisSchool = selectedSchoolFromFilters(analysisFilters);
let viewer = null;
let listing = null;
let contactLoadError = false;
let effectiveAnalysisPreferences = {};
let analysisPrepared = false;

function isMissingColumnError(error) {
  return error?.code === 'PGRST204'
    || error?.code === '42703'
    || /column.+does not exist|could not find.+column.+schema cache/i.test(error?.message || '');
}

function isMissingReportsError(error) {
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || /relation.+reports.+does not exist|could not find.+reports/i.test(error?.message || '');
}

function isMissingFunctionError(error) {
  return error?.code === 'PGRST202' || error?.code === '42883'
    || /function.+does not exist|could not find.+function.+schema cache/i.test(error?.message || '');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
}

function renderPills(targetId, values, labels) {
  const container = document.getElementById(targetId);
  container.innerHTML = '';
  if (!Array.isArray(values) || !values.length) {
    const empty = document.createElement('span');
    empty.className = 'text-sm text-[#6B667E]';
    empty.textContent = 'Ikke oppgitt';
    container.appendChild(empty);
    return;
  }
  values.forEach((value) => {
    const pill = document.createElement('span');
    pill.className = 'px-3 py-1 rounded-full bg-[#F4F2FF] text-[#6C4CE0] text-xs font-semibold';
    pill.textContent = labels[value] || value;
    container.appendChild(pill);
  });
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fieldMatchState(item) {
  if (item.status === 'unknown' || item.percentage === null || item.percentage === undefined) {
    return { label: 'Ikke oppgitt', classes: 'bg-slate-100 text-slate-700' };
  }
  if (item.status === 'matched') return { label: 'Oppfylt', classes: 'bg-emerald-50 text-emerald-800' };
  if (item.status === 'partial') return { label: 'Delvis', classes: 'bg-amber-50 text-amber-900' };
  return { label: 'Ikke oppfylt', classes: 'bg-red-50 text-red-800' };
}

function renderFieldMatch(match) {
  const summary = document.getElementById('listing-field-match-summary');
  const context = document.getElementById('listing-analysis-context');
  const container = document.getElementById('listing-field-match');
  if (!match?.breakdown?.length) {
    summary.textContent = 'Ingen kriterier valgt';
    context.textContent = 'Velg preferanser i søket eller lagre dem på Min side. Hvert valgt kriterium blir vist, også når det ikke er nok grunnlag til en prosent.';
    container.innerHTML = '';
    return;
  }
  summary.textContent = typeof match.score === 'number'
    ? `${match.score}% Smart Match`
    : `${match.criteria} ${match.criteria === 1 ? 'kriterium' : 'kriterier'} vist · ingen prosent`;
  const chosenCriteriaLabel = match.criteria === 1 ? 'valgt kriterium' : 'valgte kriterier';
  context.textContent = `Kontrollgrunnlag: ${match.criteria} ${chosenCriteriaLabel}; ${match.verifiedCriteria} kontrollert og ${match.unknownCriteria} uten tilstrekkelige annonsedata. ${typeof match.score === 'number' ? 'Prosenten' : 'Kontrollen'} bruker annonsens strukturerte felt, ikke AI- eller kartresultatet.`;
  container.innerHTML = match.breakdown.map((item) => {
    const state = fieldMatchState(item);
    const percentage = item.percentage === null || item.percentage === undefined ? '' : ` · ${Math.round(Number(item.percentage))}%`;
    return `<li class="flex items-start justify-between gap-3 rounded-xl border border-[#E7E3F5] bg-white px-3 py-2.5">
      <span><strong class="block text-xs text-[#211C33]">${escapeHtml(item.label)}</strong><span class="mt-0.5 block text-xs text-[#6B667E]">${escapeHtml(item.detail)}</span></span>
      <span class="shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${state.classes}">${state.label}${percentage}</span>
    </li>`;
  }).join('');
}

function renderStructuredControl(targetId, match, label, notSelectedMessage) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const item = match?.breakdown?.find((entry) => entry.label === label);
  if (!item) {
    target.innerHTML = `<div class="rounded-xl bg-slate-50 px-3 py-2.5"><div class="flex items-center justify-between gap-2"><strong class="text-xs text-[#211C33]">Annonsefelt</strong><span class="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">Ikke valgt</span></div><p class="mt-1 text-xs leading-relaxed">${escapeHtml(notSelectedMessage)}</p></div>`;
    return;
  }
  const state = fieldMatchState(item);
  const percentage = item.percentage === null || item.percentage === undefined ? '' : ` · ${Math.round(Number(item.percentage))}%`;
  target.innerHTML = `<div class="rounded-xl bg-[#FAF9F6] px-3 py-2.5"><div class="flex items-center justify-between gap-2"><strong class="text-xs text-[#211C33]">Annonsefelt</strong><span class="rounded-full px-2 py-1 text-xs font-semibold ${state.classes}">${state.label}${percentage}</span></div><p class="mt-1 text-xs leading-relaxed">${escapeHtml(item.detail)}</p></div>`;
}

function renderRequiredControlAreas(match) {
  renderStructuredControl('listing-area-analysis', match, 'Område', 'Område er ikke valgt i dette søket.');
  renderStructuredControl('listing-transport-field-analysis', match, 'Kollektivtransport', 'Maks gangtid til kollektivtransport er ikke valgt.');
  renderStructuredControl('listing-amenity-field-analysis', match, 'Fasiliteter', 'Ingen fasiliteter er valgt i dette søket.');
  renderStructuredControl('listing-quality-field-analysis', match, 'Boligkvaliteter', 'Ingen boligkvaliteter er valgt i dette søket.');
  renderStructuredControl('listing-school-field-analysis', match, 'Skoleavstand', 'Ingen skole er valgt i dette søket.');
}

function requestedPreferenceCount(preferences, school) {
  return [
    Boolean(String(preferences.search_location || '').trim()),
    Number(preferences.monthly_budget_max) > 0,
    Array.isArray(preferences.preferred_property_types) && preferences.preferred_property_types.length > 0,
    Boolean(preferences.occupation),
    Boolean(preferences.desired_move_in_date),
    String(preferences.max_transit_minutes ?? '').trim() !== '',
    Array.isArray(preferences.preferred_amenities) && preferences.preferred_amenities.length > 0,
    Array.isArray(preferences.preferred_lifestyle_tags) && preferences.preferred_lifestyle_tags.length > 0,
    Boolean(school),
  ].filter(Boolean).length;
}

function safeGoogleMapsLink(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    const allowedHost = url.hostname === 'maps.google.com'
      || (['www.google.com', 'www.google.no'].includes(url.hostname) && url.pathname.startsWith('/maps'));
    return url.protocol === 'https:' && !url.username && !url.password && allowedHost ? url.toString() : '';
  } catch {
    return '';
  }
}

function safeHttpsLink(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : '';
  } catch {
    return '';
  }
}

function mapsPlaceLink(place) {
  const url = safeGoogleMapsLink(place?.maps_url);
  const mapsLink = url ? ` <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="font-semibold text-[#5A3EC2] hover:underline">Åpne i <span translate="no">Google Maps</span><span class="sr-only"> (åpnes i ny fane)</span></a>` : '';
  const attributions = (Array.isArray(place?.attributions) ? place.attributions : []).flatMap((item) => {
    const provider = typeof item?.provider === 'string' ? item.provider.trim() : '';
    if (!provider) return [];
    const providerUrl = safeHttpsLink(item.provider_url);
    return [providerUrl
      ? `<a href="${escapeHtml(providerUrl)}" target="_blank" rel="noopener noreferrer" class="underline">${escapeHtml(provider)}</a>`
      : escapeHtml(provider)];
  });
  return `${mapsLink}${attributions.length ? ` · Datakilde: ${attributions.join(', ')}` : ''}`;
}

function renderImageAnalysis(result) {
  const target = document.getElementById('listing-image-analysis');
  const imageResult = result?.image_analysis || {};
  const requested = new Set(result?.requested?.lifestyle_tags || []);
  const observations = Array.isArray(imageResult.observations)
    ? imageResult.observations.filter((item) => requested.size === 0 || requested.has(item.criterion))
    : [];
  const meta = imageResult.analyzed_images
    ? `${imageResult.analyzed_images} av ${imageResult.total_images || imageResult.analyzed_images} bilder kontrollert${imageResult.status === 'cached' ? ' · gjenbrukt kontroll for uendrede bilder' : ''}.`
    : '';
  const statusLabels = {
    supported: ['Tegn funnet', 'bg-emerald-50 text-emerald-800'],
    not_supported: ['Lite støtte', 'bg-amber-50 text-amber-900'],
    unknown: ['Kan ikke fastslås', 'bg-slate-100 text-slate-700'],
  };
  const rows = observations.map((item) => {
    const [status, classes] = statusLabels[item.status] || statusLabels.unknown;
    const imageRefs = Array.isArray(item.image_indexes) && item.image_indexes.length
      ? ` · bilde ${item.image_indexes.join(', ')}` : '';
    const confidence = { low: 'lav', medium: 'middels', high: 'høy' }[item.confidence] || 'lav';
    return `<li class="rounded-xl border border-[#E7E3F5] bg-[#FAF9F6] px-3 py-2.5">
      <div class="flex flex-wrap items-center justify-between gap-2"><strong class="text-xs text-[#211C33]">${escapeHtml(TAG_LABELS[item.criterion] || item.criterion)}</strong><span class="rounded-full px-2 py-1 text-xs font-semibold ${classes}">${status}</span></div>
      <p class="mt-1 text-xs leading-relaxed text-[#6B667E]">${escapeHtml(item.evidence || 'Ingen konkret observasjon.')}</p>
      <p class="mt-1 text-xs text-[#6B667E]">Sikkerhet: ${confidence}${escapeHtml(imageRefs)}</p>
    </li>`;
  }).join('');
  target.innerHTML = `
    <p class="text-xs leading-relaxed">${escapeHtml(imageResult.summary || 'Bildekontrollen ga ikke noe resultat.')}</p>
    ${meta ? `<p class="mt-1 text-xs font-semibold text-[#6B667E]">${escapeHtml(meta)} · Kilde: OpenAI</p>` : ''}
    ${rows ? `<ul class="mt-3 space-y-2">${rows}</ul>` : '<p class="mt-2 text-xs">Ingen valgte boligkvaliteter kunne vises.</p>'}
    <p class="mt-3 text-xs leading-relaxed text-[#6B667E]">«Tegn funnet» er en visuell observasjon, ikke bevis på areal, alder, teknisk tilstand eller kvalitet.</p>`;
}

function renderAmenityAnalysis(result) {
  const target = document.getElementById('listing-amenity-analysis');
  const maps = result?.maps || {};
  const items = Array.isArray(maps.amenities) ? maps.amenities : [];
  if (!items.length) {
    const message = maps.status === 'not_requested'
      ? 'Ingen fasiliteter er valgt i preferansene.'
      : 'Fasiliteter kunne ikke kontrolleres.';
    target.innerHTML = `<p class="text-xs">${escapeHtml(message)}</p>`;
    return;
  }
  target.innerHTML = `<ul class="space-y-2">${items.map((item) => {
    if (item.status === 'found' && item.nearest) {
      return `<li class="rounded-xl border border-[#E7E3F5] bg-[#FAF9F6] px-3 py-2.5"><strong class="text-xs text-[#211C33]">${escapeHtml(item.label)}</strong><p class="mt-1 text-xs">Nærmeste karttreff: ${escapeHtml(item.nearest.name)} · omtrent ${escapeHtml(formatMeters(item.nearest.straight_line_distance_meters))} i luftlinje.${mapsPlaceLink(item.nearest)}</p></li>`;
    }
    const message = item.status === 'not_found'
      ? `Ingen karttreff innen ${formatMeters(item.radius_meters)}. Det beviser ikke at tilbudet mangler.`
      : 'Kunne ikke kontrolleres akkurat nå.';
    return `<li class="rounded-xl border border-[#E7E3F5] bg-[#FAF9F6] px-3 py-2.5"><strong class="text-xs text-[#211C33]">${escapeHtml(item.label)}</strong><p class="mt-1 text-xs">${escapeHtml(message)}</p></li>`;
  }).join('')}</ul><p class="mt-3 text-xs font-normal text-[#5E5E5E]">Kilde: <span translate="no" class="whitespace-nowrap">Google Maps</span> · søk fra annonsens omtrentlige område-/bypunkt.</p>`;
}

function renderRouteAnalysis(result) {
  const maps = result?.maps || {};
  const transitTarget = document.getElementById('listing-route-analysis');
  const schoolTarget = document.getElementById('listing-school-route-analysis');
  const transitRows = [];
  const transit = maps.nearest_transit;
  if (transit) {
    if (transit.status === 'meets' || transit.status === 'does_not_meet') {
      const status = transit.status === 'meets' ? 'Oppfyller ønsket maksgrense' : 'Over ønsket maksgrense';
      transitRows.push(`<li class="rounded-xl bg-[#FAF9F6] px-3 py-2.5"><strong class="text-xs text-[#211C33]">Google-rute · ${escapeHtml(status)}</strong><p class="mt-1 text-xs">Omtrent ${escapeHtml(Number(transit.duration_minutes))} min gange (${escapeHtml(formatMeters(transit.distance_meters))}) til ${escapeHtml(transit.nearest?.name || 'karttreff')}; ønsket maks ${escapeHtml(Number(transit.requested_max_minutes))} min.${mapsPlaceLink(transit.nearest)}</p></li>`);
    } else {
      transitRows.push(`<li class="rounded-xl bg-[#FAF9F6] px-3 py-2.5"><strong class="text-xs text-[#211C33]">Google-rute · kan ikke fastslås</strong><p class="mt-1 text-xs">${escapeHtml(transit.reason || 'Ruten kunne ikke beregnes.')}${mapsPlaceLink(transit.nearest)}</p></li>`);
    }
  }
  transitTarget.innerHTML = transitRows.length
    ? `<ul class="space-y-2">${transitRows.join('')}</ul><p class="mt-3 text-xs font-normal text-[#5E5E5E]">Kilde: <span translate="no" class="whitespace-nowrap">Google Maps</span>. Gangruten bruker annonsens omtrentlige startpunkt.</p>`
    : '<p class="text-xs">Maks gangtid til kollektivtransport er ikke valgt, så ingen Google-rute ble bestilt.</p>';

  const schoolRows = [];
  const school = maps.school_route;
  if (school) {
    if (school.status === 'found') {
      schoolRows.push(`<li class="rounded-xl bg-[#FAF9F6] px-3 py-2.5"><strong class="text-xs text-[#211C33]">Google-rute til ${escapeHtml(school.school_name)}</strong><p class="mt-1 text-xs">Omtrent ${escapeHtml(Number(school.duration_minutes))} min (${escapeHtml(formatMeters(school.distance_meters))}) med kollektivtransport og avreise ${escapeHtml(school.departure_basis || 'nå')}.</p></li>`);
    } else {
      schoolRows.push(`<li class="rounded-xl bg-[#FAF9F6] px-3 py-2.5"><strong class="text-xs text-[#211C33]">Google-rute til ${escapeHtml(school.school_name || 'valgt skole')} · kan ikke fastslås</strong><p class="mt-1 text-xs">${escapeHtml(school.reason || 'Ruten kunne ikke beregnes.')}</p></li>`);
    }
  }
  schoolTarget.innerHTML = schoolRows.length
    ? `<ul class="space-y-2">${schoolRows.join('')}</ul><p class="mt-3 text-xs font-normal text-[#5E5E5E]">Kilde: <span translate="no" class="whitespace-nowrap">Google Maps</span>. Reisetiden varierer med avgangstid, driftsavvik og det omtrentlige startpunktet.</p>`
    : '<p class="text-xs">Ingen skole er valgt, så ingen Google-rute til skole ble bestilt.</p>';
}

async function analysisErrorMessage(error, data) {
  if (data?.message) return data.message;
  try {
    if (error?.context instanceof Response) {
      const payload = await error.context.clone().json();
      if (payload?.message) return payload.message;
    }
  } catch { /* Supabase kan allerede ha lest responsen. */ }
  return 'Kontrollen kunne ikke fullføres. Prøv igjen senere.';
}

async function runListingAnalysis() {
  if (!listing || listing._example) return;
  if (!viewer) {
    rememberReturnTo(window.location.href);
    const loginUrl = new URL('index.html', document.baseURI);
    loginUrl.searchParams.set('auth', 'login');
    loginUrl.searchParams.set('returnTo', window.location.href);
    window.location.assign(loginUrl.toString());
    return;
  }
  const button = document.getElementById('run-listing-analysis');
  const status = document.getElementById('listing-analysis-status');
  button.disabled = true;
  button.textContent = 'Kontrollerer …';
  status.textContent = 'Kontrollerer bilder, fasiliteter og reisetid. Dette kan ta noen sekunder …';
  const body = analysisRequestBody(listing.id, effectiveAnalysisPreferences, analysisSchool);
  const { data, error } = await supabase.functions.invoke('analyze-listing-fit', { body });
  if (error || !data?.listing_id) {
    status.textContent = await analysisErrorMessage(error, data);
    button.disabled = false;
    button.textContent = 'Prøv kontrollen på nytt';
    return;
  }
  renderImageAnalysis(data);
  renderAmenityAnalysis(data);
  renderRouteAnalysis(data);
  document.getElementById('listing-analysis-notice').textContent = data.notice || 'Resultatet er veiledende og må bekreftes.';
  const results = document.getElementById('listing-analysis-results');
  results.classList.remove('hidden');
  results.tabIndex = -1;
  results.focus({ preventScroll: true });
  status.textContent = `Kontrollen ble fullført ${new Date(data.analyzed_at).toLocaleString('nb-NO', { hour: '2-digit', minute: '2-digit' })}. Ingen AI- eller kartfunn er lagt inn i Smart Match-prosenten.`;
  button.disabled = false;
  button.textContent = 'Kjør kontrollen på nytt';
}

async function prepareAnalysisPanel() {
  if (analysisPrepared || !listing) return;
  analysisPrepared = true;
  const button = document.getElementById('run-listing-analysis');
  const status = document.getElementById('listing-analysis-status');
  const disclosure = document.getElementById('listing-analysis-disclosure');
  button.disabled = true;

  if (listing._example) {
    const exampleMatch = computeMatch(listing, buildMatchPreferences(null, analysisFilters), { school: analysisSchool });
    renderFieldMatch(exampleMatch);
    renderRequiredControlAreas(exampleMatch);
    disclosure.textContent = 'Eksempelboliger har illustrasjoner og sendes aldri til eksterne analysetjenester.';
    status.textContent = 'AI- og kartkontroll er ikke tilgjengelig for oppdiktede eksempelboliger.';
    button.textContent = 'Ikke tilgjengelig for eksempel';
    return;
  }

  let profile = null;
  if (viewer) {
    const { data, error } = await supabase.rpc('get_my_profile');
    if (!error) profile = Array.isArray(data) ? data[0] : data;
    else console.warn('Kunne ikke hente lagrede preferanser til kontrollen:', error.code || 'UNKNOWN');
  }
  effectiveAnalysisPreferences = buildMatchPreferences(profile, analysisFilters);
  const match = computeMatch(listing, effectiveAnalysisPreferences, { school: analysisSchool });
  renderFieldMatch(match);
  renderRequiredControlAreas(match);
  const preferenceCount = requestedPreferenceCount(effectiveAnalysisPreferences, analysisSchool);
  const imageDisclosure = listing.ai_image_analysis_allowed
    ? 'Opptil seks godkjente annonsebilder kan sendes til OpenAI for en begrenset boligkontroll.'
    : 'Annonsøren har ikke tillatt AI-bildekontroll, så ingen bilder blir sendt til OpenAI.';
  disclosure.textContent = `${imageDisclosure} Valgte fasilitetstyper og omtrentlige koordinater sendes bare til Google Maps når du starter kontrollen. ${preferenceCount ? `${preferenceCount} preferansegrupper er valgt.` : 'Ingen kartpreferanser er valgt.'}`;
  if (!listing.ai_image_analysis_allowed && viewer.id === listing.user_id) {
    const editLink = document.createElement('a');
    editLink.href = `create-listing.html?edit=${encodeURIComponent(listing.id)}#ai-image-analysis-allowed`;
    editLink.className = 'ml-1 font-semibold text-[#5A3EC2] hover:underline';
    editLink.textContent = 'Slå på for denne annonsen.';
    disclosure.appendChild(editLink);
  }
  status.textContent = viewer ? 'Kontrollen er ikke kjørt.' : 'Logg inn for å starte den kostnadsbegrensede kontrollen.';
  button.textContent = viewer ? 'Kjør AI- og kartkontroll' : 'Logg inn for å kontrollere';
  button.disabled = false;
}

function renderImages() {
  const rawImageUrls = Array.isArray(listing.images) && listing.images.length ? listing.images : (listing.image_url ? [listing.image_url] : []);
  const imageUrls = rawImageUrls.map((url) => safePublicMediaUrl(url, LISTING_IMAGES_BUCKET)).filter(Boolean);
  const mainImage = document.getElementById('listing-img');
  if (listing._example) {
    const art = document.createElement('div');
    art.className = 'w-full h-72 md:h-96';
    art.dataset.propertyArt = listing._art;
    art.setAttribute('role', 'img');
    art.setAttribute('aria-label', 'Illustrasjonsbilde av en oppdiktet bolig');
    mainImage.replaceWith(art);
    return;
  }
  mainImage.src = imageUrls[0] || PLACEHOLDER_IMG;
  mainImage.alt = `Forsidebilde for ${listing.title}`;
  installImageFallback(mainImage, PLACEHOLDER_IMG);
  const thumbs = document.getElementById('listing-thumbs');
  if (imageUrls.length < 2) return;
  thumbs.classList.remove('hidden');
  thumbs.classList.add('flex');
  thumbs.innerHTML = imageUrls.map((url, index) => `<button type="button" data-src="${escapeHtml(url)}" aria-label="Vis bilde ${index + 1}" class="thumb-btn shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 ${index === 0 ? 'border-[#6C4CE0]' : 'border-transparent'}"><img src="${escapeHtml(url)}" class="thumb-image w-full h-full object-cover" alt="Bilde ${index + 1} av ${imageUrls.length} for ${escapeHtml(listing.title)}" /></button>`).join('');
  thumbs.querySelectorAll('.thumb-image').forEach((image) => installImageFallback(image, PLACEHOLDER_IMG));
  thumbs.addEventListener('click', (event) => {
    const button = event.target.closest('.thumb-btn');
    if (!button) return;
    mainImage.dataset.fallbackApplied = 'false';
    mainImage.src = button.dataset.src;
    thumbs.querySelectorAll('.thumb-btn').forEach((item) => item.classList.replace('border-[#6C4CE0]', 'border-transparent'));
    button.classList.replace('border-transparent', 'border-[#6C4CE0]');
  });
}

function renderVideo() {
  const videoUrl = safePublicMediaUrl(listing.video_url, LISTING_VIDEOS_BUCKET);
  if (!videoUrl) return;
  const section = document.getElementById('listing-video-section');
  const video = document.getElementById('listing-video');
  video.src = videoUrl;
  video.setAttribute('aria-label', `Videovisning for ${listing.title}`);
  video.addEventListener('error', () => {
    section.classList.add('hidden');
    video.removeAttribute('src');
  }, { once: true });
  section.classList.remove('hidden');
}

async function renderTrustBadges() {
  if (listing._example) {
    document.getElementById('owner-name').textContent = 'Eksempelbolig · ingen utleier';
    document.getElementById('owner-initials').textContent = 'KM';
    return;
  }
  const [{ data: ownerProfile }, { data: stats }] = await Promise.all([
    supabase.from('profiles').select('full_name, avatar_url, is_verified').eq('id', listing.user_id).single(),
    supabase.rpc('get_response_stats', { target_user: listing.user_id }),
  ]);
  const ownerName = ownerProfile?.full_name || 'KollektivMatch-bruker';
  document.getElementById('owner-name').textContent = ownerName;
  document.getElementById('owner-initials').textContent = ownerName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'KM';
  const avatarUrl = safePublicMediaUrl(ownerProfile?.avatar_url, PROFILE_AVATARS_BUCKET);
  if (avatarUrl) {
    const avatar = document.getElementById('owner-avatar');
    avatar.src = avatarUrl;
    avatar.alt = `Profilbilde av ${ownerName}`;
    avatar.classList.remove('hidden');
    document.getElementById('owner-initials').classList.add('hidden');
    avatar.addEventListener('error', () => {
      avatar.classList.add('hidden');
      document.getElementById('owner-initials').classList.remove('hidden');
    }, { once: true });
  }
  const container = document.getElementById('owner-trust-badges');
  if (ownerProfile?.is_verified) {
    const badge = document.createElement('span');
    badge.className = 'inline-flex items-center bg-[#F4F2FF] text-[#6C4CE0] text-[11px] font-semibold px-2.5 py-1 rounded-full';
    badge.textContent = 'Bekreftet utdannings-e-post';
    container.appendChild(badge);
  }
  const stat = Array.isArray(stats) ? stats[0] : stats;
  if (stat?.sample_size >= 3 && stat.response_rate != null) {
    const badge = document.createElement('span');
    badge.className = 'inline-flex items-center bg-[#F4F2FF] text-[#6C4CE0] text-[11px] font-semibold px-2.5 py-1 rounded-full';
    badge.textContent = `Svarer på ${stat.response_rate}% av henvendelser`;
    container.appendChild(badge);
  }
}

document.getElementById('share-listing').addEventListener('click', async () => {
  if (!listing) return;
  const shareUrl = new URL(`listing-detail.html?id=${encodeURIComponent(listing.id)}`, document.baseURI).toString();
  const examplePrefix = listing._example ? 'Eksempelbolig – kan ikke leies. ' : '';
  const shareData = {
    title: `${examplePrefix}${listing.title} – KollektivMatch`,
    text: `${examplePrefix}${listing.title} i ${listing.city} · ${new Intl.NumberFormat('nb-NO').format(listing.price)} kr/mnd`,
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
    if (error?.name !== 'AbortError') showToast('Kunne ikke dele annonsen. Kopier adressen fra nettleseren.', 'error');
  }
});

document.getElementById('run-listing-analysis').addEventListener('click', () => {
  runListingAnalysis().catch((error) => {
    console.error('Uventet feil under annonsekontroll:', error?.message || 'UNKNOWN');
    const button = document.getElementById('run-listing-analysis');
    button.disabled = false;
    button.textContent = 'Prøv kontrollen på nytt';
    document.getElementById('listing-analysis-status').textContent = 'Kontrollen kunne ikke fullføres. Prøv igjen senere.';
  });
});

function renderContact() {
  const chatLink = document.getElementById('chat-link');
  if (listing._example) {
    document.getElementById('contact-heading').textContent = 'Om dette eksemplet';
    document.getElementById('contact-intro').textContent = 'Prøv andre preferanser i boligsøket og sammenlign resultatene.';
    document.getElementById('share-listing').textContent = 'Del eksemplet';
    chatLink.textContent = 'Tilbake til boligsøket';
    chatLink.href = 'index.html#filter-form';
    document.getElementById('contact-box').textContent = 'Dette er en oppdiktet bolig med illustrasjonsbilde. Den er laget for å prøve Smart Match og kan ikke leies. Det finnes ingen utleier å kontakte.';
    return;
  }
  if (viewer?.id === listing.user_id) {
    chatLink.textContent = 'Dette er din egen annonse';
    chatLink.href = 'dashboard.html';
    chatLink.classList.replace('bg-[#6C4CE0]', 'bg-[#211C33]');
  } else {
    chatLink.href = `chat.html?listing=${encodeURIComponent(listing.id)}&user=${encodeURIComponent(listing.user_id)}`;
  }
  const contact = document.getElementById('contact-box');
  if (!viewer) {
    contact.textContent = 'Logg inn for å se telefon/e-post utleier eventuelt har lagt til.';
    contact.classList.add('text-xs', 'text-[#6B667E]');
    return;
  }
  if (contactLoadError) {
    contact.textContent = 'Kontaktinformasjonen kunne ikke hentes nå. Bruk meldingstjenesten eller prøv igjen senere.';
    contact.classList.add('text-xs', 'text-[#6B667E]');
    return;
  }
  if (!listing.contact_info) {
    contact.textContent = 'Ingen ekstra kontaktinformasjon er oppgitt. Bruk meldingstjenesten.';
    contact.classList.add('text-xs', 'text-[#6B667E]');
    return;
  }
  const raw = listing.contact_info.trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
  const isPhone = !isEmail && /^[\d\s+()-]{6,}$/.test(raw);
  if (isEmail || isPhone) {
    const link = document.createElement('a');
    link.href = isEmail ? `mailto:${raw}` : `tel:${raw.replace(/[\s()-]/g, '')}`;
    link.className = 'block p-3 bg-[#F4F2FF] rounded-2xl text-sm font-medium text-[#6C4CE0] break-all';
    link.textContent = raw;
    contact.replaceChildren(link);
  } else {
    const text = document.createElement('div');
    text.className = 'p-3 bg-[#F4F2FF] rounded-2xl text-sm font-medium text-[#6C4CE0] break-all';
    text.textContent = raw;
    contact.replaceChildren(text);
  }
}

document.getElementById('report-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!listing || listing._example) return;
  const button = document.getElementById('report-submit');
  button.disabled = true;
  const data = new FormData(event.target);
  const reportPayload = {
    p_listing_id: listing.id,
    p_reason: data.get('reason'),
    p_details: data.get('details').trim() || null,
  };
  const { error } = await supabase.rpc('submit_report', reportPayload);
  button.disabled = false;
  if (error) {
    console.error('Kunne ikke sende rapport:', error.message);
    showToast(isMissingReportsError(error) || isMissingFunctionError(error)
      ? 'Rapportering krever at databasemigreringen installeres.'
      : 'Rapporten kunne ikke sendes. Du kan bare rapportere samme annonse én gang, og det er en timegrense mot misbruk.', 'error');
  } else {
    event.target.reset();
    showToast('Takk. Rapporten er sendt til gjennomgang.', 'success');
  }
});

async function init() {
  const example = getExampleListing(id);
  if (example) {
    listing = example;
    renderListing();
    return;
  }
  if (!UUID_PATTERN.test(id || '')) {
    document.getElementById('loading').textContent = 'Ugyldig annonse-ID.';
    return;
  }
  const { data: { user } } = await supabase.auth.getUser();
  viewer = user;
  const modernColumns = 'id, user_id, title, description, price, city, area, location_lat, location_lon, location_precision, move_in_date, images, image_url, roommates_info, lifestyle_tags, amenities, preferred_occupations, transit_minutes, grocery_nearby, gym_nearby, green_areas_nearby, property_type, room_size_m2, deposit_amount, furnished, rent_includes, status, is_featured, featured_until, created_at, updated_at';
  const columnVariants = [
    `${modernColumns}, video_url, ai_image_analysis_allowed`,
    `${modernColumns}, video_url`,
    modernColumns,
    'id, user_id, title, description, price, city, area, move_in_date, image_url, roommates_info, is_featured, featured_until, created_at',
  ];
  let data = null;
  let error = null;
  for (const columns of columnVariants) {
    ({ data, error } = await supabase.from('listings').select(columns).eq('id', id).single());
    if (!error || !isMissingColumnError(error)) break;
  }
  if (error || !data) {
    document.getElementById('loading').textContent = 'Kunne ikke finne denne annonsen.';
    return;
  }
  listing = data;
  if (viewer) {
    const { data: contactInfo, error: contactError } = await supabase.rpc('get_listing_contact', { p_listing_id: id });
    if (contactError) {
      contactLoadError = true;
      console.warn('Kontaktinformasjonen ble ikke hentet:', contactError.message);
    } else {
      listing.contact_info = typeof contactInfo === 'string' ? contactInfo : null;
    }
  }
  renderListing();
}

function renderListing() {
  document.title = `${listing._example ? 'Eksempel: ' : ''}${listing.title} – KollektivMatch`;
  document.getElementById('page-description').content = `${listing.title} i ${listing.city}, ${new Intl.NumberFormat('nb-NO').format(listing.price)} kr per måned. Kontakt annonsøren på KollektivMatch.`;
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('listing-content').classList.remove('hidden');
  renderImages();
  renderVideo();
  document.getElementById('listing-title').textContent = `${listing._example ? 'Eksempel: ' : ''}${listing.title}`;
  if (listing._example) {
    document.getElementById('page-description').content = 'Oppdiktet eksempelbolig for å prøve Smart Match. Kan ikke leies.';
    const notice = document.createElement('p');
    notice.className = 'example-notice mb-5';
    notice.textContent = 'Eksempelbolig · oppdiktede opplysninger og illustrasjonsbilde. Boligen kan ikke leies.';
    document.getElementById('listing-content').prepend(notice);
  }
  if (listing.is_featured && listing.featured_until && new Date(listing.featured_until) > new Date()) {
    document.getElementById('listing-featured-badge').classList.remove('hidden');
  }
  document.getElementById('listing-city-badge').textContent = listing.city;
  document.getElementById('listing-price').textContent = `${new Intl.NumberFormat('nb-NO').format(listing.price)} kr`;
  document.getElementById('listing-move-in').textContent = listing.move_in_date ? formatDate(`${listing.move_in_date}T00:00:00`) : 'Fleksibel';
  document.getElementById('listing-area').textContent = listing.area || 'Ikke oppgitt';
  document.getElementById('listing-property-type').textContent = PROPERTY_LABELS[listing.property_type] || 'Ikke oppgitt';
  document.getElementById('listing-room-size').textContent = listing.room_size_m2 ? `${listing.room_size_m2} m²` : 'Ikke oppgitt';
  document.getElementById('listing-deposit').textContent = listing.deposit_amount != null ? `${new Intl.NumberFormat('nb-NO').format(listing.deposit_amount)} kr` : 'Ikke oppgitt';
  document.getElementById('listing-furnished').textContent = listing.furnished == null ? 'Ikke oppgitt' : listing.furnished ? 'Møblert' : 'Ikke møblert';
  document.getElementById('listing-dates').textContent = `Opprettet ${formatDate(listing.created_at)} · Sist oppdatert ${formatDate(listing.updated_at || listing.created_at)}`;
  document.getElementById('listing-desc').textContent = listing.description || 'Ingen beskrivelse oppgitt.';
  document.getElementById('listing-roommates').textContent = listing.roommates_info || 'Ingen informasjon lagt til.';
  document.getElementById('listing-transit').textContent = listing.transit_minutes != null ? `${listing.transit_minutes} min til nærmeste T-bane/buss.` : 'Avstand til kollektivtransport er ikke oppgitt.';
  renderPills('listing-tags', listing.lifestyle_tags, TAG_LABELS);
  renderPills('listing-amenities', listing.amenities, AMENITY_LABELS);
  renderPills('listing-rent-includes', listing.rent_includes, INCLUDED_LABELS);
  renderContact();
  if (!listing._example && viewer && viewer.id !== listing.user_id) document.getElementById('report-section').classList.remove('hidden');
  renderTrustBadges().catch((trustError) => console.error('Kunne ikke hente tillitsmerker:', trustError.message));
  prepareAnalysisPanel().catch((analysisError) => {
    console.error('Kunne ikke klargjøre annonsekontrollen:', analysisError?.message || 'UNKNOWN');
    document.getElementById('listing-analysis-status').textContent = 'Kontrollpanelet kunne ikke klargjøres akkurat nå.';
  });
}

init().catch(() => {
  document.getElementById('loading').textContent = 'Kunne ikke laste annonsen. Prøv igjen senere.';
});
