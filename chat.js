import { supabase } from './supabase-config.js';
import { rememberReturnTo } from './auth.js';
import { showToast } from './ui.js';
import { PROFILE_AVATARS_BUCKET, safePublicMediaUrl } from './storage-utils.js?v=20260828-1';

const params = new URLSearchParams(window.location.search);
const listingId = params.get('listing');
const queryPeerId = params.get('user');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const loading = document.getElementById('chat-loading');
const shell = document.getElementById('chat-shell');
const messages = document.getElementById('messages');
const form = document.getElementById('chat-form');
const input = document.getElementById('chat-input');
const submit = document.getElementById('chat-submit');
const realtimeError = document.getElementById('realtime-error');
const characterCount = document.getElementById('chat-character-count');
let currentUser = null;
let peerUserId = null;
let listing = null;
let channel = null;
const renderedIds = new Set();

function initials(name) {
  return String(name || 'KM').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'KM';
}

async function renderPeerIdentity() {
  const { data: profile, error } = await supabase.from('profiles')
    .select('full_name, avatar_url, is_verified').eq('id', peerUserId).single();
  if (error) console.error('Kunne ikke hente samtalepartnerens profil:', error.message);
  const name = profile?.full_name || 'KollektivMatch-bruker';
  document.getElementById('chat-peer-name').textContent = name;
  document.getElementById('chat-peer-initials').textContent = initials(name);
  document.getElementById('chat-peer-education').classList.toggle('hidden', profile?.is_verified !== true);
  const avatarUrl = safePublicMediaUrl(profile?.avatar_url, PROFILE_AVATARS_BUCKET);
  if (avatarUrl) {
    const avatar = document.getElementById('chat-peer-avatar');
    avatar.src = avatarUrl;
    avatar.alt = `Profilbilde av ${name}`;
    avatar.classList.remove('hidden');
    document.getElementById('chat-peer-initials').classList.add('hidden');
    avatar.addEventListener('error', () => {
      avatar.classList.add('hidden');
      document.getElementById('chat-peer-initials').classList.remove('hidden');
    }, { once: true });
  }
}

function isMissingFunctionError(error) {
  return error?.code === 'PGRST202'
    || error?.code === '42883'
    || /function.+does not exist|could not find.+function.+schema cache/i.test(error?.message || '');
}

function isConversationMessage(message) {
  return message.listing_id === listingId && (
    (message.sender_id === currentUser.id && message.receiver_id === peerUserId) ||
    (message.sender_id === peerUserId && message.receiver_id === currentUser.id)
  );
}

function appendMessage(message) {
  if (renderedIds.has(message.id)) return;
  document.getElementById('empty-messages')?.remove();
  renderedIds.add(message.id);
  const mine = message.sender_id === currentUser.id;
  const row = document.createElement('div');
  row.className = `flex ${mine ? 'justify-end' : 'justify-start'}`;
  const bubble = document.createElement('div');
  bubble.className = mine ? 'max-w-[80%] px-4 py-2.5 rounded-2xl bg-[#6C4CE0] text-white' : 'max-w-[80%] px-4 py-2.5 rounded-2xl bg-[#F4F2FF] text-[#211C33]';
  const text = document.createElement('p');
  text.className = 'text-sm whitespace-pre-wrap break-words';
  text.textContent = message.content;
  const meta = document.createElement('p');
  meta.className = mine ? 'text-[11px] mt-1 text-white/80' : 'text-[11px] mt-1 text-[#6B667E]';
  meta.textContent = new Date(message.created_at).toLocaleString('nb-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  bubble.append(text, meta);
  row.appendChild(bubble);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

async function markIncomingAsRead() {
  const { error } = await supabase.rpc('mark_messages_read', { p_listing_id: listingId, p_sender_id: peerUserId });
  if (error) console.error('Kunne ikke markere meldinger som lest:', error.message);
}

async function loadMessages() {
  const { data, error } = await supabase.from('messages').select('id, listing_id, sender_id, receiver_id, content, is_read, created_at')
    .eq('listing_id', listingId)
    .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${peerUserId}),and(sender_id.eq.${peerUserId},receiver_id.eq.${currentUser.id})`)
    .order('created_at', { ascending: true }).limit(500);
  if (error) {
    console.error('Kunne ikke hente meldinger:', error.message);
    messages.innerHTML = '<p class="text-sm text-red-700 text-center py-10">Kunne ikke laste samtalen. Prøv å laste siden på nytt.</p>';
    return false;
  }
  messages.innerHTML = '';
  renderedIds.clear();
  if (!data.length) {
    const empty = document.createElement('p');
    empty.id = 'empty-messages';
    empty.className = 'text-sm text-[#6B667E] text-center py-10';
    empty.textContent = 'Ingen meldinger ennå. Presenter deg gjerne kort og spør om rommet fortsatt er ledig.';
    messages.appendChild(empty);
  } else {
    data.forEach(appendMessage);
  }
  await markIncomingAsRead();
  return true;
}

function startRealtime() {
  if (channel) supabase.removeChannel(channel);
  realtimeError.classList.add('hidden');
  channel = supabase.channel(`messages-${listingId}-${currentUser.id}-${peerUserId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `listing_id=eq.${listingId}` }, async ({ new: message }) => {
      if (!isConversationMessage(message)) return;
      appendMessage(message);
      if (message.receiver_id === currentUser.id) await markIncomingAsRead();
    })
    .subscribe((status) => {
      if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) realtimeError.classList.remove('hidden');
    });
}

async function ownerMayReply() {
  const { data, error } = await supabase.from('messages').select('id')
    .eq('listing_id', listingId).eq('sender_id', peerUserId).eq('receiver_id', currentUser.id).limit(1);
  return !error && data.length > 0;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = input.value.trim();
  if (!content || !currentUser || !peerUserId || submit.disabled) return;
  if (content.length > 2000) {
    showToast('Meldingen kan være maks 2000 tegn.', 'error');
    return;
  }
  submit.disabled = true;
  submit.textContent = 'Sender …';
  const { data, error } = await supabase.rpc('send_message', {
    p_listing_id: listingId, p_receiver_id: peerUserId, p_content: content,
  });
  submit.disabled = false;
  submit.textContent = 'Send';
  if (error) {
    console.error('Kunne ikke sende melding:', error.message);
    const errorMessage = isMissingFunctionError(error)
      ? 'Meldinger krever at databasemigreringen installeres.'
      : /for mange meldinger/i.test(error.message || '')
        ? 'Du har sendt mange meldinger på kort tid. Vent litt og prøv igjen.'
        : /annonsen er ikke aktiv/i.test(error.message || '')
          ? 'Annonsen er ikke aktiv, og en ny samtale kan derfor ikke startes.'
          : 'Meldingen kunne ikke sendes. Vent litt og prøv igjen.';
    showToast(errorMessage, 'error');
    return;
  }
  input.value = '';
  characterCount.textContent = '0 / 2000';
  appendMessage(Array.isArray(data) ? data[0] : data);
});

input.addEventListener('input', () => {
  characterCount.textContent = `${input.value.length} / 2000`;
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.getElementById('reload-chat').addEventListener('click', async () => {
  realtimeError.classList.add('hidden');
  if (await loadMessages()) startRealtime();
});

async function init() {
  if (!UUID_PATTERN.test(listingId || '') || (queryPeerId && !UUID_PATTERN.test(queryPeerId))) {
    loading.textContent = 'Ugyldig samtalelenke.';
    return;
  }
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
  const { data, error } = await supabase.from('listings').select('id, user_id, title, city, price').eq('id', listingId).single();
  if (error || !data) {
    loading.textContent = 'Fant ikke annonsen du prøver å chatte om.';
    return;
  }
  listing = data;
  if (listing.user_id === currentUser.id) {
    peerUserId = queryPeerId;
    if (!peerUserId || peerUserId === currentUser.id || !(await ownerMayReply())) {
      loading.textContent = 'Åpne en eksisterende samtale fra Min side. En annonseeier kan ikke starte en ny samtale med en vilkårlig bruker.';
      return;
    }
  } else {
    peerUserId = listing.user_id;
  }
  document.getElementById('chat-listing-title').textContent = listing.title;
  document.getElementById('chat-listing-meta').textContent = `${new Intl.NumberFormat('nb-NO').format(listing.price)} kr/mnd • ${listing.city}`;
  document.getElementById('chat-listing-link').href = `listing-detail.html?id=${encodeURIComponent(listing.id)}`;
  await renderPeerIdentity();
  loading.classList.add('hidden');
  shell.classList.remove('hidden');
  await loadMessages();
  startRealtime();
}

window.addEventListener('beforeunload', () => { if (channel) supabase.removeChannel(channel); });
init();
