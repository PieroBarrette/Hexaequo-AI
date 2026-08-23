/**
 * The local game: board, side reserves, interaction and AI scheduling.
 *
 * Interaction has two equivalent grammars. Clicking is stateful — pick a piece,
 * then a destination — while dragging is direct. A pointer that moves more than
 * a few pixels before release becomes a drag; anything shorter is treated as a
 * click, so both live on the same handlers without a mode switch.
 */

import { t, onLanguageChange } from '../i18n.js';
import { navigate, setLeaveGuard } from '../router.js';
import { get as getSetting, set as setSetting, onSettingsChange } from '../settings.js';
import { play as playSound } from '../audio.js';
import { createBoard, pieceSvg, cx, cy, SIZE } from '../ui/board.js';
import { miniBoardSvg } from '../ui/miniBoard.js';
import { STEP, RING_OFFSETS, inBoard, cellLabel, hexPath } from '../game/hex.js';
import {
  BLACK, WHITE, DISK, RING, createState, cloneState, positionKey, withPieceLifted,
  applyMove, undoMove, tilePlacementSpots, pieceOwner, pieceType, makePiece,
  deserializeState,
  TILES_PER_PLAYER, DISKS_PER_PLAYER, RINGS_PER_PLAYER,
} from '../game/state.js';
import {
  generateMoves, generateDiskMoves, availableJumps, checkWinner, moveNotation, moveIntent,
  findLegalMove,
} from '../game/moves.js';
import { chooseMove } from '../game/ai.js';
import { request, listen, connect, inviteLink, identify } from '../net.js';
import { sessionToken } from '../auth.js';

const MODE_LOCAL = 'local';
const MODE_AI = 'ai';
const MODE_AI_AI = 'aiai';

export function mountPlay(outlet, params) {
  /* ── View state ───────────────────────────────────────────────────────── */
  let state, history, moveLog, repetitions, result, lastMove;
  let selected = null;
  let chain = null;
  let placeMode = null;
  let picker = null;
  let thinking = false;
  let aiRunning = false;
  let drag = null;
  let effect = null;
  let effectEndsAt = 0;
  let drawerOpen = false;
  let drawerTab = 'moves';

  /**
   * Review: every position the game has been through, and where the player is
   * looking.
   *
   * `timeline[i]` is the position after i plies, so `timeline[0]` is the
   * opening and the last entry is the live position. `review` is null while
   * watching the game itself, and an index into the timeline while looking
   * back. Looking back never touches the game — it is a second reader of the
   * same history, which is what makes it safe to offer mid-game.
   */
  let timeline = [];
  let timelineMoves = [];
  let review = null;
  let resultSeen = false;          // the result card has been dismissed

  let mode = MODE_AI;
  let humanSide = BLACK;
  let level = getSetting('aiLevel');

  /* Online games: the server owns the position, so this view only sends move
     intents and renders whatever comes back. `net` is null for local play. */
  const wantsOnline = params && params.get('online') === '1' && params.get('code');
  let net = wantsOnline
    ? {
      code: String(params.get('code')).toUpperCase(),
      colour: null,
      pending: false,          // a move is in flight
      noFly: false,            // that move came from a drag, so do not re-animate it
      opponentPresent: false,
      awaiting: null,          // { seat, until } while an opponent may still return
      error: null,
      ready: false,
      clock: null,           // last snapshot the server sent
      clockAt: 0,            // when we received it, to interpolate locally
      chat: [],
      unread: 0,
      rematchAsked: false,     // we have offered
      rematchOffered: false,   // they have offered
      rematchDeclined: false,
      rematchCode: null,       // the room that replaces this one
      unsubscribe: [],
    }
    : null;
  let countdownTimer = 0;
  let clockTimer = 0;

  const isAI = (player) =>
    !net && (mode === MODE_AI_AI || (mode === MODE_AI && player !== humanSide));

  /** Whether the local player may act at all right now. */
  const canAct = () => (review === null) && (net
    ? net.ready && !net.pending && state.turn === net.colour
    : !isAI(state.turn));

  /** The position on screen: the game itself, or the ply being reviewed. */
  const shownState = () => (review === null ? state : timeline[review]) || state;
  const atLivePosition = () => review === null || review >= timeline.length - 1;

  /* ── Markup ───────────────────────────────────────────────────────────── */
  outlet.innerHTML = `
    <div class="game">
      <aside class="rail" data-rail="0"></aside>
      <div class="board-area">
        <div class="net-strip"></div>
        <div class="board-host" style="flex:1;display:flex;min-width:0"></div>
        <div class="chain-bar">
          <span class="taken"></span>
          <button class="btn btn--icon" data-action="end-jump" title="${t('game.endJump')}">✓</button>
          <button class="btn btn--icon" data-action="cancel-jump" title="${t('game.cancel')}">✕</button>
        </div>
        <div class="result-overlay">
          <div class="result-card">
            <div class="result-title"></div>
            <div class="result-why"></div>
            <div class="result-rating"></div>
            <div class="result-note"></div>
            <div class="result-actions"></div>
          </div>
        </div>
        <div class="review-bar">
          <button class="btn btn--icon" data-action="rev-first" title="${t('review.first')}">⏮</button>
          <button class="btn btn--icon" data-action="rev-prev" title="${t('review.previous')}">◀</button>
          <span class="review-ply" data-field="ply"></span>
          <button class="btn btn--icon" data-action="rev-next" title="${t('review.next')}">▶</button>
          <button class="btn btn--icon" data-action="rev-last" title="${t('review.last')}">⏭</button>
          <button class="btn review-live" data-action="rev-live">${t('review.backToLive')}</button>
        </div>
        <div class="drawer">
          <div class="drawer-tabs">
            <button class="drawer-tab is-active" data-tab="moves">${t('game.moveList')}</button>
            <button class="drawer-tab" data-tab="chat">${t('chat.tab')}<i class="tab-dot"></i></button>
          </div>
          <div class="drawer-body">
            <div class="move-list"></div>
            <div class="chat-pane">
              <div class="chat-log"></div>
              <form class="chat-form">
                <input class="btn chat-input" maxlength="300" autocomplete="off"
                       placeholder="${t('chat.placeholder')}">
                <button class="btn btn--primary" type="submit">${t('chat.send')}</button>
              </form>
            </div>
          </div>
        </div>
      </div>
      <aside class="rail" data-rail="1"></aside>
    </div>`;

  const gameEl = outlet.querySelector('.game');
  const board = createBoard(outlet.querySelector('.board-host'));
  const rails = [outlet.querySelector('[data-rail="0"]'), outlet.querySelector('[data-rail="1"]')];
  const chainBar = outlet.querySelector('.chain-bar');
  const overlay = outlet.querySelector('.result-overlay');
  const drawer = outlet.querySelector('.drawer');
  const moveListEl = outlet.querySelector('.move-list');
  const reviewBar = outlet.querySelector('.review-bar');
  const chatPane = outlet.querySelector('.chat-pane');
  const chatLogEl = outlet.querySelector('.chat-log');
  const chatForm = outlet.querySelector('.chat-form');
  const chatInput = outlet.querySelector('.chat-input');

  /* Game controls live in the site header so the board keeps its height. */
  const tools = document.getElementById('header-tools');
  const toolsRight = document.getElementById('header-tools-right');
  buildTools();

  function buildTools() {
    tools.innerHTML = toolsMarkup();
    buildDrawerButton();
    tools.querySelector('[data-control="level"]').value = String(level);
    tools.querySelector('[data-control="mode"]').value = mode;
    const side = tools.querySelector('[data-control="side"]');
    if (side) side.value = String(humanSide);
  }

  function toolsMarkup() {
    return `
    <select class="btn" data-control="mode">
      <option value="${MODE_LOCAL}">${t('game.modeLocal')}</option>
      <option value="${MODE_AI}" selected>${t('game.modeAi')}</option>
      <option value="${MODE_AI_AI}">${t('game.modeAiAi')}</option>
    </select>
    <select class="btn" data-control="side">
      <option value="0">${t('game.playAs', { colour: t('common.black') })}</option>
      <option value="1">${t('game.playAs', { colour: t('common.white') })}</option>
    </select>
    <select class="btn" data-control="level">
      <option value="0">${t('game.levelBeginner')}</option>
      <option value="1">${t('game.levelEasy')}</option>
      <option value="2">${t('game.levelMedium')}</option>
      <option value="3">${t('game.levelStrong')}</option>
    </select>
    <button class="btn btn--icon" data-action="run" title="${t('game.run')}">▶</button>
    <button class="btn btn--icon" data-action="step" title="${t('game.stepOnce')}">⏭</button>
    <button class="btn btn--icon" data-action="undo" title="${t('game.undo')}">↶</button>
    <button class="btn btn--icon" data-action="new" title="${t('game.newGame')}">⟳</button>
    <button class="btn btn--icon" data-action="resign" title="${t('online.resign')}">⚑</button>`;
  }

  /* Grouped at the right with the other panel toggles. The chevron matches the
     motion — up to raise the panel, down to put it away — where an ≡ read as a
     hamburger menu. */
  function buildDrawerButton() {
    toolsRight.innerHTML =
      `<button class="btn btn--icon${drawerOpen ? ' is-on' : ''}" data-action="drawer"`
      + ` title="${t('game.moveList')}">${drawerOpen ? '⌄' : '⌃'}</button>`;
  }

  /**
   * Re-render everything that carries words, in place. The game itself is
   * untouched, which is the point: changing the language mid-game must not cost
   * you the game.
   */
  function relabel() {
    buildTools();
    const movesTab = outlet.querySelector('[data-tab="moves"]');
    if (movesTab) movesTab.textContent = t('game.moveList');
    const chatTab = outlet.querySelector('[data-tab="chat"]');
    if (chatTab) chatTab.innerHTML = `${t('chat.tab')}<i class="tab-dot"></i>`;
    chatInput.placeholder = t('chat.placeholder');
    chatForm.querySelector('button').textContent = t('chat.send');
    outlet.querySelector('[data-action="end-jump"]').title = t('game.endJump');
    outlet.querySelector('[data-action="cancel-jump"]').title = t('game.cancel');
    outlet.querySelector('[data-action="rev-live"]').textContent = t('review.backToLive');
    for (const [action, key] of [['rev-first', 'first'], ['rev-prev', 'previous'],
      ['rev-next', 'next'], ['rev-last', 'last']]) {
      outlet.querySelector(`[data-action="${action}"]`).title = t('review.' + key);
    }
    refresh();
  }

  /* ── Game lifecycle ───────────────────────────────────────────────────── */

  function newGame() {
    state = createState();
    history = [];
    moveLog = [];
    repetitions = new Map();
    result = null;
    lastMove = null;
    selected = null;
    chain = null;
    placeMode = null;
    picker = null;
    thinking = false;
    drag = null;
    timeline = [cloneState(state)];
    timelineMoves = [];
    review = null;
    resultSeen = false;
    clearEffect();
    board.setView({ x: 0, y: 0, w: 1, h: 1 }, true);
    board.__firstFrame = true;
    recordPosition();
    refresh(true);
    afterEffect(scheduleAI);
  }

  /**
   * File the position a move produced, so it can be looked at later.
   *
   * A player reviewing when the next move lands stays where they were reading;
   * being yanked back to the live board mid-thought is the behaviour every
   * chess site had to unlearn.
   */
  function recordPly(move) {
    timelineMoves.push(move);
    timeline.push(cloneState(state));
  }

  function recordPosition() {
    const signature = positionKey(state);
    const count = (repetitions.get(signature) || 0) + 1;
    repetitions.set(signature, count);
    // Results store *why* they happened, not the sentence: the language can
    // change while the finished game is still on screen.
    if (count >= 3 && !result) result = { draw: true, reason: 'repetition' };
  }

  function clearEffect() {
    effect = null;
    effectEndsAt = 0;
    board.clearEffects();
  }

  function afterEffect(callback) {
    const wait = Math.max(0, effectEndsAt - Date.now());
    setTimeout(callback, wait + (mode === MODE_AI_AI ? 170 : 0));
  }

  /**
   * Apply a move and set up its animation.
   * `noFly` suppresses the travel animation when the player has already dragged
   * the piece to its destination. `flyPath` and `captureList` let a multi-jump
   * chain animate only its final hop, the earlier ones having been shown live.
   */
  /**
   * Play a move. Locally that means applying it; online it means asking the
   * server, which will echo the position back to both players.
   */
  function commit(move, noFly, flyPath, captureList) {
    if (net) { sendIntent(move, noFly); return; }
    applyLocal(move, noFly, flyPath, captureList);
  }

  function applyLocal(move, noFly, flyPath, captureList) {
    history.push({
      snapshot: cloneState(state),
      log: moveLog.slice(),
      repetitions: new Map(repetitions),
      lastMove,
    });

    const player = state.turn;
    const notation = moveNotation(move, cellLabel);
    const allCaptures = move.type === 'disk' ? move.captures
      : (move.type === 'ring' && move.capture ? [move.capture] : []);
    const captures = captureList !== undefined ? captureList : allCaptures;

    let path = flyPath !== undefined ? flyPath
      : (move.type === 'disk' ? move.path.slice()
        : (move.type === 'ring' ? [move.from, move.to] : null));
    if (noFly) path = null;

    const next = {
      path,
      code: makePiece(player, move.type === 'ring' ? RING : DISK),
      captured: [],
      newTile: move.type === 'tile' ? move.cell : null,
      newPiece: move.type === 'piece' ? move.cell : null,
      hidden: path ? path[path.length - 1] : null,
    };
    for (const c of captures) {
      let step = 1;
      if (path) {
        for (let i = 0; i + 1 < path.length; i++) {
          if ((path[i] + path[i + 1]) / 2 === c.cell) { step = i + 1; break; }
        }
      }
      next.captured.push({ cell: c.cell, code: c.code, step });
    }

    applyMove(state, move);
    lastMove = move;
    moveLog.push({ player, text: notation, captured: allCaptures.length > 0 });
    recordPly(move);

    const won = checkWinner(state);
    if (won) {
      result = { winner: won.winner, reason: won.reason };
    } else {
      recordPosition();
      if (!result && generateMoves(state).length === 0) {
        result = { draw: true, reason: 'noMoves', colour: state.turn };
      }
    }

    selected = null;
    chain = null;
    placeMode = null;
    picker = null;
    drag = null;

    effect = next;
    playMoveSounds(move, next);
    refresh();
    afterEffect(scheduleAI);
  }

  function playMoveSounds(move, next) {
    if (move.type === 'tile') playSound('tilePlacement');
    else if (move.type === 'piece') playSound('piecePlacement');
    else playSound('move');

    const steps = next.path ? next.path.length - 1 : 0;
    const flight = steps ? Math.min(180 + 150 * steps, 820) : 0;
    for (const c of next.captured) {
      playSound('capture', steps ? Math.max(0, flight * Math.min(1, c.step / steps) - 80) : 60);
    }
    if (result) playSound('gameEnd', 420);
  }

  function undoLast() {
    if (thinking || !history.length) return;
    const stopAt = mode === MODE_AI ? humanSide : null;
    do {
      const previous = history.pop();
      state = previous.snapshot;
      moveLog = previous.log;
      repetitions = previous.repetitions;
      lastMove = previous.lastMove;
      result = null;
      resultSeen = false;
    } while (history.length && stopAt !== null && state.turn !== stopAt);
    // The undone plies never happened; the review has nowhere to go but back.
    timeline.length = history.length + 1;
    timelineMoves.length = history.length;
    if (review !== null && review > history.length) review = null;
    if (mode === MODE_AI_AI) aiRunning = false;
    selected = null;
    chain = null;
    placeMode = null;
    picker = null;
    drag = null;
    clearEffect();
    refresh();
  }

  function scheduleAI() {
    if (result || thinking || drag) return;
    if (!isAI(state.turn)) return;
    if (mode === MODE_AI_AI && !aiRunning) return;
    thinking = true;
    refresh();
    setTimeout(() => {
      const move = chooseMove(state, level);
      thinking = false;
      if (move) commit(move); else refresh();
    }, 40);
  }

  function stepAI() {
    if (result || thinking || !isAI(state.turn)) return;
    thinking = true;
    refresh();
    setTimeout(() => {
      const move = chooseMove(state, level);
      thinking = false;
      if (move) commit(move); else refresh();
    }, 40);
  }

  const colourName = (player) => (player === BLACK ? t('common.black') : t('common.white'));

  /* ── Online ───────────────────────────────────────────────────────────── */

  const REASON_KEYS = {
    disks: 'byDisks', rings: 'byRings', cleared: 'byCleared',
    noMoves: 'byNoMoves', repetition: 'byRepetition',
    resigned: 'byResigned', abandoned: 'byAbandoned', timeout: 'byTimeout',
  };

  /** The sentence for a result, rendered in whatever language is current. */
  function resultWhy(outcome) {
    if (!outcome) return '';
    return t('result.' + (REASON_KEYS[outcome.reason] || 'byNoMoves'), {
      colour: colourName(outcome.colour === undefined ? state.turn : outcome.colour),
    });
  }

  function readResult(payload) {
    if (!payload) return null;
    const outcome = { reason: payload.reason, colour: state.turn };
    return payload.winner === null || payload.winner === undefined
      ? { draw: true, ...outcome }
      : { winner: payload.winner, ...outcome };
  }

  /**
   * The clock a seat should be showing right now. The server sends a snapshot
   * with each move; between moves the side on turn is counted down locally, so
   * the display is smooth without asking the server every second.
   */
  function remainingFor(seat) {
    if (!net || !net.clock) return null;
    const base = net.clock.remaining[seat];
    if (!net.clock.running || net.clock.turn !== seat) return Math.max(0, base);
    return Math.max(0, base - (Date.now() - net.clockAt));
  }

  function formatClock(ms) {
    const total = Math.ceil(ms / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function adoptClock(clock) {
    if (!net || !clock) return;
    net.clock = clock;
    net.clockAt = Date.now();
  }

  /** Repaint just the clock read-outs, without redrawing the board. */
  function tickClocks() {
    if (!net || !net.clock) return;
    for (let seat = 0; seat < 2; seat++) {
      const node = outlet.querySelector(`[data-clock="${seat}"]`);
      if (!node) continue;
      const left = remainingFor(seat);
      node.textContent = formatClock(left);
      node.classList.toggle('is-running', net.clock.running && net.clock.turn === seat && !result);
      node.classList.toggle('is-low', left <= 20000);
    }
  }

  /** Adopt a position the server sent, and animate the move that produced it. */
  function applyRemote(payload) {
    state = deserializeState(payload.state);
    adoptClock(payload.clock);

    const move = payload.move;
    const path = move.type === 'disk' ? move.path
      : (move.type === 'ring' ? [move.from, move.to] : null);

    lastMove = move.type === 'tile' || move.type === 'piece'
      ? { type: move.type, cell: move.cell }
      : (move.type === 'disk' ? { type: 'disk', path: move.path } : { type: 'ring', from: move.from, to: move.to });

    const mine = payload.by === net.colour;
    const captured = (payload.captures || []).map((c) => {
      let step = 1;
      if (path) {
        for (let i = 0; i + 1 < path.length; i++) {
          if ((path[i] + path[i + 1]) / 2 === c.cell) { step = i + 1; break; }
        }
      }
      return { cell: c.cell, code: c.code, step };
    });

    // A move the local player dragged is already where they put it.
    const flightPath = (mine && net.noFly) ? null : path;
    effect = {
      path: flightPath,
      code: makePiece(payload.by, move.type === 'ring' ? RING : DISK),
      captured,
      newTile: move.type === 'tile' ? move.cell : null,
      newPiece: move.type === 'piece' ? move.cell : null,
      hidden: flightPath ? flightPath[flightPath.length - 1] : null,
    };
    if (mine) net.noFly = false;

    moveLog.push({ player: payload.by, text: payload.notation, captured: captured.length > 0 });
    recordPly(payload.move);
    selected = null;
    chain = null;
    picker = null;
    placeMode = null;
    if (payload.result) result = readResult(payload.result);

    if (move.type === 'tile') playSound('tilePlacement');
    else if (move.type === 'piece') playSound('piecePlacement');
    else playSound('move');
    const steps = flightPath ? flightPath.length - 1 : 0;
    const flight = steps ? Math.min(180 + 150 * steps, 820) : 0;
    for (const c of captured) {
      playSound('capture', steps ? Math.max(0, flight * Math.min(1, c.step / steps) - 80) : 60);
    }
    if (result) playSound('gameEnd', 420);

    refresh();
  }

  /** Re-read the room, after a refused move or a reconnection. */
  async function syncFromServer() {
    try {
      const view = await request('hx:sync', { code: net.code });
      if (!view.ok) { net.error = view.error; refresh(); return; }
      adoptRoom(view);
    } catch {
      net.error = 'OFFLINE';
      refresh();
    }
  }

  /**
   * Rebuild the whole game from the server's move list.
   *
   * The room hands over the ordered moves, so a player who joins late — or
   * comes back after a dropped connection — can still walk through everything
   * that happened before they arrived.
   */
  function replayTimeline(intents) {
    const line = [];
    const position = createState();
    line.push(cloneState(position));
    for (const intent of intents || []) {
      /* What the server sends is an intent, not a move: a jump names the
         squares it visits and says nothing about what it takes. Ask the
         position which legal move that describes, exactly as the server does
         when it accepts one. */
      const move = findLegalMove(position, intent);
      if (!move) break;
      applyMove(position, move);
      line.push(cloneState(position));
    }
    return line;
  }

  function adoptRoom(view) {
    if (view.colour !== undefined && view.colour !== null && view.colour >= 0) net.colour = view.colour;
    state = deserializeState(view.state);
    moveLog = (view.notations || []).map((text, i) => ({
      player: i % 2, text, captured: /×/.test(text),
    }));
    timelineMoves = (view.moves || []).slice();
    timeline = replayTimeline(timelineMoves);
    if (timeline.length === timelineMoves.length + 1) {
      // Whatever the replay produced, the live position is the server's.
      timeline[timeline.length - 1] = cloneState(state);
    } else {
      // The replay could not follow the move list. Rather than offer a review
      // that lies, offer none: the live position is still exactly right.
      timeline = [cloneState(state)];
      timelineMoves = [];
    }
    if (review !== null && review >= timeline.length) review = null;
    lastMove = null;
    net.chat = (view.chat || []).slice();
    net.rematchOffered = view.rematchOfferedBy !== null && view.rematchOfferedBy !== undefined
      && view.rematchOfferedBy !== net.colour;
    if (view.rematchCode) net.rematchCode = view.rematchCode;
    result = view.result ? readResult(view.result) : null;
    resultSeen = false;
    net.opponentPresent = Boolean(view.seats && view.seats[1 - net.colour]);
    net.rated = Boolean(view.rated);
    net.people = view.players || [null, null];
    net.awaiting = view.awaitingReturn
      ? { seat: view.awaitingReturn.seat, until: Date.now() + view.awaitingReturn.msLeft }
      : null;
    net.ready = true;
    net.error = null;
    adoptClock(view.clock);
    clearEffect();
    refresh();
  }

  async function sendIntent(move, noFly) {
    net.pending = true;
    net.noFly = Boolean(noFly);
    net.error = null;
    selected = null;
    chain = null;
    picker = null;
    placeMode = null;
    refresh();
    let response;
    try {
      response = await request('hx:move', { code: net.code, intent: moveIntent(move) });
    } catch {
      response = { ok: false, error: 'OFFLINE' };
    }
    net.pending = false;
    if (!response.ok) {
      net.error = response.error;
      net.noFly = false;
      // The server refused: whatever we thought the position was, it is wrong.
      await syncFromServer();
      return;
    }
    // The accepted move arrives through the hx:moved broadcast, which the
    // server sends to the whole room including us, so there is nothing to
    // apply here — only the pending flag to clear.
    refresh();
  }

  /**
   * Take our seat in the room, as ourselves.
   *
   * Identifying first is what makes the game rated — and, in a game we were
   * paired into, is what proves the reserved seat is ours.
   */
  async function claimSeat() {
    try {
      await connect();
      await identify(sessionToken()).catch(() => {});
      const view = await request('hx:join', { code: net.code });
      if (!view.ok) { net.error = view.error; net.ready = false; refresh(); return; }
      adoptRoom(view);
    } catch {
      net.error = 'OFFLINE';
      refresh();
    }
  }

  async function joinRoom() {
    await claimSeat();

    net.unsubscribe.push(listen('hx:moved', (payload) => {
      if (!net || payload.code !== net.code) return;
      applyRemote(payload);
    }));
    net.unsubscribe.push(listen('hx:ended', (payload) => {
      if (!net || payload.code !== net.code) return;
      result = readResult(payload.result);
      adoptClock(payload.clock);
      net.awaiting = null;
      refresh();
    }));
    net.unsubscribe.push(listen('hx:seats', (payload) => {
      if (!net || payload.code !== net.code) return;
      net.people = payload.players || [null, null];
      net.rated = Boolean(payload.rated);
      refresh();
    }));
    net.unsubscribe.push(listen('hx:rated', (payload) => {
      if (!net || payload.code !== net.code) return;
      net.ratings = payload.ratings || null;
      renderResult();
    }));
    net.unsubscribe.push(listen('hx:chat', (payload) => {
      if (!net || payload.code !== net.code) return;
      net.chat.push(payload.message);
      // Somebody else's message, with the tab closed: mark it and chime once.
      if (payload.message.seat !== net.colour && !(drawerOpen && drawerTab === 'chat')) {
        net.unread++;
        playSound('ui');
      }
      renderChat();
    }));
    net.unsubscribe.push(listen('hx:rematch:offer', (payload) => {
      if (!net || payload.code !== net.code) return;
      net.rematchOffered = true;
      net.rematchDeclined = false;
      playSound('ui');
      // An offer is worth seeing even if the card was put away.
      resultSeen = false;
      refresh();
    }));
    net.unsubscribe.push(listen('hx:rematch:declined', (payload) => {
      if (!net || payload.code !== net.code) return;
      net.rematchAsked = false;
      net.rematchDeclined = true;
      refresh();
    }));
    net.unsubscribe.push(listen('hx:rematch:ready', (payload) => {
      if (!net || payload.code !== net.code) return;
      goToRematch(payload.next);
    }));
    net.unsubscribe.push(listen('hx:opponent', (payload) => {
      if (!net || payload.code !== net.code) return;
      if (payload.seat === net.colour) return;
      adoptClock(payload.clock);
      net.opponentPresent = payload.joined;
      net.awaiting = payload.joined || payload.msLeft == null
        ? null
        : { seat: payload.seat, until: Date.now() + payload.msLeft };
      refresh();
    }));
    /* A dropped socket comes back with a new id, and the server freed our seat
       when the old one died. Asking for the position again would leave us
       watching our own game while the abandonment countdown ran, so take the
       seat back instead — hx:join is also how the countdown is called off. */
    net.unsubscribe.push(listen('connect', () => { if (net) claimSeat(); }));
  }

  async function resign() {
    if (!net || result) return;
    if (!window.confirm(t('online.confirmResign'))) return;
    try { await request('hx:resign', { code: net.code }); } catch { net.error = 'OFFLINE'; }
    refresh();
  }

  /**
   * Ask for another game, or take up the offer already on the table.
   *
   * One event does both, so the button says what it will do rather than the
   * player having to know whose turn it is to ask.
   */
  async function askRematch() {
    if (!net || !result) return;
    net.rematchDeclined = false;
    let response;
    try {
      response = await request('hx:rematch', { code: net.code });
    } catch {
      net.error = 'OFFLINE';
      refresh();
      return;
    }
    if (!response.ok) { net.error = response.error; refresh(); return; }
    if (response.ready && response.code) { goToRematch(response.code); return; }
    net.rematchAsked = true;
    refresh();
  }

  function goToRematch(code) {
    if (!net || net.rematchCode === code) return;
    net.rematchCode = code;
    playSound('ui');
    navigate('play', { online: '1', code });
  }

  /* ── Rendering ────────────────────────────────────────────────────────── */

  function refresh(instant) {
    /* Everything below draws `position`, which is the game itself while the
       player is watching it and a past ply while they are reading back. */
    const position = shownState();
    const reviewing = review !== null;
    const player = position.turn;
    const human = !result && !thinking && canAct();
    const dragging = !!(drag && drag.active);
    const idle = human && !chain && !picker && selected === null && !placeMode && !dragging;
    const aid = getSetting('showValidMoves');
    const spots = reviewing ? [] : tilePlacementSpots(chain ? chain.preview : state);
    const source = chain ? chain.preview : position;

    const targets = new Map();
    if (human) {
      if (placeMode === 'disk' || placeMode === 'ring') {
        for (const k of source.tileKeys) {
          if (source.tileAt[k] === player && source.pieceAt[k] < 0) targets.set(k, { kind: 'place' });
        }
      } else if (chain) {
        for (const jump of availableJumps(chain.preview, chain.current, player, chain.visited, chain.visitedFrom)) {
          targets.set(jump.land, { kind: jump.capture ? 'capture' : 'move' });
        }
      } else if (selected !== null) {
        collectDestinations(selected, targets);
      }
    }

    const canPlacePiece = human
      && (state.diskReserve[player] > 0 || (state.ringReserve[player] > 0 && state.capturedDisks[player] > 0));
    const hints = new Set();
    if (idle && canPlacePiece) {
      for (const k of source.tileKeys) {
        if (source.tileAt[k] === player && source.pieceAt[k] < 0) hints.add(k);
      }
    }
    const movable = new Set();
    if (human && !placeMode && !chain) {
      for (const k of source.tileKeys) {
        const code = source.pieceAt[k];
        if (code >= 0 && pieceOwner(code) === player) movable.add(k);
      }
    }

    /* The move that produced what is on screen: the game's last move while
       watching, and the reviewed ply's own move while reading back. */
    const marked = reviewing ? (review > 0 ? timelineMoves[review - 1] : null) : lastMove;
    const lastMoveCells = [];
    if (marked && !chain) {
      if (marked.type === 'tile' || marked.type === 'piece') lastMoveCells.push(marked.cell);
      else if (marked.type === 'disk') lastMoveCells.push(marked.path[0], marked.path[marked.path.length - 1]);
      else lastMoveCells.push(marked.from, marked.to);
    }

    board.render({
      state: source,
      spots,
      spotsLive: human && !chain && !dragging && position.tileReserve[player] > 0
        && (placeMode === 'tile' || idle),
      placeMode,
      targets,
      hints,
      movable,
      selected,
      chainPath: chain ? chain.path : [],
      chainCurrent: chain ? chain.current : null,
      chainPiece: makePiece(player, DISK),
      lastMoveCells: [...new Set(lastMoveCells)],
      picker: picker ? {
        cell: picker.cell,
        options: picker.options,
        pieceCode: (option) => makePiece(player, option === 'ring' ? RING : DISK),
      } : null,
      hidden: !reviewing && effect && effect.hidden != null ? effect.hidden : -1,
      held: dragging ? drag.cell : -1,
      newTile: !reviewing && effect ? effect.newTile : null,
      newPiece: !reviewing && effect ? effect.newPiece : null,
      showValidMoves: aid,
      instant: instant || board.__firstFrame,
    });
    board.__firstFrame = false;
    gameEl.classList.toggle('is-reviewing', reviewing);

    renderRails(position, reviewing);
    renderChainBar();
    renderResult();
    renderMoveList();
    renderReviewBar();
    renderChat();
    renderNetStatus();
    syncTools();
    tickClocks();
    runEffect();
  }

  function collectDestinations(cell, targets) {
    const player = state.turn;
    const code = state.pieceAt[cell];
    if (pieceType(code) === DISK) {
      for (let i = 0; i < 6; i++) {
        const n = cell + STEP[i];
        if (inBoard(n) && state.tileAt[n] >= 0 && state.pieceAt[n] < 0) targets.set(n, { kind: 'move' });
      }
      for (const jump of availableJumps(withPieceLifted(state, cell), cell, player, [cell], 0)) {
        targets.set(jump.land, { kind: jump.capture ? 'capture' : 'move' });
      }
    } else {
      for (let i = 0; i < 12; i++) {
        const to = cell + RING_OFFSETS[i];
        if (!inBoard(to) || state.tileAt[to] < 0) continue;
        const occupant = state.pieceAt[to];
        if (occupant >= 0 && pieceOwner(occupant) === player) continue;
        targets.set(to, { kind: occupant >= 0 ? 'capture' : 'move' });
      }
    }
  }

  function runEffect() {
    if (!effect || effect.played) return;
    /* A move that lands while the player is reading back has no board to play
       on. The position is recorded either way; only the animation is lost. */
    if (review !== null) { effect = null; return; }
    effect.played = true;
    const total = board.playEffects(effect, () => { effect = null; refresh(); });
    effectEndsAt = Date.now() + total;
  }

  /* Reserves drawn as real pieces: solid means available, dashed means spent. */
  function tokenSvg(kind, colour) {
    if (kind === 'tile') return miniBoardSvg({ tiles: [[0, 0, colour]] });
    const type = kind === 'ring' ? RING : DISK;
    return `<svg viewBox="${-SIZE * .8} ${-SIZE * .8} ${SIZE * 1.6} ${SIZE * 1.6}"`
      + ` xmlns="http://www.w3.org/2000/svg">${pieceSvg(0, 0, makePiece(colour, type), .78)}</svg>`;
  }

  function emptySlotSvg(kind) {
    const r = kind === 'disk' ? SIZE * .42 : SIZE * .55;
    const shape = kind === 'tile'
      ? `<path d="${hexPath(0, 0, SIZE * .9)}" fill="none"`
      : `<circle r="${r}" fill="none"`;
    return `<svg viewBox="${-SIZE} ${-SIZE} ${SIZE * 2} ${SIZE * 2}" xmlns="http://www.w3.org/2000/svg">`
      + `${shape} stroke="var(--muted)" stroke-opacity=".35" stroke-width="4" stroke-dasharray="9 7"/></svg>`;
  }

  function stackHtml(kind, colour, total, available, usable) {
    let out = '<div class="stack">';
    for (let i = 0; i < total; i++) {
      const filled = i < available;
      const classes = ['token'];
      if (filled && usable) classes.push('is-usable');
      if (filled && usable && placeMode === kind) classes.push('is-armed');
      out += `<span class="${classes.join(' ')}"${filled && usable ? ` data-arm="${kind}"` : ''}>`
        + (filled ? tokenSvg(kind, colour) : emptySlotSvg(kind)) + '</span>';
    }
    return out + '</div>';
  }

  /** The reserves, for whichever position is on screen. */
  function renderRails(position, reviewing) {
    for (let player = 0; player < 2; player++) {
      const rail = rails[player];
      const opponent = 1 - player;
      const isTurn = !result && position.turn === player;
      const live = !reviewing && isTurn && !thinking && !chain && !picker
        && (net ? (player === net.colour && canAct()) : !isAI(player));
      let freeOwnTiles = 0;
      for (const k of position.tileKeys) {
        if (position.tileAt[k] === player && position.pieceAt[k] < 0) freeOwnTiles++;
      }
      rail.innerHTML =
        `<div class="player-dot${player === WHITE ? ' is-white' : ''}"`
        + ` title="${colourName(player)} — ${isAI(player) ? 'IA' : ''}"></div>`
        + (net && net.clock ? `<div class="clock" data-clock="${player}">${formatClock(remainingFor(player))}</div>` : '')
        + stackHtml('tile', player, TILES_PER_PLAYER, position.tileReserve[player],
          live && tilePlacementSpots(position).length > 0)
        + stackHtml('disk', player, DISKS_PER_PLAYER, position.diskReserve[player], live && freeOwnTiles > 0)
        + stackHtml('ring', player, RINGS_PER_PLAYER, position.ringReserve[player],
          live && freeOwnTiles > 0 && position.capturedDisks[player] > 0)
        + '<div class="rail-sep"></div>'
        + stackHtml('disk', opponent, DISKS_PER_PLAYER, position.capturedDisks[player], false)
        + stackHtml('ring', opponent, RINGS_PER_PLAYER, position.capturedRings[player], false);
      rail.classList.toggle('is-turn', isTurn && !reviewing);
      rail.classList.toggle('is-thinking', isTurn && thinking && !reviewing);
    }
  }

  function renderChainBar() {
    chainBar.classList.toggle('is-on', !!chain);
    if (!chain) return;
    chainBar.querySelector('.taken').innerHTML = chain.captures.length
      ? chain.captures.map((c) =>
        `<span class="token">${tokenSvg(pieceType(c.code) === RING ? 'ring' : 'disk', pieceOwner(c.code))}</span>`).join('')
      : `<span style="color:var(--muted);padding:0 4px">⋯</span>`;
  }

  /**
   * The end-of-game card.
   *
   * Dismissable on purpose: the board underneath is the thing people actually
   * want to look at once the game is over, and a modal that cannot be closed
   * is a modal that gets in the way of every review.
   */
  function renderResult() {
    overlay.classList.toggle('is-on', !!result && !resultSeen);
    if (!result || resultSeen) return;
    overlay.querySelector('.result-title').innerHTML = result.draw
      ? `<span style="color:var(--muted)">${t('result.draw')}</span>`
      : `<span class="player-dot${result.winner === WHITE ? ' is-white' : ''}"></span>`
        + t('result.wins', { colour: colourName(result.winner) });
    overlay.querySelector('.result-why').textContent = resultWhy(result);

    /* A rated game moved two ratings; show the player what theirs did. */
    const stake = overlay.querySelector('.result-rating');
    const mine = net && net.ratings && net.colour !== null ? net.ratings[net.colour] : null;
    if (!mine) { stake.textContent = ''; stake.className = 'result-rating'; }
    else {
      const sign = mine.change > 0 ? '+' : '';
      stake.textContent = `${t('online.ratingChange')} ${mine.after} (${sign}${mine.change})`;
      stake.className = `result-rating ${mine.change > 0 ? 'is-up' : (mine.change < 0 ? 'is-down' : '')}`;
    }

    const note = overlay.querySelector('.result-note');
    note.textContent = !net ? ''
      : (net.rematchDeclined ? t('result.rematchDeclined')
        : (net.rematchAsked ? t('result.rematchWaiting')
          : (net.rematchOffered ? t('result.rematchOffered') : '')));

    overlay.querySelector('.result-actions').innerHTML = resultActions();
  }

  function resultActions() {
    const viewButton = `<button class="btn" data-action="review-game">${t('result.viewGame')}</button>`;
    const menu = `<button class="btn" data-action="menu">${t('nav.backToMenu')}</button>`;
    if (!net) {
      return `<button class="btn btn--primary" data-action="new">${t('result.rematch')}</button>`
        + viewButton + menu;
    }
    // Online, a rematch is a request, not a decision: the wording says which.
    const label = net.rematchOffered ? t('result.rematchAccept')
      : (net.rematchAsked ? t('result.rematchWaiting') : t('result.rematch'));
    return `<button class="btn btn--primary" data-action="rematch"${net.rematchAsked ? ' disabled' : ''}>`
      + `${label}</button>`
      + viewButton
      + `<button class="btn" data-action="new-online">${t('result.newOpponent')}</button>`
      + menu;
  }

  /* ── Review ───────────────────────────────────────────────────────────── */

  function goToPly(index) {
    const last = timeline.length - 1;
    const target = Math.max(0, Math.min(last, index));
    review = target >= last ? null : target;
    selected = null;
    chain = null;
    picker = null;
    placeMode = null;
    clearEffect();
    refresh(true);
  }

  function stepReview(delta) {
    const current = review === null ? timeline.length - 1 : review;
    goToPly(current + delta);
  }

  function renderReviewBar() {
    // Nothing to look back on until a move has been played.
    const usable = timeline.length > 1;
    reviewBar.classList.toggle('is-on', usable);
    if (!usable) return;
    const last = timeline.length - 1;
    const at = review === null ? last : review;
    reviewBar.querySelector('[data-field="ply"]').textContent = `${at} / ${last}`;
    reviewBar.querySelector('[data-action="rev-first"]').disabled = at === 0;
    reviewBar.querySelector('[data-action="rev-prev"]').disabled = at === 0;
    reviewBar.querySelector('[data-action="rev-next"]').disabled = at === last;
    reviewBar.querySelector('[data-action="rev-last"]').disabled = at === last;
    reviewBar.classList.toggle('is-back', review !== null);
  }

  const escapeText = (value) => String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Each half-move is a link into the review: click it and the board goes there. */
  function renderMoveList() {
    if (!drawerOpen || drawerTab !== 'moves') return;
    const at = review === null ? timeline.length - 1 : review;
    const cell = (entry, ply, extra) => {
      if (!entry) return '<span></span>';
      const classes = [extra, entry.captured ? 'took' : '', ply === at ? 'is-at' : '']
        .filter(Boolean).join(' ');
      return `<span class="ply ${classes}" data-ply="${ply}">${entry.text}</span>`;
    };
    let out = '';
    for (let i = 0; i < moveLog.length; i += 2) {
      out += `<div><span class="n">${i / 2 + 1}.</span>`
        + cell(moveLog[i], i + 1, 'black')
        + cell(moveLog[i + 1], i + 2, '') + '</div>';
    }
    moveListEl.innerHTML = out || `<div style="color:var(--muted)">${t('game.noMoves')}</div>`;
    const current = moveListEl.querySelector('.is-at');
    if (current) current.scrollIntoView({ block: 'nearest' });
    else moveListEl.scrollTop = moveListEl.scrollHeight;
  }

  /* ── Chat ─────────────────────────────────────────────────────────────── */

  function renderChat() {
    const chatTab = outlet.querySelector('[data-tab="chat"]');
    // There is nobody to talk to in a local game.
    chatTab.style.display = net ? '' : 'none';
    chatTab.classList.toggle('has-unread', Boolean(net && net.unread));
    if (!net || !drawerOpen || drawerTab !== 'chat') return;

    const mine = (message) => message.seat === net.colour;
    chatLogEl.innerHTML = net.chat.length
      ? net.chat.map((message) =>
        `<div class="chat-line${mine(message) ? ' is-mine' : ''}">`
        + `<span class="chat-who">${escapeText(message.name || colourName(message.seat))}</span>`
        + `<span class="chat-text">${escapeText(message.text)}</span></div>`).join('')
      : `<div style="color:var(--muted)">${t('chat.empty')}</div>`;
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }

  async function sendChat(text) {
    if (!net || !text.trim()) return;
    try {
      const response = await request('hx:chat', { code: net.code, text });
      // A message the server refused should not look sent.
      if (!response.ok && response.error !== 'TOO_FAST') { net.error = response.error; refresh(); }
    } catch { /* the next message is the player's own retry */ }
  }

  function showDrawerTab(name) {
    drawerTab = name;
    for (const tab of outlet.querySelectorAll('.drawer-tab')) {
      tab.classList.toggle('is-active', tab.getAttribute('data-tab') === name);
    }
    moveListEl.style.display = name === 'moves' ? '' : 'none';
    chatPane.style.display = name === 'chat' ? '' : 'none';
    if (name === 'chat' && net) net.unread = 0;
    renderMoveList();
    renderChat();
    if (name === 'chat') chatInput.focus();
  }

  function syncTools() {
    const isDuel = mode === MODE_AI_AI;
    const show = (selector, visible) => {
      const node = tools.querySelector(selector);
      if (node) node.style.display = visible ? '' : 'none';
    };
    tools.querySelector('[data-control="mode"]').value = mode;
    // Online, none of the local controls apply: no mode, no AI, no undo.
    show('[data-control="mode"]', !net);
    show('[data-control="side"]', !net && mode === MODE_AI);
    show('[data-control="level"]', !net && mode !== MODE_LOCAL);
    show('[data-action="run"]', !net && isDuel);
    show('[data-action="step"]', !net && isDuel);
    show('[data-action="undo"]', !net);
    show('[data-action="new"]', !net);
    show('[data-action="resign"]', !!net);

    const run = tools.querySelector('[data-action="run"]');
    run.textContent = aiRunning ? '⏸' : '▶';
    run.classList.toggle('is-on', aiRunning);
    tools.querySelector('[data-action="step"]').disabled = thinking || !!result || aiRunning;
    // Undoing while reading back would rewrite the game under the review.
    tools.querySelector('[data-action="undo"]').disabled =
      thinking || !history.length || review !== null;
    const resignButton = tools.querySelector('[data-action="resign"]');
    if (resignButton) resignButton.disabled = !net || !net.ready || !!result;
  }

  /** The strip above the board that explains the state of an online game. */
  function renderNetStatus() {
    const strip = outlet.querySelector('.net-strip');
    if (!net) { strip.classList.remove('is-on'); return; }
    strip.classList.add('is-on');

    let message;
    let tone = '';
    if (net.error) {
      message = t('online.errors.' + net.error) === 'online.errors.' + net.error
        ? t('online.errors.OFFLINE') : t('online.errors.' + net.error);
      tone = 'is-warn';
    } else if (!net.ready) {
      message = t('online.connecting');
    } else if (net.awaiting) {
      const left = Math.max(0, Math.ceil((net.awaiting.until - Date.now()) / 1000));
      message = `${t('online.opponentLeft')} — ${left}s`;
      tone = 'is-warn';
    } else if (review !== null) {
      message = t('review.reviewing');
    } else if (!net.opponentPresent && !result) {
      message = t('online.waiting');
    } else if (result) {
      message = '';
    } else {
      message = state.turn === net.colour ? t('game.yourTurn') : t('game.turnOf', { colour: colourName(state.turn) });
    }

    /* Who is on the other side, and whether anything is at stake. */
    const other = net.people && net.colour !== null ? net.people[1 - net.colour] : null;
    const opponentLabel = other
      ? `<span class="net-vs">${escapeText(other.pseudo)}<span class="net-elo">${other.elo}</span></span>`
      : '';
    const stakeLabel = net.rated
      ? `<span class="net-stake is-rated" title="${t('online.rated')}">${t('online.rated')}</span>`
      : `<span class="net-stake" title="${t('online.signInToRate')}">${t('online.unrated')}</span>`;

    strip.className = `net-strip is-on ${tone}`;
    strip.innerHTML =
      `<span class="player-dot${net.colour === WHITE ? ' is-white' : ''}"></span>`
      + `<span>${net.colour === null ? '' : t('online.youAre', { colour: colourName(net.colour) })}</span>`
      + opponentLabel
      + `<span class="net-msg">${message}</span>`
      + `<span class="grow"></span>`
      + stakeLabel
      + `<code class="room-code room-code--sm">${net.code}</code>`
      + `<button class="btn btn--icon" data-action="copy-link" title="${t('online.copyLink')}">⧉</button>`;

    // Keep the abandonment countdown ticking without redrawing the board.
    clearInterval(countdownTimer);
    if (net.awaiting) {
      countdownTimer = setInterval(() => {
        if (!net || !net.awaiting) { clearInterval(countdownTimer); return; }
        const left = Math.max(0, Math.ceil((net.awaiting.until - Date.now()) / 1000));
        const label = strip.querySelector('.net-msg');
        if (label) label.textContent = `${t('online.opponentLeft')} — ${left}s`;
        if (left <= 0) clearInterval(countdownTimer);
      }, 500);
    }
  }

  /* ── Interaction ──────────────────────────────────────────────────────── */

  function openPicker(cell) {
    const player = state.turn;
    const options = [];
    if (state.diskReserve[player] > 0) options.push('disk');
    if (state.ringReserve[player] > 0 && state.capturedDisks[player] > 0) options.push('ring');
    if (!options.length) return false;
    // With a single legal piece there is nothing to choose: place it.
    if (options.length === 1) {
      commit({ type: 'piece', cell, piece: options[0] === 'ring' ? RING : DISK });
      return true;
    }
    picker = { cell, options };
    selected = null;
    refresh();
    return true;
  }

  function takeJump(jump, byDrag) {
    const preview = chain.preview;
    const from = chain.current;
    if (byDrag) chain.noFly = true;
    if (jump.capture) {
      preview.pieceAt[jump.capture.cell] = -1;
      chain.captures.push(jump.capture);
    }
    chain.path.push(jump.land);
    chain.visited.push(jump.land);
    if (jump.capture) chain.visitedFrom = chain.visited.length - 1;
    chain.current = jump.land;

    const more = availableJumps(preview, chain.current, state.turn, chain.visited, chain.visitedFrom).length > 0;
    if (!more) { finishChain(byDrag, from, jump.capture); return; }

    chain.shown = true;
    clearEffect();
    if (!byDrag) {
      effect = {
        path: [from, jump.land],
        code: makePiece(state.turn, DISK),
        captured: jump.capture ? [{ cell: jump.capture.cell, code: jump.capture.code, step: 1 }] : [],
        newTile: null,
        newPiece: null,
        hidden: jump.land,
      };
      playSound('move');
      if (jump.capture) playSound('capture', 200);
    }
    refresh();
  }

  function finishChain(byDrag, from, lastCapture) {
    const current = chain;
    const move = { type: 'disk', path: current.path.slice(), captures: current.captures.slice() };
    chain = null;
    if (current.shown) {
      // Earlier hops are already on screen; animate only the final one.
      commit(move, byDrag || current.noFly,
        from === undefined ? null : [from, move.path[move.path.length - 1]],
        lastCapture ? [lastCapture] : []);
    } else {
      commit(move, byDrag || current.noFly);
    }
  }

  function startChain(from) {
    const preview = withPieceLifted(state, from);
    chain = {
      preview, current: from, path: [from], captures: [],
      visited: [from], visitedFrom: 0, noFly: false, shown: false,
    };
  }

  function onCell(cell, pieceChoice) {
    // Reading back through the game is a view, never a move.
    if (review !== null || result || thinking || isAI(state.turn)) return;
    const player = state.turn;
    const isMine = (k) => state.pieceAt[k] >= 0 && pieceOwner(state.pieceAt[k]) === player;
    const isFreeOwnTile = (k) => state.tileAt[k] === player && state.pieceAt[k] < 0;

    if (picker) {
      if (pieceChoice) {
        commit({ type: 'piece', cell: picker.cell, piece: pieceChoice === 'ring' ? RING : DISK });
        return;
      }
      const previous = picker.cell;
      picker = null;
      if (cell !== previous && isFreeOwnTile(cell) && openPicker(cell)) return;
      if (isMine(cell)) selected = cell;
      refresh();
      return;
    }

    if (placeMode === 'tile') {
      if (state.tileAt[cell] < 0 && tilePlacementSpots(state).includes(cell)) commit({ type: 'tile', cell });
      else { placeMode = null; refresh(); }
      return;
    }
    if (placeMode === 'disk' || placeMode === 'ring') {
      if (isFreeOwnTile(cell)) commit({ type: 'piece', cell, piece: placeMode === 'ring' ? RING : DISK });
      else { placeMode = null; refresh(); }
      return;
    }

    if (chain) {
      const jump = availableJumps(chain.preview, chain.current, player, chain.visited, chain.visitedFrom)
        .find((j) => j.land === cell);
      if (jump) takeJump(jump);
      else if (cell === chain.current) finishChain();
      return;
    }

    if (selected !== null) {
      if (tryMove(selected, cell, false)) return;
      selected = isMine(cell) && cell !== selected ? cell : null;
      refresh();
      return;
    }

    if (isMine(cell)) { selected = cell; refresh(); return; }
    if (state.tileAt[cell] < 0) {
      if (state.tileReserve[player] > 0 && tilePlacementSpots(state).includes(cell)) {
        commit({ type: 'tile', cell });
      }
      return;
    }
    if (isFreeOwnTile(cell)) openPicker(cell);
  }

  /** Attempt to move the piece on `from` to `to`. Returns true if a move began. */
  function tryMove(from, to, byDrag) {
    const player = state.turn;
    const code = state.pieceAt[from];
    if (pieceType(code) === DISK) {
      for (let i = 0; i < 6; i++) {
        if (from + STEP[i] === to && state.tileAt[to] >= 0 && state.pieceAt[to] < 0) {
          commit({ type: 'disk', path: [from, to], captures: [] }, byDrag);
          return true;
        }
      }
      const lifted = withPieceLifted(state, from);
      const jump = availableJumps(lifted, from, player, [from], 0).find((j) => j.land === to);
      if (jump) { startChain(from); takeJump(jump, byDrag); return true; }
    } else {
      for (let i = 0; i < 12; i++) {
        if (from + RING_OFFSETS[i] !== to || state.tileAt[to] < 0) continue;
        const occupant = state.pieceAt[to];
        if (occupant >= 0 && pieceOwner(occupant) === player) break;
        commit({
          type: 'ring', from, to,
          capture: occupant >= 0 ? { cell: to, code: occupant } : null,
        }, byDrag);
        return true;
      }
    }
    return false;
  }

  /* Pointer: a short press is a click, a longer travel becomes a drag. */
  board.svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const target = event.target.closest('[data-cell]');
    if (!target) {
      if (picker || selected !== null || placeMode) {
        picker = null; selected = null; placeMode = null; refresh();
      }
      return;
    }
    drag = {
      cell: Number(target.getAttribute('data-cell')),
      piece: target.getAttribute('data-piece'),
      x0: event.clientX, y0: event.clientY, active: false,
    };
    try { board.svg.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
  });

  board.svg.addEventListener('pointermove', (event) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.abs(event.clientX - drag.x0) + Math.abs(event.clientY - drag.y0) < 7) return;
      if (!beginDrag()) { drag = null; return; }
    }
    const point = board.toUserSpace(event.clientX, event.clientY);
    drag.flyer.setAttribute('transform',
      `translate(${(point.x - drag.originX).toFixed(1)},${(point.y - drag.originY).toFixed(1)})`);
  });

  board.svg.addEventListener('pointerup', (event) => {
    const current = drag;
    drag = null;
    if (!current) return;
    if (!current.active) { onCell(current.cell, current.piece); return; }
    board.clearEffects();
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const target = under && under.closest ? under.closest('[data-cell]') : null;
    const cell = target ? Number(target.getAttribute('data-cell')) : -1;
    if (cell >= 0 && cell !== current.cell) dropOn(cell);
    else refresh();
  });

  board.svg.addEventListener('pointercancel', () => {
    if (drag && drag.active) board.clearEffects();
    drag = null;
    refresh();
  });

  function beginDrag() {
    if (review !== null || result || thinking || isAI(state.turn)) return false;
    const cell = drag.cell;
    const player = state.turn;
    let code;
    if (chain) {
      if (cell !== chain.current) return false;
      code = makePiece(player, DISK);
    } else if (!picker && !placeMode
      && state.pieceAt[cell] >= 0 && pieceOwner(state.pieceAt[cell]) === player) {
      code = state.pieceAt[cell];
      selected = cell;
    } else {
      return false;
    }
    drag.active = true;
    drag.originX = cx(cell);
    drag.originY = cy(cell);
    clearEffect();
    refresh();
    drag.flyer = board.beginDrag(cell, code);
    return true;
  }

  function dropOn(cell) {
    if (chain) {
      const jump = availableJumps(chain.preview, chain.current, state.turn, chain.visited, chain.visitedFrom)
        .find((j) => j.land === cell);
      if (jump) takeJump(jump, true); else refresh();
      return;
    }
    if (selected === null) { refresh(); return; }
    if (!tryMove(selected, cell, true)) refresh();
  }

  /* Reserves: choose which kind of piece to place. */
  gameEl.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) { playSound('ui'); showDrawerTab(tab.getAttribute('data-tab')); return; }

    const ply = event.target.closest('[data-ply]');
    if (ply) { goToPly(Number(ply.getAttribute('data-ply'))); return; }

    const token = event.target.closest('[data-arm]');
    if (!token) return;
    const kind = token.getAttribute('data-arm');
    placeMode = placeMode === kind ? null : kind;
    selected = null;
    picker = null;
    playSound('ui');
    refresh();
  });

  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = chatInput.value;
    chatInput.value = '';
    sendChat(text);
  });

  /* ── Controls ─────────────────────────────────────────────────────────── */

  function onToolClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    playSound('ui');
    if (action === 'undo') undoLast();
    else if (action === 'new') { if (net) { navigate('online'); return; } aiRunning = false; newGame(); }
    else if (action === 'new-online') navigate('online');
    else if (action === 'menu') navigate('home');
    else if (action === 'resign') resign();
    else if (action === 'review-game') { resultSeen = true; goToPly(0); }
    else if (action === 'rematch') askRematch();
    else if (action === 'rev-first') goToPly(0);
    else if (action === 'rev-prev') stepReview(-1);
    else if (action === 'rev-next') stepReview(1);
    else if (action === 'rev-last') goToPly(timeline.length - 1);
    else if (action === 'rev-live') goToPly(timeline.length - 1);
    else if (action === 'copy-link' && net) {
      navigator.clipboard.writeText(inviteLink(net.code)).catch(() => {});
      button.textContent = '✓';
      setTimeout(() => { button.textContent = '⧉'; }, 1200);
    }
    else if (action === 'run') { aiRunning = !aiRunning; refresh(); if (aiRunning) scheduleAI(); }
    else if (action === 'step') stepAI();
    else if (action === 'drawer') {
      drawerOpen = !drawerOpen;
      drawer.classList.toggle('is-on', drawerOpen);
      buildDrawerButton();
      showDrawerTab(drawerTab);
    }
    else if (action === 'end-jump') { if (chain) finishChain(); }
    else if (action === 'cancel-jump') { chain = null; selected = null; clearEffect(); refresh(); }
  }

  function onToolChange(event) {
    const control = event.target.closest('[data-control]');
    if (!control) return;
    const name = control.getAttribute('data-control');
    if (name === 'mode') { mode = control.value; aiRunning = false; newGame(); }
    else if (name === 'side') { humanSide = Number(control.value); newGame(); }
    else if (name === 'level') { level = Number(control.value); setSetting('aiLevel', level); refresh(); }
  }

  function onKey(event) {
    // Never steal a keystroke meant for the chat box.
    if (event.target && event.target.closest && event.target.closest('input, textarea')) {
      if (event.key === 'Escape') event.target.blur();
      return;
    }
    if (event.key === 'Escape') {
      if (review !== null) { goToPly(timeline.length - 1); return; }
      if (drawerOpen) { drawerOpen = false; drawer.classList.remove('is-on'); return; }
      selected = null; chain = null; placeMode = null; picker = null; clearEffect(); refresh();
    } else if (event.key === 'Enter' && chain) {
      finishChain();
    } else if (event.key === 'ArrowLeft') { event.preventDefault(); stepReview(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); stepReview(1); }
    else if (event.key === 'Home') { event.preventDefault(); goToPly(0); }
    else if (event.key === 'End') { event.preventDefault(); goToPly(timeline.length - 1); }
    else if ((event.key === 'z' || event.key === 'Z') && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      undoLast();
    }
  }

  tools.addEventListener('click', onToolClick);
  tools.addEventListener('change', onToolChange);
  toolsRight.addEventListener('click', onToolClick);
  outlet.addEventListener('click', onToolClick);
  document.addEventListener('keydown', onKey);

  /* Leaving a local game in progress throws it away — ask first. Online games
     live on the server, and a finished game has nothing left to lose. */
  setLeaveGuard(() => {
    if (net || result || !history.length) return true;
    return window.confirm(t('game.confirmLeave'));
  });
  const onResize = () => refresh(true);
  window.addEventListener('resize', onResize);

  /* Settings and language can be changed from a panel floating over this very
     game, so both have to land without a remount. */
  const stopWatchingSettings = onSettingsChange((name) => {
    if (name === 'showValidMoves') refresh();
    else if (name === 'aiLevel' && !net) { level = getSetting('aiLevel'); buildTools(); refresh(); }
  });
  const stopWatchingLanguage = onLanguageChange(relabel);

  newGame();
  showDrawerTab('moves');
  if (net) {
    joinRoom();
    clockTimer = setInterval(tickClocks, 250);
  }

  /* Expose the live view for the self-test harness. */
  window.__hexaequo = {
    get state() { return state; },
    get result() { return result; },
    get chain() { return chain; },
    get picker() { return picker; },
    get placeMode() { return placeMode; },
    get selected() { return selected; },
    get history() { return history; },
    get moveLog() { return moveLog; },
    get effect() { return effect; },
    get net() { return net; },
    get review() { return review; },
    get timeline() { return timeline; },
    get shown() { return shownState(); },
    onCell, newGame, commit, refresh, board, goToPly,
    setMode: (m) => { mode = m; aiRunning = false; newGame(); },
  };

  return () => {
    clearInterval(countdownTimer);
    clearInterval(clockTimer);
    if (net) {
      for (const off of net.unsubscribe) { try { off(); } catch { /* already gone */ } }
      net = null;                       // stops in-flight handlers from touching a dead view
    }
    stopWatchingSettings();
    stopWatchingLanguage();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    // The header toolbar outlives the view, so its handlers must go with it.
    setLeaveGuard(null);
    tools.removeEventListener('click', onToolClick);
    tools.removeEventListener('change', onToolChange);
    toolsRight.removeEventListener('click', onToolClick);
    tools.innerHTML = '';
    toolsRight.innerHTML = '';
    delete window.__hexaequo;
  };
}
