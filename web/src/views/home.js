/** Home screen: the mark, and the four ways into the site. */

import { t } from '../i18n.js';
import { isSignedIn, onAuthChange, sessionToken } from '../auth.js';
import { request, connect, identify } from '../net.js';
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
  outlet.innerHTML = `
    <div class="home">
      <div class="home-inner">
      ${logoLockupHtml('lg')}
      <p class="lede">${t('meta.tagline')}</p>
      <p class="home-purpose">${t('home.purpose')}</p>
      <nav class="home-menu">
        <button class="btn btn--primary" data-go="play">${t('home.playLocal')}</button>
        <button class="btn" data-go="online" data-online-button>${t('home.playOnline')}</button>
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

  let liveCode = null;

  async function findMyGame() {
    const button = outlet.querySelector('[data-online-button]');
    if (!button) return;
    if (!isSignedIn()) {
      liveCode = null;
      button.textContent = t('home.playOnline');
      button.classList.remove('btn--primary');
      return;
    }
    try {
      await connect();
      await identify(sessionToken()).catch(() => {});
      const mine = await request('hx:mygame', {});
      liveCode = mine && mine.ok ? mine.code : null;
    } catch { liveCode = null; }
    if (!outlet.isConnected) return;
    button.textContent = liveCode ? t('home.rejoin') : t('home.playOnline');
    button.classList.toggle('btn--primary', Boolean(liveCode));
  }

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
      const where = go.getAttribute('data-go');
      // Straight to the board rather than through the page that would only
      // send you there.
      if (where === 'online' && liveCode) navigate('play', { online: '1', code: liveCode });
      else navigate(where);
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
  findMyGame();
  const stop = onAuthChange(() => { showAccountOnly(); findMyGame(); });
  return () => stop();
}
