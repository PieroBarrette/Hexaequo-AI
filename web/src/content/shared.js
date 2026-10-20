/**
 * What the pages share: the way they link to one another, and the paragraph
 * that sends a reader on to the guide and the FAQ.
 *
 * Every page here is written once and drawn twice — by the app, in a panel,
 * and by backend/scripts/makePages.js, into the document at the page's own
 * address. Both hand the page a `tr` that reads the locale files:
 *   tr.t(path, vars) — a string, as i18n's t();
 *   tr.list(path)    — an array or object, for the longer pages' structure.
 * Nothing in this folder may touch the DOM or import the app's state: it runs
 * under Node too.
 */

import { pageAt } from '../pages.js';

/**
 * Mark the links between pages so the app can open them as panels.
 *
 * The text is written with plain addresses (/fr/regles/), which is what a
 * crawler needs to follow. A link to one of the site's pages also gets
 * data-panel, and the panels answer a click on it by opening that page in
 * place rather than loading the address.
 */
export function linkPages(html) {
  return html.replace(/<a href="(\/[^"#]*)"/g, (whole, href) => {
    const page = pageAt(href);
    return page ? `<a href="${href}" data-panel="${page.name}"` : whole;
  });
}

/** Where to read next, at the foot of the rules and of the page about the game. */
export function further(tr) {
  return `<h2>${tr.t('pages.furtherTitle')}</h2>
    <p>${linkPages(tr.t('pages.furtherText'))}</p>`;
}

/** Text that will sit in an attribute or in markup, made safe for both. */
export function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
