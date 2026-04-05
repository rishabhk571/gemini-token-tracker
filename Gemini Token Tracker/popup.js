/**
 * popup.js
 * Manages the settings popup: save/clear API key, toggle API mode.
 * All data goes to chrome.storage.local — never to any external server.
 */

const STORAGE_KEY_APIKEY  = 'gtm_api_key';
const STORAGE_KEY_USEAPI  = 'gtm_use_api';
const toggleEl    = document.getElementById('toggle-api');
const inputKeyEl  = document.getElementById('input-key');
const btnSave     = document.getElementById('btn-save');
const btnClear    = document.getElementById('btn-clear');
const statusEl    = document.getElementById('status-msg');
const keyStatusEl = document.getElementById('key-status');
const keySectionEl = document.getElementById('key-section');
const btnEdit     = document.getElementById('btn-edit');
const keyEditFields = document.getElementById('key-edit-fields');

let themeObserver = null;
let hasSavedKey = false;
let isEditing = false;

function syncThemeFromBody() {
  const bgColor = window.getComputedStyle(document.body).backgroundColor;
  const rgb = bgColor.match(/\d+/g);
  if (rgb && rgb.length >= 3) {
    const r = parseInt(rgb[0], 10);
    const g = parseInt(rgb[1], 10);
    const b = parseInt(rgb[2], 10);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    if (brightness < 128) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }
}

function initThemeSync() {
  syncThemeFromBody();
  if (themeObserver) return;
  themeObserver = new MutationObserver(syncThemeFromBody);
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });

  const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  if (themeQuery.addEventListener) {
    themeQuery.addEventListener('change', syncThemeFromBody);
  } else if (themeQuery.addListener) {
    themeQuery.addListener(syncThemeFromBody);
  }
}

initThemeSync();

// Edit key button
if (btnEdit) {
  btnEdit.addEventListener('click', () => {
    setEditMode(!isEditing);
  });
}


// ── Helpers ────────────────────────────────────────────────────

function showStatus(msg, type = 'ok') {
  statusEl.textContent = msg;
  statusEl.className   = `status ${type}`;
  setTimeout(() => { statusEl.className = 'status'; }, 3000);
}

function maskKey(key) {
  if (!key || key.length < 8) return '••••••••';
  return key.slice(0, 6) + '••••' + key.slice(-4);
}

function updateEditButtonLabel() {
  if (!btnEdit) return;
  btnEdit.textContent = isEditing ? 'Done' : 'Edit';
}

function setEditMode(next) {
  if (!keyEditFields) return;
  if (!hasSavedKey) {
    isEditing = true;
    keyEditFields.classList.remove('is-hidden');
    updateEditButtonLabel();
    return;
  }
  isEditing = !!next;
  keyEditFields.classList.toggle('is-hidden', !isEditing);
  updateEditButtonLabel();
}

function syncKeyUI(savedKey) {
  hasSavedKey = !!savedKey;
  if (hasSavedKey) {
    keyStatusEl.innerHTML = `API key saved: <span>${maskKey(savedKey)}</span>`;
    if (btnEdit) btnEdit.classList.remove('is-hidden');
    if (!isEditing && keyEditFields) {
      keyEditFields.classList.add('is-hidden');
    }
  } else {
    keyStatusEl.textContent = 'No API key saved';
    if (btnEdit) btnEdit.classList.add('is-hidden');
    isEditing = true;
    if (keyEditFields) keyEditFields.classList.remove('is-hidden');
  }
  updateEditButtonLabel();
}

// ── Load current state ─────────────────────────────────────────

chrome.storage.local.get([STORAGE_KEY_APIKEY, STORAGE_KEY_USEAPI], (result) => {
  const savedKey = result[STORAGE_KEY_APIKEY] || '';
  const useApi   = result[STORAGE_KEY_USEAPI] || false;

  toggleEl.checked = useApi;
  keySectionEl.style.opacity = useApi ? '1' : '0.5';

  isEditing = !savedKey;
  syncKeyUI(savedKey);
});
// ── Toggle switch ──────────────────────────────────────────────

toggleEl.addEventListener('change', () => {
  const useApi = toggleEl.checked;
  chrome.storage.local.set({ [STORAGE_KEY_USEAPI]: useApi });
  keySectionEl.style.opacity = useApi ? '1' : '0.5';
  showStatus(useApi ? 'API mode enabled (exact counts)' : 'Heuristic mode enabled', 'info');
});


// ── Save key ───────────────────────────────────────────────────

btnSave.addEventListener('click', () => {
  const key = inputKeyEl.value.trim();

  if (!key) {
    showStatus('Enter a key first.', 'error');
    return;
  }
  if (!key.startsWith('AIza') || key.length < 30) {
    showStatus('This does not look like a valid Google AI Studio API key.', 'error');
    return;
  }

  chrome.storage.local.set({ [STORAGE_KEY_APIKEY]: key }, () => {
    inputKeyEl.value = '';
    isEditing = false;
    syncKeyUI(key);
    showStatus('API key saved securely.', 'ok');
  });
});
// ── Clear key ──────────────────────────────────────────────────

btnClear.addEventListener('click', () => {
  chrome.storage.local.remove([STORAGE_KEY_APIKEY], () => {
    inputKeyEl.value = '';
    isEditing = true;
    syncKeyUI('');
    showStatus('Key cleared.', 'info');
  });
});


