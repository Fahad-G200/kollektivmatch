// ui.js
//
// Rene, gjenbrukbare UI-hjelpere. Ingen Supabase-avhengighet her,
// slik at auth.js og feed.js begge kan bruke dem uten omveier.

const ICONS = {
  success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>`,
  error: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
};

// Implicit omsluttede labels er gyldige HTML, men en eksplisitt for/id-kobling
// gir mer forutsigbar støtte i hjelpemidler og ved automatisert testing.
document.querySelectorAll('label:not([for])').forEach((label, index) => {
  const control = label.querySelector('input, select, textarea');
  if (!control) return;
  if (!control.id) control.id = `linked-field-${index}`;
  label.htmlFor = control.id;
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[c]));
}

/**
 * Viser en toast nederst til høyre. Fjernes automatisk selv.
 * @param {string} message
 * @param {'success'|'error'} type
 */
export function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  container.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  container.setAttribute('aria-atomic', 'true');

  const toast = document.createElement('div');
  const accent = type === 'error' ? 'border-red-400 text-red-600' : 'border-primary-500 text-primary-600';

  toast.className = `bg-white border-l-4 ${accent} shadow-lg shadow-ink/5 rounded-xl pl-3 pr-4 py-3 mb-3 flex items-center gap-2.5 max-w-sm animate-toast-in`;
  toast.innerHTML = `${ICONS[type] || ICONS.success}<span class="text-sm font-medium text-ink">${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('animate-toast-out');
    setTimeout(() => toast.remove(), 200);
  }, 3800);
}

let lastFocusedElement = null;
let activeModal = null;

function getFocusableElements(modal) {
  return Array.from(modal.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.classList.contains('hidden') && element.getClientRects().length > 0);
}

function handleModalKeydown(event) {
  if (!activeModal) return;
  if (event.key === 'Escape') {
    closeModal(activeModal.id);
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = getFocusableElements(activeModal);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  lastFocusedElement = document.activeElement;
  activeModal = modal;
  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
  document.addEventListener('keydown', handleModalKeydown);
  requestAnimationFrame(() => getFocusableElements(modal)[0]?.focus());
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  modal?.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
  document.removeEventListener('keydown', handleModalKeydown);
  activeModal = null;
  if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
  lastFocusedElement = null;
}
