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
import { STEP, RING_OFFSETS, inBoard, cellLabel } from '../game/hex.js';
import {
  BLACK, WHITE, DISK, RING, createState, cloneState, positionKey, withPieceLifted,
  applyMove, undoMove, tilePlacementSpots, pieceOwner, pieceType, makePiece,
  deserializeState,
} from '../game/state.js';
import {
  generateMoves, generateDiskMoves, availableJumps, checkWinner, moveNotation, moveIntent,
  findLegalMove,
} from '../game/moves.js';
import { chooseMove, judge, DISK_POINTS } from '../game/ai.js';
import { request, listen, connect, inviteLink, identify } from '../net.js';
import { sessionToken, api, isSignedIn, onAuthChange } from '../auth.js';
import { offerPosition, takePosition } from '../handoff.js';
import { openPanel } from '../ui/panels.js';

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
  /**
   * A move chosen during the opponent's turn, waiting for ours.
   *
   * Stored as an intent rather than a move, because the position it will be
   * played into is not the one it was chosen in. When our turn arrives the
   * intent is offered to the new position: if it still names a legal move it
   * goes, and if it does not it is quietly dropped. That is the whole promise
   * — never a move the player did not choose, never one that is not legal.
   */
  let premove = null;
  let resumedNote = false;      // this game was carried on from another one

  let timeline = [];
  let timelineMoves = [];
  let review = null;
  let playTimer = 0;          // walking the game on its own
  let playSpeed = 1;
  let resultSeen = false;          // the result card has been dismissed

  let mode = MODE_AI;
  let humanSide = BLACK;
  let level = getSetting('aiLevel');
  /* Watching two engines is only interesting if they can differ, so the duel
     keeps a level per colour rather than one for both. */
  let duelLevels = [level, level];

  const levelFor = (player) => (mode === MODE_AI_AI ? duelLevels[player] : level);

  /* Online games: the server owns the position, so this view only sends move
     intents and renders whatever comes back. `net` is null for local play. */
  /* A finished game read back from the database. Neither local nor online:
     nothing here can be played, only looked at. */
  const archiveId = params && params.get('game');
  let archive = null;

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
  const canAct = () => !archiveId && (review === null) && (net
    ? net.ready && !net.pending && state.turn === net.colour
    : !isAI(state.turn));

  /** Whether the player may line a move up while the other side thinks. */
  const canPremove = () => Boolean(
    net && net.ready && !net.pending && !result && review === null
    && net.colour !== null && state.turn !== net.colour && getSetting('premove')
  );

  /** The board as it would be if it were our turn, for choosing against. */
  function premoveBoard() {
    const hypothetical = cloneState(state);
    hypothetical.turn = net.colour;
    return hypothetical;
  }

  /** The position on screen: the game itself, or the ply being reviewed. */
  const shownState = () => (review === null ? state : timeline[review]) || state;
  const atLivePosition = () => review === null || review >= timeline.length - 1;

  /* ── Markup ───────────────────────────────────────────────────────────── */
  outlet.innerHTML = `
    <div class="game">
      <aside class="rail" data-rail="0"></aside>
      <div class="board-area">
        <div class="net-strip"></div>
        <div class="guest-note" hidden></div>
        <div class="board-host" style="flex:1;display:flex;min-width:0"></div>
        <div class="piece-picker" hidden></div>
        <div class="resume-sheet" hidden></div>
        <div class="chain-bar">
          <span class="taken"></span>
          <button class="btn btn--icon" data-action="end-jump" title="${t('game.endJump')}">✓</button>
          <button class="btn btn--icon" data-action="cancel-jump" title="${t('game.cancel')}">✕</button>
        </div>
        <div class="chat-bubble" hidden></div>
        <div class="result-overlay">
          <div class="result-card">
            <div class="result-title"></div>
            <div class="result-why"></div>
            <div class="result-rating"></div>
            <div class="result-note"></div>
            <div class="result-actions"></div>
          </div>
        </div>
        <div class="board-bar">
          <div class="bar-tools"></div>
          <div class="review-bar">
          <button class="btn btn--icon" data-action="rev-first" title="${t('review.first')}">⏮</button>
          <button class="btn btn--icon" data-action="rev-prev" title="${t('review.previous')}">◀</button>
          <span class="review-ply" data-field="ply"></span>
          <button class="btn btn--icon" data-action="rev-next" title="${t('review.next')}">▶</button>
          <button class="btn btn--icon" data-action="rev-last" title="${t('review.last')}">⏭</button>
          <button class="btn btn--icon" data-action="rev-play" title="${t('review.play')}">▶</button>
          <select class="btn review-speed" data-control="rev-speed" title="${t('review.speed')}">
            <option value="1">1×</option>
            <option value="2">2×</option>
            <option value="4">4×</option>
          </select>
          <button class="btn review-resume" data-action="resume">${t('review.resume')}</button>
          <button class="btn review-live" data-action="rev-live">${t('review.backToLive')}</button>
          </div>
          <span class="bar-gap"></span>
          <div class="bar-right"></div>
        </div>
        <div class="drawer">
          <div class="drawer-tabs">
            <button class="drawer-tab is-active" data-tab="moves">${t('game.moveList')}</button>
            <button class="drawer-tab" data-tab="chat">${t('chat.tab')}<i class="tab-dot"></i></button>
          </div>
          <div class="eval-curve" hidden></div>
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
  const pickerEl = outlet.querySelector('.piece-picker');
  const resumeEl = outlet.querySelector('.resume-sheet');
  const guestNote = outlet.querySelector('.guest-note');
  /* Added rather than templated: createBoard replaces the whole contents of
     its host, so anything written into it beforehand is thrown away. */
  const evalBar = document.createElement('div');
  evalBar.className = 'eval-bar';
  evalBar.hidden = true;
  evalBar.innerHTML = '<div class="eval-fill"></div><span class="eval-number"></span>';
  outlet.querySelector('.board-host').appendChild(evalBar);
  /* One number per ply, kept because stepping back and forth through a game
     asks for the same positions over and over — and because the curve wants
     every one of them. */
  const evalCache = new Map();
  const curveEl = outlet.querySelector('.eval-curve');
  let curveTimer = 0;
  const bubbleEl = outlet.querySelector('.chat-bubble');
  let bubbleTimer = 0;
  const overlay = outlet.querySelector('.result-overlay');
  const drawer = outlet.querySelector('.drawer');
  const moveListEl = outlet.querySelector('.move-list');
  const reviewBar = outlet.querySelector('.review-bar');
  const chatPane = outlet.querySelector('.chat-pane');
  const chatLogEl = outlet.querySelector('.chat-log');
  const chatForm = outlet.querySelector('.chat-form');
  const chatInput = outlet.querySelector('.chat-input');

  /*
   * Game controls sit under the board, not in the site header.
   *
   * In the header they crowded out the identity and navigation on a phone in
   * portrait, and the drawer's own toggle ended up at the top of the screen
   * pointing at a panel that rises from the bottom. Everything that acts on
   * the game is in one bar beneath it now, within reach of a thumb.
   */
  const tools = outlet.querySelector('.bar-tools');
  const toolsRight = outlet.querySelector('.bar-right');
  buildTools();

  function buildTools() {
    tools.innerHTML = toolsMarkup();
    buildDrawerButton();
    tools.querySelector('[data-control="level"]').value = String(level);
    tools.querySelector('[data-control="levelBlack"]').value = String(duelLevels[0]);
    tools.querySelector('[data-control="levelWhite"]').value = String(duelLevels[1]);
    tools.querySelector('[data-control="mode"]').value = mode;
    const side = tools.querySelector('[data-control="side"]');
    if (side) side.value = String(humanSide);
  }

  function levelOptions(prefix = '') {
    return ['levelBeginner', 'levelEasy', 'levelMedium', 'levelStrong']
      .map((key, i) => `<option value="${i}">${prefix}${t('game.' + key)}</option>`).join('');
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
    <select class="btn" data-control="level" title="${t('settings.aiLevel')}">
      ${levelOptions()}
    </select>
    <select class="btn" data-control="levelBlack" title="${t('game.levelOf', { colour: t('common.black') })}">
      ${levelOptions('● ')}
    </select>
    <select class="btn" data-control="levelWhite" title="${t('game.levelOf', { colour: t('common.white') })}">
      ${levelOptions('○ ')}
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
    /* The unread mark belongs here as well as on the tab: when a message
       arrives the drawer is usually shut, and the tab that carries the other
       mark is the very thing you cannot see. */
    const unread = Boolean(net && net.unread);
    toolsRight.innerHTML =
      `<button class="btn btn--icon${drawerOpen ? ' is-on' : ''}${unread ? ' has-unread' : ''}"`
      + ` data-action="drawer" title="${unread ? t('chat.unread', { n: net.unread }) : t('game.moveList')}">`
      + `${drawerOpen ? '⌄' : '⌃'}<i class="tab-dot"></i></button>`;
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
    outlet.querySelector('[data-control="rev-speed"]').title = t('review.speed');
    for (const [action, key] of [['rev-first', 'first'], ['rev-prev', 'previous'],
      ['rev-next', 'next'], ['rev-last', 'last']]) {
      outlet.querySelector(`[data-action="${action}"]`).title = t('review.' + key);
    }
    refresh();
  }

  /* ── Game lifecycle ───────────────────────────────────────────────────── */

  /**
   * Start a game, from the opening or from a position handed over.
   *
   * A resumed game keeps no history from before its first move: it is a new
   * game that happens to begin in the middle of somebody else's, not a
   * continuation of it. Nothing about it reaches the database — local games
   * are never recorded — so the game it came from cannot be touched.
   */
  function newGame(from) {
    evalCache.clear();
    state = from ? cloneState(from) : createState();
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
    /* Chosen out of turn: keep it rather than send it. Every selection path in
       the view ends here, so catching it in one place is enough. */
    if (canPremove()) {
      premove = moveIntent(move);
      selected = null;
      chain = null;
      picker = null;
      placeMode = null;
      playSound('ui');
      refresh();
      return;
    }
    if (net) { sendIntent(move, noFly); return; }
    applyLocal(move, noFly, flyPath, captureList);
  }

  function clearPremove(sound) {
    if (!premove) return;
    premove = null;
    if (sound) playSound('ui');
    refresh();
  }

  /**
   * Our turn has come: play what was lined up, if it is still playable.
   *
   * Tested against the position that actually arrived, not the one it was
   * chosen in — the opponent may have taken the piece, or filled the square.
   */
  function runPremove() {
    if (!premove || !net || result) return;
    if (state.turn !== net.colour || net.pending) return;
    const intent = premove;
    premove = null;
    const move = findLegalMove(state, intent);
    if (!move) { refresh(); return; }
    sendIntent(move, false);
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

  /* `ending` is passed explicitly because the review replays a finished game:
     `result` is set the whole way through, and reading it here would sound the
     end of the game after every single move. */
  function playMoveSounds(move, next, ending = Boolean(result)) {
    if (move.type === 'tile') playSound('tilePlacement');
    else if (move.type === 'piece') playSound('piecePlacement');
    else playSound('move');

    const steps = next.path ? next.path.length - 1 : 0;
    const flight = steps ? Math.min(180 + 150 * steps, 820) : 0;
    for (const c of next.captured) {
      playSound('capture', steps ? Math.max(0, flight * Math.min(1, c.step / steps) - 80) : 60);
    }
    if (ending) {
      const voice = endingVoice(result);
      if (voice) playSound(voice, 420);
    }
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
    // The undone plies never happened, and neither did what was thought of
    // them: the same index now holds a different position.
    evalCache.clear();
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
    // Whose engine is about to think, and therefore at what strength.
    const mover = state.turn;
    thinking = true;
    refresh();
    setTimeout(() => {
      const move = chooseMove(state, levelFor(mover));
      thinking = false;
      if (move) commit(move); else refresh();
    }, 40);
  }

  function stepAI() {
    if (result || thinking || !isAI(state.turn)) return;
    const mover = state.turn;
    thinking = true;
    refresh();
    setTimeout(() => {
      const move = chooseMove(state, levelFor(mover));
      thinking = false;
      if (move) commit(move); else refresh();
    }, 40);
  }

  const colourName = (player) => (player === BLACK ? t('common.black') : t('common.white'));

  /**
   * The sound a result deserves, from the point of view of whoever is sitting
   * here.
   *
   * Online there is a side to be on, so a win rises and a loss falls. In a
   * local game both players share the screen and neither of them lost, so it
   * is always the winning phrase — there is nobody to console.
   */
  function endingVoice(outcome) {
    if (!outcome) return null;
    if (outcome.draw) return 'draw';
    if (net && net.colour !== null && net.colour !== undefined) {
      return outcome.winner === net.colour ? 'win' : 'loss';
    }
    if (!net && mode === MODE_AI) {
      return outcome.winner === humanSide ? 'win' : 'loss';
    }
    return 'win';
  }

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
    if (result) {
      const voice = endingVoice(result);
      if (voice) playSound(voice, 420);
    }

    refresh();
    // Whatever was lined up gets its moment now, if it is still legal.
    if (premove) afterEffect(runPremove);
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
    evalCache.clear();
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
    premove = null;
    net.chat = (view.chat || []).slice();
    net.rematchOffered = view.rematchOfferedBy !== null && view.rematchOfferedBy !== undefined
      && view.rematchOfferedBy !== net.colour;
    if (view.rematchCode) net.rematchCode = view.rematchCode;
    result = view.result ? readResult(view.result) : null;
    resultSeen = false;
    net.opponentPresent = Boolean(view.seats && view.seats[1 - net.colour]);
    net.rated = Boolean(view.rated);
    net.people = view.players || [null, null];
    net.settled = view.settled || [false, false];
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
    if (net.settled && net.colour !== null) net.settled[net.colour] = true;
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

  /** Whether signing in would still make this game count. */
  const guestSeat = () => Boolean(net) && net.ready && !result && net.colour !== null
    && !isSignedIn() && !(net.people && net.people[net.colour])
    && !(net.settled && net.settled[net.colour]);

  async function joinRoom() {
    /* Signing in while sitting at the board should be felt at the board: take
       the seat again so it carries our name, and with it the stake. */
    net.unsubscribe.push(onAuthChange(async () => {
      if (!net || result) return;
      await identify(sessionToken()).catch(() => {});
      await claimSeat();
    }));
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
      if (payload.settled) net.settled = payload.settled;
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
        playSound('message');
        buildDrawerButton();      // the arrow carries the mark while shut
        showBubble(payload.message);
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

  /**
   * Hand the invitation to whatever the device uses for sharing.
   *
   * A cancelled sheet throws, and is not a failure worth reporting: the player
   * changed their mind, and the code is on screen either way.
   */
  async function shareLink() {
    if (!net) return;
    const url = inviteLink(net.code);
    try {
      await navigator.share({ title: 'Hexaequo', text: t('online.shareText'), url });
    } catch { /* dismissed, or refused by the platform */ }
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

  /* ── A finished game, read back ───────────────────────────────────────── */

  /**
   * Load a stored game and stand at the opening position.
   *
   * The moves come back as intents, exactly as they were played, and are
   * replayed through the same engine that produced them — so this board is
   * the game itself rather than a recording of it.
   */
  async function loadArchive() {
    try {
      archive = await api('/profile/games/' + encodeURIComponent(archiveId));
    } catch (error) {
      archive = null;
      showArchiveError(error.message);
      return;
    }
    if (!archive.replayable) {
      showArchiveError(t('profile.notReplayable'));
      return;
    }

    evalCache.clear();
    timelineMoves = (archive.moves || []).slice();
    timeline = replayTimeline(timelineMoves);
    if (timeline.length !== timelineMoves.length + 1) {
      showArchiveError(t('profile.notReplayable'));
      return;
    }
    moveLog = (archive.notations || []).map((text, i) => ({
      player: i % 2, text, captured: /×/.test(text),
    }));
    state = timeline[timeline.length - 1];
    result = archive.winner
      ? readResult({
        winner: archive.winner === 'draw' ? null : (archive.winner === 'black' ? 0 : 1),
        reason: archive.reason,
      })
      : null;
    // Straight to the start: the point of opening a finished game is to walk
    // through it, not to look at the end of it.
    resultSeen = true;
    goToPly(0);
  }

  function showArchiveError(message) {
    const strip = outlet.querySelector('.net-strip');
    strip.className = 'net-strip is-on is-warn';
    strip.innerHTML = '<span class="net-msg">' + escapeText(message) + '</span>';
  }

  /* ── Rendering ────────────────────────────────────────────────────────── */

  function refresh(instant) {
    /* Everything below draws `position`, which is the game itself while the
       player is watching it and a past ply while they are reading back. */
    const position = shownState();
    const reviewing = review !== null;
    const lining = canPremove();
    const player = lining ? net.colour : position.turn;
    const human = (!result && !thinking && canAct()) || lining;
    const dragging = !!(drag && drag.active);
    const idle = human && !chain && !picker && selected === null && !placeMode && !dragging;
    const aid = getSetting('showValidMoves');
    /* While lining a move up, everything is chosen against the board as it
       would be on our turn — the reserves, the legal squares, all of it. */
    const acting = lining ? premoveBoard() : position;
    const spots = reviewing ? [] : tilePlacementSpots(chain ? chain.preview : acting);
    const source = chain ? chain.preview : acting;

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
      && (acting.diskReserve[player] > 0
        || (acting.ringReserve[player] > 0 && acting.capturedDisks[player] > 0));
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
    const showEffect = Boolean(effect) && (!reviewing || effect.review);
    const premoveCells = [];
    if (premove && !reviewing) {
      if (premove.type === 'tile' || premove.type === 'piece') premoveCells.push(premove.cell);
      else if (premove.type === 'disk') premoveCells.push(premove.path[0], premove.path[premove.path.length - 1]);
      else premoveCells.push(premove.from, premove.to);
    }
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
      spotsLive: human && !chain && !dragging && acting.tileReserve[player] > 0
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
      premoveCells: [...new Set(premoveCells)],
      // Only the cell: the choice itself is drawn over the board, not in it.
      picker: picker ? { cell: picker.cell } : null,
      hidden: showEffect && effect.hidden != null ? effect.hidden : -1,
      held: dragging ? drag.cell : -1,
      newTile: showEffect ? effect.newTile : null,
      newPiece: showEffect ? effect.newPiece : null,
      showValidMoves: aid,
      instant: instant || board.__firstFrame,
    });
    board.__firstFrame = false;
    gameEl.classList.toggle('is-reviewing', reviewing);

    renderRails(position, reviewing);
    renderPicker();
    renderChainBar();
    renderResult();
    renderMoveList();
    renderReviewBar();
    renderChat();
    renderEvalBar();
    renderEvalCurve();
    fillCurve();
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
    /* A move that lands from the game while the player is reading back has no
       board to play on — theirs is showing another position entirely. One the
       review itself built is exactly what they asked for. */
    if (review !== null && !effect.review) { effect = null; return; }
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

  /**
   * A pile of pieces: exactly what is in it, and nothing else.
   *
   * The empty slots used to be drawn as dashed outlines, which read as a
   * checklist of what was missing rather than as an inventory. A board game
   * does not show you the pieces you no longer have.
   */
  function stackHtml(kind, colour, count, usable) {
    if (!count) return '';
    let out = '<div class="stack">';
    for (let i = 0; i < count; i++) {
      const classes = ['token'];
      if (usable) classes.push('is-usable');
      if (usable && placeMode === kind) classes.push('is-armed');
      out += `<span class="${classes.join(' ')}"${usable ? ` data-arm="${kind}"` : ''}>`
        + tokenSvg(kind, colour) + '</span>';
    }
    return out + '</div>';
  }

  const LEVEL_KEYS = ['levelBeginner', 'levelEasy', 'levelMedium', 'levelStrong'];

  /**
   * Who is playing this colour, written above their pieces.
   *
   * It used to be a bare black or white dot on a bar at the top, which said
   * which colours existed but not who held them — and in an online game the
   * names were at the top while the pieces were at the sides, so nothing tied
   * one to the other. Here the name sits over the inventory it owns, which is
   * also the plainest way to see which colour you are playing.
   */
  function railWho(player) {
    let who = null;                       // { pseudo, elo, userId }
    let label = colourName(player);
    let you = false;

    if (archive) {
      who = archive[player === BLACK ? 'black' : 'white'] || null;
    } else if (net) {
      who = net.people ? net.people[player] : null;
      you = net.colour === player;
      /* A seat held by someone who never signed in has no record to show, but
         it is taken all the same: say "guest" rather than name the colour as
         though nobody were sitting there. */
      if (!who && (you || net.opponentPresent)) label = t('profile.guest');
    } else if (isAI(player)) {
      label = t('game.computer') + ' · ' + t('game.' + LEVEL_KEYS[levelFor(player)]);
    } else if (mode === MODE_AI) {
      you = player === humanSide;
      label = t('game.you');
    }

    const name = who && who.pseudo ? escapeText(who.pseudo) : escapeText(label);
    const linked = who && who.userId
      ? `<a class="player-link rail-name" href="#/profile?id=${escapeText(who.userId)}">${name}</a>`
      : `<span class="rail-name">${who && !who.pseudo ? t('profile.guest') : name}</span>`;

    return `<div class="rail-who${you ? ' is-you' : ''}">`
      + `<span class="player-dot${player === WHITE ? ' is-white' : ''}"`
      + ` title="${colourName(player)}"></span>`
      + linked
      + (who && who.elo != null ? `<span class="rail-elo">${who.elo}</span>` : '')
      + (you ? `<span class="rail-you">${t('game.you')}</span>` : '')
      + '</div>';
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
      const taken = position.capturedDisks[player] + position.capturedRings[player] > 0;
      rail.innerHTML =
        railWho(player)
        + (net && net.clock ? `<div class="clock" data-clock="${player}">${formatClock(remainingFor(player))}</div>` : '')
        + stackHtml('tile', player, position.tileReserve[player],
          live && tilePlacementSpots(position).length > 0)
        + stackHtml('disk', player, position.diskReserve[player], live && freeOwnTiles > 0)
        + stackHtml('ring', player, position.ringReserve[player],
          live && freeOwnTiles > 0 && position.capturedDisks[player] > 0)
        /* Below the line: pieces taken from the opponent, which are as real a
           part of this player's inventory as their own. */
        + (taken ? '<div class="rail-sep"></div>' : '')
        + stackHtml('disk', opponent, position.capturedDisks[player], false)
        + stackHtml('ring', opponent, position.capturedRings[player], false);
      rail.classList.toggle('is-turn', isTurn && !reviewing);
      rail.classList.toggle('is-thinking', isTurn && thinking && !reviewing);
    }
  }

  /**
   * The disk-or-ring chooser.
   *
   * Drawn in HTML over the board rather than inside it, so its targets are a
   * real size in real pixels: the board scales to fit, and two circles sized
   * in board units came out around thirteen pixels across on a phone.
   */
  function renderPicker() {
    if (!picker) {
      pickerEl.hidden = true;
      pickerEl.innerHTML = '';
      return;
    }
    const label = { disk: t('game.placeDisk'), ring: t('game.placeRing') };
    pickerEl.innerHTML = picker.options.map((option) => `
      <button class="piece-choice" data-choose="${option}">
        <span class="piece-choice-art">${tokenSvg(option, state.turn)}</span>
        <span>${label[option]}</span>
      </button>`).join('');
    pickerEl.hidden = false;
    placePicker();
  }

  /** Park the chooser next to its cell, and keep it inside the board area. */
  function placePicker() {
    if (!picker || pickerEl.hidden) return;
    const area = outlet.querySelector('.board-area').getBoundingClientRect();
    const spot = board.toScreenSpace(cx(picker.cell), cy(picker.cell));
    const box = pickerEl.getBoundingClientRect();
    const margin = 8;

    let left = spot.x - area.left - box.width / 2;
    left = Math.max(margin, Math.min(area.width - box.width - margin, left));

    /* Above the cell by preference — a finger on the cell should not cover the
       thing it just opened — and below when there is no room above. */
    const gap = 54;
    let top = spot.y - area.top - box.height - gap;
    if (top < margin) top = spot.y - area.top + gap;
    top = Math.max(margin, Math.min(area.height - box.height - margin, top));

    pickerEl.style.left = `${Math.round(left)}px`;
    pickerEl.style.top = `${Math.round(top)}px`;
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
  /**
   * How much of the board area sits below the board itself.
   *
   * The end-of-game card stops there rather than covering everything, so the
   * bar and the drawer stay usable while it is up. Measured rather than
   * guessed: the bar is one row on a wide screen and two on a phone, and the
   * drawer's height changes as it opens.
   */
  function measureBelowBoard() {
    const area = outlet.querySelector('.board-area');
    let below = 0;
    for (const node of [drawer, outlet.querySelector('.board-bar')]) {
      if (node) below += node.getBoundingClientRect().height;
    }
    area.style.setProperty('--below-board', `${Math.round(below)}px`);
  }

  function renderResult() {
    measureBelowBoard();
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

  /** Say where this game came from, so nobody mistakes it for a fresh one. */
  function showResumeNote(handoff) {
    resumedNote = true;
    const strip = outlet.querySelector('.net-strip');
    strip.className = 'net-strip is-on';
    strip.innerHTML = `<span class="net-msg">${
      handoff.from
        ? t('review.resumedFrom', { game: escapeText(handoff.from), n: handoff.ply })
        : t('review.resumedHere', { n: handoff.ply })
    }</span>`;
  }

  /* ── Playing on from a position ───────────────────────────────────────── */

  /**
   * Offer to carry on from whatever is on screen.
   *
   * The choice of opponent is asked for rather than assumed: someone reading a
   * game back may want to try the position against the engine, or to set it up
   * for two people at a table, or simply to watch it played out.
   */
  function openResumeSheet() {
    const options = [
      ['ai', t('review.resumeVsAi')],
      ['local', t('review.resumeTwo')],
      ['aiai', t('review.resumeWatch')],
    ];
    resumeEl.innerHTML = `<p class="resume-title">${t('review.resumeTitle', { n: reviewPly() })}</p>`
      + options.map(([id, label]) =>
        `<button class="btn resume-choice" data-resume="${id}">${label}</button>`).join('')
      + `<button class="btn btn--link" data-resume="cancel">${t('game.cancel')}</button>`;
    resumeEl.hidden = false;
  }

  const closeResumeSheet = () => { resumeEl.hidden = true; resumeEl.innerHTML = ''; };

  const reviewPly = () => (review === null ? timeline.length - 1 : review);

  /**
   * Hand the position to a fresh local game.
   *
   * Local games are never written anywhere, so the game this came from is
   * untouched by construction rather than by care — there is no code path from
   * here that could reach it.
   */
  function resumeFrom(mode) {
    const position = shownState();
    if (!position) return;
    offerPosition({
      position: cloneState(position),
      mode,
      // Carry on as the colour whose turn it is: the interesting question is
      // almost always "what should have been played here".
      side: position.turn,
      from: archive
        ? `${(archive.black && archive.black.pseudo) || t('profile.guest')} – `
          + `${(archive.white && archive.white.pseudo) || t('profile.guest')}`
        : null,
      ply: reviewPly(),
    });
    closeResumeSheet();
    playSound('ui');
    navigate('play', { resumed: '1' });
  }

  /* ── Review ───────────────────────────────────────────────────────────── */

  /**
   * Rebuild the move that produced a ply, so it can be played again.
   *
   * The timeline stores intents, which name the squares a piece visited and
   * say nothing about what it took. Resolving one against the position before
   * it gives back the whole move, captures and all — the same thing the board
   * animates during a live game.
   */
  function effectForPly(index) {
    if (index < 1 || index >= timeline.length) return null;
    const from = timeline[index - 1];
    const move = findLegalMove(from, timelineMoves[index - 1]);
    if (!move) return null;

    const player = from.turn;
    const path = move.type === 'disk' ? move.path.slice()
      : (move.type === 'ring' ? [move.from, move.to] : null);
    const captures = move.type === 'disk' ? move.captures
      : (move.type === 'ring' && move.capture ? [move.capture] : []);

    const shot = {
      review: true,
      path,
      code: makePiece(player, move.type === 'ring' ? RING : DISK),
      captured: [],
      newTile: move.type === 'tile' ? move.cell : null,
      newPiece: move.type === 'piece' ? move.cell : null,
      hidden: path ? path[path.length - 1] : null,
    };
    for (const capture of captures) {
      let step = 1;
      if (path) {
        for (let i = 0; i + 1 < path.length; i++) {
          if ((path[i] + path[i + 1]) / 2 === capture.cell) { step = i + 1; break; }
        }
      }
      shot.captured.push({ cell: capture.cell, code: capture.code, step });
    }
    return shot;
  }

  /**
   * Show the position after `index` plies.
   *
   * `animate` replays the move that produced it, which is what a single step
   * forward means. Jumping straight to a ply from the move list does not
   * animate: there is no single move to show.
   */
  function goToPly(index, animate) {
    const last = timeline.length - 1;
    const target = Math.max(0, Math.min(last, index));
    review = target >= last ? null : target;
    selected = null;
    chain = null;
    picker = null;
    placeMode = null;
    clearEffect();
    if (animate) {
      const shot = effectForPly(target);
      if (shot) {
        effect = shot;
        playMoveSounds(timelineMoves[target - 1], shot, Boolean(result) && target === last);
      }
    }
    refresh(!animate);
  }

  function stepReview(delta) {
    const current = review === null ? timeline.length - 1 : review;
    // Only a single step forward has one move to show.
    goToPly(current + delta, delta === 1);
  }

  /**
   * Walk the game forward on its own until it runs out or is stopped.
   *
   * Each step waits for its own animation rather than a fixed tick, so a long
   * jump chain is not cut off by the next move starting on top of it.
   */
  function startAutoplay() {
    stopAutoplay();
    if (timeline.length < 2) return;
    // Starting from the end means starting again from the beginning.
    if (review === null) goToPly(0);
    tickAutoplay();
    renderReviewBar();
  }

  function tickAutoplay() {
    const last = timeline.length - 1;
    const at = review === null ? last : review;
    if (at >= last) { stopAutoplay(); renderReviewBar(); return; }
    stepReview(1);
    const wait = Math.max(240, (effectEndsAt - Date.now()) + 260) / playSpeed;
    playTimer = setTimeout(tickAutoplay, wait);
  }

  function stopAutoplay() {
    if (playTimer) clearTimeout(playTimer);
    playTimer = 0;
  }

  const isAutoplaying = () => playTimer !== 0;

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
    /* Not during a live online game: setting the position up against the
       engine while the other player waits is analysis mid-game, which is the
       one thing a rated game cannot allow. Everywhere else it is offered. */
    const liveOnline = Boolean(net) && !result;
    reviewBar.querySelector('[data-action="resume"]').hidden = liveOnline;
    const playButton = reviewBar.querySelector('[data-action="rev-play"]');
    playButton.textContent = isAutoplaying() ? '⏸' : '▶';
    playButton.classList.toggle('is-on', isAutoplaying());
    playButton.title = isAutoplaying() ? t('review.pause') : t('review.play');
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

  /**
   * Open or shut the drawer, on a given tab.
   *
   * The drawer takes room from the board rather than covering it, so the board
   * has to be told its frame changed — and the result card has to be told how
   * much room is left beneath it.
   */
  function setDrawer(open, tab) {
    drawerOpen = open;
    drawer.classList.toggle('is-on', drawerOpen);
    buildDrawerButton();
    showDrawerTab(tab || drawerTab);
    measureBelowBoard();
    setTimeout(() => { measureBelowBoard(); refresh(true); }, 300);
  }

  function showDrawerTab(name) {
    drawerTab = name;
    for (const tab of outlet.querySelectorAll('.drawer-tab')) {
      tab.classList.toggle('is-active', tab.getAttribute('data-tab') === name);
    }
    moveListEl.style.display = name === 'moves' ? '' : 'none';
    renderEvalCurve();
    fillCurve();
    chatPane.style.display = name === 'chat' ? '' : 'none';
    if (name === 'chat' && net) { net.unread = 0; buildDrawerButton(); hideBubble(); }
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
    /* Online, none of the local controls apply: no mode, no AI, no undo. In a
       stored game none of them do either — there is nothing left to play. */
    const local = !net && !archiveId;
    show('[data-control="mode"]', local);
    show('[data-control="side"]', local && mode === MODE_AI);
    show('[data-control="level"]', local && mode === MODE_AI);
    show('[data-control="levelBlack"]', local && isDuel);
    show('[data-control="levelWhite"]', local && isDuel);
    show('[data-action="run"]', local && isDuel);
    show('[data-action="step"]', local && isDuel);
    show('[data-action="undo"]', local);
    show('[data-action="new"]', local);
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

  /**
   * What the opponent just said, while the panel that would show it is shut.
   *
   * A dot on an arrow says a message exists; it does not say what it was, so
   * it cannot be answered without first going to look. The bubble carries the
   * words to where you are already looking, and tapping it opens the chat to
   * reply. Dismissing it is not reading it: the mark on the arrow stays until
   * the message has actually been seen in the panel.
   */
  function showBubble(message) {
    clearTimeout(bubbleTimer);
    const text = message.text.length > 140 ? message.text.slice(0, 139) + '…' : message.text;
    const more = net.unread > 1
      ? `<span class="bubble-more">${t('chat.andMore', { n: net.unread - 1 })}</span>` : '';
    bubbleEl.innerHTML = `<span class="bubble-who">${escapeText(bubbleName())}</span>`
      + `<span class="bubble-text">${escapeText(text)}</span>${more}`;
    bubbleEl.hidden = false;
    /* Long enough to read a sentence, short enough not to become furniture. */
    bubbleTimer = setTimeout(hideBubble, 12000);
  }

  function hideBubble() {
    clearTimeout(bubbleTimer);
    bubbleTimer = 0;
    bubbleEl.hidden = true;
  }

  /** Who is speaking, for the line above the words. */
  function bubbleName() {
    const other = net && net.people && net.colour !== null ? net.people[1 - net.colour] : null;
    return other && other.pseudo ? other.pseudo : t('profile.guest');
  }

  /**
   * "You are playing as a guest."
   *
   * Said once, where it can be acted on, and only while acting on it would
   * still change anything: the seat takes your name and the game starts
   * counting, right up until you play from it.
   */
  function renderGuestNote() {
    const show = guestSeat();
    guestNote.hidden = !show;
    if (!show) return;
    guestNote.innerHTML = `<span>${t('online.guestNote')}</span>`
      + `<button class="btn btn--sm btn--primary" data-action="guest-sign-in">`
      + `${t('account.signIn')}</button>`;
  }

  /**
   * How the position on screen stands, drawn down the side of the board.
   *
   * Only while reading a game back, and never in a live online game: setting
   * the engine on the position while the other player waits is analysis
   * mid-game, which is the one thing a rated game cannot allow. It is the same
   * rule that hides "play from here".
   */
  const evalShown = () =>
    (review !== null || Boolean(archiveId) || Boolean(result)) && !(net && !result);

  /**
   * Points to a share of the bar.
   *
   * A logistic rather than a straight line, because the difference between
   * level and a disk down matters and the difference between five disks down
   * and six does not — past a point the game is simply lost, and the bar
   * should say so without needing more room to say it in.
   */
  function evalShare(score) {
    return 1 / (1 + Math.exp(-score / 250));
  }

  function renderEvalBar() {
    if (!evalShown()) { evalBar.hidden = true; return; }
    const at = review === null ? timeline.length - 1 : review;
    const verdict = verdictAt(at);

    const share = verdict.decisive
      ? (verdict.score > 0 ? 0 : 1)          // black wins: white's share is none
      : 1 - evalShare(verdict.score);
    const points = verdict.score / DISK_POINTS;
    const label = verdict.decisive ? '✓' : Math.abs(points).toFixed(1);

    evalBar.hidden = false;
    evalBar.classList.toggle('is-black-ahead', verdict.score > 0);
    evalBar.querySelector('.eval-fill').style.height = `${(share * 100).toFixed(1)}%`;
    const number = evalBar.querySelector('.eval-number');
    number.textContent = label;
    evalBar.title = verdict.decisive
      ? t('review.evalDecided', { colour: colourName(verdict.score > 0 ? BLACK : WHITE) })
      : t('review.evalTitle', { n: label, d: verdict.depth });
  }

  /** The judgement for one ply, computed once and remembered. */
  function verdictAt(ply) {
    let found = evalCache.get(ply);
    if (!found) {
      found = judge(cloneState(timeline[ply]), { ms: 250, maxDepth: 6 });
      evalCache.set(ply, found);
    }
    return found;
  }

  /**
   * Fill in the plies nobody has looked at yet, a few at a time.
   *
   * Judging a whole game is a second or two of work. Done in one go it is a
   * second or two with the page frozen, so it is done in slices with the
   * browser given the gaps: the curve draws itself in as the answers arrive,
   * which is also a plainer thing to watch than a spinner.
   */
  function fillCurve() {
    clearTimeout(curveTimer);
    if (!evalShown() || timeline.length < 2) return;
    const missing = [];
    for (let i = 0; i < timeline.length; i++) if (!evalCache.has(i)) missing.push(i);
    if (!missing.length) return;
    for (const ply of missing.slice(0, 4)) verdictAt(ply);
    renderEvalCurve();
    curveTimer = setTimeout(fillCurve, 0);
  }

  /**
   * The whole game as one line: the shape of the match at a glance.
   *
   * Dark above the line, light below, split where the balance is — the bar
   * beside the board laid on its side, so the two read as one picture. Drawn
   * by hand rather than by a chart library: it is one series of at most a few
   * hundred numbers, and a dependency would cost more than it draws.
   */
  function renderEvalCurve() {
    const on = evalShown() && timeline.length > 1 && drawerOpen && drawerTab === 'moves';
    curveEl.hidden = !on;
    if (!on) return;

    const width = 300;
    const height = 64;
    const last = timeline.length - 1;
    const at = review === null ? last : review;
    const x = (i) => (i * width) / last;
    const y = (ply) => {
      const verdict = evalCache.get(ply);
      if (!verdict) return height / 2;                    // not judged yet: level
      const share = verdict.decisive
        ? (verdict.score > 0 ? 1 : 0)
        : 1 / (1 + Math.exp(-verdict.score / 250));       // 1 is Black winning
      return share * height;
    };

    let line = '';
    for (let i = 0; i <= last; i++) line += `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(i).toFixed(1)}`;
    const above = `${line}L${width},0L0,0Z`;             // Black's share of the picture

    curveEl.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img"
           aria-label="${t('review.curve')}">
        <rect x="0" y="0" width="${width}" height="${height}" fill="var(--piece-light)"/>
        <path d="${above}" fill="var(--piece-dark)"/>
        <line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}"
              stroke="var(--line)" stroke-width="1" stroke-dasharray="3 3"/>
        <line class="curve-at" x1="${x(at).toFixed(1)}" y1="0"
              x2="${x(at).toFixed(1)}" y2="${height}" stroke="var(--accent)" stroke-width="1.5"/>
        <circle cx="${x(at).toFixed(1)}" cy="${y(at).toFixed(1)}" r="3" fill="var(--accent)"/>
      </svg>`;
  }

  /** The strip above the board that explains the state of an online game. */
  function renderNetStatus() {
    renderGuestNote();
    const strip = outlet.querySelector('.net-strip');
    // A resumed game keeps the note saying where it came from.
    if (resumedNote) return;

    if (archiveId) {
      if (!archive) return;                 // an error is already on the strip
      strip.className = 'net-strip is-on';
      strip.innerHTML =
        '<span class="net-msg">' + t('review.reviewingArchive') + '</span>'
        + '<span class="grow"></span>'
        + (archive.rated
          ? '<span class="net-stake is-rated">' + t('online.rated') + '</span>'
          : '<span class="net-stake">' + t('online.unrated') + '</span>');
      return;
    }

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

    /* Who is on the other side is written over their pieces; what is left for
       the strip is what is happening and what is at stake. */
    const stakeLabel = net.rated
      ? `<span class="net-stake is-rated" title="${t('online.rated')}">${t('online.rated')}</span>`
      : `<span class="net-stake" title="${t('online.signInToRate')}">${t('online.unrated')}</span>`;

    strip.className = `net-strip is-on ${tone}`;
    strip.innerHTML =
      `<span class="net-msg">${message}</span>`
      + `<span class="grow"></span>`
      + stakeLabel
      + `<code class="room-code room-code--sm">${net.code}</code>`
      /* The device's own share sheet where there is one — that is how a link
         reaches a message, an email or whatever else is installed. Copying
         stays for everything that has no sheet to offer. */
      + (navigator.share
        ? `<button class="btn btn--icon" data-action="share-link" title="${t('online.share')}">⇪</button>`
        : '')
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
    const board = canPremove() ? premoveBoard() : state;
    const player = board.turn;
    const options = [];
    if (board.diskReserve[player] > 0) options.push('disk');
    if (board.ringReserve[player] > 0 && board.capturedDisks[player] > 0) options.push('ring');
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
    if (!canAct() && !canPremove()) return;
    /* While lining a move up, the board is read as though it were our turn —
       the position it will be played into is close enough to choose against. */
    const player = canPremove() ? net.colour : state.turn;
    const board = canPremove() ? premoveBoard() : state;
    const isMine = (k) => board.pieceAt[k] >= 0 && pieceOwner(board.pieceAt[k]) === player;
    const isFreeOwnTile = (k) => board.tileAt[k] === player && board.pieceAt[k] < 0;

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
      if (board.tileAt[cell] < 0 && tilePlacementSpots(board).includes(cell)) commit({ type: 'tile', cell });
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
    if (board.tileAt[cell] < 0) {
      if (board.tileReserve[player] > 0 && tilePlacementSpots(board).includes(cell)) {
        commit({ type: 'tile', cell });
      }
      return;
    }
    if (isFreeOwnTile(cell)) openPicker(cell);
  }

  /** Attempt to move the piece on `from` to `to`. Returns true if a move began. */
  function tryMove(from, to, byDrag) {
    const board = canPremove() ? premoveBoard() : state;
    const player = board.turn;
    const code = board.pieceAt[from];
    if (pieceType(code) === DISK) {
      for (let i = 0; i < 6; i++) {
        if (from + STEP[i] === to && board.tileAt[to] >= 0 && board.pieceAt[to] < 0) {
          commit({ type: 'disk', path: [from, to], captures: [] }, byDrag);
          return true;
        }
      }
      const lifted = withPieceLifted(board, from);
      const jump = availableJumps(lifted, from, player, [from], 0).find((j) => j.land === to);
      if (jump) { startChain(from); takeJump(jump, byDrag); return true; }
    } else {
      for (let i = 0; i < 12; i++) {
        if (from + RING_OFFSETS[i] !== to || board.tileAt[to] < 0) continue;
        const occupant = board.pieceAt[to];
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
      } else if (premove) {
        clearPremove(true);
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
    if (!canAct() && !canPremove()) return false;
    const cell = drag.cell;
    const position = canPremove() ? premoveBoard() : state;
    const player = position.turn;
    let code;
    if (chain) {
      if (cell !== chain.current) return false;
      code = makePiece(player, DISK);
    } else if (!picker && !placeMode
      && position.pieceAt[cell] >= 0 && pieceOwner(position.pieceAt[cell]) === player) {
      code = position.pieceAt[cell];
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
    if (!drag.flyer) { drag.active = false; refresh(); return false; }
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
    if (ply) { stopAutoplay(); goToPly(Number(ply.getAttribute('data-ply'))); return; }

    const token = event.target.closest('[data-arm]');
    if (!token) return;
    const kind = token.getAttribute('data-arm');
    placeMode = placeMode === kind ? null : kind;
    selected = null;
    picker = null;
    playSound('ui');
    refresh();
  });

  resumeEl.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-resume]');
    if (!choice) return;
    const which = choice.getAttribute('data-resume');
    if (which === 'cancel') { playSound('ui'); closeResumeSheet(); return; }
    resumeFrom(which);
  });

  pickerEl.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-choose]');
    if (!choice || !picker) return;
    playSound('ui');
    onCell(picker.cell, choice.getAttribute('data-choose'));
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
    else if (action === 'rev-first') { stopAutoplay(); goToPly(0); }
    else if (action === 'rev-prev') { stopAutoplay(); stepReview(-1); }
    else if (action === 'rev-next') { stopAutoplay(); stepReview(1); }
    else if (action === 'rev-last') { stopAutoplay(); goToPly(timeline.length - 1); }
    else if (action === 'rev-live') { stopAutoplay(); goToPly(timeline.length - 1); }
    else if (action === 'resume') { stopAutoplay(); openResumeSheet(); }
    else if (action === 'guest-sign-in') { openPanel('account'); }
    else if (action === 'rev-play') {
      if (isAutoplaying()) { stopAutoplay(); renderReviewBar(); } else startAutoplay();
    }
    else if (action === 'share-link' && net) { shareLink(); }
    else if (action === 'copy-link' && net) {
      navigator.clipboard.writeText(inviteLink(net.code)).catch(() => {});
      button.textContent = '✓';
      setTimeout(() => { button.textContent = '⧉'; }, 1200);
    }
    else if (action === 'run') { aiRunning = !aiRunning; refresh(); if (aiRunning) scheduleAI(); }
    else if (action === 'step') stepAI();
    else if (action === 'drawer') setDrawer(!drawerOpen, drawerTab);
    else if (action === 'end-jump') { if (chain) finishChain(); }
    else if (action === 'cancel-jump') { chain = null; selected = null; clearEffect(); refresh(); }
  }

  function onToolChange(event) {
    const control = event.target.closest('[data-control]');
    if (!control) return;
    const name = control.getAttribute('data-control');
    if (name === 'rev-speed') { playSpeed = Number(control.value) || 1; return; }
    if (name === 'mode') { mode = control.value; aiRunning = false; newGame(); }
    else if (name === 'side') { humanSide = Number(control.value); newGame(); }
    else if (name === 'level') { level = Number(control.value); setSetting('aiLevel', level); refresh(); }
    else if (name === 'levelBlack') { duelLevels[0] = Number(control.value); refresh(); }
    else if (name === 'levelWhite') { duelLevels[1] = Number(control.value); refresh(); }
  }

  /** A point on the curve is a point in the game. */
  function onCurveClick(event) {
    if (timeline.length < 2) return;
    const svg = curveEl.querySelector('svg');
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    const share = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    playSound('ui');
    stopAutoplay();
    goToPly(Math.round(share * (timeline.length - 1)));
  }

  function onAnyPointer(event) {
    if (bubbleEl.hidden) return;
    if (bubbleEl.contains(event.target)) {
      playSound('ui');
      setDrawer(true, 'chat');       // which clears the mark, and the bubble
      return;
    }
    hideBubble();
  }

  function onKey(event) {
    // Never steal a keystroke meant for the chat box.
    if (event.target && event.target.closest && event.target.closest('input, textarea')) {
      if (event.key === 'Escape') event.target.blur();
      return;
    }
    if (event.key === 'Escape') {
      if (review !== null) { goToPly(timeline.length - 1); return; }
      if (premove) { clearPremove(true); return; }
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

  /* One listener each, on the view.
   *
   * The bar used to live in the site header, outside this container, so it
   * needed listeners of its own. Now that it is inside, a second listener
   * means every click is handled twice — which toggled the drawer open and
   * straight back shut. */
  outlet.addEventListener('click', onToolClick);
  outlet.addEventListener('change', onToolChange);
  curveEl.addEventListener('click', onCurveClick);
  document.addEventListener('keydown', onKey);
  /* Capture, so the bubble is dealt with before anything else consumes the
     tap — including the board, which stops propagation of its own. */
  document.addEventListener('pointerdown', onAnyPointer, true);

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

  /*
   * A position handed over from a game being read back.
   *
   * It becomes an ordinary local game — nothing here writes anywhere, so the
   * game it came from cannot be affected by whatever happens next.
   */
  const resumed = params && params.get('resumed') === '1' ? takePosition() : null;
  if (resumed) {
    mode = resumed.mode;
    if (resumed.mode === MODE_AI) humanSide = resumed.side;
    aiRunning = resumed.mode === MODE_AI_AI;
  }

  newGame(resumed ? resumed.position : null);
  if (resumed) showResumeNote(resumed);
  showDrawerTab('moves');
  if (archiveId) loadArchive();
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
    stopAutoplay();
    clearInterval(countdownTimer);
    clearInterval(clockTimer);
    if (net) {
      for (const off of net.unsubscribe) { try { off(); } catch { /* already gone */ } }
      net = null;                       // stops in-flight handlers from touching a dead view
    }
    stopWatchingSettings();
    stopWatchingLanguage();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onAnyPointer, true);
    clearTimeout(bubbleTimer);
    clearTimeout(curveTimer);
    window.removeEventListener('resize', onResize);
    /* The bar is part of this view now, so it goes when the view goes; only
       the guard reaches outside. */
    setLeaveGuard(null);
    delete window.__hexaequo;
  };
}
