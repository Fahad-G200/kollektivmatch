import {
  onAuthChange,
  signIn,
  signUp,
  signOut,
  signInWithGoogle,
  requestPasswordReset,
  resendConfirmation,
  rememberReturnTo,
} from './auth.js';
import { ENABLE_GOOGLE_AUTH } from './supabase-config.js';
import { loadListings, loadMoreListings, populateCitySuggestions } from './feed.js?v=20260827-1';
import { openModal, closeModal, showToast } from './ui.js';
import { searchSchools } from './location-utils.js?v=20260827-2';

const authButtons = document.getElementById('auth-buttons');
const userMenu = document.getElementById('user-menu');
const filterForm = document.getElementById('filter-form');
const filterKeys = [
  'city', 'maxPrice', 'moveInDate', 'propertyType', 'preferredOccupation',
  'maxTransitMinutes', 'amenities', 'lifestyleTags', 'schoolName', 'schoolLat',
  'schoolLon', 'sortBy',
];
const schoolInput = document.getElementById('f-school');
const schoolLatInput = document.getElementById('f-school-lat');
const schoolLonInput = document.getElementById('f-school-lon');
const schoolSuggestions = document.getElementById('school-suggestions');
const schoolStatus = document.getElementById('school-search-status');
const clearSchoolButton = document.getElementById('clear-school');
const advancedFilters = document.getElementById('advanced-filters');
const advancedFilterCount = document.getElementById('advanced-filter-count');
let registrationEmail = '';
let resendTimer = null;
let schoolSearchTimer = null;
let schoolSearchController = null;
const TERMS_VERSION = '2026-08-23';
const FILTER_LABELS = {
  propertyType: {
    leilighet: 'Leilighet', hybel: 'Hybel', enebolig: 'Enebolig',
    rekkehus: 'Rekkehus', studentbolig: 'Studentbolig', annet: 'Annet',
  },
  preferredOccupation: { student: 'Student', jobb: 'I jobb', annet: 'Annet' },
  amenities: {
    matbutikk: 'Matbutikk', kollektivtransport: 'Kollektivt',
    treningssenter: 'Trening', grontomrade: 'Grøntområde',
  },
  lifestyleTags: {
    'nyoppusset-bad': 'Pent bad', 'stort-kjokken': 'Sosiale soner',
    'rolig-miljo': 'Rolig miljø', 'stort-rom': 'Stort rom',
  },
};

onAuthChange((user) => {
  authButtons?.classList.toggle('hidden', !!user);
  userMenu?.classList.toggle('hidden', !user);
  userMenu?.classList.toggle('flex', !!user);
});

document.getElementById('logout-btn')?.addEventListener('click', signOut);

function resetAuthModalView() {
  document.getElementById('check-email-state')?.classList.add('hidden');
  document.querySelector('[data-tab="login"]')?.click();
}

document.getElementById('open-login')?.addEventListener('click', () => {
  resetAuthModalView();
  openModal('auth-modal');
});

document.getElementById('open-register')?.addEventListener('click', () => {
  resetAuthModalView();
  openModal('auth-modal');
  document.querySelector('[data-tab="register"]')?.click();
});

document.getElementById('close-auth-modal')?.addEventListener('click', () => closeModal('auth-modal'));
document.getElementById('auth-modal-backdrop')?.addEventListener('click', () => closeModal('auth-modal'));
document.getElementById('check-email-ok-btn')?.addEventListener('click', () => {
  resetAuthModalView();
  closeModal('auth-modal');
});

const googleSection = document.getElementById('google-auth-section');
googleSection?.classList.toggle('hidden', !ENABLE_GOOGLE_AUTH);
if (ENABLE_GOOGLE_AUTH) {
  document.getElementById('google-login-btn')?.addEventListener('click', signInWithGoogle);
}

const authTabs = document.querySelectorAll('.auth-tab');
authTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    authTabs.forEach((item) => item.classList.remove('bg-white', 'shadow-sm', 'text-ink'));
    authTabs.forEach((item) => item.classList.add('text-mist'));
    tab.classList.add('bg-white', 'shadow-sm', 'text-ink');
    tab.classList.remove('text-mist');

    const target = tab.dataset.tab;
    document.getElementById('login-form')?.classList.toggle('hidden', target !== 'login');
    document.getElementById('register-form')?.classList.toggle('hidden', target !== 'register');
    document.getElementById('check-email-state')?.classList.add('hidden');
  });
});

document.getElementById('login-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById('login-submit-btn');
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = 'Logger inn...';
  try {
    await signIn(
      form.elements.namedItem('email').value,
      form.elements.namedItem('password').value,
    );
  } catch (error) {
    console.error('Uventet innloggingsfeil:', error);
    showToast('Kunne ikke logge inn. Prøv igjen.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Logg inn';
  }
});

document.getElementById('forgot-password-btn')?.addEventListener('click', () => {
  const email = document.querySelector('#login-form input[name="email"]')?.value;
  requestPasswordReset(email);
});

function startResendCooldown(seconds = 60) {
  clearInterval(resendTimer);
  const button = document.getElementById('resend-confirmation-btn');
  const counter = document.getElementById('resend-countdown');
  let remaining = seconds;
  button.disabled = true;

  const update = () => {
    if (remaining <= 0) {
      button.disabled = false;
      button.textContent = 'Send bekreftelses-e-post på nytt';
      clearInterval(resendTimer);
      return;
    }
    button.innerHTML = `Send bekreftelses-e-post på nytt (<span id="resend-countdown">${remaining}</span>)`;
    remaining -= 1;
  };
  update();
  resendTimer = setInterval(update, 1000);
  if (counter) counter.textContent = String(seconds);
}

document.getElementById('resend-confirmation-btn')?.addEventListener('click', async () => {
  const success = await resendConfirmation(registrationEmail);
  if (success) startResendCooldown();
});

document.getElementById('register-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById('register-submit-btn');
  if (button.disabled) return;

  const field = (name) => form.elements.namedItem(name);
  const emailField = field('email');
  const passwordField = field('password');
  const fullNameField = field('fullName');
  const roleField = field('role');
  const occupationField = field('occupation');
  const institutionField = field('institution');
  const incomeStatusField = field('incomeStatus');
  const monthlyBudgetField = field('monthlyBudgetMax');
  const acceptTermsField = field('acceptTerms');

  if (passwordField.value.length < 12) {
    showToast('Passordet må være minst 12 tegn.', 'error');
    return;
  }
  if (!acceptTermsField.checked) {
    showToast('Du må godta bruksvilkårene for å opprette konto.', 'error');
    return;
  }

  const priorityTags = Array.from(form.querySelectorAll('input[name="priority_tags"]:checked')).map((input) => input.value);
  if (priorityTags.length > 3) {
    showToast('Velg maks 3 prioriteringer.', 'error');
    return;
  }

  button.disabled = true;
  button.textContent = 'Oppretter konto...';
  registrationEmail = emailField.value.trim();

  try {
    const result = await signUp(registrationEmail, passwordField.value, fullNameField.value.trim(), roleField.value, {
      occupation: occupationField.value || null,
      institution: institutionField.value.trim() || null,
      income_status: incomeStatusField.value || null,
      monthly_budget_max: monthlyBudgetField.value || null,
      priority_tags: priorityTags,
      terms_accepted_at: new Date().toISOString(),
      terms_version: TERMS_VERSION,
    });

    if (result?.needsConfirmation) {
      form.classList.add('hidden');
      document.getElementById('check-email-state')?.classList.remove('hidden');
      startResendCooldown();
    }
  } catch (error) {
    console.error('Uventet registreringsfeil:', error);
    showToast('Kunne ikke opprette kontoen. Prøv igjen.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Opprett konto';
  }
});

document.getElementById('mobile-menu-btn')?.addEventListener('click', (event) => {
  const menu = document.getElementById('mobile-menu');
  const expanded = menu?.classList.toggle('hidden') === false;
  event.currentTarget.setAttribute('aria-expanded', String(expanded));
});

function validCoordinate(value, min, max) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function selectedSchoolFromForm() {
  const latitude = validCoordinate(schoolLatInput?.value, -90, 90);
  const longitude = validCoordinate(schoolLonInput?.value, -180, 180);
  const name = schoolInput?.value.trim() || '';
  if (!name || latitude === null || longitude === null) return null;
  return { name, latitude, longitude };
}

function hideSchoolSuggestions() {
  schoolSuggestions?.classList.add('hidden');
  schoolInput?.setAttribute('aria-expanded', 'false');
}

function clearSchool({ keepText = false } = {}) {
  schoolSearchController?.abort();
  clearTimeout(schoolSearchTimer);
  if (!keepText && schoolInput) schoolInput.value = '';
  if (schoolLatInput) schoolLatInput.value = '';
  if (schoolLonInput) schoolLonInput.value = '';
  if (clearSchoolButton) clearSchoolButton.classList.add('hidden');
  if (schoolSuggestions) schoolSuggestions.innerHTML = '';
  hideSchoolSuggestions();
  const sortSelect = filterForm?.elements?.sortBy;
  if (sortSelect?.value === 'nearest_school') sortSelect.value = 'best_match';
  if (schoolStatus) schoolStatus.textContent = 'Søk med skolenavn eller forkortelser som UiO, UiB, UiT, NTNU og NMBU. Feltet er valgfritt.';
  updateAdvancedFilterSummary();
}

function chooseSchool(school, { preferNearest = true } = {}) {
  if (!schoolInput || !schoolLatInput || !schoolLonInput) return;
  schoolInput.value = school.label || school.name;
  schoolLatInput.value = String(school.latitude);
  schoolLonInput.value = String(school.longitude);
  clearSchoolButton?.classList.remove('hidden');
  hideSchoolSuggestions();
  const sortSelect = filterForm?.elements?.sortBy;
  if (preferNearest && sortSelect?.value === 'best_match') sortSelect.value = 'nearest_school';
  if (schoolStatus) schoolStatus.textContent = `Valgt: ${schoolInput.value}. Avstand vises som omtrentlig luftlinje.`;
  updateAdvancedFilterSummary();
}

function renderSchoolSuggestions(schools) {
  if (!schoolSuggestions || !schoolInput) return;
  schoolSuggestions.innerHTML = '';
  schools.forEach((school) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'option';
    button.className = 'block w-full rounded-lg px-3 py-2.5 text-left hover:bg-primary-50 focus:bg-primary-50 focus:outline-none';
    const name = document.createElement('span');
    name.className = 'block text-sm font-semibold text-ink';
    name.textContent = school.name;
    const detail = document.createElement('span');
    detail.className = 'block text-xs text-mist';
    detail.textContent = [school.type, school.municipality].filter(Boolean).join(' · ');
    button.append(name, detail);
    button.addEventListener('click', () => chooseSchool(school));
    schoolSuggestions.appendChild(button);
  });
  schoolSuggestions.classList.toggle('hidden', schools.length === 0);
  schoolInput.setAttribute('aria-expanded', String(schools.length > 0));
}

async function findSchoolSuggestions(query) {
  schoolSearchController?.abort();
  schoolSearchController = new AbortController();
  if (schoolStatus) schoolStatus.textContent = 'Søker etter skole …';
  try {
    const schools = await searchSchools(query, { signal: schoolSearchController.signal, limit: 8 });
    renderSchoolSuggestions(schools);
    if (schoolStatus) schoolStatus.textContent = schools.length
      ? 'Velg riktig skole fra forslagene.'
      : 'Fant ingen skole med dette navnet. Prøv et mer fullstendig navn.';
    return schools;
  } catch (error) {
    if (error?.name === 'AbortError') return [];
    hideSchoolSuggestions();
    if (schoolStatus) schoolStatus.textContent = 'Skolesøket er midlertidig utilgjengelig. De andre filtrene virker fortsatt.';
    return [];
  }
}

schoolInput?.addEventListener('input', () => {
  if (schoolLatInput?.value || schoolLonInput?.value) clearSchool({ keepText: true });
  if (schoolLatInput) schoolLatInput.value = '';
  if (schoolLonInput) schoolLonInput.value = '';
  clearSchoolButton?.classList.toggle('hidden', schoolInput.value.trim().length === 0);
  const query = schoolInput.value.trim();
  clearTimeout(schoolSearchTimer);
  if (query.length < 2) {
    hideSchoolSuggestions();
    if (schoolStatus) schoolStatus.textContent = query ? 'Skriv minst to tegn for å få forslag.' : 'Søk med skolenavn eller forkortelser som UiO, UiB, UiT, NTNU og NMBU. Feltet er valgfritt.';
    return;
  }
  schoolSearchTimer = setTimeout(() => findSchoolSuggestions(query), 280);
});

schoolInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideSchoolSuggestions();
});
schoolInput?.addEventListener('blur', () => setTimeout(hideSchoolSuggestions, 150));
clearSchoolButton?.addEventListener('click', () => {
  clearSchool();
  schoolInput?.focus();
});

async function ensureSchoolSelection() {
  const query = schoolInput?.value.trim() || '';
  if (!query) {
    clearSchool();
    return true;
  }
  if (selectedSchoolFromForm()) return true;
  const schools = await findSchoolSuggestions(query);
  if (!schools.length) {
    showToast('Velg en skole fra forslagene, eller tøm skolefeltet.', 'error');
    schoolInput?.focus();
    return false;
  }
  chooseSchool(schools[0]);
  return true;
}

function getFiltersFromForm() {
  const form = filterForm;
  const school = selectedSchoolFromForm();
  return {
    city: form.city.value.trim(),
    maxPrice: form.maxPrice.value,
    moveInDate: form.moveInDate.value,
    propertyType: form.propertyType.value,
    preferredOccupation: form.preferredOccupation.value,
    maxTransitMinutes: form.maxTransitMinutes.value,
    amenities: Array.from(form.querySelectorAll('input[name="amenities"]:checked')).map((input) => input.value),
    lifestyleTags: Array.from(form.querySelectorAll('input[name="lifestyleTags"]:checked')).map((input) => input.value),
    schoolName: school?.name || '',
    schoolLat: school?.latitude ?? '',
    schoolLon: school?.longitude ?? '',
    sortBy: form.sortBy.value || 'best_match',
  };
}

function filtersToUrl(filters) {
  const url = new URL(window.location.href);
  filterKeys.forEach((key) => url.searchParams.delete(key));
  Object.entries(filters).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, item));
    else if (value && !(key === 'sortBy' && value === 'best_match')) url.searchParams.set(key, value);
  });
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function fillFormFromUrl() {
  const params = new URLSearchParams(window.location.search);
  ['city', 'maxPrice', 'moveInDate', 'propertyType', 'preferredOccupation', 'maxTransitMinutes', 'schoolName', 'schoolLat', 'schoolLon', 'sortBy'].forEach((name) => {
    if (params.has(name) && filterForm.elements[name]) filterForm.elements[name].value = params.get(name);
  });
  ['amenities', 'lifestyleTags'].forEach((name) => {
    params.getAll(name).forEach((value) => {
      const input = filterForm.querySelector(`input[name="${name}"][value="${CSS.escape(value)}"]`);
      if (input) input.checked = true;
    });
  });
  if (selectedSchoolFromForm()) {
    clearSchoolButton?.classList.remove('hidden');
    if (schoolStatus) schoolStatus.textContent = `Valgt: ${schoolInput.value}. Avstand vises som omtrentlig luftlinje.`;
  } else if (schoolInput?.value) {
    clearSchool({ keepText: true });
  }
  updateAdvancedFilterSummary({ openWhenSelected: true });
}

function renderActiveFilters(filters) {
  const target = document.getElementById('active-filters');
  const values = [];
  if (filters.city) values.push({ key: 'city', label: `Sted: ${filters.city}` });
  if (filters.maxPrice) values.push({ key: 'maxPrice', label: `Maks ${filters.maxPrice} kr` });
  if (filters.moveInDate) values.push({ key: 'moveInDate', label: `Innflytting innen ${filters.moveInDate}` });
  if (filters.propertyType) values.push({
    key: 'propertyType', label: `Boligtype: ${FILTER_LABELS.propertyType[filters.propertyType] || filters.propertyType}`,
  });
  if (filters.preferredOccupation) values.push({
    key: 'preferredOccupation', label: `Passer for: ${FILTER_LABELS.preferredOccupation[filters.preferredOccupation] || filters.preferredOccupation}`,
  });
  if (filters.maxTransitMinutes) values.push({ key: 'maxTransitMinutes', label: `Maks ${filters.maxTransitMinutes} min til kollektivt` });
  if (filters.schoolName) values.push({ key: 'schoolName', label: `Nærmest: ${filters.schoolName}` });
  filters.amenities.forEach((value) => values.push({
    key: 'amenities', value, label: FILTER_LABELS.amenities[value] || value,
  }));
  filters.lifestyleTags.forEach((value) => values.push({
    key: 'lifestyleTags', value, label: FILTER_LABELS.lifestyleTags[value] || value,
  }));

  target.classList.toggle('hidden', values.length === 0);
  target.innerHTML = '';
  values.forEach(({ key, value = '', label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter-chip';
    button.dataset.filterKey = key;
    button.dataset.filterValue = value;
    button.setAttribute('aria-label', `Fjern filter: ${label}`);
    const text = document.createElement('span');
    text.textContent = label;
    const remove = document.createElement('span');
    remove.className = 'filter-chip__remove';
    remove.setAttribute('aria-hidden', 'true');
    remove.textContent = '×';
    button.append(text, remove);
    target.appendChild(button);
  });
}

function updateAdvancedFilterSummary({ openWhenSelected = false } = {}) {
  if (!filterForm || !advancedFilterCount) return;
  const selected = [
    filterForm.elements.propertyType?.value,
    filterForm.elements.preferredOccupation?.value,
    filterForm.elements.maxTransitMinutes?.value,
    selectedSchoolFromForm()?.name,
    ...Array.from(filterForm.querySelectorAll('[name="amenities"]:checked')),
    ...Array.from(filterForm.querySelectorAll('[name="lifestyleTags"]:checked')),
  ].filter(Boolean).length;
  advancedFilterCount.textContent = selected ? `${selected} valgt` : 'Ingen valgt';
  if (openWhenSelected && selected && advancedFilters) advancedFilters.open = true;
}

document.getElementById('active-filters')?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-filter-key]');
  if (!button) return;
  const { filterKey, filterValue } = button.dataset;
  if (filterKey === 'schoolName') {
    clearSchool();
  } else if (filterKey === 'amenities' || filterKey === 'lifestyleTags') {
    const input = filterForm.querySelector(`input[name="${filterKey}"][value="${CSS.escape(filterValue)}"]`);
    if (input) input.checked = false;
  } else if (filterForm.elements[filterKey]) {
    filterForm.elements[filterKey].value = '';
  }
  updateAdvancedFilterSummary();
  submitFilters();
});

function disableUnavailableAdvancedFilters(filters) {
  const select = filterForm.elements.propertyType;
  filters.propertyType = '';
  filters.preferredOccupation = '';
  filters.maxTransitMinutes = '';
  filters.amenities = [];
  filters.lifestyleTags = [];
  if (!select.disabled) {
    select.value = '';
    filterForm.elements.preferredOccupation.value = '';
    filterForm.elements.maxTransitMinutes.value = '';
    filterForm.querySelectorAll('[name="amenities"], [name="lifestyleTags"]').forEach((input) => { input.checked = false; });
    [select, filterForm.elements.preferredOccupation, filterForm.elements.maxTransitMinutes,
      ...filterForm.querySelectorAll('[name="amenities"], [name="lifestyleTags"]')].forEach((control) => {
      control.disabled = true;
      control.title = 'Dette filteret blir tilgjengelig etter databaseoppdateringen.';
      control.classList.add('opacity-60', 'cursor-not-allowed');
    });
    select.options[0].textContent = 'Krever databaseoppdatering';
    filterForm.elements.preferredOccupation.options[0].textContent = 'Krever databaseoppdatering';
    document.getElementById('advanced-filters-unavailable')?.classList.remove('hidden');
    if (advancedFilters) advancedFilters.open = true;
  }
  filtersToUrl(filters);
  renderActiveFilters(filters);
}

async function submitFilters({ updateUrl = true } = {}) {
  const filters = getFiltersFromForm();
  if (filters.sortBy === 'nearest_school' && !filters.schoolName) {
    filters.sortBy = 'best_match';
    filterForm.sortBy.value = 'best_match';
  }
  if (updateUrl) filtersToUrl(filters);
  renderActiveFilters(filters);
  const result = await loadListings(filters);
  if (result?.propertyTypeUnavailable) disableUnavailableAdvancedFilters(filters);
}

filterForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!(await ensureSchoolSelection())) return;
  submitFilters();
});

document.getElementById('reset-filters')?.addEventListener('click', () => {
  filterForm.reset();
  clearSchool();
  filterForm.sortBy.value = 'best_match';
  if (advancedFilters) advancedFilters.open = false;
  updateAdvancedFilterSummary();
  submitFilters();
});

filterForm?.addEventListener('change', () => updateAdvancedFilterSummary());

document.getElementById('load-more-btn')?.addEventListener('click', loadMoreListings);

const initialParams = new URLSearchParams(window.location.search);
const returnTo = initialParams.get('returnTo');
if (returnTo) rememberReturnTo(returnTo);
if (initialParams.get('auth') === 'login') {
  resetAuthModalView();
  openModal('auth-modal');
}
if (initialParams.get('account') === 'deleted') {
  showToast('Kontoen og innholdet ditt er slettet.', 'success');
  initialParams.delete('account');
  history.replaceState(null, '', `${window.location.pathname}${initialParams.size ? `?${initialParams}` : ''}${window.location.hash}`);
}

fillFormFromUrl();
submitFilters({ updateUrl: false });
populateCitySuggestions();
