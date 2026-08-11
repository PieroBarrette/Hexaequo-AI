/** Application entry point: settings, localisation, routing, service worker. */

import { loadSettings, onSettingsChange, get as getSetting } from './settings.js';
import { initI18n, t, translateDocument, onLanguageChange } from './i18n.js';
import { defineRoute, startRouter, navigate, refreshRoute } from './router.js';
import { unlockAudio, setVolume, play as playSound } from './audio.js';
import { logoLockupHtml } from './ui/logo.js';
import { mountHome } from './views/home.js';
import { mountPlay } from './views/play.js';
import { mountRules } from './views/rules.js';
import { mountSettings, setInstallPrompt } from './views/settings.js';

function renderChrome() {
  document.title = t('meta.title');
  document.getElementById('brand').innerHTML = logoLockupHtml('sm');
  translateDocument();
}

async function boot() {
  loadSettings();
  await initI18n();
  setVolume(getSetting('volume'));

  defineRoute('home', mountHome);
  defineRoute('play', mountPlay);
  defineRoute('rules', mountRules);
  defineRoute('settings', mountSettings);

  renderChrome();
  startRouter();

  document.getElementById('brand').addEventListener('click', () => { playSound('ui'); navigate('home'); });
  document.getElementById('site-nav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-go]');
    if (!button) return;
    playSound('ui');
    navigate(button.getAttribute('data-go'));
  });

  // Re-render everything on a language change: view markup is built from t().
  onLanguageChange(() => { renderChrome(); refreshRoute(); });
  /* Theme and material are pure CSS variables, so they need no re-render; the
     move aid is read the next time the board draws. Only the language changes
     the markup itself. */
  onSettingsChange((name, value) => { if (name === 'volume') setVolume(value); });

  // Audio may only start after a gesture.
  const unlock = () => {
    unlockAudio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    setInstallPrompt(event);
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ });
    });
  }
}

boot();
