/**
 * The account panel: sign in with Google, choose a nickname, see your record.
 *
 * It opens over whatever is on screen like the other panels, so signing in
 * never costs you a game in progress.
 */

import { t } from '../i18n.js';
import { play as playSound } from '../audio.js';
import {
  currentUser, isSignedIn, mustChoosePseudo, renderGoogleButton,
  chooseNickname, nicknameAvailable, signOut, onAuthChange,
} from '../auth.js';

export function mountAccount(outlet) {
  let error = null;
  let busy = false;
  let checkTimer = 0;
  let hint = null;

  const stop = onAuthChange(() => render());

  function statLine(labelKey, value) {
    return `<div class="row"><span>${t(labelKey)}</span><b>${value}</b></div>`;
  }

  function render() {
    const user = currentUser();

    if (!isSignedIn()) {
      outlet.innerHTML = `
        <div class="page"><div class="page-inner">
          <p class="lede">${t('account.signedOutLede')}</p>
          ${error ? `<p class="net-error">${error}</p>` : ''}
          <div class="google-button" id="google-button"></div>
          <p class="lede" style="font-size:12px;margin-top:18px">${t('account.whyGoogle')}</p>
        </div></div>`;
      const host = outlet.querySelector('#google-button');
      renderGoogleButton(host).catch((e) => {
        host.innerHTML = `<p class="net-error">${t('account.googleUnavailable')}</p>`;
        console.warn('[auth]', e.message);
      });
      return;
    }

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

    const total = user.gamesPlayed || 0;
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
        <h2>${t('account.record')}</h2>
        ${statLine('account.rating', user.elo)}
        ${statLine('account.played', total)}
        ${statLine('account.wins', user.wins || 0)}
        ${statLine('account.losses', user.losses || 0)}
        ${statLine('account.draws', user.draws || 0)}
        <div class="row-actions" style="margin-top:22px">
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

  outlet.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    playSound('ui');
    if (action === 'signout') { signOut(); return; }
    if (action === 'save') { await save(); return; }
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
        hint = answer.available ? t('account.nicknameFree') : (answer.reason || t('account.nicknameTaken'));
      } catch {
        hint = t('account.nicknameRules');
      }
      label.textContent = hint;
      label.classList.toggle('is-bad', hint !== t('account.nicknameFree'));
    }, 350);
  });

  outlet.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.closest('[data-input="pseudo"]')) save();
  });

  render();
  return () => { clearTimeout(checkTimer); stop(); };
}
