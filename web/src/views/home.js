/** Home screen: the mark, and the four ways into the site. */

import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { logoLockupHtml } from '../ui/logo.js';
import { play } from '../audio.js';
import { get as getSetting, set as setSetting, resolvedTheme } from '../settings.js';
import { openPanel } from '../ui/panels.js';

export function mountHome(outlet) {
  outlet.innerHTML = `
    <div class="home">
      ${logoLockupHtml('lg')}
      <p class="lede">${t('meta.tagline')}</p>
      <p class="home-purpose">${t('home.purpose')}</p>
      <nav class="home-menu">
        <button class="btn btn--primary" data-go="play">${t('home.playLocal')}</button>
        <button class="btn" data-go="online">${t('home.playOnline')}</button>
        <button class="btn" data-panel="leaderboard">${t('home.leaderboard')}</button>
        <button class="btn" data-panel="rules">${t('home.rules')}</button>
        <button class="btn" data-panel="settings">${t('home.settings')}</button>
      </nav>
      <div class="home-foot">
        <button data-action="lang">${getSetting('language') === 'fr' ? 'English' : 'Français'}</button>
        <button data-go="privacy">${t('nav.privacy')}</button>
        <button data-go="terms">${t('nav.terms')}</button>
        <button data-action="theme">${resolvedTheme() === 'dark' ? '☀' : '☾'}</button>
      </div>
    </div>`;

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
}
