/**
 * The lobby, rendered into whatever container the online page gives it.
 *
 * Presence is a subscription, not a poll: you appear when you step in, the
 * server pushes the roster when it changes, and you disappear when you leave or
 * close the tab. Challenges are addressed to one person and expire on their
 * own, so nothing here needs cleaning up by hand.
 */

import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { request, connect, listen, identify } from '../net.js';
import { play as playSound } from '../audio.js';
import { isSignedIn, currentUser, sessionToken, sessionReady, onAuthChange } from '../auth.js';
import { openPanel } from '../ui/panels.js';

const CADENCES = ['bullet', 'blitz', 'rapid', 'classic'];
const cadenceLabel = (id) => t('online.cadence' + id.charAt(0).toUpperCase() + id.slice(1));

const escapeText = (value) => String(value).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Mount the lobby into `host`. Returns a teardown that leaves the room, so
 * nobody is left listed in a lobby they walked out of.
 */
export function mountLobby(host) {
  let joined = false;
  let busy = false;
  let players = [];
  let messages = [];
  let cadence = 'rapid';
  let incoming = null;      // a challenge addressed to us
  let notice = null;        // the last thing that happened, in words
  let sentTo = null;
  const unsubscribe = [];

  const me = () => (currentUser() ? currentUser().id : null);

  function render() {
    if (!sessionReady()) {
      host.innerHTML = `
        <div class="rule-block">
          <h3>${t('lobby.title')}</h3>
          <p class="lede">${t('online.connecting')}</p>
        </div>`;
      return;
    }
    if (!isSignedIn()) {
      host.innerHTML = `
        <div class="rule-block">
          <h3>${t('lobby.title')}</h3>
          <p class="lede">${t('lobby.signIn')}</p>
          <button class="btn btn--primary" data-action="sign-in">${t('account.signIn')}</button>
        </div>`;
      return;
    }
    if (!joined) {
      host.innerHTML = `
        <div class="rule-block">
          <h3>${t('lobby.title')}</h3>
          <p class="lede">${t('lobby.lede')}</p>
          <button class="btn btn--primary" data-action="enter" ${busy ? 'disabled' : ''}>
            ${busy ? t('online.connecting') : t('lobby.enter')}
          </button>
        </div>`;
      return;
    }

    host.innerHTML = `
      ${incoming ? challengeCard() : ''}
      ${notice ? `<p class="lobby-notice">${escapeText(notice)}</p>` : ''}
      <div class="rule-block">
        <div class="lobby-head">
          <h3>${t('lobby.title')}</h3>
          <span class="lobby-count">${t('lobby.count', { n: players.length })}</span>
          <button class="btn btn--sm" data-action="leave">${t('lobby.leave')}</button>
        </div>
        <p class="lede" style="font-size:12px">${t('lobby.cadenceFor')}</p>
        <div class="cadence-grid">
          ${CADENCES.map((id) => `
            <button class="btn cadence${id === cadence ? ' is-active' : ''}" data-cadence="${id}">
              ${cadenceLabel(id)}
            </button>`).join('')}
        </div>
        <div class="lobby-list">${playerRows()}</div>
      </div>
      <div class="rule-block chat-block">
        <div class="chat-log lobby-chat">${chatRows()}</div>
        <form class="chat-form">
          <input class="btn chat-input" maxlength="300" autocomplete="off"
                 placeholder="${t('chat.placeholder')}">
          <button class="btn btn--primary" type="submit">${t('chat.send')}</button>
        </form>
      </div>`;
    const log = host.querySelector('.lobby-chat');
    if (log) log.scrollTop = log.scrollHeight;
  }

  function playerRows() {
    if (!players.length) return `<p class="lede">${t('lobby.nobody')}</p>`;
    const mine = me();
    return players.map((player) => {
      const isMe = player.userId === mine;
      const status = isMe ? t('lobby.you')
        : (player.playing ? t('lobby.playing') : t('lobby.available'));
      const action = isMe || player.playing ? ''
        : `<button class="btn btn--sm" data-challenge="${escapeText(player.userId)}">`
          + `${sentTo === player.userId ? '✓' : t('lobby.challenge')}</button>`;
      return `<div class="lobby-row${isMe ? ' is-me' : ''}">`
        + `<span class="lobby-name">${escapeText(player.pseudo)}</span>`
        + `<span class="lobby-elo">${player.elo}</span>`
        + `<span class="lobby-status${player.playing ? ' is-busy' : ''}">${status}</span>`
        + action + '</div>';
    }).join('');
  }

  function chatRows() {
    if (!messages.length) return `<p class="lede">${t('lobby.quiet')}</p>`;
    const mine = me();
    return messages.map((message) =>
      `<div class="chat-line${message.userId === mine ? ' is-mine' : ''}">`
      + `<span class="chat-who">${escapeText(message.pseudo)}</span>`
      + `<span class="chat-text">${escapeText(message.text)}</span></div>`).join('');
  }

  function challengeCard() {
    return `
      <div class="rule-block challenge-card">
        <h3>${t('lobby.incoming', { name: escapeText(incoming.from.pseudo), elo: incoming.from.elo })}</h3>
        <p class="lede">${cadenceLabel(incoming.timeControl)}</p>
        <div class="row-actions">
          <button class="btn btn--primary" data-action="accept">${t('lobby.accept')}</button>
          <button class="btn" data-action="decline">${t('lobby.decline')}</button>
        </div>
      </div>`;
  }

  /* ── Server ───────────────────────────────────────────────────────────── */

  function subscribe() {
    if (unsubscribe.length) return;
    unsubscribe.push(listen('hx:lobby:update', (payload) => {
      players = payload.players || [];
      if (joined) render();
    }));
    unsubscribe.push(listen('hx:lobby:chat', (payload) => {
      messages.push(payload.message);
      if (joined) render();
    }));
    unsubscribe.push(listen('hx:challenge:incoming', (payload) => {
      incoming = payload;
      notice = null;
      playSound('ui');
      render();
    }));
    unsubscribe.push(listen('hx:challenge:declined', (payload) => {
      if (incoming && incoming.id === payload.id) incoming = null;
      sentTo = null;
      notice = t('lobby.declined');
      render();
    }));
    unsubscribe.push(listen('hx:challenge:expired', (payload) => {
      if (incoming && incoming.id === payload.id) incoming = null;
      sentTo = null;
      notice = t('lobby.expired');
      render();
    }));
    unsubscribe.push(listen('hx:challenge:ready', (payload) => {
      incoming = null;
      playSound('ui');
      navigate('play', { online: '1', code: payload.code });
    }));
    // A reconnection loses the seat in the room; step back in.
    unsubscribe.push(listen('connect', async () => {
      if (!joined) return;
      await identify(sessionToken()).catch(() => {});
      enter(true).catch(() => {});
    }));
  }

  async function enter(quiet) {
    if (!quiet) { busy = true; render(); }
    try {
      await connect();
      await identify(sessionToken()).catch(() => {});
      subscribe();
      const response = await request('hx:lobby:enter', {});
      busy = false;
      if (!response.ok) { notice = t('online.errors.' + response.error); render(); return; }
      joined = true;
      players = response.players || [];
      messages = response.chat ? response.chat.slice() : [];
      render();
    } catch {
      busy = false;
      notice = t('online.errors.OFFLINE');
      render();
    }
  }

  async function leave() {
    joined = false;
    render();
    try { await request('hx:lobby:leave', {}); } catch { /* leaving is best-effort */ }
  }

  /* ── Wiring ───────────────────────────────────────────────────────────── */

  /*
   * The lobby is mounted inside the online page, and that page delegates
   * clicks on the same attributes from a container above this one. A click
   * handled here must stop, or it is handled twice: two calls to openPanel
   * opened the account panel and then closed it again, and the button looked
   * dead.
   */
  host.addEventListener('click', async (event) => {
    const mine = event.target.closest('[data-cadence], [data-challenge], [data-action]');
    if (mine && host.contains(mine)) event.stopPropagation();

    const pick = event.target.closest('[data-cadence]');
    if (pick) { cadence = pick.getAttribute('data-cadence'); playSound('ui'); render(); return; }

    const target = event.target.closest('[data-challenge]');
    if (target) {
      playSound('ui');
      const userId = target.getAttribute('data-challenge');
      const response = await request('hx:challenge', { userId, timeControl: cadence })
        .catch(() => ({ ok: false, error: 'OFFLINE' }));
      if (!response.ok) { notice = t('online.errors.' + response.error); render(); return; }
      sentTo = userId;
      const player = players.find((p) => p.userId === userId);
      notice = t('lobby.challengeSent', { name: player ? player.pseudo : '' });
      render();
      return;
    }

    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    playSound('ui');
    if (action === 'sign-in') { openPanel('account'); return; }
    if (action === 'enter') { enter(); return; }
    if (action === 'leave') { leave(); return; }
    if (action === 'accept' && incoming) {
      const id = incoming.id;
      incoming = null;
      render();
      const response = await request('hx:challenge:accept', { id })
        .catch(() => ({ ok: false, error: 'OFFLINE' }));
      // The room arrives through hx:challenge:ready, which both sides receive.
      if (!response.ok) { notice = t('online.errors.' + response.error); render(); }
      return;
    }
    if (action === 'decline' && incoming) {
      const id = incoming.id;
      incoming = null;
      render();
      request('hx:challenge:decline', { id }).catch(() => {});
    }
  });

  host.addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const field = host.querySelector('.chat-input');
    if (!field) return;
    const text = field.value;
    field.value = '';
    if (!text.trim()) return;
    request('hx:lobby:chat', { text }).catch(() => {});
  });

  render();

  /* Signing in or out anywhere on the site is felt here: the roster, the chat
     and the challenge buttons all depend on having a name. */
  const stopWatchingAuth = onAuthChange(() => {
    if (!isSignedIn() && joined) leave();
    else render();
  });

  return () => {
    stopWatchingAuth();
    if (joined) request('hx:lobby:leave', {}).catch(() => {});
    joined = false;
    for (const off of unsubscribe) {
      try { off(); } catch { /* already gone */ }
    }
    unsubscribe.length = 0;
  };
}
