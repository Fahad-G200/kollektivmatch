import { supabase } from './supabase-config.js';
import { rememberReturnTo } from './auth.js';
import { showToast } from './ui.js';
import {
  LISTING_IMAGES_BUCKET,
  LISTING_VIDEOS_BUCKET,
  installImageFallback,
  removeOwnedImages,
  removeOwnedVideo,
  safePublicMediaUrl,
} from './storage-utils.js?v=20260828-1';
import { geocodeListingArea } from './location-utils.js?v=20260825-1';

const form = document.getElementById('create-listing-form');
const authCheckState = document.getElementById('auth-check-state');
const submitButton = document.getElementById('submit-btn');
const fileInput = document.getElementById('image-files-input');
const dropZone = document.getElementById('image-drop-zone');
const previewGrid = document.getElementById('image-preview-grid');
const fileErrors = document.getElementById('file-errors');
const imageCount = document.getElementById('image-count');
const videoInput = document.getElementById('video-file-input');
const videoDropZone = document.getElementById('video-drop-zone');
const videoPreviewCard = document.getElementById('video-preview-card');
const videoPreview = document.getElementById('video-preview');
const videoMeta = document.getElementById('video-meta');
const videoErrors = document.getElementById('video-errors');
const heading = document.getElementById('page-heading');
const progressLabel = document.getElementById('listing-progress-label');
const progressTrack = document.querySelector('.listing-progress-track');
const progressValue = document.getElementById('listing-progress-value');
const draftStatus = document.getElementById('listing-draft-status');
const saveDraftButton = document.getElementById('save-listing-draft');
const deleteDraftButton = document.getElementById('delete-listing-draft');
const editId = new URLSearchParams(window.location.search).get('edit');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SOURCE_SIZE = 25 * 1024 * 1024;
const MAX_UPLOAD_SIZE = 5.5 * 1024 * 1024;
const MAX_IMAGES = 100;
const MAX_IMAGE_PIXELS = 40_000_000;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const MAX_VIDEO_DURATION = 90;
const DRAFT_VERSION = 1;
const DRAFT_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const DRAFT_SIMPLE_FIELDS = [
  'title', 'property_type', 'price', 'move_in_date', 'room_size_m2', 'deposit_amount',
  'furnished', 'description', 'city', 'area', 'transit_minutes',
];
const DRAFT_CHECKBOX_FIELDS = ['rent_includes', 'amenities', 'lifestyle_tags', 'preferred_occupations'];
const PLACEHOLDER_IMG = 'assets/placeholder.svg';
let currentUser = null;
let imageItems = [];
let originalExistingImages = [];
let videoItem = null;
let originalExistingVideo = null;
let originalLocation = null;
let originalLocationText = null;
let draftStorageEnabled = false;
let draftSaveTimer = null;

function addFileError(message) {
  const line = document.createElement('p');
  line.textContent = message;
  fileErrors.appendChild(line);
  fileErrors.classList.remove('hidden');
}

function clearFileErrors() {
  fileErrors.innerHTML = '';
  fileErrors.classList.add('hidden');
}

function cleanupPreview(item) {
  if (item.kind === 'file' && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
}

function renderImages() {
  previewGrid.innerHTML = '';
  imageItems.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'relative rounded-xl border border-line bg-white p-1.5';

    const image = document.createElement('img');
    image.src = item.kind === 'file'
      ? item.previewUrl
      : safePublicMediaUrl(item.url, LISTING_IMAGES_BUCKET, 'assets/placeholder.svg');
    image.alt = index === 0 ? 'Forhåndsvisning av forsidebilde' : `Forhåndsvisning av bilde ${index + 1}`;
    image.className = 'w-full aspect-square object-cover rounded-lg bg-primary-50';
    installImageFallback(image, PLACEHOLDER_IMG);

    const cover = document.createElement('span');
    cover.className = `absolute top-3 left-3 px-2 py-0.5 bg-white/95 text-[10px] font-semibold rounded-full ${index === 0 ? '' : 'hidden'}`;
    cover.textContent = 'Forside';

    const controls = document.createElement('div');
    controls.className = 'grid grid-cols-3 gap-1 mt-1.5';
    [
      ['left', '←', 'Flytt bildet til venstre', index === 0],
      ['remove', 'Fjern', `Fjern bilde ${index + 1}`, false],
      ['right', '→', 'Flytt bildet til høyre', index === imageItems.length - 1],
    ].forEach(([action, text, label, disabled]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = action;
      button.dataset.index = String(index);
      button.disabled = disabled;
      button.setAttribute('aria-label', label);
      button.className = 'text-xs px-1 py-1.5 rounded-md bg-primary-50 text-primary-700 disabled:opacity-30';
      button.textContent = text;
      controls.appendChild(button);
    });

    card.append(image, cover, controls);
    previewGrid.appendChild(card);
  });
  imageCount.textContent = `${imageItems.length} ${imageItems.length === 1 ? 'bilde' : 'bilder'} valgt`;
}

function isHeic(file) {
  return ['image/heic', 'image/heif'].includes(file.type.toLowerCase()) || /\.(heic|heif)$/i.test(file.name);
}

function addFiles(fileList) {
  clearFileErrors();
  const fingerprints = new Set(imageItems.filter((item) => item.kind === 'file').map((item) => item.fingerprint));
  for (const file of Array.from(fileList)) {
    if (imageItems.length >= MAX_IMAGES) {
      addFileError(`Du kan laste opp maks ${MAX_IMAGES} bilder per annonse.`);
      break;
    }
    if (isHeic(file)) {
      addFileError(`«${file.name}» er HEIC/HEIF. Eksporter bildet som JPG, PNG eller WebP først.`);
      continue;
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      addFileError(`«${file.name}» har et format som ikke støttes. Bruk JPG, PNG eller WebP.`);
      continue;
    }
    if (file.size > MAX_SOURCE_SIZE) {
      addFileError(`«${file.name}» er over 25 MB og må gjøres mindre før opplasting.`);
      continue;
    }
    const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
    if (fingerprints.has(fingerprint)) {
      addFileError(`«${file.name}» er allerede valgt.`);
      continue;
    }
    fingerprints.add(fingerprint);
    imageItems.push({
      id: crypto.randomUUID(), kind: 'file', file, fingerprint,
      previewUrl: URL.createObjectURL(file),
    });
  }
  fileInput.value = '';
  renderImages();
}

fileInput.addEventListener('change', () => addFiles(fileInput.files));
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});
['dragenter', 'dragover'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.add('border-primary-500', 'bg-primary-50');
}));
['dragleave', 'drop'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.remove('border-primary-500', 'bg-primary-50');
}));
dropZone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));

function clearVideoError() {
  videoErrors.textContent = '';
  videoErrors.classList.add('hidden');
}

function showVideoError(message) {
  videoErrors.textContent = message;
  videoErrors.classList.remove('hidden');
}

function cleanupVideoPreview(item = videoItem) {
  if (item?.kind === 'file' && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
}

function formatFileSize(bytes) {
  return `${Math.max(0.1, bytes / (1024 * 1024)).toLocaleString('nb-NO', { maximumFractionDigits: 1 })} MB`;
}

function renderVideo() {
  if (!videoItem) {
    videoPreview.pause();
    videoPreview.removeAttribute('src');
    videoPreview.load();
    videoPreviewCard.classList.add('hidden');
    return;
  }
  videoPreview.src = videoItem.kind === 'file'
    ? videoItem.previewUrl
    : safePublicMediaUrl(videoItem.url, LISTING_VIDEOS_BUCKET);
  videoPreviewCard.classList.remove('hidden');
  videoMeta.textContent = videoItem.kind === 'file'
    ? `${videoItem.file.name} · ${formatFileSize(videoItem.file.size)} · ${Math.ceil(videoItem.duration)} sek`
    : 'Lagret boligvideo';
}

function readVideoDuration(url) {
  return new Promise((resolve, reject) => {
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => resolve(probe.duration);
    probe.onerror = () => reject(new Error('Videoen kunne ikke leses.'));
    probe.src = url;
  });
}

async function chooseVideo(file) {
  clearVideoError();
  if (!file) return;
  if (!ALLOWED_VIDEO_TYPES.has(file.type)) {
    showVideoError('Videoformatet støttes ikke. Bruk MP4, WebM eller MOV.');
    return;
  }
  if (file.size > MAX_VIDEO_SIZE) {
    showVideoError('Videoen er større enn 50 MB. Velg en kortere eller mer komprimert video.');
    return;
  }
  const previewUrl = URL.createObjectURL(file);
  try {
    const duration = await readVideoDuration(previewUrl);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Videoen har ugyldig varighet.');
    if (duration > MAX_VIDEO_DURATION + 0.25) throw new Error('Videoen kan være maks 90 sekunder.');
    cleanupVideoPreview();
    videoItem = { kind: 'file', file, previewUrl, duration };
    renderVideo();
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    showVideoError(error.message || 'Videoen kunne ikke leses.');
  } finally {
    videoInput.value = '';
  }
}

videoInput.addEventListener('change', () => chooseVideo(videoInput.files?.[0]));
videoDropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    videoInput.click();
  }
});
['dragenter', 'dragover'].forEach((eventName) => videoDropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  videoDropZone.classList.add('border-primary-500', 'bg-primary-50');
}));
['dragleave', 'drop'].forEach((eventName) => videoDropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  videoDropZone.classList.remove('border-primary-500', 'bg-primary-50');
}));
videoDropZone.addEventListener('drop', (event) => chooseVideo(event.dataTransfer.files?.[0]));
document.getElementById('remove-video').addEventListener('click', () => {
  cleanupVideoPreview();
  videoItem = null;
  clearVideoError();
  renderVideo();
});

previewGrid.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const index = Number(button.dataset.index);
  if (button.dataset.action === 'remove') {
    cleanupPreview(imageItems[index]);
    imageItems.splice(index, 1);
  } else if (button.dataset.action === 'left' && index > 0) {
    [imageItems[index - 1], imageItems[index]] = [imageItems[index], imageItems[index - 1]];
  } else if (button.dataset.action === 'right' && index < imageItems.length - 1) {
    [imageItems[index + 1], imageItems[index]] = [imageItems[index], imageItems[index + 1]];
  }
  renderImages();
});

const noneCheckbox = document.getElementById('lifestyle-none');
const qualityCheckboxes = Array.from(form.querySelectorAll('input[name="lifestyle_tags"]'));
noneCheckbox.addEventListener('change', () => {
  if (noneCheckbox.checked) qualityCheckboxes.forEach((input) => { input.checked = false; });
});
qualityCheckboxes.forEach((input) => input.addEventListener('change', () => {
  if (input.checked) noneCheckbox.checked = false;
}));

function setField(name, value) {
  if (form.elements[name]) form.elements[name].value = value ?? '';
}

function checkBoxes(name, values) {
  (values || []).forEach((value) => {
    const input = form.querySelector(`input[name="${name}"][value="${CSS.escape(value)}"]`);
    if (input) input.checked = true;
  });
}

function updateListingProgress() {
  const required = Array.from(form.querySelectorAll('[required]'))
    .filter((control) => control.type !== 'file');
  const complete = required.filter((control) => String(control.value || '').trim() && control.checkValidity()).length;
  const maximum = required.length || 1;
  const percentage = Math.round((complete / maximum) * 100);
  progressLabel.textContent = complete === maximum
    ? 'Alt obligatorisk er fylt ut'
    : `${complete} av ${maximum} obligatoriske felt ferdig`;
  progressValue.style.width = `${percentage}%`;
  progressTrack?.setAttribute('aria-valuemax', String(maximum));
  progressTrack?.setAttribute('aria-valuenow', String(complete));
}

function listingDraftKey() {
  return currentUser ? `kollektivmatch:listing-draft:v${DRAFT_VERSION}:${currentUser.id}` : null;
}

function draftPayload() {
  const values = {};
  DRAFT_SIMPLE_FIELDS.forEach((name) => {
    values[name] = String(form.elements[name]?.value || '');
  });
  DRAFT_CHECKBOX_FIELDS.forEach((name) => {
    values[name] = Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value);
  });
  return { version: DRAFT_VERSION, updatedAt: Date.now(), values };
}

function draftHasContent(payload) {
  return Object.values(payload.values).some((value) => Array.isArray(value) ? value.length : value.trim());
}

function formatDraftTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
}

function removeStoredDraft({ announce = false } = {}) {
  const key = listingDraftKey();
  if (key) {
    try { localStorage.removeItem(key); } catch { /* Lagring kan være blokkert av nettleseren. */ }
  }
  draftStorageEnabled = false;
  clearTimeout(draftSaveTimer);
  deleteDraftButton?.classList.add('hidden');
  if (announce && draftStatus) {
    draftStatus.textContent = 'Den lagrede kladden er fjernet fra denne enheten. Feltene på skjermen er ikke slettet.';
  }
}

function saveDraft({ announce = false } = {}) {
  if (editId || !currentUser) return false;
  const payload = draftPayload();
  if (!draftHasContent(payload)) {
    if (announce && draftStatus) draftStatus.textContent = 'Fyll ut minst ett felt før du lagrer en kladd.';
    return false;
  }
  try {
    localStorage.setItem(listingDraftKey(), JSON.stringify(payload));
  } catch {
    if (draftStatus) draftStatus.textContent = 'Nettleseren tillot ikke lokal kladdlagring.';
    return false;
  }
  draftStorageEnabled = true;
  deleteDraftButton?.classList.remove('hidden');
  if (draftStatus) {
    draftStatus.textContent = `Kladd lagret på denne enheten kl. ${formatDraftTime(payload.updatedAt)}. Kontaktinfo og mediefiler er ikke med.`;
  }
  return true;
}

function scheduleDraftSave() {
  if (!draftStorageEnabled || editId) return;
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => saveDraft(), 500);
}

function restoreDraft() {
  const key = listingDraftKey();
  if (!key || editId) return false;
  let payload;
  try { payload = JSON.parse(localStorage.getItem(key) || 'null'); } catch { payload = null; }
  if (!payload || payload.version !== DRAFT_VERSION || !payload.updatedAt || Date.now() - payload.updatedAt > DRAFT_MAX_AGE) {
    if (payload) removeStoredDraft();
    return false;
  }
  DRAFT_SIMPLE_FIELDS.forEach((name) => setField(name, payload.values?.[name] || ''));
  DRAFT_CHECKBOX_FIELDS.forEach((name) => {
    form.querySelectorAll(`input[name="${name}"]`).forEach((input) => { input.checked = false; });
    checkBoxes(name, payload.values?.[name]);
  });
  draftStorageEnabled = true;
  deleteDraftButton?.classList.remove('hidden');
  if (draftStatus) {
    draftStatus.textContent = `Kladd fra ${new Date(payload.updatedAt).toLocaleDateString('nb-NO')} er hentet frem. Endringer lagres videre på denne enheten.`;
  }
  return true;
}

form.addEventListener('input', () => {
  updateListingProgress();
  scheduleDraftSave();
});
form.addEventListener('change', () => {
  updateListingProgress();
  scheduleDraftSave();
});
saveDraftButton?.addEventListener('click', () => saveDraft({ announce: true }));
deleteDraftButton?.addEventListener('click', () => removeStoredDraft({ announce: true }));

async function loadBitmap(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file, { imageOrientation: 'from-image' });
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bildet kunne ikke leses')); };
    image.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
}

async function compressImage(file) {
  const bitmap = await loadBitmap(file);
  if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
    bitmap.close?.();
    throw new Error(`«${file.name}» har for høy bildeoppløsning.`);
  }
  let scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  let blob = null;

  for (const quality of [0.84, 0.74, 0.64, 0.54]) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    blob = await canvasToBlob(canvas, quality);
    if (blob && blob.size <= MAX_UPLOAD_SIZE) break;
    scale *= 0.82;
  }
  if (typeof bitmap.close === 'function') bitmap.close();
  if (!blob || blob.size > MAX_UPLOAD_SIZE) throw new Error(`«${file.name}» kunne ikke komprimeres nok.`);
  return blob;
}

async function uploadNewImages() {
  const uploaded = new Map();
  const uploadedPaths = [];
  const fileItems = imageItems.filter((item) => item.kind === 'file');
  try {
    for (let index = 0; index < fileItems.length; index += 1) {
      const item = fileItems[index];
      submitButton.textContent = `Behandler bilde ${index + 1} av ${fileItems.length} …`;
      const blob = await compressImage(item.file);
      const path = `${currentUser.id}/${crypto.randomUUID()}.webp`;
      const { error } = await supabase.storage.from(LISTING_IMAGES_BUCKET).upload(path, blob, {
        upsert: false, contentType: 'image/webp', cacheControl: '3600',
      });
      if (error) throw error;
      uploadedPaths.push(path);
      const { data } = supabase.storage.from(LISTING_IMAGES_BUCKET).getPublicUrl(path);
      uploaded.set(item.id, data.publicUrl);
    }
    return { uploaded, uploadedPaths };
  } catch (error) {
    if (uploadedPaths.length) await supabase.storage.from(LISTING_IMAGES_BUCKET).remove(uploadedPaths);
    throw error;
  }
}

async function uploadNewVideo() {
  if (!videoItem || videoItem.kind !== 'file') return { url: videoItem?.url || null, path: null };
  submitButton.textContent = 'Laster opp video …';
  const extension = videoItem.file.type === 'video/webm' ? 'webm'
    : videoItem.file.type === 'video/quicktime' ? 'mov' : 'mp4';
  const path = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(LISTING_VIDEOS_BUCKET).upload(path, videoItem.file, {
    upsert: false,
    contentType: videoItem.file.type,
    cacheControl: '3600',
  });
  if (error) throw error;
  const { data } = supabase.storage.from(LISTING_VIDEOS_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

function resetSubmitButton() {
  submitButton.disabled = false;
  submitButton.textContent = editId ? 'Lagre endringer' : 'Publiser annonse';
}

function isMissingColumnError(error) {
  return error?.code === 'PGRST204'
    || error?.code === '42703'
    || /column.+does not exist|could not find.+column.+schema cache/i.test(error?.message || '');
}

async function ensureCurrentProfile(user) {
  const { data, error } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle();
  if (error || data) return { error };

  const fullName = String(user.user_metadata?.full_name || '').trim() || null;
  const result = await supabase.from('profiles').insert({ id: user.id, full_name: fullName });
  if (result.error?.code === '23505') return { error: null };
  return { error: result.error };
}

function saveErrorMessage(error, editing) {
  const action = editing ? 'lagre endringene' : 'publisere annonsen';
  if (error?.code === '23503') return 'Brukerprofilen mangler. Last siden på nytt og prøv igjen.';
  if (error?.code === '42501') return `Du har ikke tilgang til å ${action}. Logg ut og inn igjen.`;
  if (error?.code === '23514' || error?.code === '22023') return 'Én eller flere opplysninger i annonsen er ugyldige. Kontroller feltene og prøv igjen.';
  const safeCode = /^[A-Z0-9]{3,12}$/i.test(error?.code || '') ? ` Feilkode: ${error.code}.` : '';
  return `Kunne ikke ${action}. Ingen nye bilder eller videoer ble beholdt.${safeCode}`;
}

function legacyListingFields(fields) {
  const {
    images,
    video_url,
    property_type,
    room_size_m2,
    deposit_amount,
    furnished,
    rent_includes,
    lifestyle_tags,
    amenities,
    preferred_occupations,
    transit_minutes,
    grocery_nearby,
    gym_nearby,
    green_areas_nearby,
    location_lat,
    location_lon,
    location_precision,
    ...legacyFields
  } = fields;
  return legacyFields;
}

async function saveListing(fields) {
  const write = (payload) => {
    const query = editId
      ? supabase.from('listings').update(payload).eq('id', editId).eq('user_id', currentUser.id)
      : supabase.from('listings').insert({ ...payload, user_id: currentUser.id });
    return query.select('id').single();
  };

  let result = await write(fields);
  let usedLegacySchema = false;
  if (result.error && isMissingColumnError(result.error)) {
    console.warn('Databasen mangler de nye annonsefeltene. Prøver kompatibel lagring uten disse feltene.');
    result = await write(legacyListingFields(fields));
    usedLegacySchema = !result.error;
  }
  return { ...result, usedLegacySchema };
}

async function loadForEdit() {
  if (!editId) return true;
  if (!UUID_PATTERN.test(editId)) return false;
  const { data: listing, error } = await supabase.from('listings').select('*').eq('id', editId).single();
  if (error || !listing || listing.user_id !== currentUser.id) return false;

  heading.textContent = 'Rediger annonse';
  submitButton.textContent = 'Lagre endringer';
  ['title', 'property_type', 'price', 'move_in_date', 'room_size_m2', 'deposit_amount', 'description', 'roommates_info', 'city', 'area', 'transit_minutes', 'contact_info'].forEach((name) => setField(name, listing[name]));
  setField('furnished', listing.furnished == null ? '' : String(listing.furnished));
  checkBoxes('rent_includes', listing.rent_includes);
  checkBoxes('amenities', listing.amenities);
  checkBoxes('lifestyle_tags', listing.lifestyle_tags);
  checkBoxes('preferred_occupations', listing.preferred_occupations);
  const oldImages = Array.isArray(listing.images) && listing.images.length ? listing.images : (listing.image_url ? [listing.image_url] : []);
  originalExistingImages = [...new Set(oldImages)]
    .map((url) => safePublicMediaUrl(url, LISTING_IMAGES_BUCKET))
    .filter(Boolean);
  imageItems = originalExistingImages.map((url) => ({ id: crypto.randomUUID(), kind: 'existing', url }));
  originalExistingVideo = safePublicMediaUrl(listing.video_url, LISTING_VIDEOS_BUCKET) || null;
  videoItem = originalExistingVideo ? { kind: 'existing', url: originalExistingVideo } : null;
  const hasStoredLocation = listing.location_lat !== null && listing.location_lat !== undefined
    && listing.location_lon !== null && listing.location_lon !== undefined
    && Number.isFinite(Number(listing.location_lat)) && Number.isFinite(Number(listing.location_lon));
  originalLocation = hasStoredLocation
    ? {
      latitude: Number(listing.location_lat),
      longitude: Number(listing.location_lon),
      precision: listing.location_precision || (listing.area ? 'area' : 'city'),
    }
    : null;
  originalLocationText = { city: listing.city || '', area: listing.area || '' };
  renderImages();
  renderVideo();
  return true;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submitButton.disabled || !form.reportValidity()) return;
  submitButton.disabled = true;
  submitButton.textContent = editId ? 'Lagrer …' : 'Publiserer …';

  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== currentUser.id) {
    showToast('Økten din har utløpt. Logg inn på nytt.', 'error');
    resetSubmitButton();
    return;
  }

  const profileResult = await ensureCurrentProfile(user);
  if (profileResult.error) {
    console.error('Kunne ikke klargjøre brukerprofil:', profileResult.error);
    showToast(saveErrorMessage(profileResult.error, Boolean(editId)), 'error');
    resetSubmitButton();
    return;
  }

  const locationData = new FormData(form);
  const locationText = {
    city: String(locationData.get('city') || '').trim(),
    area: String(locationData.get('area') || '').trim(),
  };
  submitButton.textContent = 'Finner omtrentlig område …';
  let approximateLocation = await geocodeListingArea(locationText);
  const locationUnchanged = editId
    && originalLocationText
    && locationText.city === originalLocationText.city
    && locationText.area === originalLocationText.area;
  if (!approximateLocation && locationUnchanged) approximateLocation = originalLocation;

  let uploadResult = { uploaded: new Map(), uploadedPaths: [] };
  let videoUpload = { url: videoItem?.url || null, path: null };
  try {
    uploadResult = await uploadNewImages();
    videoUpload = await uploadNewVideo();
  } catch (error) {
    console.error('Mediebehandling eller opplasting feilet:', error.message);
    if (uploadResult.uploadedPaths.length) await supabase.storage.from(LISTING_IMAGES_BUCKET).remove(uploadResult.uploadedPaths);
    addFileError(error.message.startsWith('«') ? error.message : 'En mediefil kunne ikke lastes opp. Ingen nye mediefiler ble lagret.');
    showToast('Kunne ikke laste opp bilder eller video. Prøv igjen.', 'error');
    resetSubmitButton();
    return;
  }

  const images = imageItems.map((item) => item.kind === 'existing' ? item.url : uploadResult.uploaded.get(item.id)).filter(Boolean);
  const data = new FormData(form);
  const amenities = data.getAll('amenities');
  const furnishedValue = data.get('furnished');
  const fields = {
    title: data.get('title').trim(),
    property_type: data.get('property_type'),
    price: Number(data.get('price')),
    move_in_date: data.get('move_in_date') || null,
    room_size_m2: data.get('room_size_m2') ? Number(data.get('room_size_m2')) : null,
    deposit_amount: data.get('deposit_amount') ? Number(data.get('deposit_amount')) : null,
    furnished: furnishedValue === '' ? null : furnishedValue === 'true',
    rent_includes: data.getAll('rent_includes'),
    description: data.get('description').trim(),
    roommates_info: data.get('roommates_info').trim() || null,
    city: data.get('city').trim(),
    area: data.get('area').trim() || null,
    location_lat: approximateLocation?.latitude ?? null,
    location_lon: approximateLocation?.longitude ?? null,
    location_precision: approximateLocation?.precision ?? null,
    images,
    image_url: images[0] || null,
    video_url: videoUpload.url,
    contact_info: data.get('contact_info').trim() || null,
    lifestyle_tags: noneCheckbox.checked ? [] : data.getAll('lifestyle_tags'),
    amenities,
    preferred_occupations: data.getAll('preferred_occupations'),
    transit_minutes: data.get('transit_minutes') ? Number(data.get('transit_minutes')) : null,
    grocery_nearby: amenities.includes('matbutikk'),
    gym_nearby: amenities.includes('treningssenter'),
    green_areas_nearby: amenities.includes('grontomrade'),
  };

  const result = await saveListing(fields);

  if (result.error) {
    console.error('Kunne ikke lagre annonse:', result.error);
    if (uploadResult.uploadedPaths.length) await supabase.storage.from(LISTING_IMAGES_BUCKET).remove(uploadResult.uploadedPaths);
    if (videoUpload.path) await supabase.storage.from(LISTING_VIDEOS_BUCKET).remove([videoUpload.path]);
    showToast(saveErrorMessage(result.error, Boolean(editId)), 'error');
    resetSubmitButton();
    return;
  }

  if (result.usedLegacySchema) {
    const unusedUploads = [...uploadResult.uploaded.values()].filter((url) => url !== fields.image_url);
    if (unusedUploads.length) {
      const cleanup = await removeOwnedImages(supabase, unusedUploads, currentUser.id);
      if (cleanup.error) console.warn('Kunne ikke rydde ekstra bilder etter kompatibel lagring:', cleanup.error.message);
    }
    if (videoUpload.path) {
      const { error } = await supabase.storage.from(LISTING_VIDEOS_BUCKET).remove([videoUpload.path]);
      if (error) console.warn('Kunne ikke rydde video etter kompatibel lagring:', error.message);
      videoUpload = { url: null, path: null };
    }
  }

  if (editId) {
    const removedImages = originalExistingImages.filter((url) => !images.includes(url));
    const cleanup = await removeOwnedImages(supabase, removedImages, currentUser.id);
    const removedVideo = originalExistingVideo && originalExistingVideo !== videoUpload.url
      ? await removeOwnedVideo(supabase, originalExistingVideo, currentUser.id)
      : { error: null };
    if (cleanup.error || removedVideo.error) {
      console.error('Kunne ikke rydde fjernet media:', cleanup.error?.message || removedVideo.error?.message);
      showToast('Endringene er lagret, men fjernet media kunne ikke ryddes helt fra lagringen.', 'error');
    } else {
      showToast('Endringene er lagret.', 'success');
    }
  } else {
    const wantsBoost = data.get('boost_after_publish') === 'on';
    removeStoredDraft();
    showToast(result.usedLegacySchema
      ? 'Annonsen er publisert med forsidebildet. Kjør databasemigreringene for video og nye boligfelt.'
      : wantsBoost ? 'Annonsen er publisert. Åpner fremhevingsvalgene …' : 'Annonsen er publisert.', 'success');
    const listingId = result.data?.id;
    const target = wantsBoost && listingId
      ? `dashboard.html?published=${encodeURIComponent(listingId)}&boost=1`
      : listingId ? `listing-detail.html?id=${encodeURIComponent(listingId)}` : 'index.html';
    setTimeout(() => window.location.assign(target), 900);
    return;
  }
  setTimeout(() => window.location.assign('dashboard.html'), 900);
});

async function init() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    rememberReturnTo(window.location.href);
    const loginUrl = new URL('./index.html', document.baseURI);
    loginUrl.searchParams.set('auth', 'login');
    loginUrl.searchParams.set('returnTo', window.location.href);
    window.location.replace(loginUrl.toString());
    return;
  }
  currentUser = user;
  const loaded = await loadForEdit();
  if (!loaded) {
    showToast('Fant ikke annonsen, eller du har ikke tilgang til å redigere den.', 'error');
    setTimeout(() => window.location.replace('dashboard.html'), 700);
    return;
  }
  if (editId) {
    saveDraftButton?.classList.add('hidden');
    deleteDraftButton?.classList.add('hidden');
    if (draftStatus) draftStatus.textContent = 'Endringer lagres når du trykker «Lagre endringer».';
  } else {
    restoreDraft();
  }
  authCheckState.classList.add('hidden');
  form.classList.remove('hidden');
  renderImages();
  updateListingProgress();
}

init();
