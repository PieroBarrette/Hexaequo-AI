/**
 * Online lobby.
 *
 * Three ways in: quick match, which finds an opponent near your rating; a
 * private room whose link you send to whoever you like; and a code, for the
 * other end of that link.
 *
 * Quick match needs an account, because the pairing is done on your rating.
 * Private rooms do not: whoever holds the link takes the free seat, and the
 * game is rated only if both seats turn out to hold signed-in players.
 */

import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { request, connect, listen, inviteLink, serverOrigin, identify } from '../net.js';
import { play as playSound } from '../audio.js';
import { isSignedIn, onAuthChange, sessionToken } from '../auth.js';
import { openPanel } from '../ui/panels.js';
import { mountLobby } from './lobby.js';

/** Cadences offered when opening a room; must match the server's table. */
const CADENCES = ['none', 'bullet', 'blitz', 'rapid', 'classic'];

/**
 * Quick match leaves out `none`: a rated game with no clock has no way to end
 * when someone simply walks away from it.
 */
const QUICK_CADENCES = ['bullet', 'blitz', 'rapid', 'classic'];

/** The server's widest band. Used only to draw how far the search has opened. */
const MAX_BAND = 1200;

const cadenceLabel = (id) => t('online.cadence' + id.charAt(0).toUpperCase() + id.slice(1));

/** mm:ss, for the search timer. */
function clockText(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function mountOnline(outlet) {
  let busy = false;
  let created = null;
  let error = null;
  let cadence = 'none';
  let quickCadence = 'rapid';
  let tab = 'play';

  /** Null when not searching; otherwise the last status the server sent. */
  let search = null;
  let ticker = null;
  const unsubscribe = [];

  function tabStrip() {
    const one = (id, label) =>
      `<button class="page-tab${tab === id ? ' is-active' : ''}" data-page-tab="${id}">${label}</button>`;
    return `<div class="page-tabs">${one('play', t('online.tabPlay'))}${one('lobby', t('lobby.tab'))}</div>`;
  }

  /** The lobby owns its container, so only the frame around it is redrawn. */
  function renderLobbyTab() {
    if (closeLobby.active) {
      // Already mounted: just relabel the strip above it.
      const strip = outlet.querySelector('.page-tabs');
      if (strip) strip.outerHTML = tabStrip();
      return;
    }
    outlet.innerHTML = `
      <div class="page"><div class="page-inner">
        <h1>${t('online.title')}</h1>
        ${tabStrip()}
        <div class="lobby-host"></div>
      </div></div>`;
    closeLobby.active = mountLobby(outlet.querySelector('.lobby-host'));
  }

  function closeLobby() {
    if (!closeLobby.active) return;
    try { closeLobby.active(); } catch { /* already gone */ }
    closeLobby.active = null;
  }

  const rangeText = () => t('online.quickRange', {
    low: Math.max(0, search.elo - search.band),
    high: search.elo + search.band,
  });
  const bandWidth = () => `${Math.min(100, (search.band / MAX_BAND) * 100)}%`;
  /* Only worth saying when somebody else is in there: "1 waiting" is just you. */
  const queuedText = () => (search.queued > 1 ? ` · ${t('online.quickQueued', { n: search.queued })}` : '');

  function quickBlock() {
    if (!isSignedIn()) {
      return `
        <div class="rule-block">
          <h3>${t('online.quick')}</h3>
          <p class="lede">${t('online.quickSignIn')}</p>
          <button class="btn btn--primary" data-action="sign-in">${t('account.signIn')}</button>
        </div>`;
    }

    if (search) {
      return `
        <div class="rule-block searching">
          <h3>${t('online.quickSearching')}</h3>
          <div class="search-band">
            <span class="search-range" data-field="range">${rangeText()}</span>
            <span class="search-timer" data-field="timer">${clockText(Date.now() - search.since)}</span>
          </div>
          <div class="search-bar"><i data-field="fill" style="width:${bandWidth()}"></i></div>
          <p class="lede" style="font-size:12px;margin:10px 0 12px">
            ${cadenceLabel(search.timeControl)} · ${t('online.quickWidening')}
            <span data-field="queued">${queuedText()}</span>
          </p>
          <button class="btn" data-action="unqueue">${t('online.quickCancel')}</button>
        </div>`;
    }

    return `
      <div class="rule-block">
        <h3>${t('online.quick')}</h3>
        <p class="lede">${t('online.quickLede')}</p>
        <div class="cadence-grid">
          ${QUICK_CADENCES.map((id) => `
            <button class="btn cadence${id === quickCadence ? ' is-active' : ''}" data-quick-cadence="${id}">
              ${cadenceLabel(id)}
            </button>`).join('')}
        </div>
        <button class="btn btn--primary" data-action="queue" ${busy ? 'disabled' : ''}
                style="margin-top:10px">
          ${busy ? t('online.connecting') : t('online.quickFind')}
        </button>
      </div>`;
  }

  function render() {
    // The lobby keeps its own state and its own subscriptions; re-rendering the
    // page around it would tear it down mid-conversation.
    if (tab === 'lobby') return renderLobbyTab();
    closeLobby();

    outlet.innerHTML = `
      <div class="page"><div class="page-inner">
        <h1>${t('online.title')}</h1>
        ${tabStrip()}
        <p class="lede">${t('online.lede')}</p>

        ${error ? `<p class="net-error">${error}</p>` : ''}

        ${quickBlock()}

        ${created ? `
          <div class="rule-block">
            <h3>${t('online.waiting')}</h3>
            <p class="lede">${t('online.codeLabel')}</p>
            <div class="room-code">${created.code}</div>
            <div class="row-actions">
              ${navigator.share
    ? `<button class="btn btn--primary" data-action="share">${t('online.share')}</button>` : ''}
              <button class="btn${navigator.share ? '' : ' btn--primary'}" data-action="copy">${t('online.copyLink')}</button>
              <button class="btn" data-action="enter">${t('online.enterNow')}</button>
            </div>
            <p class="lede" style="margin-top:10px">${t('online.autoEnter')}</p>
            <p class="lede" style="margin-top:10px;word-break:break-all">${inviteLink(created.code)}</p>
          </div>
        ` : `
          <div class="rule-block">
            <h3>${t('online.privateTitle')}</h3>
            <p class="lede">${t('online.privateLede')}</p>
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

        <p class="lede" style="margin-top:22px;font-size:12px">${serverOrigin()}</p>
      </div></div>`;
  }

  function fail(code) {
    const message = t('online.errors.' + code);
    error = message === 'online.errors.' + code ? t('online.errors.OFFLINE') : message;
    render();
  }

  /* ── Quick match ──────────────────────────────────────────────────────── */

  /**
   * Repaint only the numbers while searching. Re-rendering the block every
   * second would fight the button under the player's finger.
   */
  function paintSearch() {
    if (!search) return;
    const timer = outlet.querySelector('[data-field="timer"]');
    if (!timer) return render();          // the block was replaced; start over
    timer.textContent = clockText(Date.now() - search.since);
    outlet.querySelector('[data-field="range"]').textContent = rangeText();
    outlet.querySelector('[data-field="queued"]').textContent = queuedText();
    outlet.querySelector('[data-field="fill"]').style.width = bandWidth();
  }

  function startTicker() {
    stopTicker();
    ticker = setInterval(paintSearch, 1000);
  }

  function stopTicker() {
    if (ticker) clearInterval(ticker);
    ticker = null;
  }

  function adoptStatus(status) {
    if (!status || !status.inQueue) {
      search = null;
      stopTicker();
      // Dropped out for a reason the server can name — say which.
      if (status && status.error) return fail(status.error);
      render();
      return;
    }
    const first = !search;
    search = {
      timeControl: status.timeControl,
      elo: status.elo,
      band: status.band,
      queued: status.queued,
      // Anchor the timer on the server's idea of how long we have waited, so a
      // reload mid-search does not restart the count.
      since: Date.now() - (status.waitingMs || 0),
    };
    if (first) { render(); startTicker(); } else paintSearch();
  }

  async function enterQueue() {
    busy = true;
    render();
    try {
      await connect();
      await identify(sessionToken()).catch(() => {});
      subscribe();
      const response = await request('hx:queue', { timeControl: quickCadence });
      busy = false;
      if (!response.ok) return fail(response.error);
      adoptStatus(response);
    } catch {
      busy = false;
      fail('OFFLINE');
    }
  }

  async function leaveQueue() {
    search = null;
    stopTicker();
    render();
    try { await request('hx:queue:leave', {}); } catch { /* leaving is best-effort */ }
  }

  let subscribed = false;

  function subscribe() {
    if (subscribed) return;
    subscribed = true;
    unsubscribe.push(listen('hx:queue:update', (status) => adoptStatus(status)));
    unsubscribe.push(listen('hx:matched', (payload) => {
      search = null;
      stopTicker();
      playSound('ui');
      navigate('play', { online: '1', code: payload.code });
    }));
    unsubscribe.push(listen('hx:opponent', (payload) => {
      if (!created || payload.code !== created.code || !payload.joined) return;
      const code = created.code;
      created = null;
      playSound('ui');
      navigate('play', { online: '1', code });
    }));
    // A reconnection loses the queue slot with the socket it was on; take it
    // again rather than leaving the player staring at a dead timer.
    unsubscribe.push(listen('connect', async () => {
      if (!search) return;
      await identify(sessionToken()).catch(() => {});
      try {
        const response = await request('hx:queue', { timeControl: search.timeControl });
        if (response.ok) adoptStatus(response);
      } catch { /* the next attempt is the player's */ }
    }));
  }

  /* ── Wiring ───────────────────────────────────────────────────────────── */

  render();

  // Signing in from the panel turns the sign-in prompt into the real thing.
  unsubscribe.push(onAuthChange(() => { if (!search) render(); }));

  outlet.addEventListener('click', async (event) => {
    const pageTab = event.target.closest('[data-page-tab]');
    if (pageTab) {
      tab = pageTab.getAttribute('data-page-tab');
      playSound('ui');
      render();
      return;
    }
    const quickPick = event.target.closest('[data-quick-cadence]');
    if (quickPick) {
      quickCadence = quickPick.getAttribute('data-quick-cadence');
      playSound('ui');
      render();
      return;
    }
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

    if (action === 'sign-in') { openPanel('account'); return; }
    if (action === 'queue') return enterQueue();
    if (action === 'unqueue') return leaveQueue();

    if (action === 'create') {
      busy = true;
      render();
      try {
        await connect();
        await identify(sessionToken()).catch(() => {});
        subscribe();
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

    if (action === 'share' && created) {
      /* The device's own sheet: a link reaches a message or an email without
         anybody having to find where it was copied to. */
      try {
        await navigator.share({
          title: 'Hexaequo', text: t('online.shareText'), url: inviteLink(created.code),
        });
      } catch { /* dismissed, or refused by the platform */ }
      return;
    }

    if (action === 'copy' && created) {
      const link = inviteLink(created.code);
      try {
        await navigator.clipboard.writeText(link);
      } catch { /* clipboard access can be refused; the link is on screen anyway */ }
      button.textContent = t('online.copied');
    }
  });

  outlet.addEventListener('input', (event) => {
    const field = event.target.closest('[data-input="code"]');
    if (!field) return;
    field.value = field.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });

  return () => {
    stopTicker();
    closeLobby();
    // Leaving the page leaves the queue: nobody should be paired into a game
    // they are no longer watching for. Being matched empties the queue first,
    // so this is a no-op on the way into a game.
    if (search) request('hx:queue:leave', {}).catch(() => {});
    for (const off of unsubscribe) {
      try { off(); } catch { /* already gone */ }
    }
  };
}
