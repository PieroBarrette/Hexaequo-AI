/**
 * Localisation. All user-visible text goes through `t()`; the code itself stays
 * in English. Locale files are plain JSON with dotted lookup paths.
 */

import { get as getSetting, onSettingsChange } from './settings.js';

export const LANGUAGES = ['en', 'fr'];

const bundles = Object.create(null);
let active = 'en';
const listeners = new Set();

async function loadBundle(language) {
  if (bundles[language]) return bundles[language];
  const response = await fetch(new URL(`./locales/${language}.json`, import.meta.url));
  if (!response.ok) throw new Error(`Missing locale: ${language}`);
  bundles[language] = await response.json();
  return bundles[language];
}

export async function initI18n() {
  active = LANGUAGES.includes(getSetting('language')) ? getSetting('language') : 'en';
  await loadBundle(active);
  if (active !== 'en') await loadBundle('en').catch(() => {});
  onSettingsChange(async (name, value) => {
    if (name !== 'language') return;
    await setLanguage(value);
  });
}

export async function setLanguage(language) {
  if (!LANGUAGES.includes(language)) return;
  await loadBundle(language);
  active = language;
  document.documentElement.setAttribute('lang', language);
  translateDocument();
  for (const fn of listeners) fn(language);
}

export const currentLanguage = () => active;

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function lookup(bundle, path) {
  let node = bundle;
  for (const part of path.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Translate `path`, falling back to English and then to the path itself so a
 * missing key is visible rather than silently blank.
 * Placeholders are written {name} and filled from `vars`.
 */
export function t(path, vars) {
  let text = lookup(bundles[active] || {}, path);
  if (text === undefined) text = lookup(bundles.en || {}, path);
  if (text === undefined) return path;
  if (vars) {
    text = text.replace(/\{(\w+)\}/g, (whole, name) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole);
  }
  return text;
}

/**
 * Apply translations to any element carrying a data-i18n attribute:
 *   data-i18n            → textContent
 *   data-i18n-html       → innerHTML (for text with inline markup)
 *   data-i18n-attr="k:p" → sets attribute k from path p (repeat with commas)
 */
export function translateDocument(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'));
  }
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.getAttribute('data-i18n-attr').split(',')) {
      const [attr, path] = pair.split(':').map((s) => s.trim());
      if (attr && path) el.setAttribute(attr, t(path));
    }
  }
  const title = document.querySelector('title[data-i18n]');
  if (title) document.title = title.textContent;
}
