/**
 * Where the links in our own mail land: confirming an address, and choosing a
 * new password.
 *
 * Both are hash routes carrying a token, because the app is served by a
 * catch-all fallback — a path like /verify-email loads the page and quietly
 * drops the query behind it.
 */

import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { play as playSound } from '../audio.js';
import { confirmEmail, resetPassword } from '../auth.js';
import { openPanel } from '../ui/panels.js';

const escapeText = (value) => String(value).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shell(title, body) {
  return `<div class="page"><div class="page-inner" style="max-width:460px">
    <h1>${title}</h1>${body}</div></div>`;
}

/** #/verify?token=… — confirm an address. */
export function mountVerify(outlet, params) {
  const token = params && params.get('token');
  let state = token ? 'working' : 'missing';
  let message = '';

  function render() {
    if (state === 'missing') {
      outlet.innerHTML = shell(t('mail.verifyTitle'),
        `<p class="net-error">${t('mail.noToken')}</p>`
        + `<button class="btn" data-action="home">${t('nav.backToMenu')}</button>`);
      return;
    }
    if (state === 'working') {
      outlet.innerHTML = shell(t('mail.verifyTitle'), `<p class="lede">${t('online.connecting')}</p>`);
      return;
    }
    if (state === 'done') {
      outlet.innerHTML = shell(t('mail.verifyTitle'),
        `<p class="lobby-notice">${t('mail.verified')}</p>`
        + `<button class="btn btn--primary" data-action="home">${t('mail.startPlaying')}</button>`);
      return;
    }
    outlet.innerHTML = shell(t('mail.verifyTitle'),
      `<p class="net-error">${escapeText(message)}</p>`
      + `<p class="lede">${t('mail.verifyFailedHint')}</p>`
      + `<button class="btn" data-action="home">${t('nav.backToMenu')}</button>`);
  }

  outlet.addEventListener('click', (event) => {
    if (!event.target.closest('[data-action="home"]')) return;
    playSound('ui');
    navigate('home');
  });

  render();
  if (token) {
    confirmEmail(token)
      .then(() => { state = 'done'; })
      .catch((error) => { state = 'failed'; message = error.message; })
      .finally(render);
  }
}

/** #/reset?token=… — set a new password. */
export function mountReset(outlet, params) {
  const token = params && params.get('token');
  let busy = false;
  let error = null;
  let done = false;

  function render() {
    if (!token) {
      outlet.innerHTML = shell(t('mail.resetTitle'),
        `<p class="net-error">${t('mail.noToken')}</p>`
        + `<button class="btn" data-action="home">${t('nav.backToMenu')}</button>`);
      return;
    }
    if (done) {
      outlet.innerHTML = shell(t('mail.resetTitle'),
        `<p class="lobby-notice">${t('mail.resetDone')}</p>`
        + `<button class="btn btn--primary" data-action="sign-in">${t('account.signIn')}</button>`);
      return;
    }
    outlet.innerHTML = shell(t('mail.resetTitle'),
      `<p class="lede">${t('mail.resetLede')}</p>`
      + (error ? `<p class="net-error">${escapeText(error)}</p>` : '')
      + `<form class="auth-form" data-form="reset">
           <input class="btn auth-input" type="password" name="password" required minlength="8"
                  autocomplete="new-password" placeholder="${t('account.passwordNew')}">
           <input class="btn auth-input" type="password" name="again" required minlength="8"
                  autocomplete="new-password" placeholder="${t('mail.passwordAgain')}">
           <button class="btn btn--primary" type="submit" ${busy ? 'disabled' : ''}>
             ${busy ? t('online.connecting') : t('mail.setPassword')}
           </button>
         </form>`);
  }

  outlet.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const form = event.target.closest('[data-form="reset"]');
    if (!form) return;
    const password = form.querySelector('[name="password"]').value;
    const again = form.querySelector('[name="again"]').value;
    if (password !== again) { error = t('mail.passwordMismatch'); render(); return; }

    busy = true;
    error = null;
    render();
    try {
      await resetPassword(token, password);
      done = true;
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
      render();
    }
  });

  outlet.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    playSound('ui');
    if (button.getAttribute('data-action') === 'sign-in') {
      /* Wait for the route to settle before opening the panel. A route change
         closes any open panel, and setting the hash resolves asynchronously —
         so opening first would have the navigation shut it again. Listening
         before navigating covers the case where the hash is already correct
         and the route resolves at once. */
      window.addEventListener('routechange', () => openPanel('account'), { once: true });
      navigate('home');
    } else navigate('home');
  });

  render();
}
