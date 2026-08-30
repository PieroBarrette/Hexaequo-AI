/**
 * The account panel: two ways in, a nickname, and your record.
 *
 * Google and an address-and-password are equal doors, not a main one and a
 * fallback — some people will not use a Google account, and a game site that
 * insists on one loses them at the front step.
 *
 * It opens over whatever is on screen like the other panels, so signing in
 * never costs you a game in progress.
 */

import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { closeOverlay } from '../ui/overlay.js';
import { play as playSound } from '../audio.js';
import {
  currentUser, isSignedIn, mustChoosePseudo, renderGoogleButton,
  chooseNickname, nicknameAvailable, signOut, onAuthChange,
  signUpWithEmail, signInWithEmail, requestPasswordReset,
  staySignedIn, setStaySignedIn,
} from '../auth.js';

export function mountAccount(outlet) {
  let error = null;
  let notice = null;
  let busy = false;
  let checkTimer = 0;
  let hint = null;
  /** 'in' | 'up' | 'forgot' — which form the signed-out panel is showing. */
  let door = 'in';
  /* Remembered so a Google outage is reported once rather than retried on
     every redraw. The address-and-password form is unaffected either way. */
  let googleFailed = false;

  /*
   * The panel is a door, and a door that stays open is in the way.
   *
   * Signing in used to leave it standing there, redrawn as a little profile
   * card over the page you were already on — with a button offering to take
   * you to your profile, which is where the header chip goes anyway. Once you
   * are through, it closes and gives you back the page you were on, signed in.
   *
   * On the way through, not on being through: what closes it is settling —
   * signed in and named — having not been settled a moment ago. Opening it
   * deliberately while already settled, from "manage my account", still shows
   * the account. And a new account stops at the nickname, which is the one
   * thing the door still has to ask for; saving that settles it, and then it
   * closes too.
   */
  const settled = () => isSignedIn() && !mustChoosePseudo();
  let wasSettled = settled();
  const stop = onAuthChange(() => {
    const now = settled();
    const justArrived = now && !wasSettled;
    wasSettled = now;
    if (justArrived) { closeOverlay(); return; }
    render();
  });

  /* ── Signed out ───────────────────────────────────────────────────────── */

  function doorTabs() {
    const tab = (id, label) =>
      `<button class="page-tab${door === id ? ' is-active' : ''}" data-door="${id}">${label}</button>`;
    return `<div class="page-tabs">${tab('in', t('account.signIn'))}${tab('up', t('account.createAccount'))}</div>`;
  }

  function emailForm() {
    if (door === 'forgot') {
      return `
        <form class="auth-form" data-form="forgot">
          <p class="lede">${t('account.forgotLede')}</p>
          <input class="btn auth-input" type="email" name="email" autocomplete="email"
                 required placeholder="${t('account.email')}">
          <button class="btn btn--primary" type="submit" ${busy ? 'disabled' : ''}>
            ${t('account.sendResetLink')}
          </button>
          <button class="btn btn--link" type="button" data-door="in">${t('account.backToSignIn')}</button>
        </form>`;
    }
    if (door === 'up') {
      /* The nickname is answered while it is typed, in the same place and the
         same words the rename form uses, so the one rule that can reject a
         sign-up is settled before the button is pressed rather than after. */
      return `
        <form class="auth-form" data-form="up">
          <input class="btn auth-input" type="email" name="email" autocomplete="email"
                 required placeholder="${t('account.email')}">
          <input class="btn auth-input" name="pseudo" data-input="pseudo" autocomplete="nickname"
                 required maxlength="20" spellcheck="false" placeholder="${t('account.nickname')}">
          <p class="lede nickname-hint" style="min-height:1.4em;margin:-4px 0 0">${
            hint || t('account.nicknameRules')}</p>
          <input class="btn auth-input" type="password" name="password" required
                 minlength="8" autocomplete="new-password" placeholder="${t('account.passwordNew')}">
          <button class="btn btn--primary" type="submit" ${busy ? 'disabled' : ''}>
            ${busy ? t('online.connecting') : t('account.createAccount')}
          </button>
        </form>`;
    }
    return `
      <form class="auth-form" data-form="in">
        <input class="btn auth-input" type="email" name="email" autocomplete="email"
               required placeholder="${t('account.email')}">
        <input class="btn auth-input" type="password" name="password" required
               autocomplete="current-password" placeholder="${t('account.password')}">
        <label class="auth-remember">
          <input type="checkbox" name="remember" ${staySignedIn() ? 'checked' : ''}>
          <span>${t('account.staySignedIn')}</span>
        </label>
        <button class="btn btn--primary" type="submit" ${busy ? 'disabled' : ''}>
          ${busy ? t('online.connecting') : t('account.signIn')}
        </button>
        <button class="btn btn--link" type="button" data-door="forgot">${t('account.forgot')}</button>
      </form>`;
  }

  function renderSignedOut() {
    outlet.innerHTML = `
      <div class="page"><div class="page-inner">
        <p class="lede">${t('account.signedOutLede')}</p>
        ${door === 'forgot' ? '' : doorTabs()}
        ${error ? `<p class="net-error">${error}</p>` : ''}
        ${notice ? `<p class="lobby-notice">${notice}</p>` : ''}
        ${emailForm()}
        <div class="auth-or"><span>${t('account.or')}</span></div>
        <div class="google-button" id="google-button"></div>
        <p class="lede" style="font-size:12px;margin-top:18px">${t('account.whyGoogle')}</p>
      </div></div>`;

    restoreTyped();
    const host = outlet.querySelector('#google-button');
    if (googleFailed) {
      host.innerHTML = `<p class="lede">${t('account.googleUnavailable')}</p>`;
      return;
    }
    renderGoogleButton(host).catch((e) => {
      googleFailed = true;
      host.innerHTML = `<p class="lede">${t('account.googleUnavailable')}</p>`;
      console.warn('[auth] Google sign-in unavailable:', e.message);
    });
  }

  /* ── Rendering ────────────────────────────────────────────────────────── */

  /*
   * What has been typed, kept across redraws.
   *
   * render() rebuilds the panel wholesale, and submitting redraws twice — once
   * to grey the button, once to show what went wrong. Both wiped the fields,
   * so a sign-up rejected over its nickname handed back an empty form and the
   * address and password had to be typed again. The values are restored as
   * properties rather than written into the markup, which keeps the password
   * out of the HTML and out of anything that reads it.
   */
  const typed = Object.create(null);

  function restoreTyped() {
    for (const field of outlet.querySelectorAll('.auth-form [name]')) {
      if (field.type === 'checkbox') continue;
      const kept = typed[field.name];
      if (kept !== undefined) field.value = kept;
    }
  }

  outlet.addEventListener('input', (event) => {
    const field = event.target.closest('.auth-form [name]');
    if (field && field.type !== 'checkbox') typed[field.name] = field.value;
  });

  function render() {
    const user = currentUser();

    if (!isSignedIn()) { renderSignedOut(); return; }

    if (mustChoosePseudo()) {
      outlet.innerHTML = `
        <div class="page"><div class="page-inner">
          <p class="lede">${t('account.pickNicknameLede')}</p>
          ${error ? `<p class="net-error">${error}</p>` : ''}
          <div class="row-actions">
            <input class="btn nickname-input" data-input="pseudo" maxlength="20"
                   autocomplete="off" spellcheck="false" value="${escapeAttr(user.pseudo)}"
                   placeholder="${t('account.nicknamePlaceholder')}">
            <button class="btn btn--primary" data-action="save" ${busy ? 'disabled' : ''}>
              ${t('account.saveNickname')}
            </button>
          </div>
          <p class="lede nickname-hint" style="min-height:1.4em">${hint || t('account.nicknameRules')}</p>
        </div></div>`;
      const field = outlet.querySelector('[data-input="pseudo"]');
      if (field) { field.focus(); field.select(); }
      return;
    }

    outlet.innerHTML = `
      <div class="page"><div class="page-inner">
        <div class="account-head">
          ${user.avatarUrl ? `<img class="avatar" src="${escapeAttr(user.avatarUrl)}" alt="" referrerpolicy="no-referrer">` : ''}
          <div>
            <h2 style="margin:0">${escapeHtml(user.pseudo)}</h2>
            <p class="lede" style="margin:2px 0 0">${escapeHtml(user.email)}</p>
          </div>
        </div>
        ${error ? `<p class="net-error">${error}</p>` : ''}
        <!-- The record used to be repeated here, from the counters on the
             session's copy of the account — which never refreshed, so it sat
             at 1000 and no games forever. The profile computes it from the
             games themselves and is one tap away. -->
        <div class="row-actions" style="margin-top:22px">
          <button class="btn btn--primary" data-action="profile">${t('account.seeProfile')}</button>
          <button class="btn" data-action="rename">${t('account.changeNickname')}</button>
          <button class="btn" data-action="signout">${t('account.signOut')}</button>
        </div>
      </div></div>`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const escapeAttr = escapeHtml;

  async function save() {
    const field = outlet.querySelector('[data-input="pseudo"]');
    if (!field) return;
    busy = true;
    error = null;
    render();
    try {
      await chooseNickname(field.value);
      hint = null;
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
      render();
    }
  }

  /* ── Forms ────────────────────────────────────────────────────────────── */

  outlet.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target.closest('[data-form]');
    if (!form || busy) return;
    const which = form.getAttribute('data-form');
    const value = (name) => {
      const field = form.querySelector(`[name="${name}"]`);
      return field ? field.value.trim() : '';
    };
    const checked = (name) => {
      const field = form.querySelector(`[name="${name}"]`);
      return field ? field.checked : false;
    };

    /* Read before the redraw, since the redraw builds new fields. */
    if (which === 'in') setStaySignedIn(checked('remember'));

    busy = true;
    error = null;
    notice = null;
    render();
    try {
      if (which === 'up') {
        await signUpWithEmail({
          email: value('email'), pseudo: value('pseudo'), password: value('password'),
        });
      } else if (which === 'in') {
        await signInWithEmail({ email: value('email'), password: value('password') });
      } else {
        // The answer is the same whether or not the address is registered, so
        // the message has to be too.
        await requestPasswordReset(value('email'));
        door = 'in';
        notice = t('account.resetSent');
      }
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
      render();
    }
  });

  outlet.addEventListener('click', async (event) => {
    const doorButton = event.target.closest('[data-door]');
    if (doorButton) {
      door = doorButton.getAttribute('data-door');
      error = null;
      notice = null;
      playSound('ui');
      render();
      return;
    }

    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    playSound('ui');
    if (action === 'signout') { signOut(); return; }
    if (action === 'save') { await save(); return; }
    if (action === 'profile') { navigate('profile'); return; }
    if (action === 'rename') {
      // Reuse the nickname form by pretending the nickname is unchosen.
      const user = currentUser();
      if (user) user.pseudoChosen = false;
      outlet.innerHTML = '';
      renderRename(user);
    }
  });

  function renderRename(user) {
    outlet.innerHTML = `
      <div class="page"><div class="page-inner">
        <p class="lede">${t('account.pickNicknameLede')}</p>
        <div class="row-actions">
          <input class="btn nickname-input" data-input="pseudo" maxlength="20"
                 autocomplete="off" spellcheck="false" value="${escapeAttr(user.pseudo)}">
          <button class="btn btn--primary" data-action="save">${t('account.saveNickname')}</button>
        </div>
        <p class="lede nickname-hint" style="min-height:1.4em">${t('account.nicknameRules')}</p>
      </div></div>`;
    const field = outlet.querySelector('[data-input="pseudo"]');
    if (field) { field.focus(); field.select(); }
  }

  /* Tell the player whether the nickname is free while they type, rather than
     only when they submit. */
  outlet.addEventListener('input', (event) => {
    const field = event.target.closest('[data-input="pseudo"]');
    if (!field) return;
    clearTimeout(checkTimer);
    const value = field.value;
    checkTimer = setTimeout(async () => {
      const label = outlet.querySelector('.nickname-hint');
      if (!label) return;
      try {
        const answer = await nicknameAvailable(value);
        /* A `reason` means the name is the wrong shape, and the server says so
           in English — it has no idea who is reading. The rules line says the
           same thing in the reader's language, so use ours and keep the
           server's for the one thing it knows and we do not: already taken. */
        if (answer.available) hint = t('account.nicknameFree');
        else if (answer.reason) hint = t('account.nicknameRules');
        else hint = t('account.nicknameTaken');
      } catch {
        hint = t('account.nicknameRules');
      }
      label.textContent = hint;
      label.classList.toggle('is-bad', hint !== t('account.nicknameFree'));
    }, 350);
  });

  /* Only the rename and pick-a-nickname forms, which have no submit button of
     their own. The sign-up form carries the same field so it gets the same
     live answer, but it is a real form — Enter belongs to it, and save() would
     try to change the nickname of an account that does not exist yet. */
  outlet.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if (!event.target.closest('[data-input="pseudo"]')) return;
    if (event.target.closest('.auth-form')) return;
    save();
  });

  render();
  return () => { clearTimeout(checkTimer); stop(); };
}
