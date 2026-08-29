/**
 * Keeping an installed copy current.
 *
 * A web app added to a home screen is not reinstalled, and it is rarely closed
 * — so left alone it can run last month's code indefinitely, with nothing to
 * tell anyone. The browser only looks for a new worker when it feels like it,
 * which for a standalone app resumed from the background can be never.
 *
 * So: look on purpose. On start-up, whenever the app comes back to the
 * foreground, and every so often while it is open. When a new version has
 * finished downloading, offer it rather than taking it — someone may be in the
 * middle of a game, and a reload would cost them the local one.
 */

import { t } from './i18n.js';

const LOOK_AGAIN_MS = 30 * 60 * 1000;

let registration = null;
let waiting = null;          // the worker that has downloaded and is ready
let reloading = false;
let banner = null;

/** The version the server is running, for the settings screen. */
export async function serverBuild() {
  try {
    const response = await fetch('/api/version', { cache: 'no-store' });
    if (!response.ok) return null;
    const body = await response.json();
    return body.build || null;
  } catch {
    return null;                 // offline, which is not an error worth showing
  }
}

/* ── The offer ──────────────────────────────────────────────────────────── */

function showBanner() {
  if (banner) return;
  banner = document.createElement('div');
  banner.className = 'update-bar';
  banner.setAttribute('role', 'status');
  banner.innerHTML = `
    <span>${t('update.ready')}</span>
    <button class="btn btn--primary" data-update="now">${t('update.reload')}</button>
    <button class="btn btn--icon" data-update="later" aria-label="${t('update.later')}">✕</button>`;
  document.body.appendChild(banner);

  banner.addEventListener('click', (event) => {
    const action = event.target.closest('[data-update]');
    if (!action) return;
    if (action.getAttribute('data-update') === 'now') applyUpdate();
    else hideBanner();
  });

  requestAnimationFrame(() => banner.classList.add('is-on'));
}

function hideBanner() {
  if (!banner) return;
  const node = banner;
  banner = null;
  node.classList.remove('is-on');
  setTimeout(() => node.remove(), 300);
}

/**
 * Take the update.
 *
 * The waiting worker is asked to step in; when it does, the browser fires
 * controllerchange and the page reloads onto the new files. If there is no
 * worker waiting — a plain browser tab, or an update we somehow missed — a
 * reload is still the right answer.
 */
function applyUpdate() {
  if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
  else window.location.reload();
}

/* ── Looking for one ────────────────────────────────────────────────────── */

function watchWorker(worker) {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    /* `installed` with a controller already present means this is a second
       worker: a new version, downloaded and waiting. Without a controller it
       is simply the first install, and there is nothing to announce. */
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      waiting = worker;
      showBanner();
    }
  });
}

export function watchForUpdates() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Guard: Chrome can fire this more than once for a single takeover.
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('/sw.js').then((reg) => {
    registration = reg;

    // Already waiting when we arrived — a version downloaded on the last visit.
    if (reg.waiting && navigator.serviceWorker.controller) {
      waiting = reg.waiting;
      showBanner();
    }
    watchWorker(reg.installing);
    reg.addEventListener('updatefound', () => watchWorker(reg.installing));

    const look = () => reg.update().catch(() => { /* offline; try again later */ });
    look();
    setInterval(look, LOOK_AGAIN_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') look();
    });
  }).catch(() => { /* offline support is optional */ });
}

/** Used by the settings screen, so the check can also be asked for by hand. */
export async function checkNow() {
  if (!registration) return 'unsupported';
  try {
    await registration.update();
  } catch {
    return 'offline';
  }
  return waiting ? 'ready' : 'current';
}
