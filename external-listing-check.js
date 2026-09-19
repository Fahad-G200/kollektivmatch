const PROPERTY_TYPES = new Set(['leilighet', 'hybel', 'enebolig', 'rekkehus', 'studentbolig', 'hytte', 'annet']);
const AMENITIES = new Set(['matbutikk', 'kollektivtransport', 'treningssenter', 'grontomrade']);
const LIFESTYLE = new Set(['stort-rom', 'moderne-stil', 'nyoppusset-bad', 'rolig-miljo', 'stort-kjokken']);
const VISUAL_LIFESTYLE = new Set(['stort-rom', 'moderne-stil', 'nyoppusset-bad', 'stort-kjokken']);
const ACCEPTED_OCCUPATIONS = new Set(['ikke-oppgitt', 'alle', 'student', 'jobb', 'annet']);
const FINN_HOSTS = new Set(['finn.no', 'www.finn.no']);
const FINN_LISTING_PATH = /^\/realestate\/lettings\/ad\.html$/;
const MAX_IMAGES = 3;
const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_OUTPUT_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600;

const PROPERTY_LABELS = {
  leilighet: 'Leilighet', hybel: 'Hybel', enebolig: 'Enebolig', rekkehus: 'Rekkehus',
  studentbolig: 'Studentbolig / rom', hytte: 'Hytte', annet: 'Annet',
};
const AMENITY_LABELS = {
  matbutikk: 'Matbutikk i nærheten', kollektivtransport: 'Kollektivtransport i nærheten',
  treningssenter: 'Treningssenter i nærheten', grontomrade: 'Grøntområde i nærheten',
};
const LIFESTYLE_LABELS = {
  'stort-rom': 'Stort rom', 'moderne-stil': 'Moderne stil',
  'nyoppusset-bad': 'Fint / moderne bad', 'rolig-miljo': 'Rolig miljø',
  'stort-kjokken': 'Stort kjøkken / sosial sone',
};
const SOURCE_LABELS = {
  user_supplied: 'Oppgitt av deg', google_maps: 'Google Maps', ai_visual: 'AI-bildekontroll',
};

let supabasePromise;
function getSupabase() {
  supabasePromise ||= import('./supabase-config.js').then((module) => module.supabase);
  return supabasePromise;
}

function cleanText(value, maxLength = 180) {
  return String(value || '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function selectedValues(values, allowed) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanText(value, 40)).filter((value) => allowed.has(value)))];
}

function positiveInteger(value, min, max) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return '';
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isFinite(date.getTime())
    && date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]) ? match[0] : '';
}

export function validateFinnListingUrl(value) {
  const cleaned = cleanText(value, 500);
  if (!cleaned) return null;
  try {
    const url = new URL(cleaned);
    const finnkode = url.searchParams.get('finnkode') || '';
    if (url.protocol !== 'https:' || !FINN_HOSTS.has(url.hostname.toLowerCase())
      || url.port || url.username || url.password || !FINN_LISTING_PATH.test(url.pathname)
      || !/^\d{6,12}$/.test(finnkode)) return null;
    const canonical = new URL(`https://www.finn.no${url.pathname}`);
    canonical.searchParams.set('finnkode', finnkode);
    return canonical.toString();
  } catch {
    return null;
  }
}

function validSchool(filters = {}) {
  const name = cleanText(filters.schoolName, 160);
  const latitude = Number(filters.schoolLat);
  const longitude = Number(filters.schoolLon);
  return name && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    ? { name, latitude, longitude } : null;
}

export function externalPreferencesFromFilters(filters = {}) {
  const maxPrice = positiveInteger(filters.maxPrice, 1, 10_000_000);
  const maxTransitMinutes = positiveInteger(filters.maxTransitMinutes, 0, 600);
  const propertyType = cleanText(filters.propertyType, 40);
  const preferredOccupation = cleanText(filters.preferredOccupation, 40);
  return {
    city: cleanText(filters.city, 100),
    max_price: maxPrice,
    desired_move_in_date: validDate(filters.moveInDate) || null,
    property_type: PROPERTY_TYPES.has(propertyType) ? propertyType : null,
    preferred_occupation: ['student', 'jobb', 'annet'].includes(preferredOccupation) ? preferredOccupation : null,
    max_transit_minutes: maxTransitMinutes,
    amenities: selectedValues(filters.amenities, AMENITIES),
    lifestyle_tags: selectedValues(filters.lifestyleTags, LIFESTYLE),
    school: validSchool(filters),
  };
}

export function preferencePresentation(filters = {}) {
  const preferences = externalPreferencesFromFilters(filters);
  const items = [];
  if (preferences.city) items.push({ key: 'city', label: `Område: ${preferences.city}` });
  if (preferences.max_price !== null) items.push({ key: 'max_price', label: `Makspris: ${preferences.max_price.toLocaleString('nb-NO')} kr` });
  if (preferences.desired_move_in_date) items.push({ key: 'move_in', label: `Innflytting: ${preferences.desired_move_in_date}` });
  if (preferences.property_type) items.push({ key: 'property_type', label: `Boligtype: ${PROPERTY_LABELS[preferences.property_type]}` });
  if (preferences.preferred_occupation) items.push({ key: 'occupation', label: `Hverdag: ${preferences.preferred_occupation === 'jobb' ? 'i jobb' : preferences.preferred_occupation}` });
  if (preferences.max_transit_minutes !== null) items.push({ key: 'transit', label: `Kollektivt: maks ${preferences.max_transit_minutes} min` });
  preferences.amenities.forEach((key) => items.push({ key: `amenity:${key}`, label: AMENITY_LABELS[key] }));
  preferences.lifestyle_tags.forEach((key) => items.push({ key: `lifestyle:${key}`, label: LIFESTYLE_LABELS[key] }));
  if (preferences.school) items.push({ key: 'school', label: `Skole: ${preferences.school.name}` });
  return {
    preferences,
    items,
    hasScoreBasis: items.length >= 2 || Boolean(preferences.school),
    needsImages: preferences.lifestyle_tags.some((key) => VISUAL_LIFESTYLE.has(key)),
  };
}

export function buildExternalAnalysisPayload(filters, values = {}) {
  const sourceUrl = validateFinnListingUrl(values.sourceUrl);
  const propertyType = cleanText(values.propertyType, 40);
  const acceptedOccupation = cleanText(values.acceptedOccupation, 40) || 'ikke-oppgitt';
  const preferences = externalPreferencesFromFilters(filters);
  const advertisedClaims = selectedValues(values.advertisedClaims, LIFESTYLE)
    .filter((key) => preferences.lifestyle_tags.includes(key));
  return {
    source_url: sourceUrl,
    address: cleanText(values.address, 180),
    monthly_price: positiveInteger(values.monthlyPrice, 500, 500_000),
    property_type: PROPERTY_TYPES.has(propertyType) ? propertyType : null,
    move_in_date: validDate(values.moveInDate) || null,
    accepted_occupation: ACCEPTED_OCCUPATIONS.has(acceptedOccupation) ? acceptedOccupation : null,
    advertised_claims: advertisedClaims,
    analysis_consent: values.analysisConsent === true,
    preferences,
  };
}

function renderPreferenceList(filters, documentRef = document) {
  const model = preferencePresentation(filters);
  const list = documentRef.getElementById('external-check-preference-list');
  const status = documentRef.getElementById('external-check-preference-status');
  if (list) {
    list.replaceChildren();
    model.items.forEach((item) => {
      const row = documentRef.createElement('li');
      row.textContent = item.label;
      list.append(row);
    });
  }
  if (status) {
    status.textContent = model.hasScoreBasis
      ? `${model.items.length} kriterier tas med. Ukjent teller ikke som treff og vises separat.`
      : 'Velg minst to preferanser, eller én skole, i søket over.';
  }
  const selectedLifestyle = new Set(model.preferences.lifestyle_tags);
  documentRef.querySelectorAll?.('[name="advertisedClaims"]').forEach((input) => {
    const enabled = selectedLifestyle.has(input.value);
    input.disabled = !enabled;
    if (!enabled) input.checked = false;
    input.closest('label')?.classList.toggle('is-disabled', !enabled);
  });
  return model;
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file);
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
}

async function compressImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error('Velg JPG-, PNG- eller WebP-bilder på maksimalt 12 MB.');
  }
  const image = await decodeImage(file);
  const sourceWidth = Number(image.width);
  const sourceHeight = Number(image.height);
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth < 256 || sourceHeight < 256) {
    image.close?.();
    throw new Error('Bildene må være minst 256 × 256 piksler.');
  }
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    image.close?.();
    throw new Error('Nettleseren kunne ikke klargjøre bildet.');
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close?.();
  let blob = await canvasBlob(canvas, 0.82);
  if (blob && blob.size > MAX_OUTPUT_IMAGE_BYTES) blob = await canvasBlob(canvas, 0.68);
  if (!blob || blob.size > MAX_OUTPUT_IMAGE_BYTES) throw new Error('Bildet er fortsatt for stort etter skalering. Velg et mindre utsnitt.');
  return blob;
}

function safeGoogleMapsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const allowed = url.protocol === 'https:' && !url.username && !url.password
      && (url.hostname === 'maps.google.com'
        || (['www.google.com', 'www.google.no'].includes(url.hostname) && url.pathname.startsWith('/maps')));
    return allowed ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function criterionNode(criterion, documentRef) {
  const item = documentRef.createElement('li');
  item.className = 'external-result-item';
  const header = documentRef.createElement('div');
  header.className = 'external-result-item-header';
  const title = documentRef.createElement('strong');
  title.textContent = cleanText(criterion.label, 120) || 'Kriterium';
  const value = documentRef.createElement('span');
  value.textContent = typeof criterion.percentage === 'number' ? `${criterion.percentage}%` : 'Ukjent';
  header.append(title, value);
  const evidence = documentRef.createElement('p');
  evidence.textContent = cleanText(criterion.evidence, 360) || 'Ingen forklaring tilgjengelig.';
  const source = documentRef.createElement('span');
  source.className = 'external-result-source';
  source.textContent = SOURCE_LABELS[criterion.source] || 'Kilde ukjent';
  item.append(header, evidence, source);
  const detailsUrl = safeGoogleMapsUrl(criterion.details_url);
  if (detailsUrl) {
    const link = documentRef.createElement('a');
    link.href = detailsUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'external-result-source';
    link.textContent = 'Åpne treff i Google Maps ↗';
    item.append(link);
  }
  if (criterion.caveat) {
    const caveat = documentRef.createElement('p');
    caveat.textContent = cleanText(criterion.caveat, 260);
    item.append(caveat);
  }
  return item;
}

function renderCriterionGroup(target, criteria, documentRef) {
  target.replaceChildren();
  if (!criteria.length) {
    const empty = documentRef.createElement('li');
    empty.className = 'external-result-empty';
    empty.textContent = 'Ingen kriterier i denne gruppen.';
    target.append(empty);
    return;
  }
  criteria.forEach((criterion) => target.append(criterionNode(criterion, documentRef)));
}

export function renderExternalAnalysisResult(result, documentRef = document) {
  const section = documentRef.getElementById('external-check-result');
  const score = documentRef.getElementById('external-result-score');
  const coverage = documentRef.getElementById('external-result-coverage');
  const sourceLink = documentRef.getElementById('external-result-source-link');
  const metTarget = documentRef.getElementById('external-result-met');
  const missingTarget = documentRef.getElementById('external-result-missing');
  const unknownTarget = documentRef.getElementById('external-result-unknown');
  const warningsTarget = documentRef.getElementById('external-result-warnings');
  const mapsAttribution = documentRef.getElementById('external-result-maps-attribution');
  const thirdPartyAttribution = documentRef.getElementById('external-result-third-party-attribution');
  const criteria = Array.isArray(result?.criteria) ? result.criteria : [];
  const met = criteria.filter((item) => item?.status === 'met');
  const missing = criteria.filter((item) => ['partial', 'not_met'].includes(item?.status));
  const unknown = criteria.filter((item) => item?.status === 'unknown');

  if (score) score.textContent = Number.isInteger(result?.score?.percent) ? String(result.score.percent) : '–';
  if (coverage) {
    const verified = Number(result?.score?.verified_count || 0);
    const selected = Number(result?.score?.selected_count || criteria.length);
    const percent = Number(result?.score?.coverage_percent || 0);
    coverage.textContent = `${verified} av ${selected} kriterier kontrollert · ${percent}% dekning. Ukjent gir ikke poeng.`;
  }
  if (sourceLink) {
    const validSource = validateFinnListingUrl(result?.source?.url);
    if (validSource) {
      sourceLink.href = validSource;
      sourceLink.classList.remove('hidden');
    } else {
      sourceLink.removeAttribute('href');
      sourceLink.classList.add('hidden');
    }
  }
  if (metTarget) renderCriterionGroup(metTarget, met, documentRef);
  if (missingTarget) renderCriterionGroup(missingTarget, missing, documentRef);
  if (unknownTarget) renderCriterionGroup(unknownTarget, unknown, documentRef);
  mapsAttribution?.classList.toggle('hidden', !criteria.some((item) => item?.source === 'google_maps'));
  if (thirdPartyAttribution) {
    thirdPartyAttribution.replaceChildren();
    (Array.isArray(result?.maps?.data_attributions) ? result.maps.data_attributions : []).slice(0, 5).forEach((attribution) => {
      const provider = cleanText(attribution?.provider, 100);
      if (!provider) return;
      thirdPartyAttribution.append(documentRef.createTextNode(` · Data: `));
      const providerUrl = safeHttpsUrl(attribution?.provider_url);
      if (providerUrl) {
        const link = documentRef.createElement('a');
        link.href = providerUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = provider;
        thirdPartyAttribution.append(link);
      } else {
        thirdPartyAttribution.append(documentRef.createTextNode(provider));
      }
    });
  }

  if (warningsTarget) {
    warningsTarget.replaceChildren();
    (Array.isArray(result?.warnings) ? result.warnings : []).slice(0, 6).forEach((warning) => {
      const text = documentRef.createElement('p');
      text.textContent = cleanText(warning, 360);
      warningsTarget.append(text);
    });
  }
  section?.classList.remove('hidden');
  section?.focus({ preventScroll: true });
  section?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function functionErrorMessage(error, data) {
  if (data?.message) return cleanText(data.message, 260);
  const response = error?.context;
  if (response && typeof response.clone === 'function') {
    try {
      const payload = await response.clone().json();
      if (payload?.message) return cleanText(payload.message, 260);
    } catch {
      // Providerdetaljer og rå respons skal ikke vises i klienten.
    }
  }
  return 'Kontrollen kunne ikke fullføres akkurat nå. Prøv igjen senere.';
}

export function initExternalListingCheck({ getFilters, openLogin, showToast, documentRef = document } = {}) {
  const panel = documentRef.getElementById('external-listing-check');
  const form = documentRef.getElementById('external-listing-check-form');
  const imageInput = documentRef.getElementById('external-images');
  const previewTarget = documentRef.getElementById('external-image-previews');
  const submitButton = documentRef.getElementById('external-check-submit');
  const status = documentRef.getElementById('external-check-status');
  let signedInUser = null;
  let chosenFiles = [];
  let previewUrls = [];

  const clearPreviewUrls = () => {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = [];
  };

  const renderPreviews = () => {
    clearPreviewUrls();
    previewTarget?.replaceChildren();
    chosenFiles.forEach((file, index) => {
      const frame = documentRef.createElement('div');
      frame.className = 'external-image-preview';
      const image = documentRef.createElement('img');
      const objectUrl = URL.createObjectURL(file);
      previewUrls.push(objectUrl);
      image.src = objectUrl;
      image.alt = `Valgt boligbilde ${index + 1}`;
      const remove = documentRef.createElement('button');
      remove.type = 'button';
      remove.dataset.removeImage = String(index);
      remove.setAttribute('aria-label', `Fjern boligbilde ${index + 1}`);
      remove.textContent = '×';
      frame.append(image, remove);
      previewTarget?.append(frame);
    });
  };

  imageInput?.addEventListener('change', () => {
    const files = Array.from(imageInput.files || []);
    if (files.length > MAX_IMAGES) showToast?.('Du kan kontrollere opptil tre bilder om gangen.', 'error');
    chosenFiles = files.slice(0, MAX_IMAGES);
    renderPreviews();
  });

  previewTarget?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-remove-image]');
    if (!button) return;
    chosenFiles.splice(Number(button.dataset.removeImage), 1);
    if (imageInput) imageInput.value = '';
    renderPreviews();
  });

  const refreshPreferences = () => renderPreferenceList(getFilters?.() || {}, documentRef);
  panel?.addEventListener('toggle', () => { if (panel.open) refreshPreferences(); });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!signedInUser) {
      status.textContent = 'Logg inn for å starte kontrollen.';
      openLogin?.();
      return;
    }
    if (!form.reportValidity()) return;
    const preferenceModel = refreshPreferences();
    if (!preferenceModel.hasScoreBasis) {
      status.textContent = 'Velg minst to preferanser, eller én skole, i søket over først.';
      return;
    }
    const advertisedClaims = Array.from(form.querySelectorAll('[name="advertisedClaims"]:checked')).map((input) => input.value);
    const payload = buildExternalAnalysisPayload(getFilters?.() || {}, {
      sourceUrl: form.elements.sourceUrl.value,
      address: form.elements.address.value,
      monthlyPrice: form.elements.monthlyPrice.value,
      propertyType: form.elements.propertyType.value,
      moveInDate: form.elements.moveInDate.value,
      acceptedOccupation: form.elements.acceptedOccupation.value,
      advertisedClaims,
      analysisConsent: form.elements.analysisConsent.checked,
    });
    if (!payload.source_url) {
      status.textContent = 'Bruk en gyldig https-lenke til en konkret FINN eiendomsannonse med finnkode.';
      form.elements.sourceUrl.focus();
      return;
    }
    if (!payload.monthly_price || !payload.property_type || !payload.address) {
      status.textContent = 'Kontroller adresse, månedspris og boligtype.';
      return;
    }
    const needsImages = preferenceModel.needsImages || payload.advertised_claims.some((key) => VISUAL_LIFESTYLE.has(key));
    if (needsImages && chosenFiles.length === 0) {
      status.textContent = 'Legg til minst ett rent boligbilde for å kontrollere de valgte visuelle kvalitetene.';
      imageInput?.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = needsImages ? 'Klargjør bilder …' : 'Klargjør kontroll …';
    status.textContent = needsImages
      ? 'Bildene skaleres lokalt. Deretter kontrolleres adresse, ruter, fasiliteter og synlige boligtrekk.'
      : 'Klargjør adresse, ruter, fasiliteter og oppgitte annonsefelt.';
    documentRef.getElementById('external-check-result')?.classList.add('hidden');
    try {
      const uploadedImages = [];
      const filesForAnalysis = needsImages ? chosenFiles : [];
      for (const file of filesForAnalysis) uploadedImages.push(await compressImage(file));
      const body = new FormData();
      body.append('payload', JSON.stringify(payload));
      uploadedImages.forEach((blob, index) => body.append('images', blob, `bolig-${index + 1}.webp`));
      submitButton.textContent = 'Kontrollerer …';
      const supabase = await getSupabase();
      const { data, error } = await supabase.functions.invoke('analyze-external-listing', { body });
      if (error || !data) {
        status.textContent = await functionErrorMessage(error, data);
        return;
      }
      renderExternalAnalysisResult(data, documentRef);
      status.textContent = 'Kontrollen er ferdig. Resultatet lagres ikke av KollektivMatch.';
    } catch (error) {
      status.textContent = cleanText(error?.message, 260) || 'Kontrollen kunne ikke fullføres.';
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Start kontrollen';
    }
  });

  window.addEventListener('pagehide', () => {
    clearPreviewUrls();
    chosenFiles = [];
    form?.reset();
    previewTarget?.replaceChildren();
    documentRef.getElementById('external-check-result')?.classList.add('hidden');
    ['external-result-met', 'external-result-missing', 'external-result-unknown', 'external-result-warnings']
      .forEach((id) => documentRef.getElementById(id)?.replaceChildren());
  });
  refreshPreferences();

  return {
    refreshPreferences,
    setUser(user) {
      signedInUser = user || null;
      if (status) status.textContent = signedInUser
        ? 'Klar. Vanlig grense er 3 kontroller per time og 10 per døgn.'
        : 'Du må være logget inn. Vanlig grense er 3 kontroller per time.';
    },
  };
}
