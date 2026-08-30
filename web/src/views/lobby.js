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

const cadenceLabel = (id) => t('online.cadence' + id.charAt(0).toUpperCase() + id.slice(1));

/* The same day the server keeps, so the two never disagree about what is
   still here. */
const CHAT_LIFETIME_MS = 24 * 60 * 60 * 1000;

const escapeText = (value) => String(value).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Mount the lobby into `host`.
 *
 * The cadence is not this view's to choose: it is picked once at the top of
 * the page, for quick match and for a challenge alike, so the page hands down
 * a way to read it. Returns { close, refresh } — close leaves the room, so
 * nobody is left listed in a lobby they walked out of, and refresh redraws
 * when the page's cadence changes under it.
 */
export function mountLobby(host, readCadence = () => 'rapid') {
  let joined = false;
  let busy = false;
  let players = [];
  let games = [];
  let messages = [];
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
    if (!joined) {
      host.innerHTML = `
        <div class="rule-block">
          <h3>${t('lobby.title')}</h3>
          <p class="lede">${busy ? t('online.connecting') : t('lobby.lede')}</p>
        </div>`;
      return;
    }

    host.innerHTML = `
      ${notice ? `<p class="lobby-notice">${escapeText(notice)}</p>` : ''}
      <div class="rule-block">
        <div class="lobby-head">
          <h3>${t('lobby.title')}</h3>
          <span class="lobby-count">${t('lobby.count', { n: players.length })}</span>
        </div>
        <div class="lobby-list">${playerRows()}</div>
        ${isSignedIn() && readCadence() === 'none'
    ? `<p class="lede" style="font-size:12px;margin:10px 0 0">${t('lobby.noClockNoChallenge')}</p>`
    : ''}
      </div>
      ${games.length ? `
      <div class="rule-block">
        <div class="lobby-head">
          <h3>${t('watch.liveTitle')}</h3>
          <span class="lobby-count">${t('watch.liveCount', { n: games.length })}</span>
        </div>
        <div class="lobby-list">${gameRows()}</div>
      </div>` : ''}
      <div class="rule-block chat-block">
        <div class="chat-log lobby-chat">${chatRows()}</div>
        <p class="lede chat-note">${t('chat.lasts')}</p>
        ${isSignedIn() ? `
        <form class="chat-form">
          <input class="btn chat-input" maxlength="300" autocomplete="off"
                 placeholder="${t('chat.placeholder')}">
          <button class="btn btn--primary" type="submit">${t('chat.send')}</button>
        </form>` : `
        <div class="row-actions">
          <button class="btn btn--sm" data-action="sign-in">${t('lobby.signInToTalk')}</button>
        </div>`}
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
      /* Amber is not a closed door: someone at a board can still say yes to a
         game played after this one. */
      const action = isMe || !isSignedIn() || readCadence() === 'none' ? ''
        : `<button class="btn btn--sm" data-challenge="${escapeText(player.userId)}">`
          + `${sentTo === player.userId ? '✓' : t('lobby.challenge')}</button>`;
      const light = `<span class="pip is-${player.playing ? 'playing' : 'free'}"`
        + ` title="${player.playing ? t('lobby.playing') : t('lobby.available')}"></span>`;
      return `<div class="lobby-row${isMe ? ' is-me' : ''}">`
        + light
        + `<span class="lobby-name"><a class="player-link"`
          + ` href="#/profile?id=${escapeText(player.userId)}">${escapeText(player.pseudo)}</a></span>`
        + `<span class="lobby-elo">${player.elo}</span>`
        + `<span class="lobby-status${player.playing ? ' is-busy' : ''}">${status}</span>`
        + action + '</div>';
    }).join('');
  }

  /**
   * The games somebody could look in on.
   *
   * Only rooms with two signed-in players: a room opened from a private link
   * is between whoever holds that link, and putting it on a public list would
   * make it something its players never agreed to.
   */
  function gameRows() {
    const mine = me();
    return games.map((game) => {
      /* Your own game is not a show to watch, it is a chair to sit back down
         in — the server refuses to seat you as a spectator at it, and this is
         the door that does the right thing instead. */
      const yours = mine && (game.black.userId === mine || game.white.userId === mine);
      return `<div class="lobby-row">`
      + `<span class="lobby-name">${escapeText(game.black.pseudo)}`
      + `<span class="lobby-elo">${game.black.elo}</span>`
      + ` <span class="net-vs">${t('profile.versus')}</span> `
      + `${escapeText(game.white.pseudo)}<span class="lobby-elo">${game.white.elo}</span></span>`
      + `<span class="lobby-status">${t('profile.plies', { n: game.plies })}</span>`
      + (game.watchers ? `<span class="net-eyes">👁 ${game.watchers}</span>` : '')
      + (yours
        ? `<button class="btn btn--sm btn--primary" data-rejoin="${escapeText(game.code)}">`
          + `${t('home.rejoin')}</button></div>`
        : `<button class="btn btn--sm" data-watch="${escapeText(game.code)}">`
          + `${t('watch.action')}</button></div>`);
    }).join('');
  }

  function chatRows() {
    /* Filtered here as well as on the server: somebody who leaves the page
       open all day should watch the morning fall off the top without needing
       anybody else to say something first. */
    const cutoff = Date.now() - CHAT_LIFETIME_MS;
    const said = messages.filter((message) => message.at >= cutoff);
    if (!said.length) return `<p class="lede">${t('lobby.quiet')}</p>`;
    const mine = me();
    return said.map((message) =>
      `<div class="chat-line${message.userId === mine ? ' is-mine' : ''}">`
      + `<span class="chat-who">${escapeText(message.pseudo)}</span>`
      + `<span class="chat-text">${escapeText(message.text)}</span></div>`).join('');
  }

  /* ── Server ───────────────────────────────────────────────────────────── */

  function subscribe() {
    if (unsubscribe.length) return;
    unsubscribe.push(listen('hx:lobby:update', (payload) => {
      players = payload.players || [];
      games = payload.games || [];
      if (joined) render();
    }));
    unsubscribe.push(listen('hx:lobby:chat', (payload) => {
      messages.push(payload.message);
      if (joined) render();
    }));
    /* The invitation card lives above the whole site now, so this view only
       needs to hear what became of one it sent. */
    unsubscribe.push(listen('hx:challenge:declined', () => {
      sentTo = null;
      notice = t('lobby.declined');
      render();
    }));
    unsubscribe.push(listen('hx:challenge:expired', () => {
      sentTo = null;
      notice = t('lobby.expired');
      render();
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
      games = response.games || [];
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
    const mine = event.target.closest('[data-challenge], [data-action], [data-watch], [data-rejoin]');
    if (mine && host.contains(mine)) event.stopPropagation();

    const back = event.target.closest('[data-rejoin]');
    if (back) {
      playSound('ui');
      navigate('play', { online: '1', code: back.getAttribute('data-rejoin') });
      return;
    }

    const look = event.target.closest('[data-watch]');
    if (look) {
      playSound('ui');
      navigate('play', { watch: '1', code: look.getAttribute('data-watch') });
      return;
    }

    const target = event.target.closest('[data-challenge]');
    if (target) {
      playSound('ui');
      const userId = target.getAttribute('data-challenge');
      const response = await request('hx:challenge', { userId, timeControl: readCadence() })
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
  enter();

  /* Signing in or out anywhere on the site is felt here: the roster, the chat
     and the challenge buttons all depend on having a name. */
  const stopWatchingAuth = onAuthChange(() => {
    /* Signing in turns a listener into somebody on the list, and signing out
       does the reverse; either way the room is re-entered as whoever is here
       now. */
    enter(true);
  });

  return {
    refresh: render,
    close() {
      stopWatchingAuth();
      if (joined) request('hx:lobby:leave', {}).catch(() => {});
      joined = false;
      for (const off of unsubscribe) {
        try { off(); } catch { /* already gone */ }
      }
      unsubscribe.length = 0;
    },
  };
}
