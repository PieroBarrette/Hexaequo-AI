/** Home screen: the mark, the ways into the site, and what the game is. */

import { t } from '../i18n.js';
import { isSignedIn, onAuthChange } from '../auth.js';
import { navigate } from '../router.js';
import { logoLockupHtml } from '../ui/logo.js';
import { play } from '../audio.js';
import { get as getSetting, set as setSetting, resolvedTheme } from '../settings.js';
import { openPanel } from '../ui/panels.js';

export function mountHome(outlet) {
  /* Restoring the session finishes after this view is built, so anything that
     depends on being signed in appears when the answer lands rather than only
     on the next visit. */
  const showAccountOnly = () => {
    for (const node of outlet.querySelectorAll('[data-needs-account]')) {
      node.hidden = !isSignedIn();
    }
  };
  /*
   * What the game is, under the menu rather than above it.
   *
   * Search engines run this script and index what it leaves, not the copy in
   * index.html, so this is the description they read — and it needs real
   * addresses to follow, the published pages in the language on screen. The
   * menu comes first because a returning player wants the buttons; the
   * tagline over it already says what the game is in one line, so the text
   * below goes on from there rather than saying it again.
   *
   * The links in the footer are addresses for the same reason. In the app
   * they still switch the language and open the policies in place; only a
   * click meant for a new tab follows the href.
   */
  const fr = getSetting('language') === 'fr';
  const page = (en, french) => (fr ? french : en);
  outlet.innerHTML = `
    <div class="home">
      <div class="home-inner">
      ${logoLockupHtml('lg', 'h1')}
      <p class="lede">${t('meta.tagline')}</p>
      <nav class="home-menu">
        <p class="home-heading">${t('home.play')}</p>
        <div class="home-pair">
          <button class="btn btn--primary" data-go="play">${t('home.playLocal')}</button>
          <button class="btn btn--primary" data-go="online"
                  data-online-button>${t('home.playOnline')}</button>
        </div>
        <button class="btn" data-panel="leaderboard">${t('home.leaderboard')}</button>
        <button class="btn" data-go="profile" data-needs-account
                hidden>${t('home.profile')}</button>
        <button class="btn" data-panel="rules">${t('home.rules')}</button>
        <button class="btn" data-panel="settings">${t('home.settings')}</button>
      </nav>
      <section class="home-about">
        <p>${t('home.about')}</p>
        <p>${t('home.ways')}</p>
        <p class="home-links">
          <a href="${page('/rules/', '/fr/regles/')}" data-panel="rules">${t('home.fullRules')}</a>
          <a href="${page('/play/', '/fr/jouer/')}">${t('home.more')}</a>
        </p>
      </section>
      <div class="home-foot">
        <a href="${page('/fr/jouer/', '/play/')}" hreflang="${page('fr', 'en')}"
           data-action="lang">${page('Français', 'English')}</a>
        <a href="${page('/privacy/', '/fr/confidentialite/')}" data-go="privacy">${t('nav.privacy')}</a>
        <a href="${page('/terms/', '/fr/conditions/')}" data-go="terms">${t('nav.terms')}</a>
        <button data-action="theme">${resolvedTheme() === 'dark' ? '☀' : '☾'}</button>
      </div>
      <p class="home-credit">${t('home.credit')}</p>
      </div>
    </div>`;

/*
 * The online door stays the online door.
 *
 * It used to turn into "rejoin your game" whenever one was unfinished and go
 * straight to the board, which meant an unfinished game shut the online page
 * altogether: no lobby, no chat, no leaderboard of who is about. The chip in
 * the corner already offers the way back from every page, so the button does
 * not have to be that offer as well — and being it cost the only route to
 * everything else.
 */

  outlet.addEventListener('click', (event) => {
    const hit = event.target.closest('[data-panel], [data-go], [data-action]');
    if (!hit) return;
    if (hit.tagName === 'A') {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
    }
    play('ui');
    if (hit.hasAttribute('data-panel')) {
      openPanel(hit.getAttribute('data-panel'));
      return;
    }
    if (hit.hasAttribute('data-go')) {
      navigate(hit.getAttribute('data-go'));
      return;
    }
    if (hit.getAttribute('data-action') === 'lang') {
      setSetting('language', getSetting('language') === 'fr' ? 'en' : 'fr');
    } else {
      setSetting('theme', resolvedTheme() === 'dark' ? 'light' : 'dark');
    }
  });

  showAccountOnly();
  const stop = onAuthChange(() => showAccountOnly());

  /* The sun or the moon says which way the next press goes, so it has to
     turn when the theme does — from this button, from the settings panel,
     from an account signing in, or from the sky outside when the theme
     follows the system. All of those end in the same place, the attribute on
     <html>, so that is what is watched. It is written in the middle of the
     fade, which puts the turn of the icon inside the fade with everything
     else. */
  const themeButton = outlet.querySelector('[data-action="theme"]');
  const themeWatch = new MutationObserver(() => {
    themeButton.textContent =
      document.documentElement.getAttribute('data-theme') === 'dark' ? '☀' : '☾';
  });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  return () => { stop(); themeWatch.disconnect(); };
}
