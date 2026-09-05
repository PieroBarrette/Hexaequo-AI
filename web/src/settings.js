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
  soundVoice: 'melodic', // 'melodic' (pitched) | 'percussive' (struck)
  sound: true,
  volume: 0.5,
  showValidMoves: true,
  showLastMove: true,
  /* 'auto' | 'always' | 'never'. Auto writes them on the board while a game is
     being read back and leaves it bare while one is being played, which is
     when they are wanted and when they are in the way. */
  showCoordinates: 'auto',
  /* Two kinds of motion, two switches: what happens on the board (a piece
     travelling to its cell, a capture fading, a placement settling) and what
     crosses from a reserve to the board. Either can be had without the
     other. */
  animateMoves: true,
  animatePlacement: true,
  premove: false,
  /* The gentlest of the four. Somebody opening the site for the first time
     has not read the rules yet, and an opponent that beats them before they
     have understood how a ring moves teaches nothing. The level is one tap
     away in the bar for anyone who wants more. */
  aiLevel: 0,             // see AI_LEVELS_VERSION below
  aiLevelsVersion: 0,
};

/*
 * A beginner level was added below the three that existed, so every stored
 * aiLevel means one level weaker than it used to. Bumping this shifts an old
 * setting up once, rather than silently making everyone’s opponent easier.
 */
const AI_LEVELS_VERSION = 1;

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

/**
 * The language to open in, for somebody who has never chosen one.
 *
 * `navigator.languages` is the ordered list a browser actually offers;
 * `navigator.language` is only the first of it. Reading just the first meant a
 * browser set to Spanish, then French, then English was answered in English —
 * the site does not speak Spanish, so it fell to the default rather than
 * carrying on down the list to the language it does speak. The region is
 * dropped: fr-CA and fr-FR are the same locale file here.
 */
function preferredLanguage() {
  const offered = (navigator.languages && navigator.languages.length)
    ? navigator.languages
    : [navigator.language];
  for (const tag of offered) {
    const base = String(tag || '').toLowerCase().split('-')[0];
    if (base === 'fr' || base === 'en') return base;
  }
  return 'en';
}

export function loadSettings() {
  const stored = readStored();
  /* Nothing stored at all is a first visit, and a first visit has nothing to
     migrate. Without this the version shift below ran on the defaults
     themselves — so the beginner level they now start at was bumped one
     stronger before anybody saw it. */
  const firstVisit = !Object.keys(stored).length;
  current = { ...DEFAULTS, ...stored };
  if (firstVisit) current.aiLevelsVersion = AI_LEVELS_VERSION;
  if (current.aiLevelsVersion < AI_LEVELS_VERSION) {
    current.aiLevel = Math.min(3, Number(current.aiLevel || 0) + 1);
    current.aiLevelsVersion = AI_LEVELS_VERSION;
    persist();
  }
  /* It used to be a switch. A stored true or false still means what it said,
     and anything else — including nothing at all — takes the new default. */
  if (current.showCoordinates === true) current.showCoordinates = 'always';
  else if (current.showCoordinates === false) current.showCoordinates = 'never';
  else if (!['auto', 'always', 'never'].includes(current.showCoordinates)) {
    current.showCoordinates = 'auto';
  }
  if (!current.language) current.language = preferredLanguage();
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
