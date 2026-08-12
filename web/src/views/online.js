/**
 * Online lobby: open a game and share the link, or join one with a code.
 *
 * No account is involved. A room is a six-character code, and whoever holds the
 * link takes the free seat. These games are not rated — ratings arrive with
 * accounts.
 */

import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { request, connect, inviteLink, serverOrigin } from '../net.js';
import { play as playSound } from '../audio.js';

/** Cadences offered when opening a room; must match the server's table. */
const CADENCES = ['none', 'bullet', 'blitz', 'rapid', 'classic'];
const cadenceLabel = (id) => t('online.cadence' + id.charAt(0).toUpperCase() + id.slice(1));

export function mountOnline(outlet) {
  let busy = false;
  let created = null;
  let error = null;
  let cadence = 'none';

  function render() {
    outlet.innerHTML = `
      <div class="page"><div class="page-inner">
        <h1>${t('online.title')}</h1>
        <p class="lede">${t('online.lede')}</p>

        ${error ? `<p class="net-error">${error}</p>` : ''}

        ${created ? `
          <div class="rule-block">
            <h3>${t('online.waiting')}</h3>
            <p class="lede">${t('online.codeLabel')}</p>
            <div class="room-code">${created.code}</div>
            <div class="row-actions">
              <button class="btn btn--primary" data-action="copy">${t('online.copyLink')}</button>
              <button class="btn" data-action="enter">${t('nav.play')}</button>
            </div>
            <p class="lede" style="margin-top:10px;word-break:break-all">${inviteLink(created.code)}</p>
          </div>
        ` : `
          <div class="rule-block">
            <h3>${t('online.create')}</h3>
            <p class="lede">${t('online.cadence')}</p>
            <div class="cadence-grid">
              ${CADENCES.map((id) => `
                <button class="btn cadence${id === cadence ? ' is-active' : ''}" data-cadence="${id}">
                  ${cadenceLabel(id)}
                </button>`).join('')}
            </div>
            <p class="lede" style="font-size:12px;margin:10px 0 14px">${t('online.cadenceHint')}</p>
            <button class="btn btn--primary" data-action="create" ${busy ? 'disabled' : ''}>
              ${busy ? t('online.connecting') : t('online.create')}
            </button>
          </div>

          <div class="rule-block">
            <h3>${t('online.join')}</h3>
            <div class="row-actions">
              <input class="btn code-input" data-input="code" maxlength="6" autocomplete="off"
                     spellcheck="false" placeholder="${t('online.codePlaceholder')}">
              <button class="btn btn--primary" data-action="join" ${busy ? 'disabled' : ''}>${t('online.join')}</button>
            </div>
          </div>
        `}

        <p class="lede" style="margin-top:22px;font-size:12px">${t('online.unrated')} · ${serverOrigin()}</p>
      </div></div>`;
  }

  function fail(code) {
    error = t('online.errors.' + code) === 'online.errors.' + code
      ? t('online.errors.OFFLINE')
      : t('online.errors.' + code);
    render();
  }

  render();

  outlet.addEventListener('click', async (event) => {
    const pick = event.target.closest('[data-cadence]');
    if (pick) {
      cadence = pick.getAttribute('data-cadence');
      playSound('ui');
      render();
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || busy) return;
    const action = button.getAttribute('data-action');
    playSound('ui');
    error = null;

    if (action === 'create') {
      busy = true;
      render();
      try {
        await connect();
        const response = await request('hx:create', { timeControl: cadence });
        if (!response.ok) { busy = false; return fail(response.error); }
        created = response;
        busy = false;
        render();
      } catch {
        busy = false;
        fail('OFFLINE');
      }
      return;
    }

    if (action === 'join') {
      const field = outlet.querySelector('[data-input="code"]');
      const code = (field ? field.value : '').toUpperCase().trim();
      if (code.length !== 6) return;
      busy = true;
      render();
      try {
        await connect();
        const response = await request('hx:join', { code });
        busy = false;
        if (!response.ok) return fail(response.error);
        navigate('play', { online: '1', code });
      } catch {
        busy = false;
        fail('OFFLINE');
      }
      return;
    }

    if (action === 'enter' && created) {
      navigate('play', { online: '1', code: created.code });
      return;
    }

    if (action === 'copy' && created) {
      const link = inviteLink(created.code);
      try {
        await navigator.clipboard.writeText(link);
        button.textContent = t('online.copied');
      } catch {
        // Clipboard access can be refused; the link is on screen anyway.
        button.textContent = t('online.copied');
      }
    }
  });

  outlet.addEventListener('input', (event) => {
    const field = event.target.closest('[data-input="code"]');
    if (!field) return;
    field.value = field.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });
}
