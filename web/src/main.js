/** Application entry point: settings, localisation, routing, service worker. */

import { loadSettings, onSettingsChange, get as getSetting } from './settings.js';
import { initI18n, t, translateDocument, onLanguageChange } from './i18n.js';
import { defineRoute, startRouter, navigate, refreshRoute, currentRoute } from './router.js';
import { unlockAudio, setVolume, play as playSound } from './audio.js';
import { logoLockupHtml } from './ui/logo.js';
import { mountHome } from './views/home.js';
import { mountPlay } from './views/play.js';
import { mountRules } from './views/rules.js';
import { mountOnline } from './views/online.js';
import { mountPrivacy, mountTerms } from './views/legal.js';
import { mountProfile } from './views/profile.js';
import { mountVerify, mountReset } from './views/mailAction.js';
import { mountSettings, setInstallPrompt } from './views/settings.js';
import { closeOverlay } from './ui/overlay.js';
import { openPanel, relabelPanel } from './ui/panels.js';
import { restoreSession, onAuthChange, currentUser, mustChoosePseudo } from './auth.js';

/** The header chip: your nickname and rating, or an invitation to sign in. */
function renderAccountChip() {
  const chip = document.getElementById('account-chip');
  if (!chip) return;
  const user = currentUser();
  chip.innerHTML = user
    ? '<span class="chip-name">' + user.pseudo + '</span><span class="chip-elo">' + user.elo + '</span>'
    : t('account.signIn');
  chip.classList.toggle('is-signed-in', Boolean(user));
}

function renderChrome() {
  document.title = t('meta.title');
  document.getElementById('brand').innerHTML = logoLockupHtml('sm');
  translateDocument();
  renderAccountChip();
}

async function boot() {
  loadSettings();
  await initI18n();
  setVolume(getSetting('volume'));

  defineRoute('home', mountHome);
  defineRoute('play', mountPlay);
  defineRoute('rules', mountRules);
  defineRoute('online', mountOnline);
  defineRoute('privacy', mountPrivacy);
  defineRoute('terms', mountTerms);
  defineRoute('settings', mountSettings);
  defineRoute('profile', mountProfile);
  /* Landing points for the links in our own mail. */
  defineRoute('verify', mountVerify);
  defineRoute('reset', mountReset);

  renderChrome();
  startRouter();

  /* Restore the session in the background. The app is fully usable signed out,
     so nothing waits on this; the header fills in when the answer arrives. */
  onAuthChange(() => {
    renderAccountChip();
    if (mustChoosePseudo()) openPanel('account');
  });
  restoreSession();

  document.getElementById('brand').addEventListener('click', () => {
    playSound('ui');
    closeOverlay();
    navigate('home');
  });
  document.getElementById('site-nav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-go]');
    if (!button) return;
    playSound('ui');
    openPanel(button.getAttribute('data-go'));
  });

  onLanguageChange(() => {
    renderChrome();
    // The play view relabels itself in place; remounting it would throw away
    // the game, which is exactly what these panels exist to avoid.
    if (currentRoute() !== 'play') refreshRoute();
    relabelPanel();
  });
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

  /* The service worker is cache-first, which is right in production and a trap
     in development: it keeps serving the previous copy of every module until
     CACHE_VERSION changes. Skip it on localhost, and tear down anything a
     previous session left registered there. */
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    if (isLocal) {
      navigator.serviceWorker.getRegistrations()
        .then((all) => all.forEach((r) => r.unregister()))
        .catch(() => {});
      if (window.caches) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
    } else {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ });
      });
    }
  }
}

boot();
