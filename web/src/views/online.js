/**
 * One page for playing online: how to start a game, and who is about.
 *
 * Two ways in rather than three. Quick match finds an opponent near your
 * rating and needs an account, because the pairing is done on one. A private
 * room does not: whoever holds the link takes the free seat, and the game is
 * rated only if both seats turn out to hold signed-in players. The six-letter
 * code is gone — it was a second way of saying what the link already says, and
 * a thing to mistype.
 *
 * The cadence is chosen once, at the top, for whichever of the two is used.
 * Without a clock there is nothing to stop a rated game hanging on somebody
 * who walked away, so quick match is closed at that setting; a private game
 * between people who know each other is fine without one.
 *
 * The lobby is not a second tab. It is the rest of this page — mounted once
 * and left alone while the block above it redraws, because it holds a
 * conversation and its own subscriptions.
 */

import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { request, connect, listen, inviteLink, identify } from '../net.js';
import { play as playSound } from '../audio.js';
import { isSignedIn, onAuthChange, sessionToken } from '../auth.js';
import { openPanel } from '../ui/panels.js';
import { mountLobby } from './lobby.js';
import { qrSvg } from '../ui/qr.js';

/** Cadences offered, which must match the server's table. */
const CADENCES = ['none', 'bullet', 'blitz', 'rapid', 'classic'];

/** The one cadence quick match cannot use. */
const NO_CLOCK = 'none';

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
  let cadence = 'rapid';
  let showingQr = false;

  /** Null when not searching; otherwise the last status the server sent. */
  let search = null;
  /** The code of a game of yours still unfinished, when there is one. */
  let liveCode = null;
  let ticker = null;
  const unsubscribe = [];

  /* The shell is built once; only the top half is ever redrawn. */
  outlet.innerHTML = `
    <div class="page"><div class="page-inner">
      <h1>${t('online.title')}</h1>
      <div class="online-top"></div>
      <div class="lobby-host"></div>
    </div></div>
    <div class="qr-sheet" hidden></div>`;
  const top = outlet.querySelector('.online-top');
  const qrSheet = outlet.querySelector('.qr-sheet');
  const lobby = mountLobby(outlet.querySelector('.lobby-host'), () => cadence);

  const rangeText = () => t('online.quickRange', {
    low: Math.max(0, search.elo - search.band),
    high: search.elo + search.band,
  });
  const bandWidth = () => `${Math.min(100, (search.band / MAX_BAND) * 100)}%`;
  /* Only worth saying when somebody else is in there: "1 waiting" is just you. */
  const queuedText = () => (search.queued > 1 ? ` · ${t('online.quickQueued', { n: search.queued })}` : '');

  /* ── The blocks ───────────────────────────────────────────────────────── */

  /** The cadence, once, for whichever door is used. */
  function cadenceBlock() {
    return `
      <div class="rule-block">
        <h3>${t('online.cadenceTitle')}</h3>
        <div class="cadence-grid">
          ${CADENCES.map((id) => `
            <button class="btn cadence${id === cadence ? ' is-active' : ''}" data-cadence="${id}">
              ${cadenceLabel(id)}
            </button>`).join('')}
        </div>
      </div>`;
  }

  /**
   * One door back, in place of the two ways in.
   *
   * With a game still going, starting another is the one thing that cannot be
   * meant — so the page offers the way back to it instead of a quick match and
   * a new room. Only these two are taken away: the lobby underneath keeps its
   * list, its chat and its names, which is the reason the page is reachable at
   * all while a game is unfinished.
   */
  function rejoinBlock() {
    return `
      <div class="rule-block">
        <div class="online-doors">
          <button class="btn btn--primary" data-action="rejoin">${t('home.rejoin')}</button>
        </div>
        <p class="lede" style="font-size:12px;margin:10px 0 0">${t('online.finishFirst')}</p>
      </div>`;
  }

  /** The two ways in, side by side, neither the more important one. */
  function doorsBlock() {
    const noClock = cadence === NO_CLOCK;
    const canQuick = isSignedIn() && !noClock;
    return `
      <div class="rule-block">
        <div class="online-doors">
          <button class="btn${canQuick ? ' btn--primary' : ''}" data-action="queue"
                  ${canQuick && !busy ? '' : 'disabled'}>${t('online.quickFind')}</button>
          <button class="btn btn--primary" data-action="create" ${busy ? 'disabled' : ''}>
            ${t('online.create')}</button>
        </div>
        <p class="lede" style="font-size:12px;margin:10px 0 0">
          ${noClock ? t('online.quickNeedsClock')
    : (isSignedIn() ? t('online.quickLede') : t('online.quickSignIn'))}
        </p>
      </div>`;
  }

  /** Searching, with the band widening and a way to stop. */
  function searchBlock() {
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

  /**
   * A room waiting for whoever gets the link.
   *
   * No six-letter code: the link carries it, and the QR carries the link to a
   * phone that is not the one holding it.
   */
  function waitingBlock() {
    return `
      <div class="rule-block">
        <h3>${t('online.waiting')}</h3>
        <p class="lede">${t('online.autoEnter')}</p>
        <div class="row-actions">
          <button class="btn btn--primary" data-action="share">${t('online.share')}</button>
          <button class="btn" data-action="qr">${t('online.showQr')}</button>
          <button class="btn" data-action="cancel-room">${t('game.cancel')}</button>
        </div>
      </div>`;
  }

  function render() {
    /* A game of your own outranks the doors, but not a room you are in the
       middle of opening or a search already running — those are answers to
       something you just pressed. */
    const rejoin = Boolean(liveCode) && !search && !created;
    top.innerHTML = `
      ${error ? `<p class="net-error">${error}</p>` : ''}
      ${search || created || rejoin ? '' : cadenceBlock()}
      ${rejoin ? rejoinBlock()
    : search ? searchBlock() : (created ? waitingBlock() : doorsBlock())}`;
    renderQr();
  }

  /** Ask whether a game of ours is still going, and redraw if the answer moved. */
  async function findMyGame() {
    const was = liveCode;
    if (!isSignedIn()) liveCode = null;
    else {
      try {
        await connect();
        await identify(sessionToken()).catch(() => {});
        const mine = await request('hx:mygame', {});
        liveCode = mine && mine.ok ? mine.code : null;
      } catch { liveCode = null; }
    }
    if (outlet.isConnected && liveCode !== was) render();
  }

  /** The link as something a camera can read. A tap anywhere closes it. */
  function renderQr() {
    const on = showingQr && Boolean(created);
    qrSheet.hidden = !on;
    if (!on) { qrSheet.innerHTML = ''; return; }
    qrSheet.innerHTML = `<div class="qr-card">${qrSvg(inviteLink(created.code))}
      <p class="lede">${t('online.qrHint')}</p></div>`;
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
    const timer = top.querySelector('[data-field="timer"]');
    if (!timer) return render();          // the block was replaced; start over
    timer.textContent = clockText(Date.now() - search.since);
    top.querySelector('[data-field="range"]').textContent = rangeText();
    top.querySelector('[data-field="queued"]').textContent = queuedText();
    top.querySelector('[data-field="fill"]').style.width = bandWidth();
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
      const response = await request('hx:queue', { timeControl: cadence });
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
  findMyGame();

  /* Signing in from the panel turns the sign-in prompt into the real thing —
     and is also when a game of yours can first be found. */
  unsubscribe.push(onAuthChange(() => { if (!search) render(); findMyGame(); }));

  /* Anywhere on the sheet puts the code away. */
  qrSheet.addEventListener('click', () => { showingQr = false; renderQr(); });

  outlet.addEventListener('click', async (event) => {
    const pick = event.target.closest('[data-cadence]');
    if (pick) {
      cadence = pick.getAttribute('data-cadence');
      playSound('ui');
      render();
      // The list below shows a challenge button that depends on this.
      lobby.refresh();
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
    if (action === 'qr') { showingQr = true; renderQr(); return; }
    if (action === 'rejoin' && liveCode) {
      navigate('play', { online: '1', code: liveCode });
      return;
    }

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

    if (action === 'cancel-room' && created) {
      /* A room nobody joined has no game to protect, so it goes rather than
         standing empty for whoever follows the link afterwards. */
      const code = created.code;
      created = null;
      showingQr = false;
      render();
      request('hx:cancel', { code }).catch(() => {});
      return;
    }

    if (action === 'share' && created) {
      /* The device's own sheet, which already offers to copy as one of its
         choices — so there is no second button for copying. Where there is no
         sheet, copying is what the sheet call falls back to. */
      const link = inviteLink(created.code);
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Hexaequo', text: t('online.shareText'), url: link });
        } catch { /* dismissed, or refused by the platform */ }
        return;
      }
      try {
        await navigator.clipboard.writeText(link);
        button.textContent = t('online.copied');
      } catch { /* refused; the link is on screen anyway */ }
    }
  });

  return () => {
    stopTicker();
    lobby.close();
    // Leaving the page leaves the queue: nobody should be paired into a game
    // they are no longer watching for. Being matched empties the queue first,
    // so this is a no-op on the way into a game.
    if (search) request('hx:queue:leave', {}).catch(() => {});
    for (const off of unsubscribe) {
      try { off(); } catch { /* already gone */ }
    }
  };
}
