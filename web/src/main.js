/** Application entry point: settings, localisation, routing, service worker. */

import { loadSettings, onSettingsChange, get as getSetting } from './settings.js';
import { initI18n, t, translateDocument, onLanguageChange } from './i18n.js';
import { defineRoute, startRouter, navigate, refreshRoute, currentRoute } from './router.js';
import { unlockAudio, setVolume, play as playSound } from './audio.js';
import { logoMarkSvg } from './ui/logo.js';
import { icon } from './ui/icons.js';
import { mountHome } from './views/home.js';
import { mountPlay } from './views/play.js';
import { mountOnline } from './views/online.js';
import { mountProfile } from './views/profile.js';
import { mountVerify, mountReset } from './views/mailAction.js';
import { mountSettings, setInstallPrompt } from './views/settings.js';
import { closeOverlay, overlayName } from './ui/overlay.js';
import { openPanel, relabelPanel } from './ui/panels.js';
import { pageAt } from './pages.js';
import { mountChallenges } from './ui/challenge.js';
import {
  restoreSession, onAuthChange, currentUser, mustChoosePseudo, isSignedIn,
  sessionReady, sessionToken,
} from './auth.js';
import { watchForUpdates } from './update.js';
import { startSettingsSync } from './settingsSync.js';
import { startPush } from './push.js';

/**
 * The header chip: your nickname and rating, or an invitation to sign in.
 *
 * Or, for the moment between opening the page and the server confirming the
 * session, neither. A token in the drawer is a session until the server says
 * otherwise, and "sign in" over it was a lie told on every load -- for a second
 * on a good day, for the whole visit when the first request failed.
 */
function renderAccountChip() {
  const chip = document.getElementById('account-chip');
  if (!chip) return;
  const user = currentUser();
  const pending = !user && !sessionReady() && Boolean(sessionToken());
  chip.innerHTML = user
    ? '<span class="chip-name">' + user.pseudo + '</span><span class="chip-elo">' + user.elo + '</span>'
    : (pending ? t('online.connecting') : t('account.signIn'));
  chip.classList.toggle('is-signed-in', Boolean(user));
  chip.classList.toggle('is-pending', pending);
}

/**
 * The header, in words.
 *
 * The button at the top left used to be the logo and nothing else -- on a
 * phone, a small hexagon with no border and no arrow, which most people read
 * as a picture. It is the way back to the menu from every page, so it now says
 * so: a chevron for the direction, the mark for where it goes, and the word for
 * anyone the first two do not reach. Its name for a screen reader comes from
 * the markup's data-i18n-attr, which translateDocument fills in below.
 */
function renderChrome() {
  /* The game's own title; a page open in a panel puts its own back over
     this as soon as it is relabelled (panels.js). */
  document.title = t('meta.homeTitle');
  document.getElementById('brand').innerHTML =
    `${icon('prev')}${logoMarkSvg()}<span class="brand-word">${t('nav.menu')}</span>`;
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
  defineRoute('online', mountOnline);
  /* #/rules, #/privacy and #/terms were screens before they were panels with
     addresses of their own, and links to them are out there. Each now lands
     on the home screen with its page open over it. After this route has
     settled, since a change of screen closes whatever panel is open. */
  const legacyPage = (name) => () => {
    setTimeout(() => {
      window.addEventListener('routechange', () => openPanel(name), { once: true });
      window.location.replace('#/home');
    }, 0);
  };
  for (const name of ['rules', 'privacy', 'terms']) defineRoute(name, legacyPage(name));
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
  /* Notifications on this device follow the session in the same way:
     registered for the account at sign-in, forgotten at sign-out. */
  startPush();
  /* Arrived at a page's own address — /fr/regles/ from a search result, a
     shared link — the game opens as usual, with that page drawn over it once
     the first screen is up. Closing it leaves the player at the menu. */
  const landed = pageAt(window.location.pathname);
  if (landed) window.addEventListener('routechange', () => openPanel(landed.name), { once: true });
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
   * The page can be zoomed. It used to refuse every pinch and every double
   * tap, so that the board, which sizes itself to the screen, could never end
   * up pushed past the edge — and with them it refused anyone who needed a
   * rule or a name larger to read it. The board looks after itself now
   * (app.css): one finger there is for the pieces, a double tap means
   * nothing, and a pinch can always zoom back out, even when the board is
   * all there is on screen.
   *
   * What stays refused is the zoom nobody asked for. Safari enlarges the page
   * by itself when a field under 16px takes the focus, and leaves it that
   * way — and the fields here are smaller than that on purpose. maximum-scale
   * stops it, and in WebKit that is all it does, since iOS 10 lets a pinch
   * past it; Chrome on Android reads it as no zoom at all. So it is added
   * only where GestureEvent, which only WebKit has, says this is WebKit.
   */
  if (typeof window.GestureEvent !== 'undefined') {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) viewport.setAttribute('content', `${viewport.getAttribute('content')}, maximum-scale=1`);
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    setInstallPrompt(event);
  });

  /* The service worker is cache-first, which is right in production and a trap
     in development: it would keep serving the previous copy of every module.
     On a development machine it caches nothing (see sw.js) and is there only
     because notifications cannot arrive without one; anything an older worker
     cached there is cleared out. */
  const isLocal = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(location.hostname);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    if (isLocal) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
      if (window.caches) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
    } else {
      window.addEventListener('load', watchForUpdates);
    }
    /* A notification tapped while the app is already open: the worker brings
       it forward and says where to go, and the app goes there itself rather
       than being reloaded out from under whatever it was doing. */
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data || {};
      if (data.type !== 'hx:open' || typeof data.url !== 'string') return;
      let target;
      try { target = new URL(data.url, location.href); } catch { return; }
      if (target.origin !== location.origin) return;
      const [name, query] = target.hash.replace(/^#\/?/, '').split('?');
      closeOverlay();
      navigate(name || 'home', query ? Object.fromEntries(new URLSearchParams(query)) : undefined);
    });
  }
}

boot();
