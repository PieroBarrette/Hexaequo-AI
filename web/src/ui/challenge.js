/**
 * What is addressed to you, wherever you happen to be.
 *
 * A challenge used to be a card inside the lobby view, which meant it could
 * only reach you while you were looking at the lobby — and the lobby is the one
 * place you are least likely to be sitting when somebody wants a game. This
 * mounts once, above everything, and answers for the whole site.
 *
 * One at a time, in both directions. Being asked two questions you can only say
 * yes to once is worse than being asked none, so the server refuses a second
 * invitation and this never has more than one card to draw.
 *
 * Saying yes while you are at another board schedules the game instead of
 * starting it: the agreement waits in a chip until both boards are clear, and
 * then the room opens by itself.
 *
 * A game already under way is addressed to you in the same sense, so it shares
 * the corner: leaving a game is safe only if the way back is one press from
 * wherever you went.
 */

import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { request, listen, connect, identify } from '../net.js';
import { play as playSound } from '../audio.js';
import { isSignedIn, sessionToken, onAuthChange, currentUser } from '../auth.js';

const escapeText = (value) => String(value).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const cadenceLabel = (id) =>
  t('online.cadence' + String(id || 'rapid').charAt(0).toUpperCase() + String(id || 'rapid').slice(1));

let host = null;
let incoming = null;      // a question waiting for an answer
let outgoing = null;      // a question we asked, waiting on them
let agreed = null;        // a yes that is waiting for a board to clear
let notice = null;        // the last thing that happened, in words
let myGame = null;        // { code } — a game of ours that is still running
let noticeTimer = 0;
let armed = false;

/** Whether we are looking at the very game the standing agreement points at. */
function watchingTheDeal() {
  if (!agreed || !agreed.watchCode) return false;
  /* Read from the hash rather than asking the router, which keeps its parsing
     to itself; this needs one answer and not a new export. */
  const [name, query] = (window.location.hash || '').replace(/^#\/?/, '').split('?');
  if (name !== 'play') return false;
  const params = new URLSearchParams(query || '');
  return params.get('watch') === '1'
    && String(params.get('code') || '').toUpperCase() === agreed.watchCode;
}

/** Whether the board in front of us is the game we are being offered a way back to. */
function inMyGame() {
  if (!myGame) return false;
  const [name, query] = (window.location.hash || '').replace(/^#\/?/, '').split('?');
  if (name !== 'play') return false;
  const params = new URLSearchParams(query || '');
  return String(params.get('code') || '').toUpperCase() === myGame.code;
}

/**
 * The code of a game of ours still running, for a page that would rather carry
 * the way back itself. Read rather than asked for a second time: two answers to
 * one question can disagree, and the page would be drawing the gap between
 * them.
 */
export const myGameCode = () => (myGame ? myGame.code : null);

/*
 * Whether the page in front of us already carries the same door.
 *
 * The online page puts "rejoin your game" exactly where its two ways in would
 * be, so the chip there would be the same button twice on one screen. Nowhere
 * else does, so nowhere else loses it.
 */
function pageOffersTheWayBack() {
  const [name] = (window.location.hash || '').replace(/^#\/?/, '').split('?');
  return name === 'online';
}

function render() {
  if (!host) return;
  const chip = agreed && !watchingTheDeal();
  const back = myGame && !inMyGame() && !pageOffersTheWayBack();
  if (!incoming && !outgoing && !chip && !back && !notice) {
    host.hidden = true; host.innerHTML = ''; return;
  }
  host.hidden = false;
  host.innerHTML = (back ? backChip() : '')
    + (incoming ? incomingCard() : '')
    + (outgoing ? outgoingChip() : '')
    + (chip ? agreedChip() : '')
    + (notice ? `<div class="hail hail--note">${escapeText(notice)}</div>` : '');
}

/**
 * The game you walked away from, and the way back into it.
 *
 * Going elsewhere starts a countdown on your seat, so the site must not make
 * you hunt for the door back. It follows you instead — every page, one press.
 */
function backChip() {
  return `
    <div class="hail hail--back">
      <div class="hail-lede">${t('challenge.gameRunning')}</div>
      <div class="hail-actions">
        <button class="btn btn--sm btn--primary" data-hail="back">${t('home.rejoin')}</button>
      </div>
    </div>`;
}

function incomingCard() {
  return `
    <div class="hail hail--ask">
      <div class="hail-title">
        ${t('lobby.incoming', { name: escapeText(incoming.from.pseudo), elo: incoming.from.elo })}
      </div>
      <div class="hail-lede">
        ${cadenceLabel(incoming.timeControl)}
        ${incoming.busy ? ` · ${t('challenge.afterThisGame')}` : ''}
      </div>
      <div class="hail-actions">
        <button class="btn btn--primary btn--sm" data-hail="accept">${t('lobby.accept')}</button>
        <button class="btn btn--sm" data-hail="decline">${t('lobby.decline')}</button>
      </div>
    </div>`;
}

/**
 * What you asked, and the way to unask it.
 *
 * You may only have one invitation out at a time, so an unanswered one stands
 * between you and asking anybody else. Waiting for a reply that may never come
 * is not a choice; taking it back is.
 */
function outgoingChip() {
  return `
    <div class="hail hail--sent">
      <div class="hail-lede">
        ${t('challenge.waitingOn', { name: escapeText(outgoing.to.pseudo) })}
        · ${cadenceLabel(outgoing.timeControl)}
      </div>
      <div class="hail-actions">
        <button class="btn btn--sm" data-hail="withdraw">${t('challenge.withdraw')}</button>
      </div>
    </div>`;
}

function agreedChip() {
  return `
    <div class="hail hail--deal">
      <div class="hail-lede">
        ${t('challenge.agreedWith', { name: escapeText(agreed.opponent.pseudo) })}
      </div>
      <div class="hail-actions">
        ${agreed.watchCode
    ? `<button class="btn btn--sm btn--primary" data-hail="watch">${t('watch.while')}</button>`
    : ''}
        <button class="btn btn--sm" data-hail="cancel">${t('game.cancel')}</button>
      </div>
    </div>`;
}

/** Say something for a few seconds, then stop saying it. */
function say(text) {
  notice = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice = null; render(); }, 6000);
  render();
}

async function onClick(event) {
  const button = event.target.closest('[data-hail]');
  if (!button) return;
  const action = button.getAttribute('data-hail');
  playSound('ui');

  if (action === 'accept' && incoming) {
    const id = incoming.id;
    incoming = null;
    render();
    const response = await request('hx:challenge:accept', { id })
      .catch(() => ({ ok: false, error: 'OFFLINE' }));
    // A game that can start now arrives through hx:challenge:ready, which both
    // sides receive; one that cannot arrives as an agreement.
    if (!response.ok) say(t('online.errors.' + response.error));
    return;
  }
  if (action === 'back' && myGame) {
    navigate('play', { online: '1', code: myGame.code });
    return;
  }
  if (action === 'watch' && agreed && agreed.watchCode) {
    /* The chip stays: the agreement is still standing, and it is what opens
       the real game when the one being watched ends. */
    navigate('play', { watch: '1', code: agreed.watchCode });
    return;
  }
  const takeBack = { decline: incoming, withdraw: outgoing, cancel: agreed }[action];
  if (takeBack) {
    if (action === 'decline') incoming = null;
    else if (action === 'withdraw') outgoing = null;
    else agreed = null;
    render();
    request('hx:challenge:decline', { id: takeBack.id }).catch(() => {});
  }
}

/**
 * Start listening. Idempotent: signing in and out again must not stack up two
 * of every handler.
 */
async function arm() {
  if (armed || !isSignedIn()) return;
  armed = true;
  try {
    await connect();
    await identify(sessionToken()).catch(() => {});
  } catch { /* the listeners below reconnect with the socket */ }

  listen('hx:challenge:incoming', (payload) => {
    incoming = payload;
    playSound('ui');
    render();
  });
  listen('hx:challenge:sent', (payload) => {
    outgoing = payload;
    render();
  });
  listen('hx:challenge:agreed', (payload) => {
    agreed = payload;
    incoming = null;
    outgoing = null;
    playSound('ui');
    // The one who said yes already knows they said yes; it is the other who
    // needs telling.
    if (payload.youAccepted) render();
    else say(t('challenge.agreedNote', { name: payload.opponent.pseudo }));
  });
  listen('hx:challenge:ready', (payload) => {
    incoming = null;
    outgoing = null;
    agreed = null;
    notice = null;
    render();
    playSound('ui');
    navigate('play', { online: '1', code: payload.code });
  });
  listen('hx:challenge:declined', (payload) => {
    if (incoming && incoming.id === payload.id) incoming = null;
    if (outgoing && outgoing.id === payload.id) outgoing = null;
    if (agreed && agreed.id === payload.id) agreed = null;
    /* Whoever took it off the table already knows they did; the other one is
       told which of the two things happened. */
    const me = currentUser();
    if (me && payload.by === me.id) { render(); return; }
    say(payload.withdrawn ? t('challenge.withdrawn') : t('lobby.declined'));
  });
  listen('hx:challenge:expired', (payload) => {
    if (incoming && incoming.id === payload.id) incoming = null;
    if (outgoing && outgoing.id === payload.id) outgoing = null;
    if (agreed && agreed.id === payload.id) agreed = null;
    say(t('lobby.expired'));
  });
  /* Signing in on a live socket does not re-dial, so take the identity across
     explicitly or the server has nobody to address. */
  listen('connect', async () => {
    await identify(sessionToken()).catch(() => {});
    catchUp();
  });
  catchUp();
}

/**
 * Pick up anything still standing.
 *
 * A question survives the page it was asked on: reloading, or walking from the
 * lobby into a game, must not lose an invitation somebody is waiting on an
 * answer to.
 */
async function catchUp() {
  if (!isSignedIn()) { myGame = null; render(); return; }
  try {
    const mine = await request('hx:mygame', {}).catch(() => null);
    myGame = mine && mine.ok && mine.code ? { code: mine.code } : null;
    const response = await request('hx:challenge:pending', {});
    if (!response || !response.ok) { render(); return; }
    incoming = response.incoming || null;
    outgoing = response.outgoing || null;
    agreed = response.agreed || null;
    render();
  } catch { /* the next connection tries again */ }
}

/** Mount once, at start-up. */
export function mountChallenges() {
  host = document.createElement('div');
  host.className = 'hail-host';
  host.hidden = true;
  host.addEventListener('click', onClick);
  document.body.appendChild(host);

  /* Every arrival is a chance for the answer to have changed: a game may have
     ended, or started, or been walked out of. */
  window.addEventListener('routechange', () => { render(); catchUp(); });

  onAuthChange(() => {
    if (isSignedIn()) { arm(); return; }
    // Signed out: nothing here is addressed to whoever is here now.
    incoming = null;
    outgoing = null;
    agreed = null;
    notice = null;
    myGame = null;
    render();
  });
  arm();
}
