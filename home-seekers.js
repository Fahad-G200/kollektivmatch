import { supabase } from './supabase-config.js';
import { rememberReturnTo } from './auth.js';
import { showToast } from './ui.js';
import { computeMatch, compareBestMatch } from './match.js?v=20260825-3';

const select = document.getElementById('listing-select');
const status = document.getElementById('seeker-status');
const results = document.getElementById('seeker-results');
const grid = document.getElementById('seeker-grid');
const summary = document.getElementById('seeker-summary');
const dialog = document.getElementById('contact-seeker-dialog');
const form = document.getElementById('contact-seeker-form');
const OCCUPATION_LABELS = { student: 'Student', jobb: 'I jobb', annet: 'Annet' };
const PROPERTY_LABELS = { leilighet: 'Leilighet', hybel: 'Hybel', enebolig: 'Enebolig', rekkehus: 'Rekkehus', studentbolig: 'Studentbolig', annet: 'Annet' };
const PRIORITY_LABELS = { 'stort-rom': 'God plass', 'moderne-stil': 'Moderne stil', 'nyoppusset-bad': 'Fint bad', 'rolig-miljo': 'Rolig miljø', 'stort-kjokken': 'Sosiale soner' };
let currentUser = null;
let listings = [];
let seekers = [];
let selectedSeeker = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
}

function isMissingFunction(error) {
  return ['PGRST202', '42883'].includes(error?.code) || /function.+does not exist|schema cache/i.test(error?.message || '');
}

function initials(name) {
  return String(name || 'KM').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'KM';
}

function formatDate(date) {
  return date ? new Date(`${date}T00:00:00`).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function selectedListing() {
  return listings.find((listing) => listing.id === select.value) || null;
}

function safeAvatar(seeker) {
  return seeker.avatar_url
    ? `<img src="${escapeHtml(seeker.avatar_url)}" alt="" class="seeker-avatar-image w-full h-full object-cover" /><span class="seeker-avatar-fallback hidden">${escapeHtml(initials(seeker.full_name))}</span>`
    : `<span class="seeker-avatar-fallback">${escapeHtml(initials(seeker.full_name))}</span>`;
}

function seekerCard(seeker) {
  const match = seeker._match;
  const badges = seeker.is_verified
    ? '<span class="trust-mini-badge">✓ Utdannings-e-post</span>'
    : '';
  const preferences = [
    seeker.monthly_budget_max ? `Maks ${new Intl.NumberFormat('nb-NO').format(seeker.monthly_budget_max)} kr/mnd` : '',
    seeker.desired_move_in_date ? `Innflytting ${formatDate(seeker.desired_move_in_date)}` : '',
    seeker.search_location ? `Ser i ${escapeHtml(seeker.search_location)}` : '',
  ].filter(Boolean);
  const tags = [
    ...(seeker.preferred_property_types || []).map((value) => PROPERTY_LABELS[value] || value),
    ...(seeker.priority_tags || []).map((value) => PRIORITY_LABELS[value] || value),
  ].slice(0, 5);
  return `
    <article class="seeker-card bg-white rounded-3xl border border-line p-5 flex flex-col">
      <div class="flex items-start gap-3">
        <div class="seeker-avatar">${safeAvatar(seeker)}</div>
        <div class="min-w-0 flex-1"><div class="flex items-start justify-between gap-2"><div><h3 class="font-bold truncate">${escapeHtml(seeker.full_name || 'Boligsøker')}</h3><p class="text-xs text-mist mt-0.5">${escapeHtml(OCCUPATION_LABELS[seeker.occupation] || 'Boligsøker')}${seeker.institution ? ` · ${escapeHtml(seeker.institution)}` : ''}</p></div>${typeof match?.score === 'number' ? `<span class="seeker-match-badge" title="${escapeHtml(match.explanation || '')}">${match.score}%</span>` : ''}</div><div class="flex flex-wrap gap-1.5 mt-2">${badges}</div></div>
      </div>
      ${seeker.seeker_bio ? `<p class="text-sm text-mist leading-relaxed mt-4">${escapeHtml(seeker.seeker_bio)}</p>` : ''}
      ${preferences.length ? `<ul class="mt-4 space-y-1 text-xs text-mist">${preferences.map((item) => `<li>• ${item}</li>`).join('')}</ul>` : ''}
      ${tags.length ? `<div class="flex flex-wrap gap-1.5 mt-4">${tags.map((tag) => `<span class="seeker-preference-chip">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      ${match?.explanation ? `<p class="mt-4 text-xs font-semibold text-primary-700">${escapeHtml(match.explanation)}</p>` : ''}
      <button type="button" data-contact-seeker="${escapeHtml(seeker.id)}" class="mt-auto pt-5 w-full text-center"><span class="block px-4 py-2.5 rounded-xl bg-primary-50 hover:bg-primary-100 text-primary-700 text-sm font-bold">Ta kontakt om annonsen</span></button>
    </article>`;
}

function installAvatarFallbacks() {
  grid.querySelectorAll('.seeker-avatar-image').forEach((image) => image.addEventListener('error', () => {
    image.classList.add('hidden');
    image.nextElementSibling?.classList.remove('hidden');
  }, { once: true }));
}

function renderSeekers(rows) {
  seekers = rows.map((seeker) => ({ ...seeker, _match: computeMatch(selectedListing(), seeker) }));
  seekers.sort(compareBestMatch);
  status.classList.add('hidden');
  results.classList.remove('hidden');
  summary.textContent = seekers.length
    ? `${seekers.length} ${seekers.length === 1 ? 'person har' : 'personer har'} valgt å være synlig for utleiere.`
    : 'Ingen boligsøkere har gjort profilen synlig ennå.';
  grid.innerHTML = seekers.length ? seekers.map(seekerCard).join('') : '<div class="sm:col-span-2 lg:col-span-3 rounded-3xl border border-dashed border-line bg-white p-10 text-center"><p class="font-bold">Ingen synlige boligsøkere ennå</p><p class="text-sm text-mist mt-2">Del KollektivMatch med aktuelle personer og be dem opprette en frivillig boligsøkerprofil.</p></div>';
  installAvatarFallbacks();
}

async function loadSeekers() {
  const listing = selectedListing();
  if (!listing) return;
  status.classList.remove('hidden');
  status.innerHTML = 'Finner boligsøkere som passer annonsen …';
  results.classList.add('hidden');
  const { data, error } = await supabase.rpc('get_home_seekers', { p_listing_id: listing.id });
  if (error) {
    console.error('Kunne ikke hente boligsøkere:', error.message);
    status.innerHTML = isMissingFunction(error)
      ? '<p class="font-bold text-ink">Boligsøkeroversikten trenger databaseoppdateringen</p><p class="text-sm mt-2">Migreringen for frivillige boligsøkerprofiler må installeres først.</p>'
      : '<p class="text-red-700">Kunne ikke hente boligsøkere. Prøv igjen.</p>';
    return;
  }
  renderSeekers(data || []);
}

function openContact(seeker) {
  const listing = selectedListing();
  if (!listing) return;
  selectedSeeker = seeker;
  document.getElementById('contact-seeker-name').textContent = `${seeker.full_name || 'Boligsøkeren'} · ${listing.title}`;
  form.message.value = `Hei ${String(seeker.full_name || '').split(/\s+/)[0] || 'der'}! Jeg tror annonsen «${listing.title}» kan passe det du ser etter. Ta gjerne en titt og si fra hvis du vil vite mer.`;
  dialog.showModal();
}

grid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-contact-seeker]');
  if (!button) return;
  const seeker = seekers.find((item) => item.id === button.dataset.contactSeeker);
  if (seeker) openContact(seeker);
});

document.getElementById('contact-seeker-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const listing = selectedListing();
  if (!listing || !selectedSeeker) return;
  const button = document.getElementById('contact-seeker-submit');
  button.disabled = true;
  button.textContent = 'Sender …';
  const { error } = await supabase.rpc('contact_home_seeker', {
    p_listing_id: listing.id,
    p_seeker_id: selectedSeeker.id,
    p_content: form.message.value.trim(),
  });
  button.disabled = false;
  button.textContent = 'Send og åpne samtalen';
  if (error) {
    console.error('Kunne ikke kontakte boligsøkeren:', error.message);
    showToast(isMissingFunction(error) ? 'Databaseoppdateringen må installeres først.' : 'Kunne ikke sende meldingen. Prøv igjen.', 'error');
    return;
  }
  window.location.assign(`chat.html?listing=${encodeURIComponent(listing.id)}&user=${encodeURIComponent(selectedSeeker.id)}`);
});

select.addEventListener('change', loadSeekers);

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
  const columns = 'id, user_id, title, description, price, city, area, move_in_date, lifestyle_tags, amenities, preferred_occupations, transit_minutes, property_type, status, created_at';
  const { data, error } = await supabase.from('listings').select(columns).eq('user_id', currentUser.id).eq('status', 'active').order('created_at', { ascending: false });
  if (error) {
    status.innerHTML = '<p class="text-red-700">Kunne ikke hente annonsene dine.</p>';
    return;
  }
  listings = data || [];
  if (!listings.length) {
    select.innerHTML = '<option value="">Ingen aktive annonser</option>';
    select.disabled = true;
    status.innerHTML = '<p class="font-bold text-ink">Du trenger en aktiv annonse først</p><p class="text-sm mt-2">Boligsøkere vises bare til innloggede eiere av aktive annonser.</p><a href="create-listing.html" class="inline-flex mt-4 px-4 py-2 rounded-xl bg-primary-600 text-white font-bold text-sm">Legg ut annonse</a>';
    return;
  }
  select.innerHTML = listings.map((listing) => `<option value="${escapeHtml(listing.id)}">${escapeHtml(listing.title)}</option>`).join('');
  const requestedListing = new URLSearchParams(window.location.search).get('listing');
  if (requestedListing && listings.some((listing) => listing.id === requestedListing)) select.value = requestedListing;
  await loadSeekers();
}

init();
