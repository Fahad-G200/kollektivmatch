import { supabase } from './supabase-config.js';
import { rememberReturnTo } from './auth.js';
import { showToast } from './ui.js';
import {
  LISTING_IMAGES_BUCKET,
  LISTING_VIDEOS_BUCKET,
  PROFILE_AVATARS_BUCKET,
  installImageFallback,
  removeOwnedAvatar,
  removeOwnedImages,
  removeOwnedVideo,
} from './storage-utils.js?v=20260825-2';
import { clampCropOffset, getCropDrawRect } from './avatar-crop.js?v=20260825-1';

const listingsContainer = document.getElementById('my-listings');
const conversationsContainer = document.getElementById('my-conversations');
const boostOrdersContainer = document.getElementById('boost-orders');
const authNav = document.getElementById('auth-nav');
const profileForm = document.getElementById('profile-form');
const preferencesForm = document.getElementById('preferences-form');
const exportDataButton = document.getElementById('export-data-btn');
const deleteAccountForm = document.getElementById('delete-account-form');
const boostModal = document.getElementById('boost-modal');
const boostForm = document.getElementById('boost-form');
const avatarInput = document.getElementById('profile-avatar-input');
const avatarCropDialog = document.getElementById('avatar-crop-dialog');
const avatarCropCanvas = document.getElementById('avatar-crop-canvas');
const avatarCropZoom = document.getElementById('avatar-crop-zoom');
const avatarCropSave = document.getElementById('avatar-crop-save');
const shortcutListingsSummary = document.getElementById('shortcut-listings-summary');
const shortcutConversationsSummary = document.getElementById('shortcut-conversations-summary');
const shortcutVippsSummary = document.getElementById('shortcut-vipps-summary');
const PLACEHOLDER_IMG = 'assets/placeholder.svg';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_LABELS = { active: 'Aktiv', paused: 'Pauset', rented: 'Utleid' };
const PAYMENT_LABELS = {
  pending: 'Venter på betaling', authorized: 'Autorisert – ikke betalt ennå', captured: 'Betalt og levert',
  cancelled: 'Kansellert', aborted: 'Avbrutt', expired: 'Utløpt', failed: 'Mislykket', refunded: 'Refundert',
};
let currentUser = null;
let currentProfile = null;
let myListings = [];
let avatarCropState = null;
let boostProducts = [];
let selectedBoostListing = null;
let preferencesAvailable = true;
let homeSeekerAvailable = true;
let profileFieldsAvailable = true;
let boostAvailable = true;
let vippsCapabilities = null;

function isMissingFunctionError(error) {
  return error?.code === 'PGRST202' || error?.code === '42883'
    || /function.+does not exist|could not find.+function.+schema cache/i.test(error?.message || '');
}

function isMissingDatabaseObject(error) {
  return ['PGRST204', 'PGRST205', '42P01', '42703'].includes(error?.code)
    || /column.+does not exist|relation.+does not exist|schema cache/i.test(error?.message || '');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
}

function formatTime(timestamp) {
  if (!timestamp) return 'Ikke oppgitt';
  return new Date(timestamp).toLocaleString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDate(timestamp) {
  if (!timestamp) return 'Ikke oppgitt';
  return new Date(timestamp).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatNokFromOre(value) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', minimumFractionDigits: 0 }).format(Number(value || 0) / 100);
}

function isEffectivelyFeatured(item) {
  return Boolean(item.is_featured && item.featured_until && new Date(item.featured_until) > new Date());
}

function setPreferencesUnavailable() {
  preferencesAvailable = false;
  document.getElementById('preferences-unavailable')?.classList.remove('hidden');
  preferencesForm.querySelectorAll('input, button').forEach((control) => { control.disabled = true; });
}

function setHomeSeekerUnavailable() {
  homeSeekerAvailable = false;
  document.getElementById('home-seeker-unavailable')?.classList.remove('hidden');
  document.querySelectorAll('#home-seeker-sharing input, #home-seeker-sharing textarea').forEach((control) => { control.disabled = true; });
}

function setProfileUnavailable() {
  profileFieldsAvailable = false;
  document.getElementById('profile-unavailable')?.classList.remove('hidden');
  profileForm.querySelectorAll('input, select, button').forEach((control) => { control.disabled = true; });
  if (shortcutVippsSummary) shortcutVippsSummary.textContent = 'Krever databaseoppdatering';
}

async function removeAllUserImages(userId) {
  const paths = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage.from(LISTING_IMAGES_BUCKET).list(userId, {
      limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' },
    });
    if (error) return { error, paths };
    const rows = data || [];
    rows.filter((item) => item.id || item.metadata).forEach((item) => paths.push(`${userId}/${item.name}`));
    if (rows.length < pageSize) break;
  }
  if (!paths.length) return { error: null, paths };
  for (let index = 0; index < paths.length; index += pageSize) {
    const { error } = await supabase.storage.from(LISTING_IMAGES_BUCKET).remove(paths.slice(index, index + pageSize));
    if (error) return { error, paths };
  }
  return { error: null, paths };
}

async function removeAllUserVideos(userId) {
  const paths = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage.from(LISTING_VIDEOS_BUCKET).list(userId, {
      limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' },
    });
    if (error) return { error, paths };
    const rows = data || [];
    rows.filter((item) => item.id || item.metadata).forEach((item) => paths.push(`${userId}/${item.name}`));
    if (rows.length < pageSize) break;
  }
  if (!paths.length) return { error: null, paths };
  for (let index = 0; index < paths.length; index += pageSize) {
    const { error } = await supabase.storage.from(LISTING_VIDEOS_BUCKET).remove(paths.slice(index, index + pageSize));
    if (error) return { error, paths };
  }
  return { error: null, paths };
}

function profileInitials(name) {
  const parts = String(name || currentUser?.email || 'KM').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'KM';
}

function renderProfileAvatar(url, name) {
  const image = document.getElementById('profile-avatar');
  const initials = document.getElementById('profile-avatar-initials');
  initials.textContent = profileInitials(name);
  if (url) {
    image.src = `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
    image.classList.remove('hidden');
    initials.classList.add('hidden');
    document.getElementById('profile-avatar-remove').classList.remove('hidden');
  } else {
    image.removeAttribute('src');
    image.classList.add('hidden');
    initials.classList.remove('hidden');
    document.getElementById('profile-avatar-remove').classList.add('hidden');
  }
}

function renderVippsVerification() {
  const card = document.getElementById('vipps-verification-card');
  const status = document.getElementById('vipps-verification-status');
  const description = document.getElementById('vipps-verification-description');
  const note = document.getElementById('vipps-verification-note');
  const button = document.getElementById('start-vipps-verification');
  if (!card || !status || !description || !note || !button) return;

  const verified = currentProfile?.vipps_verified === true;
  card.classList.toggle('is-verified', verified);
  note.classList.add('hidden');
  if (verified) {
    status.textContent = 'Vipps-konto bekreftet';
    status.classList.add('is-verified');
    description.textContent = 'Kontoen din er koblet til en serververifisert Vipps-konto. Merket vises på annonsene dine og i samtaler.';
    if (shortcutVippsSummary) shortcutVippsSummary.textContent = 'Vipps-kontoen din er bekreftet';
    button.classList.add('hidden');
    return;
  }

  status.textContent = 'Ikke bekreftet';
  status.classList.remove('is-verified');
  button.classList.remove('hidden');
  if (currentProfile && !Object.hasOwn(currentProfile, 'vipps_verified')) {
    button.disabled = true;
    if (shortcutVippsSummary) shortcutVippsSummary.textContent = 'Krever databaseoppdatering';
    note.textContent = 'Databasemigreringen for Vipps-verifisering må installeres først.';
    note.classList.remove('hidden');
  } else if (!vippsCapabilities) {
    button.disabled = true;
    button.textContent = 'Kontrollerer Vipps …';
    if (shortcutVippsSummary) shortcutVippsSummary.textContent = 'Kontrollerer bekreftelsesstatus …';
  } else if (!vippsCapabilities.login_ready) {
    button.disabled = true;
    button.textContent = 'Bekreft med Vipps';
    if (shortcutVippsSummary) shortcutVippsSummary.textContent = 'Klar når virksomhetens Vipps-avtale er aktiv';
    note.textContent = 'Den tekniske koblingen er klar, men virksomhetens Vipps Login-avtale og nøkler må aktiveres før bruk.';
    note.classList.remove('hidden');
  } else {
    button.disabled = false;
    button.textContent = 'Bekreft med Vipps';
    if (shortcutVippsSummary) shortcutVippsSummary.textContent = 'Kontoen kan bekreftes med Vipps';
  }
}

function renderAccountTrustSignals() {
  const emailStatus = document.getElementById('email-confirmation-status');
  const educationStatus = document.getElementById('education-email-status');
  if (!emailStatus || !educationStatus) return;

  const emailConfirmed = Boolean(currentUser?.email_confirmed_at || currentUser?.confirmed_at);
  emailStatus.textContent = emailConfirmed ? '✓ E-post bekreftet' : 'E-post ikke bekreftet';
  emailStatus.classList.toggle('is-verified', emailConfirmed);

  const educationConfirmed = currentProfile?.is_verified === true;
  educationStatus.textContent = educationConfirmed ? '✓ Utdannings-e-post bekreftet' : 'Utdannings-e-post ikke bekreftet';
  educationStatus.classList.toggle('is-verified', educationConfirmed);
}

async function loadVippsCapabilities() {
  const { data, error } = await supabase.functions.invoke('vipps-integration-status', { body: {} });
  vippsCapabilities = error || !data
    ? { login_ready: false, payment_ready: false, stripe_payment_ready: false, preferred_payment_provider: null, environment: null }
    : data;
  renderVippsVerification();
}

function checkValues(name, values) {
  preferencesForm.querySelectorAll(`input[name="${name}"]`).forEach((input) => { input.checked = (values || []).includes(input.value); });
}

async function loadProfileAndPreferences() {
  const { data, error } = await supabase.rpc('get_my_profile');
  if (error) {
    console.error('Kunne ikke hente profil:', error.message);
    if (shortcutVippsSummary) shortcutVippsSummary.textContent = 'Status kunne ikke lastes';
    if (isMissingFunctionError(error)) {
      setProfileUnavailable();
      setPreferencesUnavailable();
    } else showToast('Kunne ikke laste profilen din.', 'error');
    return;
  }
  const profile = Array.isArray(data) ? data[0] : data;
  currentProfile = profile || {};
  profileForm.full_name.value = profile?.full_name ?? '';
  profileForm.occupation.value = profile?.occupation ?? '';
  profileForm.institution.value = profile?.institution ?? '';
  profileForm.income_amount.value = profile?.income_amount ?? '';
  profileForm.income_period.value = profile?.income_period || 'month';
  renderProfileAvatar(profile?.avatar_url, profile?.full_name);
  renderVippsVerification();
  renderAccountTrustSignals();
  if (!Object.hasOwn(profile || {}, 'income_amount')) setProfileUnavailable();

  preferencesForm.monthly_budget_max.value = profile?.monthly_budget_max ?? '';
  preferencesForm.desired_move_in_date.value = profile?.desired_move_in_date ?? '';
  preferencesForm.search_location.value = profile?.search_location ?? '';
  checkValues('preferred_property_types', profile?.preferred_property_types);
  checkValues('priority_tags', profile?.priority_tags);
  if (Object.hasOwn(profile || {}, 'home_seeker_visible')) {
    preferencesForm.home_seeker_visible.checked = Boolean(profile?.home_seeker_visible);
    preferencesForm.seeker_bio.value = profile?.seeker_bio ?? '';
  } else setHomeSeekerUnavailable();
}

document.getElementById('start-vipps-verification')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (button.disabled || currentProfile?.vipps_verified) return;
  button.disabled = true;
  button.textContent = 'Åpner Vipps …';
  const { data, error } = await supabase.functions.invoke('start-vipps-verification', { body: {} });
  if (data?.already_verified) {
    currentProfile = { ...currentProfile, vipps_verified: true };
    renderVippsVerification();
    showToast('Vipps-kontoen er allerede bekreftet.', 'success');
    return;
  }
  if (error || !data?.verification_url) {
    console.error('Kunne ikke starte Vipps-verifisering:', error?.message || data?.error || 'UNKNOWN');
    showToast(data?.message || 'Kunne ikke starte Vipps-verifiseringen. Prøv igjen senere.', 'error');
    button.disabled = false;
    button.textContent = 'Bekreft med Vipps';
    return;
  }
  window.location.assign(data.verification_url);
});

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!profileFieldsAvailable) return;
  const button = document.getElementById('profile-submit');
  const formData = new FormData(profileForm);
  const incomeValue = String(formData.get('income_amount') || '').trim();
  const payload = {
    full_name: String(formData.get('full_name') || '').trim().slice(0, 120) || null,
    occupation: formData.get('occupation') || null,
    institution: String(formData.get('institution') || '').trim().slice(0, 160) || null,
    income_amount: incomeValue ? Number(incomeValue) : null,
    income_period: incomeValue ? formData.get('income_period') : null,
  };
  if (incomeValue && (!Number.isInteger(payload.income_amount) || payload.income_amount < 1 || payload.income_amount > 100000000)) {
    showToast('Oppgi inntekt som et helt beløp i kroner.', 'error');
    return;
  }
  button.disabled = true;
  button.textContent = 'Lagrer …';
  const { error } = await supabase.from('profiles').update(payload).eq('id', currentUser.id);
  button.disabled = false;
  button.textContent = 'Lagre profil';
  if (error) {
    console.error('Kunne ikke lagre profil:', error.message);
    showToast(isMissingDatabaseObject(error) ? 'Profilfeltene krever at den nye migreringen installeres.' : 'Kunne ikke lagre profilen. Prøv igjen.', 'error');
    return;
  }
  currentProfile = { ...currentProfile, ...payload };
  renderProfileAvatar(currentProfile.avatar_url, payload.full_name);
  showToast('Profilen er lagret.', 'success');
});

function normalizeAvatarCropOffset(offsetX, offsetY, zoom = avatarCropState?.zoom || 1) {
  if (!avatarCropState) return { x: 0, y: 0 };
  return clampCropOffset({
    imageWidth: avatarCropState.bitmap.width,
    imageHeight: avatarCropState.bitmap.height,
    viewportWidth: avatarCropCanvas.width,
    viewportHeight: avatarCropCanvas.height,
    zoom,
    offsetX,
    offsetY,
  });
}

function drawAvatarCrop() {
  if (!avatarCropState) return;
  const rect = getCropDrawRect({
    imageWidth: avatarCropState.bitmap.width,
    imageHeight: avatarCropState.bitmap.height,
    viewportWidth: avatarCropCanvas.width,
    viewportHeight: avatarCropCanvas.height,
    zoom: avatarCropState.zoom,
    offsetX: avatarCropState.offsetX,
    offsetY: avatarCropState.offsetY,
  });
  avatarCropState.offsetX = rect.offsetX;
  avatarCropState.offsetY = rect.offsetY;
  const context = avatarCropCanvas.getContext('2d', { alpha: false });
  context.fillStyle = '#F4F2FF';
  context.fillRect(0, 0, avatarCropCanvas.width, avatarCropCanvas.height);
  context.drawImage(avatarCropState.bitmap, rect.x, rect.y, rect.width, rect.height);
}

function closeAvatarCrop() {
  avatarCropState?.bitmap?.close?.();
  avatarCropState = null;
  avatarCropZoom.value = '1';
  avatarInput.value = '';
  if (avatarCropDialog.open) avatarCropDialog.close();
}

async function openAvatarCrop(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('FORMAT');
  if (file.size > 8 * 1024 * 1024) throw new Error('SIZE');
  const bitmap = await createImageBitmap(file);
  if (!bitmap.width || !bitmap.height) {
    bitmap.close?.();
    throw new Error('IMAGE');
  }
  avatarCropState?.bitmap?.close?.();
  avatarCropState = { bitmap, zoom: 1, offsetX: 0, offsetY: 0, dragging: null };
  avatarCropZoom.value = '1';
  drawAvatarCrop();
  avatarCropDialog.showModal();
  requestAnimationFrame(() => avatarCropCanvas.focus());
}

avatarInput.addEventListener('change', async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  if (!profileFieldsAvailable) {
    avatarInput.value = '';
    showToast('Profilbildet krever at profilmigreringen er installert.', 'error');
    return;
  }
  try {
    await openAvatarCrop(file);
  } catch (error) {
    console.error('Kunne ikke åpne profilbildet:', error?.message || error);
    const message = error?.message === 'FORMAT' ? 'Velg JPG, PNG eller WebP.'
      : error?.message === 'SIZE' ? 'Bildet er for stort. Maks originalfil er 8 MB.'
        : 'Bildet kunne ikke åpnes. Prøv et annet bilde.';
    showToast(message, 'error');
    avatarInput.value = '';
  }
});

avatarCropCanvas.addEventListener('pointerdown', (event) => {
  if (!avatarCropState) return;
  avatarCropCanvas.setPointerCapture(event.pointerId);
  avatarCropState.dragging = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    offsetX: avatarCropState.offsetX,
    offsetY: avatarCropState.offsetY,
  };
  avatarCropCanvas.classList.add('is-dragging');
});

avatarCropCanvas.addEventListener('pointermove', (event) => {
  const dragging = avatarCropState?.dragging;
  if (!dragging || dragging.pointerId !== event.pointerId) return;
  const bounds = avatarCropCanvas.getBoundingClientRect();
  const ratio = avatarCropCanvas.width / bounds.width;
  const offset = normalizeAvatarCropOffset(
    dragging.offsetX + (event.clientX - dragging.clientX) * ratio,
    dragging.offsetY + (event.clientY - dragging.clientY) * ratio,
  );
  avatarCropState.offsetX = offset.x;
  avatarCropState.offsetY = offset.y;
  drawAvatarCrop();
});

function stopAvatarDrag(event) {
  if (!avatarCropState?.dragging || avatarCropState.dragging.pointerId !== event.pointerId) return;
  avatarCropState.dragging = null;
  avatarCropCanvas.classList.remove('is-dragging');
}

avatarCropCanvas.addEventListener('pointerup', stopAvatarDrag);
avatarCropCanvas.addEventListener('pointercancel', stopAvatarDrag);

avatarCropCanvas.addEventListener('keydown', (event) => {
  if (!avatarCropState || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const step = event.shiftKey ? 24 : 8;
  const offset = normalizeAvatarCropOffset(
    avatarCropState.offsetX + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
    avatarCropState.offsetY + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
  );
  avatarCropState.offsetX = offset.x;
  avatarCropState.offsetY = offset.y;
  drawAvatarCrop();
});

avatarCropZoom.addEventListener('input', () => {
  if (!avatarCropState) return;
  avatarCropState.zoom = Number(avatarCropZoom.value);
  const offset = normalizeAvatarCropOffset(avatarCropState.offsetX, avatarCropState.offsetY, avatarCropState.zoom);
  avatarCropState.offsetX = offset.x;
  avatarCropState.offsetY = offset.y;
  drawAvatarCrop();
});

document.getElementById('avatar-crop-reset').addEventListener('click', () => {
  if (!avatarCropState) return;
  avatarCropState.zoom = 1;
  avatarCropState.offsetX = 0;
  avatarCropState.offsetY = 0;
  avatarCropZoom.value = '1';
  drawAvatarCrop();
  avatarCropCanvas.focus();
});

document.getElementById('avatar-crop-close').addEventListener('click', closeAvatarCrop);
document.getElementById('avatar-crop-cancel').addEventListener('click', closeAvatarCrop);
avatarCropDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeAvatarCrop();
});

avatarCropSave.addEventListener('click', async () => {
  if (!avatarCropState || !currentUser) return;
  avatarCropSave.disabled = true;
  avatarCropSave.textContent = 'Lagrer …';
  try {
    drawAvatarCrop();
    const blob = await new Promise((resolve) => avatarCropCanvas.toBlob(resolve, 'image/webp', 0.84));
    if (!blob) throw new Error('COMPRESS');
    const path = `${currentUser.id}/avatar.webp`;
    const { error: uploadError } = await supabase.storage.from(PROFILE_AVATARS_BUCKET).upload(path, blob, {
      contentType: 'image/webp', upsert: true, cacheControl: '3600',
    });
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from(PROFILE_AVATARS_BUCKET).getPublicUrl(path);
    const avatarUrl = data.publicUrl;
    const { error: profileError } = await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', currentUser.id);
    if (profileError) throw profileError;
    currentProfile = { ...currentProfile, avatar_url: avatarUrl };
    renderProfileAvatar(avatarUrl, profileForm.full_name.value);
    closeAvatarCrop();
    showToast('Profilbildet er lagret med det valgte utsnittet.', 'success');
  } catch (error) {
    console.error('Kunne ikke oppdatere profilbilde:', error?.message || error);
    showToast('Kunne ikke laste opp profilbildet. Prøv igjen.', 'error');
  } finally {
    avatarCropSave.disabled = false;
    avatarCropSave.textContent = 'Lagre profilbilde';
  }
});

document.getElementById('profile-avatar-remove').addEventListener('click', async (event) => {
  if (!currentProfile?.avatar_url || !confirm('Fjerne profilbildet?')) return;
  event.currentTarget.disabled = true;
  const cleanup = await removeOwnedAvatar(supabase, currentProfile.avatar_url, currentUser.id);
  if (cleanup.error) {
    console.error('Kunne ikke slette profilbilde:', cleanup.error.message);
    showToast('Kunne ikke fjerne profilbildet.', 'error');
    event.currentTarget.disabled = false;
    return;
  }
  const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', currentUser.id);
  event.currentTarget.disabled = false;
  if (error) {
    showToast('Bildet ble fjernet, men profilen kunne ikke oppdateres.', 'error');
    return;
  }
  currentProfile.avatar_url = null;
  renderProfileAvatar(null, profileForm.full_name.value);
  showToast('Profilbildet er fjernet.', 'success');
});

preferencesForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!preferencesAvailable) return;
  const button = document.getElementById('preferences-submit');
  const data = new FormData(preferencesForm);
  const priorities = data.getAll('priority_tags');
  if (priorities.length > 3) return showToast('Velg maks 3 prioriteringer.', 'error');
  button.disabled = true;
  button.textContent = 'Lagrer …';
  const payload = {
    monthly_budget_max: data.get('monthly_budget_max') ? Number(data.get('monthly_budget_max')) : null,
    desired_move_in_date: data.get('desired_move_in_date') || null,
    preferred_property_types: data.getAll('preferred_property_types'),
    priority_tags: priorities,
  };
  if (homeSeekerAvailable) {
    payload.search_location = String(data.get('search_location') || '').trim().slice(0, 100) || null;
    payload.home_seeker_visible = data.get('home_seeker_visible') === 'on';
    payload.seeker_bio = String(data.get('seeker_bio') || '').trim().slice(0, 300) || null;
    const visibleCriteria = [
      Number(payload.monthly_budget_max) > 0,
      Boolean(payload.desired_move_in_date),
      payload.preferred_property_types.length > 0,
      priorities.length > 0,
      Boolean(payload.search_location),
      Boolean(currentProfile?.occupation),
    ].filter(Boolean).length;
    if (payload.home_seeker_visible && !String(currentProfile?.full_name || '').trim()) {
      button.disabled = false;
      button.textContent = 'Lagre preferanser';
      return showToast('Lagre navnet ditt under Profilen din før du gjør boligsøkerprofilen synlig.', 'error');
    }
    if (payload.home_seeker_visible && visibleCriteria < 2) {
      button.disabled = false;
      button.textContent = 'Lagre preferanser';
      return showToast('Fyll ut minst to søkepreferanser før du gjør profilen synlig.', 'error');
    }
  }
  const { error } = await supabase.from('profiles').update(payload).eq('id', currentUser.id);
  button.disabled = false;
  button.textContent = 'Lagre preferanser';
  if (error) {
    console.error('Kunne ikke lagre preferanser:', error.message);
    showToast('Kunne ikke lagre preferansene. Prøv igjen.', 'error');
  } else {
    currentProfile = { ...currentProfile, ...payload };
    showToast(payload.home_seeker_visible ? 'Preferansene er lagret, og boligsøkerprofilen er synlig.' : 'Preferansene er lagret.', 'success');
  }
});

async function loadConversations() {
  const { data: rows, error } = await supabase.from('messages')
    .select('id, listing_id, sender_id, receiver_id, content, is_read, created_at')
    .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
    .order('created_at', { ascending: false }).limit(200);
  if (error) {
    console.error('Kunne ikke hente samtaler:', error.message);
    if (shortcutConversationsSummary) shortcutConversationsSummary.textContent = 'Kunne ikke laste samtalene';
    conversationsContainer.innerHTML = '<p class="text-red-600">Kunne ikke laste samtaler. Prøv å laste siden på nytt.</p>';
    return;
  }
  if (!rows.length) {
    if (shortcutConversationsSummary) shortcutConversationsSummary.textContent = 'Ingen samtaler ennå';
    conversationsContainer.innerHTML = '<div class="bg-white rounded-2xl p-10 text-center border border-line border-dashed"><p class="font-semibold">Ingen samtaler ennå</p><p class="text-sm text-mist mt-1">Når noen spør om en annonse, dukker samtalen opp her.</p><a href="index.html#listings" class="inline-flex mt-4 text-primary-700 text-sm font-semibold hover:underline">Se ledige rom</a></div>';
    return;
  }
  const conversationMap = new Map();
  rows.forEach((message) => {
    const otherId = message.sender_id === currentUser.id ? message.receiver_id : message.sender_id;
    const key = `${message.listing_id}:${otherId}`;
    if (!conversationMap.has(key)) conversationMap.set(key, { listingId: message.listing_id, otherId, message, unread: 0 });
    if (message.receiver_id === currentUser.id && !message.is_read) conversationMap.get(key).unread += 1;
  });
  const conversations = [...conversationMap.values()];
  const unreadCount = conversations.reduce((total, conversation) => total + conversation.unread, 0);
  if (shortcutConversationsSummary) {
    const conversationLabel = conversations.length === 1 ? 'samtale' : 'samtaler';
    const unreadLabel = unreadCount === 1 ? 'ulest' : 'uleste';
    shortcutConversationsSummary.textContent = `${conversations.length} ${conversationLabel}${unreadCount ? ` · ${unreadCount} ${unreadLabel}` : ''}`;
  }
  const listingIds = [...new Set(conversations.map((item) => item.listingId))];
  const profileIds = [...new Set(conversations.map((item) => item.otherId))];
  const [{ data: listingRows }, { data: profileRows }] = await Promise.all([
    supabase.from('listings').select('id, title').in('id', listingIds),
    supabase.from('profiles').select('id, full_name, avatar_url, vipps_verified, is_verified').in('id', profileIds),
  ]);
  const listingMap = Object.fromEntries((listingRows || []).map((row) => [row.id, row]));
  const profileMap = Object.fromEntries((profileRows || []).map((row) => [row.id, row]));
  conversationsContainer.innerHTML = conversations.map(({ listingId, otherId, message, unread }) => {
    const profile = profileMap[otherId] || {};
    const name = profile.full_name || 'Bruker';
    const avatar = profile.avatar_url
      ? `<img src="${escapeHtml(profile.avatar_url)}" class="w-full h-full object-cover" alt="" />`
      : `<span>${escapeHtml(profileInitials(name))}</span>`;
    return `
      <a href="chat.html?listing=${encodeURIComponent(listingId)}&user=${encodeURIComponent(otherId)}" class="bg-white rounded-2xl border border-line p-5 hover:border-primary-200 block transition-colors">
        <div class="flex items-start gap-3"><div class="chat-peer-avatar">${avatar}</div><div class="min-w-0 flex-1"><div class="flex items-center gap-2 flex-wrap"><p class="text-xs font-bold">${escapeHtml(name)}</p>${profile.vipps_verified ? '<span class="inline-flex bg-[#EAF8F0] text-[#207A45] text-[10px] font-semibold px-2 py-0.5 rounded-full">✓ Vipps-bekreftet</span>' : ''}${profile.is_verified ? '<span class="inline-flex bg-[#F4F2FF] text-[#5A3EC2] text-[10px] font-semibold px-2 py-0.5 rounded-full">✓ Utdannings-e-post</span>' : ''}</div><h3 class="font-semibold truncate">${escapeHtml(listingMap[listingId]?.title || 'Annonse')}</h3><p class="text-sm text-mist mt-1 truncate">${escapeHtml(message.content)}</p></div><div class="text-right shrink-0"><p class="text-xs text-mist">${formatTime(message.created_at)}</p>${unread ? `<span class="inline-block mt-2 px-2 py-0.5 rounded-full bg-primary-50 text-primary-600 text-xs font-semibold">${unread} ulest</span>` : ''}</div></div>
      </a>`;
  }).join('');
}

function listingCard(item) {
  const image = escapeHtml(item.images?.[0] || item.image_url || PLACEHOLDER_IMG);
  const hasStatus = Object.hasOwn(STATUS_LABELS, item.status);
  const featured = isEffectivelyFeatured(item);
  const statusOptions = hasStatus ? Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${item.status === value ? 'selected' : ''}>${label}</option>`).join('') : '';
  const statusControl = hasStatus
    ? `<label class="text-xs font-semibold text-mist">Status<select data-action="status" data-id="${item.id}" class="block mt-1 px-3 py-2 rounded-lg border border-line bg-white text-sm text-ink">${statusOptions}</select></label>`
    : '<p class="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Statusstyring krever databaseoppdatering</p>';
  const featuredInfo = featured ? `<div class="featured-purchase-note"><strong>Fremhevet · kjøpt plassering</strong><span>til ${formatDate(item.featured_until)}</span></div>` : '';
  const boostButton = hasStatus ? `<button type="button" data-action="boost" data-id="${item.id}" ${item.status !== 'active' ? 'disabled' : ''} class="px-4 py-2 text-sm font-semibold rounded-lg bg-primary-50 text-primary-700 hover:bg-primary-100 disabled:opacity-50 disabled:cursor-not-allowed">Fremhev annonse</button>` : '';
  const seekersButton = item.status === 'active' ? `<a href="home-seekers.html?listing=${encodeURIComponent(item.id)}" class="px-4 py-2 text-sm font-semibold rounded-lg bg-[#FFF6EE] text-[#8A4E21] hover:bg-[#FCEBDD]">Finn boligsøkere</a>` : '';
  return `
    <article class="bg-white p-6 rounded-2xl border border-line shadow-sm space-y-4" data-listing-id="${item.id}">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div class="flex items-center gap-4 min-w-0"><div class="w-16 h-16 bg-primary-50 rounded-lg overflow-hidden shrink-0"><img src="${image}" class="listing-thumb w-full h-full object-cover" alt="${escapeHtml(item.title)}"></div><div class="min-w-0"><div class="flex items-center gap-2"><h3 class="font-bold text-lg truncate">${escapeHtml(item.title)}</h3>${item.video_url ? '<span class="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary-50 text-primary-700">Video</span>' : ''}</div><p class="text-sm text-mist">${new Intl.NumberFormat('nb-NO').format(item.price)} kr/mnd • ${escapeHtml(item.city)}</p><p class="text-xs text-mist mt-1">Opprettet ${formatTime(item.created_at)} · Oppdatert ${formatTime(item.updated_at || item.created_at)}</p></div></div>${statusControl}</div>
      ${featuredInfo}
      <div class="flex items-center gap-2 flex-wrap justify-end">${seekersButton}${boostButton}<a href="listing-detail.html?id=${encodeURIComponent(item.id)}" class="px-4 py-2 text-sm text-mist hover:bg-primary-50 rounded-lg">Se</a><a href="create-listing.html?edit=${encodeURIComponent(item.id)}" class="px-4 py-2 text-sm text-primary-600 hover:bg-primary-50 rounded-lg">Rediger</a><button type="button" data-action="delete" data-id="${item.id}" class="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-60">Slett</button></div>
    </article>`;
}

async function loadListings() {
  const { data, error } = await supabase.from('listings').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
  if (error) {
    console.error('Kunne ikke hente annonser:', error.message);
    if (shortcutListingsSummary) shortcutListingsSummary.textContent = 'Kunne ikke laste annonsene';
    listingsContainer.innerHTML = '<p class="text-red-600">Kunne ikke laste annonsene dine. Prøv å laste siden på nytt.</p>';
    return;
  }
  myListings = data || [];
  if (shortcutListingsSummary) shortcutListingsSummary.textContent = `${myListings.length} ${myListings.length === 1 ? 'annonse' : 'annonser'} å administrere`;
  listingsContainer.innerHTML = myListings.length ? myListings.map(listingCard).join('') : '<div class="bg-white rounded-2xl p-12 text-center border border-line border-dashed"><p class="text-mist mb-4">Du har ingen annonser.</p><a href="create-listing.html" class="text-primary-600 font-semibold hover:underline">Opprett din første nå</a></div>';
  listingsContainer.querySelectorAll('.listing-thumb').forEach((image) => installImageFallback(image, PLACEHOLDER_IMG));
}

function orderCard(order) {
  const status = escapeHtml(PAYMENT_LABELS[order.status] || 'Kontrolleres');
  const success = order.status === 'captured';
  return `<article class="payment-summary-card">
    <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3"><div><p class="text-xs text-mist">Ordre ${escapeHtml(order.reference)} · ${order.payment_provider === 'stripe' ? 'Kort / digital lommebok' : 'Vipps'}</p><h3 class="font-semibold mt-0.5">${escapeHtml(order.listing_title)}</h3><p class="text-sm text-mist">${escapeHtml(order.product_name)} · ${order.duration_days} dager</p></div><span class="payment-status ${success ? 'is-success' : ''}">${status}</span></div>
    <dl class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm"><div><dt class="text-xs text-mist">Totalpris</dt><dd class="font-semibold">${formatNokFromOre(order.amount_ore)}</dd></div><div><dt class="text-xs text-mist">Opprettet</dt><dd>${formatDate(order.created_at)}</dd></div><div><dt class="text-xs text-mist">Betalingsdato</dt><dd>${order.captured_at ? formatDate(order.captured_at) : 'Ikke captured'}</dd></div><div><dt class="text-xs text-mist">Fremhevet til</dt><dd>${order.boost_end_at ? formatDate(order.boost_end_at) : 'Ikke aktivert'}</dd></div></dl>
  </article>`;
}

async function loadBoostOrders() {
  const { data, error } = await supabase.from('boost_orders').select('id,reference,listing_id,listing_title,product_id,product_name,duration_days,amount_ore,currency,status,payment_provider,created_at,authorized_at,captured_at,refunded_at,boost_start_at,boost_end_at').order('created_at', { ascending: false }).limit(50);
  if (error) {
    if (isMissingDatabaseObject(error)) {
      boostAvailable = false;
      boostOrdersContainer.innerHTML = '<div class="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Betalt fremheving blir tilgjengelig når betalingsmigreringen og serverfunksjonene er installert.</div>';
    } else {
      console.error('Kunne ikke hente betalingsordrer:', error.message);
      boostOrdersContainer.innerHTML = '<p class="text-red-600">Kunne ikke laste betalingsoversikten.</p>';
    }
    return;
  }
  boostOrdersContainer.innerHTML = data?.length ? data.map(orderCard).join('') : '<div class="bg-white rounded-2xl p-8 text-center border border-line border-dashed text-mist">Ingen fremhevingskjøp ennå.</div>';
}

async function loadBoostProducts() {
  const { data, error } = await supabase.from('boost_products').select('id,name,duration_days,price_ore,currency,is_active').eq('is_active', true).order('duration_days');
  if (error) {
    boostAvailable = false;
    if (!isMissingDatabaseObject(error)) console.error('Kunne ikke hente boost-produkter:', error.message);
    return;
  }
  boostProducts = data || [];
}

function renderBoostProducts() {
  const container = document.getElementById('boost-products');
  const methodsContainer = document.getElementById('boost-payment-methods');
  const availabilityNote = document.getElementById('boost-availability-note');
  const payButton = document.getElementById('boost-pay');
  if (!boostProducts.length) {
    container.innerHTML = '<p class="sm:col-span-2 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">Betalingspakkene er ikke tilgjengelige ennå.</p>';
    payButton.disabled = true;
    return;
  }
  container.innerHTML = boostProducts.map((product, index) => `<label class="boost-product-option"><input type="radio" name="product_id" value="${escapeHtml(product.id)}" ${index === 0 ? 'checked' : ''} class="sr-only peer"><span class="block text-sm font-bold">${escapeHtml(product.name)}</span><span class="block text-2xl font-bold text-primary-700 mt-2">${formatNokFromOre(product.price_ore)}</span><span class="block text-xs text-mist mt-1">Én betaling · ${product.duration_days} dager</span></label>`).join('');
  const methods = [];
  if (vippsCapabilities?.stripe_payment_ready === true) {
    methods.push({ id: 'stripe', title: 'Kort eller digital lommebok', detail: 'Sikker betaling levert av Stripe' });
  }
  if (vippsCapabilities?.payment_ready === true) {
    methods.push({ id: 'vipps', title: 'Vipps', detail: 'Betal i Vipps MobilePay' });
  }
  const preferred = methods.some((method) => method.id === vippsCapabilities?.preferred_payment_provider)
    ? vippsCapabilities.preferred_payment_provider
    : methods[0]?.id;
  methodsContainer.innerHTML = methods.length
    ? methods.map((method) => `<label class="boost-product-option"><input type="radio" name="payment_provider" value="${method.id}" ${method.id === preferred ? 'checked' : ''} class="sr-only peer"><span class="block text-sm font-bold">${method.title}</span><span class="block text-xs text-mist mt-1">${method.detail}</span></label>`).join('')
    : '<p class="sm:col-span-2 text-sm text-mist">Ingen betalingskonto er koblet til ennå.</p>';
  availabilityNote.textContent = methods.length
    ? ''
    : 'Opprett en Stripe-konto eller aktiver Vipps ePayment før ekte betaling kan starte.';
  availabilityNote.classList.toggle('hidden', methods.length > 0);
  payButton.disabled = methods.length === 0;
  updateBoostPaymentMethod();
  updateBoostTotal();
}

function updateBoostPaymentMethod() {
  const provider = new FormData(boostForm).get('payment_provider');
  const payButton = document.getElementById('boost-pay');
  const note = document.getElementById('boost-provider-note');
  payButton.textContent = provider === 'vipps' ? 'Betal med Vipps' : 'Gå til sikker betaling';
  note.textContent = provider === 'vipps'
    ? 'Du sendes til Vipps MobilePay. Annonsen fremheves først etter serverbekreftet betaling.'
    : 'Du sendes til Stripe for kort, Apple Pay eller Google Pay når tilgjengelig. Annonsen fremheves først etter serverbekreftet betaling.';
}

function updateBoostTotal() {
  const selectedId = new FormData(boostForm).get('product_id');
  const product = boostProducts.find((item) => item.id === selectedId);
  document.getElementById('boost-total').textContent = product ? formatNokFromOre(product.price_ore) : '–';
}

function openBoostModal(item) {
  if (!boostAvailable) return showToast('Betalingsløsningen må aktiveres i Supabase først.', 'error');
  selectedBoostListing = item;
  boostForm.reset();
  document.getElementById('boost-listing-title').textContent = item.title;
  document.getElementById('boost-error').classList.add('hidden');
  renderBoostProducts();
  if (typeof boostModal.showModal === 'function') boostModal.showModal();
  else boostModal.setAttribute('open', '');
}

boostForm.addEventListener('change', (event) => {
  if (event.target.name === 'product_id') updateBoostTotal();
  if (event.target.name === 'payment_provider') updateBoostPaymentMethod();
});
document.getElementById('boost-close').addEventListener('click', () => boostModal.close());
boostModal.addEventListener('click', (event) => { if (event.target === boostModal) boostModal.close(); });

boostForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('boost-pay');
  const errorBox = document.getElementById('boost-error');
  const data = new FormData(boostForm);
  const provider = data.get('payment_provider');
  const providerReady = provider === 'stripe'
    ? vippsCapabilities?.stripe_payment_ready === true
    : provider === 'vipps' && vippsCapabilities?.payment_ready === true;
  if (!providerReady) {
    errorBox.textContent = 'Den valgte betalingsmåten er ikke aktivert ennå.';
    errorBox.classList.remove('hidden');
    return;
  }
  if (!selectedBoostListing || !data.get('product_id') || !document.getElementById('boost-terms').checked) {
    errorBox.textContent = 'Velg pakke og godta vilkårene før du går videre.';
    errorBox.classList.remove('hidden');
    return;
  }
  button.disabled = true;
  button.textContent = 'Oppretter sikker betaling …';
  errorBox.classList.add('hidden');
  const functionName = provider === 'stripe' ? 'create-stripe-boost-payment' : 'create-boost-payment';
  const { data: response, error } = await supabase.functions.invoke(functionName, {
    body: { listing_id: selectedBoostListing.id, product_id: data.get('product_id'), accepted_terms: true },
  });
  if (error || !response?.redirect_url) {
    console.error('Kunne ikke opprette betaling:', error?.message || response?.error || 'UNKNOWN');
    errorBox.textContent = response?.message || 'Betalingen kunne ikke opprettes. Prøv igjen om litt.';
    errorBox.classList.remove('hidden');
    button.disabled = false;
    updateBoostPaymentMethod();
    return;
  }
  window.location.assign(response.redirect_url);
});

listingsContainer.addEventListener('change', async (event) => {
  const select = event.target.closest('select[data-action="status"]');
  if (!select) return;
  select.disabled = true;
  const { error } = await supabase.from('listings').update({ status: select.value }).eq('id', select.dataset.id).eq('user_id', currentUser.id);
  select.disabled = false;
  if (error) {
    console.error('Kunne ikke oppdatere status:', error.message);
    showToast('Kunne ikke endre annonsestatus.', 'error');
    await loadListings();
  } else showToast(`Annonsen er markert som ${STATUS_LABELS[select.value].toLowerCase()}.`, 'success');
});

listingsContainer.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const item = myListings.find((listing) => listing.id === button.dataset.id);
  if (!item) return;
  if (button.dataset.action === 'boost') return openBoostModal(item);
  if (button.dataset.action !== 'delete' || !confirm(`Slette «${item.title}» permanent?`)) return;
  button.disabled = true;
  button.textContent = 'Sletter …';
  const { error } = await supabase.from('listings').delete().eq('id', item.id).eq('user_id', currentUser.id);
  if (error) {
    console.error('Kunne ikke slette annonse:', error.message);
    showToast('Kunne ikke slette annonsen. Prøv igjen.', 'error');
    button.disabled = false;
    button.textContent = 'Slett';
    return;
  }
  const images = Array.isArray(item.images) && item.images.length ? item.images : (item.image_url ? [item.image_url] : []);
  const [imageCleanup, videoCleanup] = await Promise.all([
    removeOwnedImages(supabase, images, currentUser.id),
    removeOwnedVideo(supabase, item.video_url, currentUser.id),
  ]);
  const cleanupFailed = imageCleanup.error || videoCleanup.error;
  showToast(cleanupFailed ? 'Annonsen ble slettet, men enkelte egne mediefiler kunne ikke ryddes.' : 'Annonsen og egne lagrede mediefiler er slettet.', cleanupFailed ? 'error' : 'success');
  await loadListings();
});

exportDataButton?.addEventListener('click', async () => {
  if (!currentUser || exportDataButton.disabled) return;
  exportDataButton.disabled = true;
  exportDataButton.textContent = 'Forbereder fil …';
  const { data, error } = await supabase.rpc('export_my_data');
  exportDataButton.disabled = false;
  exportDataButton.textContent = 'Last ned mine data';
  if (error) {
    console.error('Kunne ikke eksportere data:', error.message);
    showToast(isMissingFunctionError(error) ? 'Dataeksport krever at databasemigreringen installeres.' : 'Kunne ikke eksportere dataene dine.', 'error');
    return;
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `kollektivmatch-data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast('Dataene dine er lastet ned.', 'success');
});

deleteAccountForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const confirmation = new FormData(deleteAccountForm).get('confirmation');
  if (confirmation !== 'SLETT') return showToast('Skriv SLETT nøyaktig for å bekrefte.', 'error');
  if (!confirm('Er du helt sikker? Kontoen og innholdet slettes permanent.')) return;
  const button = document.getElementById('delete-account-btn');
  button.disabled = true;
  button.textContent = 'Sletter …';
  const { error: capabilityError } = await supabase.rpc('export_my_data');
  if (capabilityError) {
    showToast(isMissingFunctionError(capabilityError) ? 'Kontosletting krever at databasemigreringen installeres.' : 'Kunne ikke kontrollere kontodataene. Prøv igjen.', 'error');
    button.disabled = false;
    button.textContent = 'Slett kontoen';
    return;
  }
  const imageCleanup = await removeAllUserImages(currentUser.id);
  const videoCleanup = await removeAllUserVideos(currentUser.id);
  const avatarCleanup = await removeOwnedAvatar(supabase, currentProfile?.avatar_url, currentUser.id);
  if (imageCleanup.error || videoCleanup.error || avatarCleanup.error) {
    showToast('Kunne ikke rydde alle egne bilder og videoer. Kontoen er ikke slettet; prøv igjen.', 'error');
    button.disabled = false;
    button.textContent = 'Slett kontoen';
    return;
  }
  const { error } = await supabase.rpc('delete_my_account', { p_confirmation: 'SLETT' });
  if (error) {
    console.error('Kunne ikke slette konto:', error.message);
    showToast(isMissingFunctionError(error) ? 'Kontosletting krever at databasemigreringen installeres.' : 'Kunne ikke slette kontoen. Kontakt personvernansvarlig.', 'error');
    button.disabled = false;
    button.textContent = 'Slett kontoen';
    return;
  }
  await supabase.auth.signOut().catch(() => {});
  window.location.replace('index.html?account=deleted');
});

async function init() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    rememberReturnTo(window.location.href);
    const target = new URL('./index.html', document.baseURI);
    target.searchParams.set('auth', 'login');
    target.searchParams.set('returnTo', window.location.href);
    window.location.replace(target.toString());
    return;
  }
  currentUser = user;
  renderAccountTrustSignals();
  authNav.innerHTML = `<div class="flex items-center gap-3"><span class="text-xs text-mist hidden sm:inline">${escapeHtml(user.email || '')}</span><button type="button" id="logout-btn" class="px-4 py-2 text-sm font-semibold text-mist hover:text-red-500">Logg ut</button></div>`;
  document.getElementById('logout-btn').addEventListener('click', async () => { await supabase.auth.signOut(); window.location.replace('index.html'); });
  await Promise.all([loadVippsCapabilities(), loadProfileAndPreferences(), loadListings(), loadConversations(), loadBoostProducts(), loadBoostOrders()]);
  const params = new URLSearchParams(window.location.search);
  const publishedId = params.get('published');
  if (params.get('boost') === '1' && UUID_PATTERN.test(publishedId || '')) {
    const publishedListing = myListings.find((item) => item.id === publishedId);
    if (publishedListing?.status === 'active') {
      showToast('Annonsen er publisert. Velg fremheving bare hvis du ønsker ekstra synlighet.', 'success');
      openBoostModal(publishedListing);
    }
    window.history.replaceState({}, '', 'dashboard.html');
  }
}

init();
