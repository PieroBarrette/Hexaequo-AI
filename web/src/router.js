/**
 * Minimal hash router. Hash routing means the site works from any static host
 * and from the file system, with no server rewrite rules — which matters for a
 * PWA that must also resolve deep links offline.
 */

import { crossFade } from './fade.js';

const routes = new Map();
let sequence = 0;
let currentTeardown = null;
let currentName = null;
let currentHash = null;
let leaveGuard = null;
let reverting = false;

/**
 * Let the active view veto a departure — a local game in progress asks before
 * throwing itself away. The guard returns false to stay put.
 */
export function setLeaveGuard(fn) {
  leaveGuard = fn;
}

export function defineRoute(name, mount) {
  routes.set(name, mount);
}

export function currentRoute() {
  return currentName;
}

function parseHash() {
  const raw = (window.location.hash || '').replace(/^#\/?/, '');
  const [name, query] = raw.split('?');
  return {
    name: name || 'home',
    params: new URLSearchParams(query || ''),
  };
}

export function navigate(name, params) {
  const query = params ? '?' + new URLSearchParams(params).toString() : '';
  const target = `#/${name}${query}`;
  if (window.location.hash === target) resolve();
  else window.location.hash = target;
}

function resolve() {
  if (reverting) { reverting = false; return; }

  const { name, params } = parseHash();
  const mount = routes.get(name) || routes.get('home');
  const resolvedName = routes.has(name) ? name : 'home';

  // Ask the outgoing view before discarding it. Restoring the hash fires
  // another hashchange, which `reverting` swallows.
  if (leaveGuard && currentName && resolvedName !== currentName && !leaveGuard()) {
    if (currentHash && window.location.hash !== currentHash) {
      reverting = true;
      window.location.hash = currentHash;
    }
    return;
  }
  leaveGuard = null;
  currentHash = window.location.hash;

  /* The swap itself, which the fade below runs when the browser is ready for
     it. Two departures inside one frame — a redirect on the heels of a link —
     would each queue a swap; the ticket says only the last one mounts. */
  const ticket = ++sequence;
  const swap = () => {
    if (ticket !== sequence) return;

    if (currentTeardown) {
      try { currentTeardown(); } catch { /* a broken view must not block routing */ }
      currentTeardown = null;
    }

    /* Each view gets a brand-new container. Anything it listens to on that
       element dies with it, so handlers cannot accumulate across mounts. */
    const outlet = document.getElementById('view');
    outlet.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'view-container';
    outlet.appendChild(container);
    currentName = resolvedName;
    document.documentElement.setAttribute('data-route', resolvedName);

    const teardown = mount(container, params);
    currentTeardown = typeof teardown === 'function' ? teardown : null;

    for (const link of document.querySelectorAll('[data-route-link]')) {
      link.classList.toggle('is-active', link.getAttribute('data-route-link') === resolvedName);
    }
    window.dispatchEvent(new CustomEvent('routechange', { detail: { name: resolvedName } }));
  };

  /* One screen dissolves into the next — see fade.js. The first has nothing
     to dissolve from but the loader, which has its own way of leaving. */
  if (currentName === null) swap();
  else crossFade(swap, 'route');
}

/**
 * Clean paths for the pages other services need to link to.
 *
 * The server hands index.html to any non-API route, so /privacy loads the app;
 * without this it would silently fall back to the home screen. Google's consent
 * screen wants a plain URL, not a fragment.
 */
const PATH_ROUTES = { '/privacy': 'privacy', '/terms': 'terms' };

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  const fromPath = PATH_ROUTES[window.location.pathname.replace(/\/+$/, '') || '/'];
  if (fromPath && !window.location.hash) window.location.replace(`#/${fromPath}`);
  else if (!window.location.hash) window.location.replace('#/home');
  else resolve();
}

/** Re-mount the current view, e.g. after the language changes. */
export function refreshRoute() {
  resolve();
}
