/**
 * The panels any screen can summon: settings, the account, the leaderboard —
 * and the pages that have an address of their own (pages.js): the rules, the
 * page about the game, the guide, the FAQ and the two policies.
 *
 * Kept apart from main.js so that a view can open one without importing the
 * entry point, which would make the module graph circular.
 */

import { t, reader, currentLanguage } from '../i18n.js';
import { openOverlay, isOverlayOpen, overlayName, refreshOverlay, onOverlayChange, closeOverlay } from './overlay.js';
import { mountSettings } from '../views/settings.js';
import { mountAccount } from '../views/account.js';
import { mountLeaderboard } from '../views/leaderboard.js';
import { CONTENT } from '../content/index.js';
import { PAGES, pathOf, pageAt } from '../pages.js';

/** A page from content/, drawn into a panel the way every page is laid out. */
const pageMount = (name) => (outlet) => {
  outlet.innerHTML = `<div class="page"><div class="page-inner page-text">${CONTENT[name].html(reader())}</div></div>`;
};

const PANELS = {
  settings: { title: () => t('settings.title'), mount: mountSettings },
  account: { title: () => t('account.title'), mount: mountAccount },
  leaderboard: { title: () => t('leaderboard.title'), mount: mountLeaderboard },
};
for (const name of Object.keys(PAGES)) {
  PANELS[name] = { title: () => CONTENT[name].title(reader()), mount: pageMount(name) };
}

/** Open a panel over the current screen. Opening the same one again closes it. */
export function openPanel(name) {
  const panel = PANELS[name];
  if (!panel) return;
  openOverlay(name, panel.title(), panel.mount);
}

/** Re-render the open panel in the new language, if one is open. */
export function relabelPanel() {
  if (!isOverlayOpen()) return;
  const panel = PANELS[overlayName()];
  if (panel) refreshOverlay(panel.title(), panel.mount);
  showAddress();
}

/*
 * The address bar follows the pages.
 *
 * A page opened in the app puts its own path there — /fr/regles/ for the
 * rules in French — so that it can be copied, shared and bookmarked; closing
 * it puts back the address of the screen underneath. The path is replaced,
 * never pushed: the panels had no place in the history before they had
 * addresses, and Back still does what it did. When Back or Forward land on a
 * page's address anyway, the panel follows (see the popstate listener).
 *
 * The tab is titled after the page while it is open, as the page's own
 * document is, and after the game otherwise (meta.homeTitle, which main.js
 * also sets as the app starts).
 */
function showAddress() {
  const open = isOverlayOpen() ? overlayName() : null;
  const route = window.location.hash || '';
  /* The home screen needs no fragment under a page: /fr/regles/ reads
     better than /fr/regles/#/home, and opens the same thing. */
  const under = route === '#/home' ? '' : route;
  if (open && PAGES[open]) {
    const path = pathOf(open, currentLanguage());
    if (window.location.pathname !== path || window.location.hash !== under) {
      history.replaceState(history.state, '', path + under);
    }
    document.title = CONTENT[open].docTitle(reader());
    return;
  }
  if (pageAt(window.location.pathname)) {
    history.replaceState(history.state, '', '/' + (route || '#/home'));
  }
  document.title = t('meta.homeTitle');
}

onOverlayChange(() => showAddress());

/* Back and Forward across addresses this page has held: open the page the
   address names, or close one the address no longer does. */
window.addEventListener('popstate', () => {
  const page = pageAt(window.location.pathname);
  if (page && overlayName() !== page.name) openPanel(page.name);
  else if (!page && PAGES[overlayName()]) closeOverlay();
});

/*
 * A link from one page to another opens that page in place.
 *
 * The pages link to each other with plain addresses, which is what a crawler
 * follows; content/shared.js marks those with data-panel. In the app a click
 * on one swaps the panel rather than loading the address — unless it was
 * meant for a new tab.
 */
document.addEventListener('click', (event) => {
  const link = event.target.closest('.overlay a[data-panel]');
  if (!link || event.defaultPrevented) return;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button) return;
  event.preventDefault();
  const name = link.getAttribute('data-panel');
  if (overlayName() !== name) openPanel(name);
});
