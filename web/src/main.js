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
import { closeOverlay, overlayName } from './ui/overlay.js';
import { openPanel, relabelPanel } from './ui/panels.js';
import { mountChallenges } from './ui/challenge.js';
import { restoreSession, onAuthChange, currentUser, mustChoosePseudo, isSignedIn } from './auth.js';
import { watchForUpdates } from './update.js';
import { startSettingsSync } from './settingsSync.js';

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

/**
 * Put the loader away, once there is something behind it.
 *
 * After startRouter, because that is the call that replaces the boot copy with
 * a real view — hiding it any earlier would uncover a page mid-build. On the
 * frame after, so the view has been laid out and the fade crosses to a
 * finished screen rather than to an empty one.
 *
 * It is removed rather than left hidden: it is fixed and full-screen, and a
 * transparent sheet over the whole app is the kind of thing that swallows a
 * click for the rest of the session if a transition ever fails to fire.
 */
function dismissLoader() {
  const loader = document.getElementById('loader');
  if (!loader) return;
  let leaving = false;
  const leave = () => {
    if (leaving) return;
    leaving = true;
    loader.classList.add('is-gone');
    const drop = () => loader.remove();
    loader.addEventListener('transitionend', drop, { once: true });
    setTimeout(drop, 700);          // in case the transition never runs at all
  };
  /* Two frames, so the view behind has been laid out before the fade starts —
     and a timer behind them, because a tab loaded in the background may be
     handed no frames at all until somebody looks at it, and the loader must
     not be what they find waiting. Whichever arrives first wins. */
  requestAnimationFrame(() => requestAnimationFrame(leave));
  setTimeout(leave, 150);
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
  /* Signed in, preferences belong to the account rather than to this browser;
     signed out they stay where they are. Wired before the session is restored
     so the first answer about who is here is not missed. */
  startSettingsSync(onSettingsChange);
  startRouter();
  dismissLoader();

  /* Restore the session in the background. The app is fully usable signed out,
     so nothing waits on this; the header fills in when the answer arrives. */
  onAuthChange(() => {
    renderAccountChip();
    /* Only when it is not already the panel on screen. openPanel toggles — a
       second call on the open one closes it, which is right for a nav button
       pressed twice and wrong here: signing up from inside the account panel
       asked for the nickname and slammed the door in the same breath, so a new
       account was never asked for its name at all. */
    if (mustChoosePseudo() && overlayName() !== 'account') openPanel('account');
  });
  restoreSession();

  /* Invitations are addressed to a person, not to a page, so the card that
     carries them is mounted above the router rather than inside any view. It
     dials the server only once there is a session to be addressed. */
  mountChallenges();

  document.getElementById('brand').addEventListener('click', () => {
    playSound('ui');
    closeOverlay();
    navigate('home');
  });
  document.getElementById('site-nav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-go]');
    if (!button) return;
    playSound('ui');
    const where = button.getAttribute('data-go');
    /*
     * Signed in, the chip carries your name and rating, so it should lead to
     * the page about you rather than to a panel over whatever you were doing
     * whose main button said "see my profile". Signed out it is still the
     * door, because there is no page yet.
     */
    if (where === 'account' && isSignedIn()) { closeOverlay(); navigate('profile'); return; }
    openPanel(where);
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

  /* Audio may only start after a gesture — and Chrome counts a completed
     click, not the pointerdown that begins one. Listening for both, and for a
     key, means the first sound is ready without the console complaining that
     the context was built too early. */
  const GESTURES = ['click', 'pointerup', 'keydown', 'touchend'];
  const unlock = () => {
    unlockAudio();
    for (const kind of GESTURES) window.removeEventListener(kind, unlock);
  };
  for (const kind of GESTURES) window.addEventListener(kind, unlock);

  /*
   * Hold the page at its own scale.
   *
   * Safari ignores user-scalable=no on purpose, so a pinch has to be refused
   * here — and a double tap, which iOS also reads as zoom. The board sizes
   * itself to the screen, so a zoomed one only ever means pieces pushed off
   * the edge with no obvious way back.
   */
  for (const kind of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(kind, (event) => event.preventDefault(), { passive: false });
  }
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (event) => {
    const now = Date.now();
    if (now - lastTouchEnd < 300) event.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

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
      window.addEventListener('load', watchForUpdates);
    }
  }
}

boot();
