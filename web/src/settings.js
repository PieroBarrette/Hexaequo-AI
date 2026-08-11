/**
 * User preferences, persisted in localStorage and applied to the document root.
 *
 * `theme` and `boardStyle` are independent: theme picks light or dark, board
 * style picks the material — classic is wood, modern is stone and metal. The
 * four combinations are defined in styles/tokens.css.
 */

const STORAGE_KEY = 'hexaequo.settings';

export const DEFAULTS = {
  language: null,        // null = follow the browser on first visit
  theme: 'auto',         // 'auto' | 'light' | 'dark'
  boardStyle: 'modern',  // 'classic' (wood) | 'modern' (stone & metal)
  sound: true,
  volume: 0.7,
  showValidMoves: true,
  aiLevel: 1,
};

const listeners = new Set();
let current = { ...DEFAULTS };

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* private browsing or storage full: settings simply do not survive reload */
  }
}

export function loadSettings() {
  current = { ...DEFAULTS, ...readStored() };
  if (!current.language) {
    current.language = (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
  }
  applyToDocument();
  return current;
}

export const getSettings = () => current;
export const get = (name) => current[name];

export function set(name, value) {
  if (current[name] === value) return;
  current[name] = value;
  persist();
  applyToDocument();
  for (const fn of listeners) fn(name, value, current);
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The theme actually in force, resolving 'auto' against the OS preference. */
export function resolvedTheme() {
  if (current.theme !== 'auto') return current.theme;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function applyToDocument() {
  const root = document.documentElement;
  root.setAttribute('data-theme', resolvedTheme());
  root.setAttribute('data-board-style', current.boardStyle);
  root.setAttribute('lang', current.language || 'en');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#0e1015');
  }
}

// Follow the OS when the user has chosen 'auto'.
if (window.matchMedia) {
  const query = window.matchMedia('(prefers-color-scheme: light)');
  const handler = () => { if (current.theme === 'auto') applyToDocument(); };
  if (query.addEventListener) query.addEventListener('change', handler);
  else if (query.addListener) query.addListener(handler);
}
