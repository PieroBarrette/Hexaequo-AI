/** Home screen: the mark, and the four ways into the site. */

import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { logoLockupHtml } from '../ui/logo.js';
import { play } from '../audio.js';
import { get as getSetting, set as setSetting, resolvedTheme } from '../settings.js';

export function mountHome(outlet) {
  outlet.innerHTML = `
    <div class="home">
      ${logoLockupHtml('lg')}
      <p class="lede">${t('meta.tagline')}</p>
      <nav class="home-menu">
        <button class="btn btn--primary" data-go="play">${t('home.playLocal')}</button>
        <button class="btn" data-go="rules">${t('home.rules')}</button>
        <button class="btn" data-go="settings">${t('home.settings')}</button>
        <button class="btn" disabled title="${t('home.onlineSoon')}">
          ${t('home.playOnline')} · ${t('home.onlineSoon')}
        </button>
      </nav>
      <div class="home-foot">
        <button data-action="lang">${getSetting('language') === 'fr' ? 'English' : 'Français'}</button>
        <button data-action="theme">${resolvedTheme() === 'dark' ? '☀' : '☾'}</button>
      </div>
    </div>`;

  outlet.addEventListener('click', (event) => {
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
