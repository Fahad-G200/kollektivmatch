import { supabase } from './supabase-config.js';
import { showToast } from './ui.js';
import { getExampleListing } from './example-listings.js';
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
let viewer = null;
let listing = null;
let contactLoadError = false;

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
  const publicColumnsWithoutVideo = 'id, user_id, title, description, price, city, area, move_in_date, images, image_url, roommates_info, lifestyle_tags, amenities, preferred_occupations, transit_minutes, grocery_nearby, gym_nearby, green_areas_nearby, property_type, room_size_m2, deposit_amount, furnished, rent_includes, status, is_featured, featured_until, created_at, updated_at';
  const publicColumns = `${publicColumnsWithoutVideo}, video_url`;
  let { data, error } = await supabase.from('listings').select(publicColumns).eq('id', id).single();
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await supabase.from('listings').select(publicColumnsWithoutVideo).eq('id', id).single());
    if (error && isMissingColumnError(error)) {
      const legacyColumns = 'id, user_id, title, description, price, city, area, move_in_date, image_url, roommates_info, is_featured, featured_until, created_at';
      ({ data, error } = await supabase.from('listings').select(legacyColumns).eq('id', id).single());
    }
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
}

init().catch(() => {
  document.getElementById('loading').textContent = 'Kunne ikke laste annonsen. Prøv igjen senere.';
});
