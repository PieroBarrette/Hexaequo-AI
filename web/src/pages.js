/**
 * The pages of the site that have an address of their own.
 *
 * Each is a panel of the app — the same drawer that opens over the board —
 * and each has a real path in each language, so that a search engine can
 * index it and a person can share it. Opened in the app, a panel puts its
 * path in the address bar; arrived at by that path, the app opens with the
 * panel drawn over the home screen. backend/scripts/makePages.js writes a
 * document at every one of these paths, with the panel's words already in
 * it for anything that reads the page without running it.
 *
 * Separate addresses per language rather than one page that switches: a
 * crawler indexes an address, and two languages sharing one cannot both be
 * found.
 *
 * Kept free of imports, so the settings, the panels and the build script
 * (which runs under Node) can all read it.
 */

export const PAGES = {
  rules: { en: '/rules/', fr: '/fr/regles/' },
  about: { en: '/play/', fr: '/fr/jouer/' },
  guide: { en: '/guide/', fr: '/fr/guide/' },
  faq: { en: '/faq/', fr: '/fr/faq/' },
  privacy: { en: '/privacy/', fr: '/fr/confidentialite/' },
  terms: { en: '/terms/', fr: '/fr/conditions/' },
};

/** Pages a search engine is asked to leave out of its results. */
export const UNLISTED = new Set(['privacy', 'terms']);

/** The path of a page in a language, or null for a panel without one. */
export function pathOf(name, language) {
  const page = PAGES[name];
  if (!page) return null;
  return page[language] || page.en;
}

/** Which page, and which language, a path is — or null. */
export function pageAt(pathname) {
  const path = String(pathname || '').replace(/\/index\.html$/, '/').replace(/([^/])$/, '$1/');
  for (const [name, paths] of Object.entries(PAGES)) {
    for (const [language, at] of Object.entries(paths)) {
      if (at === path) return { name, language };
    }
  }
  return null;
}
