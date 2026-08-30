/** Home screen: the mark, and the four ways into the site. */

import { t } from '../i18n.js';
import { isSignedIn, onAuthChange } from '../auth.js';
import { navigate } from '../router.js';
import { logoLockupHtml } from '../ui/logo.js';
import { play } from '../audio.js';
import { get as getSetting, set as setSetting, resolvedTheme } from '../settings.js';
import { openPanel } from '../ui/panels.js';
import { startHomeBoard } from '../ui/homeBoard.js';

export function mountHome(outlet) {
  /* Restoring the session finishes after this view is built, so anything that
     depends on being signed in appears when the answer lands rather than only
     on the next visit. */
  const showAccountOnly = () => {
    for (const node of outlet.querySelectorAll('[data-needs-account]')) {
      node.hidden = !isSignedIn();
    }
  };
  outlet.innerHTML = `
    <div class="home">
      <!-- A game going on behind all this, blurred past reading. Ahead of the
           content in the markup so it sits under it without a stacking trick,
           and hidden from anything that reads the page aloud: it is scenery,
           and there is nothing in it to hear. -->
      <div class="home-board" aria-hidden="true"></div>
      <div class="home-inner">
      ${logoLockupHtml('lg')}
      <p class="lede">${t('meta.tagline')}</p>
      <p class="home-purpose">${t('home.purpose')}</p>
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
      <div class="home-foot">
        <button data-action="lang">${getSetting('language') === 'fr' ? 'English' : 'Français'}</button>
        <button data-go="privacy">${t('nav.privacy')}</button>
        <button data-go="terms">${t('nav.terms')}</button>
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
    const panel = event.target.closest('[data-panel]');
    if (panel) {
      play('ui');
      openPanel(panel.getAttribute('data-panel'));
      return;
    }
    const go = event.target.closest('[data-go]');
    if (go) {
      play('ui');
      navigate(go.getAttribute('data-go'));
      return;
    }
    const action = event.target.closest('[data-action]');
    if (!action) return;
    play('ui');
    if (action.getAttribute('data-action') === 'lang') {
      setSetting('language', getSetting('language') === 'fr' ? 'en' : 'fr');
    } else {
      setSetting('theme', resolvedTheme() === 'dark' ? 'light' : 'dark');
    }
  });

  showAccountOnly();
  const stop = onAuthChange(() => showAccountOnly());
  const stopBoard = startHomeBoard(outlet.querySelector('.home-board'));
  return () => { stop(); stopBoard(); };
}
