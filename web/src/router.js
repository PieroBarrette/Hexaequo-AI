/**
 * Minimal hash router. Hash routing means the site works from any static host
 * and from the file system, with no server rewrite rules — which matters for a
 * PWA that must also resolve deep links offline.
 */

const routes = new Map();
let currentTeardown = null;
let currentName = null;

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
  const { name, params } = parseHash();
  const mount = routes.get(name) || routes.get('home');
  const resolvedName = routes.has(name) ? name : 'home';

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
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  if (!window.location.hash) window.location.replace('#/home');
  else resolve();
}

/** Re-mount the current view, e.g. after the language changes. */
export function refreshRoute() {
  resolve();
}
