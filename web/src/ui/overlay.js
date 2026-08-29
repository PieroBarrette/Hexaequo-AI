/**
 * Panels that float over whatever is already on screen.
 *
 * Rules and settings used to be routes, so opening them tore down the view
 * underneath — which meant consulting the rules mid-game lost the game. They
 * are now mounted into an overlay instead: the same mount functions, a
 * different container, and the game keeps running behind.
 *
 * The routes still exist so a shared link like #/rules resolves; only the
 * in-app buttons go through here.
 */

let host = null;
let teardown = null;
let openName = null;
let lastFocus = null;

function ensureHost() {
  if (host) return host;
  host = document.createElement('div');
  host.className = 'overlay';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.innerHTML = `
    <div class="overlay-backdrop" data-overlay-close></div>
    <div class="overlay-panel">
      <div class="overlay-head">
        <span class="overlay-title"></span>
        <button class="btn btn--icon" data-overlay-close aria-label="Close">✕</button>
      </div>
      <div class="overlay-body"></div>
    </div>`;
  document.body.appendChild(host);

  host.addEventListener('click', (event) => {
    if (event.target.closest('[data-overlay-close]')) closeOverlay();
  });
  return host;
}

/**
 * Escape closes the overlay before anything else sees it — the game below also
 * listens for Escape to cancel a selection, and the topmost layer should win.
 */
function onKeyDown(event) {
  if (event.key !== 'Escape' || !openName) return;
  event.stopPropagation();
  event.preventDefault();
  closeOverlay();
}
document.addEventListener('keydown', onKeyDown, true);

/*
 * A panel floats over the screen behind it, which is the whole point — until
 * that screen changes. Anything that navigates from inside a panel (the
 * account panel's link to the profile, a challenge accepted in the lobby) was
 * leaving the panel sitting on top of the page it had just asked for.
 *
 * Closing here rather than at each call site means a panel added later cannot
 * forget to do it.
 */
window.addEventListener('routechange', () => {
  if (openName) closeOverlay();
});

export const isOverlayOpen = () => Boolean(openName);
export const overlayName = () => openName;

/**
 * @param {string} name  identifier, so re-opening the same panel just closes it
 * @param {string} title heading shown in the panel
 * @param {(container: HTMLElement) => (void | Function)} mount
 */
export function openOverlay(name, title, mount) {
  if (openName === name) { closeOverlay(); return; }
  if (openName) closeOverlay();

  const node = ensureHost();
  node.querySelector('.overlay-title').textContent = title;

  /*
   * A brand-new container for every mount.
   *
   * Emptying the old one only removes its children — anything a panel had
   * listened for on the container itself survived, so opening the settings
   * twice left two click handlers on it, and a switch flipped twice and
   * appeared not to move at all. Opening a third time made it work again.
   * The router learned this for views; the overlay had not.
   */
  const old = node.querySelector('.overlay-body');
  const body = document.createElement('div');
  body.className = 'overlay-body';
  old.replaceWith(body);

  lastFocus = document.activeElement;
  const result = mount(body);
  teardown = typeof result === 'function' ? result : null;
  openName = name;
  node.classList.add('is-on');
  document.documentElement.classList.add('has-overlay');
  const close = node.querySelector('[data-overlay-close].btn');
  if (close) close.focus();
}

export function closeOverlay() {
  if (!openName) return;
  if (teardown) {
    try { teardown(); } catch { /* a broken panel must not wedge the overlay */ }
    teardown = null;
  }
  openName = null;
  host.classList.remove('is-on');
  document.documentElement.classList.remove('has-overlay');
  host.querySelector('.overlay-body').innerHTML = '';
  if (lastFocus && lastFocus.focus) lastFocus.focus();
  lastFocus = null;
}

/** Re-mount the open panel, e.g. after the language changed. */
export function refreshOverlay(title, mount) {
  if (!openName) return;
  const name = openName;
  closeOverlay();
  openOverlay(name, title, mount);
}
