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
import { request, listen, connect } from '../net.js';
import { api, isSignedIn, onAuthChange, ratingChanged } from '../auth.js';
import { openPanel } from '../ui/panels.js';
import { emojiRowHtml } from '../ui/emoji.js';

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

  let timeline = [];
  let timelineMoves = [];
  let review = null;
  let playTimer = 0;          // walking the game on its own
  let playSpeed = 1;
  let resultSeen = false;          // the result card has been dismissed
  /* The winning move deserves to be watched before it is covered up. */
  const RESULT_BEAT_MS = 700;
  let holdingResult = false;
  let resultTimer = 0;

  let mode = MODE_AI;
  let humanSide = BLACK;
  let level = getSetting('aiLevel');
  /* Watching two engines is only interesting if they can differ, so the duel
     keeps a level per colour rather than one for both. */
  let duelLevels = [level, level];

  const levelFor = (player) => {
    if (exploring) return exploring.play === 'aiai' ? duelLevels[player] : level;
    return mode === MODE_AI_AI ? duelLevels[player] : level;
  };

  /* Online games: the server owns the position, so this view only sends move
     intents and renders whatever comes back. `net` is null for local play. */
  /* A finished game read back from the database. Neither local nor online:
     nothing here can be played, only looked at. */
  const archiveId = params && params.get('game');
  let archive = null;

  const watching = Boolean(params && params.get('watch') === '1' && params.get('code'));
  const wantsOnline = watching
    || Boolean(params && params.get('online') === '1' && params.get('code'));
  let net = wantsOnline
    ? {
      code: String(params.get('code')).toUpperCase(),
      colour: null,
      watching,                // no seat: here to look, not to play
      watchers: 0,
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
      drawOffered: false,      // they have offered
      drawAsked: false,        // we have offered
      rematchCode: null,       // the room that replaces this one
      unsubscribe: [],
    }
    : null;
  let countdownTimer = 0;
  let clockTimer = 0;

  /* Nobody is the computer inside an exploration: both colours answer to the
     same hand, which is the whole of what makes it exploring. Left as it was,
     the engine replied to every move — the branch grew twice as fast as it was
     being played, and half of it was somebody else's idea. */
  /*
   * Whose engine plays this colour.
   *
   * A branch keeps its own answer. It starts with nobody — both sides pushed
   * around by hand, which is what exploring was — and can be handed to the
   * computer without leaving the branch, which is what "play from here" used
   * to be and what made it a one-way door.
   */
  const isAI = (player) => {
    if (exploring) {
      if (exploring.play === 'aiai') return true;
      if (exploring.play === 'ai') return player !== exploring.side;
      return false;
    }
    return !net && (mode === MODE_AI_AI || (mode === MODE_AI && player !== humanSide));
  };

  /*
   * Exploring: a position taken off the board and pushed around by hand.
   *
   * Holds everything the game it came from needs to be put back exactly as it
   * was — the line, the notation, the result, the position. Nothing about an
   * exploration is written anywhere; it exists between entering it and leaving
   * it, and leaving it restores this and throws the branch away.
   */
  let exploring = null;

  /** Whether the local player may act at all right now. */
  /*
   * Whether the player may move a piece right now.
   *
   * A branch is the loose case: any ply of it may be played from, and playing
   * from the middle of one throws the rest of it away — which is what makes it
   * feel like an analysis board rather than a recording you may append to.
   * Everything else is stricter: a game is played from its present, and a
   * stored game is not played at all.
   */
  const canAct = () => (exploring
    ? !isAI(state.turn)
    : !archiveId && (review === null) && (net
      ? net.ready && !net.pending && state.turn === net.colour
      : !isAI(state.turn)));

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

  /**
   * Whether the cells are named right now.
   *
   * On and off are answers; auto is a question about what the board is for at
   * this moment. Reading a game back, the names are how a move in the list
   * ties to a cell on the board and are worth having. Playing, they are one
   * more thing printed on a board you are trying to see through — and nobody
   * needs to name the cell they are about to touch.
   */
  function coordinatesWanted() {
    const choice = getSetting('showCoordinates');
    if (choice === 'always' || choice === true) return true;
    if (choice === 'never' || choice === false) return false;
    return isReview();
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
          <button class="btn btn--icon bar-menu" data-action="tools"
                  title="${t('game.tools')}">⋯</button>
          <div class="bar-tools"></div>
          <div class="review-bar">
          <button class="btn btn--icon" data-action="rev-first" title="${t('review.first')}">⏮</button>
          <button class="btn btn--icon" data-action="rev-prev" title="${t('review.previous')}">◀</button>
          <span class="review-ply" data-field="ply"></span>
          <button class="btn btn--icon" data-action="rev-next" title="${t('review.next')}">▶</button>
          <button class="btn btn--icon" data-action="rev-last" title="${t('review.last')}">⏭</button>
          <span class="review-sep"></span>
          <button class="btn btn--icon review-play" data-action="rev-play"
                  title="${t('review.play')}">▶</button>
          <select class="btn review-speed" data-control="rev-speed" title="${t('review.speed')}">
            <option value="1">1×</option>
            <option value="2">2×</option>
            <option value="4">4×</option>
          </select>
          <button class="btn review-explore" data-action="explore">${t('review.explore')}</button>
          <button class="btn review-resume" data-action="resume"></button>
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
              <!-- The lobby's row, unchanged. Most of what is said across a
                   board is one of these, and typing it on a phone while a clock
                   runs is the reason it goes unsaid. -->
              ${emojiRowHtml()}
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
  /* Watching a game shows the moves and nothing else: what two players say
     over a board is theirs, and the server does not send it here. */
  if (net && net.watching) {
    const chatTab = outlet.querySelector('[data-tab="chat"]');
    if (chatTab) chatTab.hidden = true;
  }
  /* Added rather than templated: createBoard replaces the whole contents of
     its host, so anything written into it beforehand is thrown away. */
  const evalBar = document.createElement('div');
  evalBar.className = 'eval-bar';
  evalBar.hidden = true;
  evalBar.innerHTML = '<div class="eval-fill"></div><span class="eval-number"></span>';
  outlet.querySelector('.board-host').appendChild(evalBar);
  /* What the engine would play here, beside the bar rather than in it: the bar
     is nineteen pixels wide and a move is a word. */
  const evalHint = document.createElement('button');
  evalHint.className = 'eval-hint';
  evalHint.type = 'button';
  evalHint.hidden = true;
  outlet.querySelector('.board-host').appendChild(evalHint);
  /* One number per ply, kept because stepping back and forth through a game
     asks for the same positions over and over — and because the curve wants
     every one of them. */
  const evalCache = new Map();
  const JUDGE_BUDGET = { ms: 120, maxDepth: 5 };   // see verdictAt for the numbers
  /* When the next round of judging may start. */
  let hintTimer = 0;
  /* The frame chasing the drawer while it slides, and the tidy-up after. */
  let drawerFollow = 0;
  let drawerSettle = 0;
  /* A tile or piece crossing from a reserve: { cell, tile }. While it is set,
     the board leaves that cell alone and the move's own animation waits. */
  let arriving = null;

  /* The cache is keyed by ply, and a ply number does not mean the same position
     from one line to the next — a branch, a new game or a game loaded over this
     one all put something else at 12. */
  function forgetAnalysis() {
    evalCache.clear();
  }
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
  const barEl = outlet.querySelector('.board-bar');
  buildTools();

  /*
   * The controls, folded away on a phone.
   *
   * Laid out in a row they are a row: five or seven of them on a screen four
   * hundred pixels wide take a line of the bar to themselves, and the bar is
   * cut out of the board. Behind one button they cost nothing until they are
   * wanted, and when they are wanted a stack of full-width controls above the
   * thumb is easier to hit than a strip of them squeezed edge to edge.
   *
   * The same elements either way — moved by the stylesheet, not rebuilt — so
   * everything that reads or writes them carries on unaware of which it is.
   */
  function setToolsOpen(open) {
    barEl.classList.toggle('is-tools-open', Boolean(open));
    const button = barEl.querySelector('.bar-menu');
    if (button) button.classList.toggle('is-on', Boolean(open));
  }
  const toolsOpen = () => barEl.classList.contains('is-tools-open');

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
      ${levelOptions(t('common.black') + ' · ')}
    </select>
    <select class="btn" data-control="levelWhite" title="${t('game.levelOf', { colour: t('common.white') })}">
      ${levelOptions(t('common.white') + ' · ')}
    </select>
    <button class="btn btn--icon" data-action="run" title="${t('game.run')}">▶</button>
    <button class="btn btn--icon" data-action="step" title="${t('game.stepOnce')}">⏭</button>
    <button class="btn btn--icon" data-action="undo" title="${t('game.undo')}">↶</button>
    <button class="btn btn--icon" data-action="new" title="${t('game.newGame')}">⟳</button>
    <button class="btn btn--icon" data-action="draw" title="${t('game.drawOffer')}">½</button>
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
    outlet.querySelector('[data-action="explore"]').textContent = t('review.explore');
    const menuButton = barEl.querySelector('.bar-menu');
    if (menuButton) menuButton.title = t('game.tools');
    // rev-live carries two meanings and renderReviewBar picks the right one.
    outlet.querySelector('[data-control="rev-speed"]').title = t('review.speed');
    for (const [action, key] of [['rev-first', 'first'], ['rev-prev', 'previous'],
      ['rev-next', 'next'], ['rev-last', 'last']]) {
      outlet.querySelector(`[data-action="${action}"]`).title = t('review.' + key);
    }
    refresh();
  }

  /* ── Game lifecycle ───────────────────────────────────────────────────── */

  /*
   * How long the move being thought about has been thought about.
   *
   * Local games are not on the server and have no clock, so the time each move
   * took is measured here, from when the position appeared to when it was
   * played. Online it comes from the server instead: both players and everyone
   * watching should read the same number, and no client should be able to
   * shorten its own.
   *
   * Zero means the count has not started — the opening position before anyone
   * has moved — and a move timed from there is recorded as unknown rather than
   * as having taken however long the page had been open.
   */
  let turnAt = 0;
  function spent() {
    const at = turnAt;
    turnAt = Date.now();
    return at ? Date.now() - at : null;
  }

  /**
   * Start a game, from the opening or from a position handed over.
   *
   * A resumed game keeps no history from before its first move: it is a new
   * game that happens to begin in the middle of somebody else's, not a
   * continuation of it. Nothing about it reaches the database — local games
   * are never recorded — so the game it came from cannot be touched.
   */
  function newGame(from) {
    forgetAnalysis();
    holdingResult = false;
    clearTimeout(resultTimer);
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
    turnAt = Date.now();
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
    review = null;                  // the game has moved on; so does the board
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
    /* Nothing is on its way any more either. A cell held empty for a piece
       that is no longer coming would stay empty, and every way of throwing a
       move away — a new game, an undo, stepping back — comes through here. */
    arriving = null;
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
    /* Playing from the middle of a branch replaces the rest of it. The move
       was chosen against the position on screen, so the line it belonged to
       has to be cut back to that position before it is applied — otherwise it
       would be appended to a continuation the player has just decided against. */
    if (exploring && review !== null) cutBackTo(review);
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

    // Read the heaps before the move empties them, fly once the board is drawn.
    const flight = flightFor(move, player);
    /* Held back from the board until it gets there, so the piece is never in
       two places at once. Set before the redraw, or the first frame would show
       it arrived. */
    arriving = flight ? { cell: move.cell, tile: move.type === 'tile' } : null;

    applyMove(state, move);
    lastMove = move;
    moveLog.push({ player, text: notation, captured: allCaptures.length > 0, ms: spent() });
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
    playMoveSounds(move, next, undefined, flight ? RESERVE_FLIGHT_MS : 0);
    /* The wait for whatever comes next starts now, so a computer opponent does
       not move while a piece of its own is still in the air. */
    if (flight) effectEndsAt = Math.max(effectEndsAt, Date.now() + RESERVE_FLIGHT_MS);
    refresh();
    launchFlight(flight, () => { arriving = null; refresh(); });
    afterEffect(scheduleAI);
  }

  /* `ending` is passed explicitly because the review replays a finished game:
     `result` is set the whole way through, and reading it here would sound the
     end of the game after every single move. */
  /**
   * `held` delays the contact sound by the time a piece spends crossing from a
   * reserve, so the knock happens when the piece touches the board rather than
   * when the move was decided.
   */
  function playMoveSounds(move, next, ending = Boolean(result), held = 0) {
    if (move.type === 'tile') playSound('tilePlacement', held);
    else if (move.type === 'piece') playSound('piecePlacement', held);
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
    // them: the same index now holds a different position. The count starts
    // again too: the position in front of you is a new one to think about.
    turnAt = Date.now();
    forgetAnalysis();
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
    // Two engines wait to be told to start, in a game or in a branch.
    const duel = exploring ? exploring.play === 'aiai' : mode === MODE_AI_AI;
    if (duel && !aiRunning) return;
    // Whose engine is about to think, and therefore at what strength.
    const mover = state.turn;
    thinking = true;
    refresh();
    setTimeout(() => {
      const move = chooseMove(state, levelFor(mover), { history: timeline });
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
      const move = chooseMove(state, levelFor(mover), { history: timeline });
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
    agreed: 'byAgreed',
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
    const move = payload.move;
    /* Before the position lands, while the heaps on screen are still the ones
       the move was played from. */
    const handoff = flightFor(move, payload.by);
    arriving = handoff ? { cell: move.cell, tile: move.type === 'tile' } : null;

    state = deserializeState(payload.state);
    adoptClock(payload.clock);

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

    moveLog.push({
      player: payload.by, text: payload.notation, captured: captured.length > 0,
      // The server's measurement, not ours: ours would include the trip here.
      ms: typeof payload.ms === 'number' ? payload.ms : null,
    });
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

    if (handoff) effectEndsAt = Math.max(effectEndsAt, Date.now() + RESERVE_FLIGHT_MS);
    refresh();
    launchFlight(handoff, () => { arriving = null; refresh(); });
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
    forgetAnalysis();
    if (view.colour !== undefined && view.colour !== null && view.colour >= 0) net.colour = view.colour;
    state = deserializeState(view.state);
    moveLog = (view.notations || []).map((text, i) => ({
      player: i % 2, text, captured: /×/.test(text),
      ms: (view.times || [])[i] ?? null,
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
    net.watchers = view.watchers || 0;
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
    net.drawAsked = false;      // playing on is changing your mind
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
      const view = await request(net.watching ? 'hx:watch' : 'hx:join', { code: net.code });
      if (!view.ok) {
        /* Turning up to watch a game that is yours to play: the right answer
           is the seat, not an error message about it. */
        if (view.error === 'ALREADY_PLAYING') {
          navigate('play', { online: '1', code: net.code });
          return;
        }
        net.error = view.error;
        net.ready = false;
        refresh();
        return;
      }
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
    net.unsubscribe.push(listen('hx:watchers', (payload) => {
      if (!net || payload.code !== net.code) return;
      net.watchers = payload.n || 0;
      renderNetStatus();
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
      /* The rating the header is showing has just changed. Told here, where the
         new one arrives, rather than left for the next page load — the chip and
         the profile were disagreeing about the same number. */
      const mine = net.ratings && net.colour !== null ? net.ratings[net.colour] : null;
      if (mine && typeof mine.after === 'number') ratingChanged(mine.after);
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
    net.unsubscribe.push(listen('hx:draw:offer', (payload) => {
      if (!net || payload.code !== net.code) return;
      net.drawOffered = true;
      playSound('ui');
      refresh();
    }));
    net.unsubscribe.push(listen('hx:draw:declined', (payload) => {
      if (!net || payload.code !== net.code) return;
      // Either their refusal of ours, or their withdrawal of theirs.
      if (payload.withdrawn) net.drawOffered = false;
      else net.drawAsked = false;
      refresh();
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
   * Offer to end it level, or take up the offer already on the table.
   *
   * One event does both, as with the rematch: the button says which of the two
   * it will do, so nobody has to remember whose turn it is to ask.
   */
  async function offerDraw() {
    if (!net || result || net.watching) return;
    const taking = net.drawOffered;
    const response = await request('hx:draw', { code: net.code })
      .catch(() => ({ ok: false, error: 'OFFLINE' }));
    if (!response.ok) { net.error = response.error; refresh(); return; }
    if (response.agreed) return;          // hx:ended is on its way to both sides
    if (!taking) net.drawAsked = true;
    refresh();
  }

  /** Take our offer off the table, or refuse theirs. */
  async function declineDraw() {
    if (!net) return;
    net.drawOffered = false;
    net.drawAsked = false;
    refresh();
    request('hx:draw:decline', { code: net.code }).catch(() => {});
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

    forgetAnalysis();
    timelineMoves = (archive.moves || []).slice();
    timeline = replayTimeline(timelineMoves);
    if (timeline.length !== timelineMoves.length + 1) {
      showArchiveError(t('profile.notReplayable'));
      return;
    }
    moveLog = (archive.notations || []).map((text, i) => ({
      player: i % 2, text, captured: /×/.test(text),
      ms: (archive.times || [])[i] ?? null,
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
    /* Off by choice, and off everywhere. Nothing marks the last move on a real
       table, and someone who turns this off is asking for that board — in a
       review as much as in a live game. */
    const marked = !getSetting('showLastMove') ? null
      : reviewing ? (review > 0 ? timelineMoves[review - 1] : null)
      : lastMove;
    const lastMoveCells = [];
    if (marked && !chain) {
      if (marked.type === 'tile' || marked.type === 'piece') lastMoveCells.push(marked.cell);
      else if (marked.type === 'disk') lastMoveCells.push(marked.path[0], marked.path[marked.path.length - 1]);
      else lastMoveCells.push(marked.from, marked.to);
    }

    /* Before the board, because the board is framed to fit the space left over
       and the reserves are what decide how much that is. Drawn afterwards, the
       board measured the room the reserves had taken a moment ago: on the very
       first paint they were empty, so it framed itself for a box a third
       taller than the one it got, and thereafter it was always one move behind
       — a rank of pieces spent, the reserves shrinking, and the board still
       cut for the space before. */
    renderRails(position, reviewing);

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
      arriving,
      hidden: showEffect && effect.hidden != null ? effect.hidden : -1,
      held: dragging ? drag.cell : -1,
      newTile: showEffect ? effect.newTile : null,
      newPiece: showEffect ? effect.newPiece : null,
      showValidMoves: aid,
      showCoordinates: coordinatesWanted(),
      instant: instant || board.__firstFrame,
    });
    board.__firstFrame = false;
    gameEl.classList.toggle('is-reviewing', reviewing);

    renderPicker();
    renderChainBar();
    renderResult();
    renderMoveList();
    renderReviewBar();
    renderChat();
    renderEvalBar();
    renderEvalHint();
    renderEvalCurve();
    fillCurve();
    renderNetStatus();
    syncTools();
    tickClocks();
    /* Last, because every one of the above can change how much room the board
       has, and the board was framed before any of them were drawn. */
    board.reframe(instant);
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
    /* Something is still crossing the room to this cell. Its arrival is what
       starts this, so that the piece appears where it lands rather than before
       it — one after the other, which is the order they happen in. */
    if (arriving) return;
    effect.played = true;
    /* Off means off: the position is simply there, and the move settles at
       once so nothing downstream waits on an animation nobody asked for. */
    if (!getSetting('animateMoves')) {
      effect = null;
      effectEndsAt = Date.now();
      refresh();
      return;
    }
    const total = board.playEffects(effect, () => { effect = null; refresh(); });
    effectEndsAt = Date.now() + total;
  }

  /* ── Pieces crossing the room ─────────────────────────────────────────── */

  /*
   * A piece leaving the reserve goes to the board, visibly.
   *
   * The board's own effects begin where the piece lands — it appears, and
   * grows into place — which says a piece arrived but not where from. On a
   * real table you watch a hand go to the pile and come back, and that is the
   * half a second in which you notice you are running out of rings.
   *
   * Drawn over the page rather than in the board: the reserves are HTML beside
   * the board and the board is an SVG with its own coordinate system, so the
   * only place both exist is the screen. Fixed to the viewport, above
   * everything, and gone the moment it lands — nothing on the page depends on
   * it, so nothing breaks if the browser refuses to animate it.
   */
  const RESERVE_FLIGHT_MS = 260;

  function pileRect(player, pile, kind) {
    const rail = rails[player];
    const heap = rail && rail.querySelector(`[data-pile="${pile}-${kind}"]`);
    if (!heap) return null;
    /* The first of them, because on a phone it is the only one there is: the
       heap is drawn as one piece and a count, and the rest are still in the
       markup with no size at all. Asking for the last gave a box of nought by
       nought and no piece ever left the reserve — on the screen where watching
       it go is worth the most. */
    const token = heap.querySelector('.token') || heap;
    let box = token.getBoundingClientRect();
    if (!box.width) box = heap.getBoundingClientRect();
    if (!box.width) return null;
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, side: box.width };
  }

  function cellRect(cell) {
    const middle = board.toScreenSpace(cx(cell), cy(cell));
    const across = board.toScreenSpace(cx(cell) + SIZE, cy(cell));
    const unit = Math.abs(across.x - middle.x);
    if (!unit) return null;
    return { x: middle.x, y: middle.y, side: unit * 1.7 };
  }

  /**
   * Send `glyph` across the screen to wherever `landing` says, then forget it.
   *
   * The destination is asked for on every frame rather than measured once,
   * because laying a tile can re-frame the board — the cell being flown to is
   * itself sliding and growing while the piece is in the air. Handed a fixed
   * point, the piece landed where the cell used to be and the board had moved
   * on without it.
   *
   * Its own loop rather than the browser's animation engine for the same
   * reason: a keyframe pair is decided up front, and this target is not known
   * up front. Nothing on the page depends on any of it — if the loop never
   * runs, a timer takes the piece away and the move is exactly as it was.
   */
  function fly(glyph, from, landing) {
    if (!from || !document.body) return;
    const first = landing();
    if (!first) return;
    const node = document.createElement('div');
    node.className = 'fly';
    node.innerHTML = glyph;
    document.body.appendChild(node);

    const started = performance.now();
    const done = () => node.remove();
    const place = (to, t) => {
      // Smooth out, so it leaves the pile briskly and settles onto the cell.
      const e = 1 - Math.pow(1 - t, 3);
      const side = from.side + (to.side - from.side) * e;
      node.style.width = `${side.toFixed(1)}px`;
      node.style.height = `${side.toFixed(1)}px`;
      node.style.left = `${(from.x + (to.x - from.x) * e - side / 2).toFixed(1)}px`;
      node.style.top = `${(from.y + (to.y - from.y) * e - side / 2).toFixed(1)}px`;
    };
    place(first, 0);

    const tick = (now) => {
      // Clamped at both ends: a timestamp from before the start would put the
      // piece somewhere off the screen rather than at the pile it left.
      const t = Math.max(0, Math.min(1, (now - started) / RESERVE_FLIGHT_MS));
      const to = landing() || first;
      place(to, t);
      if (t < 1) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
    // A loop that never starts must not leave a piece stuck to the screen.
    setTimeout(done, RESERVE_FLIGHT_MS + 400);
  }

  const wantsFlight = () => getSetting('animatePlacement')
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * Note where a move's pieces are coming from, before the board is redrawn.
   *
   * The heaps shrink as soon as the position changes, so the starting point
   * has to be read while it is still true. The landing point cannot be read
   * yet — the tile is not laid — so the flight waits a frame for the board to
   * have drawn it.
   */
  function flightFor(move, player) {
    if (!wantsFlight()) return null;
    if (move.type === 'tile') {
      return { glyph: tokenSvg('tile', player), from: pileRect(player, 'reserve', 'tile'), cell: move.cell };
    }
    if (move.type !== 'piece') return null;
    const kind = move.piece === RING ? 'ring' : 'disk';
    const plan = {
      glyph: tokenSvg(kind, player), from: pileRect(player, 'reserve', kind), cell: move.cell,
    };
    /* A ring is paid for with a captured disk, handed back to the player it
       was taken from. That is the one move where something travels between the
       two reserves without touching the board, and watching it go is the only
       way the trade is ever visible. */
    if (move.piece === RING) {
      plan.repaid = {
        glyph: tokenSvg('disk', 1 - player),
        from: pileRect(player, 'taken', 'disk'),
        to: () => pileRect(1 - player, 'reserve', 'disk'),
      };
    }
    return plan;
  }

  /**
   * Let the board draw, then send the pieces across to where they landed.
   *
   * `landed` is called once, whatever happens: when the flight ends, and by a
   * timer if the frames never come. Whoever is waiting on it — the board with
   * a cell held empty, the move with its animation not yet played — has to be
   * released even on a browser that refuses to animate anything.
   */
  function launchFlight(plan, landed) {
    if (!plan) { if (landed) landed(); return; }
    let done = false;
    const settle = () => { if (done) return; done = true; if (landed) landed(); };
    requestAnimationFrame(() => {
      fly(plan.glyph, plan.from, () => cellRect(plan.cell));
      if (plan.repaid) fly(plan.repaid.glyph, plan.repaid.from, plan.repaid.to);
    });
    setTimeout(settle, RESERVE_FLIGHT_MS);
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
   *
   * Every piece is drawn, always. On a phone the stylesheet shows the first of
   * them and writes the rest as a number — nine pieces laid out one by one is
   * two rows of a screen that has none to spare — and it can do that because
   * the count is on the pile for it to read. Which of the two it is stays a
   * question of how much room there is, so it is answered in CSS and settled
   * again the instant the phone is turned, with nothing to re-render.
   */
  function stackHtml(kind, colour, count, usable, pile = 'reserve') {
    if (!count) return '';
    /* Named so a piece can be animated out of the right heap. Not by whether
       it can be tapped: a pile the computer is playing from is not tappable
       and its pieces still have to come from somewhere. */
    let out = `<div class="stack" data-count="${count}" data-pile="${pile}-${kind}">`;
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
        + stackHtml('disk', opponent, position.capturedDisks[player], false, 'taken')
        + stackHtml('ring', opponent, position.capturedRings[player], false, 'taken');
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
    /*
     * Hold the card back until the move that ended the game has been seen.
     *
     * The winning move is the one worth watching, and the card covers the
     * board — so it used to arrive on top of its own cause. Wait for the
     * animation to settle, then a beat longer, then say who won.
     */
    if (result && !resultSeen) {
      /* `effect` is the move still waiting to be played. This runs earlier in
         the same refresh than runEffect does, so asking the board how much
         animation is left would always answer none — which is why the card
         used to land on top of the move that caused it. */
      const animating = Boolean(effect) || board.remainingEffectMs() > 0;
      if (animating) {
        holdingResult = true;
        overlay.classList.remove('is-on');
        return;                     // the effect's own callback refreshes us
      }
      if (holdingResult) {
        holdingResult = false;
        clearTimeout(resultTimer);
        resultTimer = setTimeout(renderResult, RESULT_BEAT_MS);
        overlay.classList.remove('is-on');
        return;
      }
      /* Nothing was playing — a resignation, an agreed draw, a flag — so
         there is nothing to watch and no reason to make anyone wait. */
    }
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
    /* Somebody who was watching has nothing to ask for: a rematch is between
       the two who played, and a new opponent is a thing you go and find. What
       is left is the game they just watched. */
    if (net.watching) return viewButton + menu;

    // Online, a rematch is a request, not a decision: the wording says which.
    const label = net.rematchOffered ? t('result.rematchAccept')
      : (net.rematchAsked ? t('result.rematchWaiting') : t('result.rematch'));
    return `<button class="btn btn--primary" data-action="rematch"${net.rematchAsked ? ' disabled' : ''}>`
      + `${label}</button>`
      + viewButton
      + `<button class="btn" data-action="new-online">${t('result.newOpponent')}</button>`
      + menu;
  }

  /* ── Playing on from a position ───────────────────────────────────────── */

  /**
   * Offer to carry on from whatever is on screen.
   *
   * The choice of opponent is asked for rather than assumed: someone reading a
   * game back may want to try the position against the engine, or to set it up
   * for two people at a table, or simply to watch it played out.
   */
  /*
   * Picking up a position takes two steps, not one.
   *
   * It used to start the moment the mode was chosen, on whatever level the
   * settings happened to hold and playing whichever colour was to move. If that
   * was not the arrangement you wanted there was nothing to be done about it:
   * changing the level mid-game is changing the game, and this position exists
   * to be tried under a particular arrangement. So the second step asks, and
   * "two players here" — which has nothing to arrange — skips it.
   */
  let resumeSetup = null;   // null, or the mode being configured

  function openResumeSheet() {
    resumeSetup = null;
    const options = [
      ['hand', t('review.playHand')],
      ['ai', t('review.resumeVsAi')],
      ['local', t('review.resumeTwo')],
      ['aiai', t('review.resumeWatch')],
    ];
    const now = exploring ? exploring.play : 'hand';
    resumeEl.innerHTML = `<p class="resume-title">${t('review.playTitle')}</p>`
      + options.map(([id, label]) =>
        `<button class="btn resume-choice${
          (id === now || (id === 'local' && now === 'hand')) && id !== 'local' ? ' is-on' : ''
        }" data-resume="${id}">${label}</button>`).join('')
      + `<button class="btn btn--link" data-resume="cancel">${t('game.cancel')}</button>`;
    resumeEl.hidden = false;
  }

  /** Step two: the arrangement, before a move is played under it. */
  function openResumeSetup(mode) {
    resumeSetup = mode;
    const turn = shownState() ? shownState().turn : BLACK;
    const rows = mode === MODE_AI
      ? `
        <label class="resume-row"><span>${t('review.resumeSide')}</span>
          <select class="btn" data-setup="side">
            <option value="0"${turn === BLACK ? ' selected' : ''}>${t('common.black')}</option>
            <option value="1"${turn === WHITE ? ' selected' : ''}>${t('common.white')}</option>
          </select></label>
        <label class="resume-row"><span>${t('review.resumeLevel')}</span>
          <select class="btn" data-setup="level">${levelOptions()}</select></label>`
      : `
        <label class="resume-row"><span>${t('game.levelOf', { colour: t('common.black') })}</span>
          <select class="btn" data-setup="levelBlack">${levelOptions()}</select></label>
        <label class="resume-row"><span>${t('game.levelOf', { colour: t('common.white') })}</span>
          <select class="btn" data-setup="levelWhite">${levelOptions()}</select></label>`;

    resumeEl.innerHTML = `<p class="resume-title">${t('review.resumeTitle', { n: reviewPly() })}</p>`
      + rows
      + `<button class="btn btn--primary resume-choice" data-resume="go">${t('review.resumeStart')}</button>`
      + `<button class="btn btn--link" data-resume="back">${t('nav.back')}</button>`;
    resumeEl.hidden = false;

    // The levels start where this view's own do, so the sheet opens on the
    // arrangement already in hand rather than on the first entry in the list.
    const set = (name, value) => {
      const field = resumeEl.querySelector(`[data-setup="${name}"]`);
      if (field) field.value = String(value);
    };
    if (mode === MODE_AI) set('level', level);
    else { set('levelBlack', duelLevels[0]); set('levelWhite', duelLevels[1]); }
  }

  /** What the setup step is currently showing. */
  function readResumeSetup(mode) {
    const read = (name, fallback) => {
      const field = resumeEl.querySelector(`[data-setup="${name}"]`);
      return field ? Number(field.value) : fallback;
    };
    if (mode === MODE_AI) {
      return { side: read('side', shownState().turn), levels: [read('level', level), read('level', level)] };
    }
    return { side: null, levels: [read('levelBlack', duelLevels[0]), read('levelWhite', duelLevels[1])] };
  }

  const closeResumeSheet = () => {
    resumeSetup = null;
    resumeEl.hidden = true;
    resumeEl.innerHTML = '';
  };

  const reviewPly = () => (review === null ? timeline.length - 1 : review);

  /**
   * Hand the position to a fresh local game.
   *
   * Local games are never written anywhere, so the game this came from is
   * untouched by construction rather than by care — there is no code path from
   * here that could reach it.
   */
  /**
   * Push the pieces around from here, without losing the game it came from.
   *
   * The line up to this ply is kept and everything after it is set aside — not
   * discarded: the whole of it is held so that leaving puts the game back move
   * for move. Both colours answer to the same hand, which is what makes it
   * exploring rather than playing: the question is "what if this had gone
   * differently", and nobody is on the other side of it.
   */
  /**
   * Cut the line back to `at` and stand on it.
   *
   * Shared by the two ways a branch is made: stepping out of the game into
   * one, and playing a move in the middle of one you are already in. The
   * second is the whole of what makes a branch feel like an analysis board —
   * go back three moves, play something else, and what came after is gone.
   */
  function cutBackTo(at) {
    timeline = timeline.slice(0, at + 1);
    timelineMoves = timelineMoves.slice(0, at);
    moveLog = moveLog.slice(0, at);
    state = cloneState(timeline[at]);
    lastMove = at > 0 ? timelineMoves[at - 1] : null;
    result = null;
    resultSeen = false;
    review = null;
    history = [];
    forgetAnalysis();
    /* Rebuilt from the line that survives, so the threefold rule counts the
       positions this branch actually stands on rather than starting blind. */
    repetitions = new Map();
    for (const position of timeline) {
      const signature = positionKey(position);
      repetitions.set(signature, (repetitions.get(signature) || 0) + 1);
    }
    selected = null;
    chain = null;
    placeMode = null;
    picker = null;
    clearEffect();
  }

  function startExploring() {
    /* Only from a game there is nothing left to play. The button is hidden
       otherwise, but hidden is a fact about the screen and this is a fact
       about the game: branching off a game still in progress would put its
       real position behind a sandbox nobody asked for. */
    if (!isReview()) return;
    // Whatever was on the clock belonged to the game, not to the branch.
    turnAt = Date.now();
    const at = reviewPly();
    const fresh = !exploring;
    if (exploring) {
      // Branching again from inside a branch. The game underneath is already
      // held; only the branch is being cut back, so the original stays put.
      // `at` moves with it, or the strip would name the older starting point.
      exploring.at = at;
    } else {
      exploring = {
        timeline, timelineMoves, moveLog, history, repetitions,
        state, result, lastMove, review, resultSeen, at,
        /* Nobody is playing it but you, until you say otherwise. */
        play: 'hand',
        side: (timeline[at] || state).turn,
      };
    }
    cutBackTo(at);
    refresh();
    /* And ask who is playing it, straight away. Branching is the question
       "what if", and the first thing that decides is who answers it — so it is
       asked at the door rather than left behind a button somebody has to
       notice. Only on the way in: re-branching from inside a branch keeps the
       arrangement it already has. */
    if (fresh) openResumeSheet();
  }

  /**
   * Put the game back exactly as it was and throw the branch away.
   *
   * Including whether its ending had been seen: the way back from a branch is
   * the way back to the end of the game, and a card that had been dismissed
   * before the branch was opened should be there again — that is what the
   * button is for.
   */
  function stopExploring() {
    if (!exploring) return;
    turnAt = Date.now();
    ({ timeline, timelineMoves, moveLog, history, repetitions,
      state, result, lastMove, review } = exploring);
    resultSeen = false;
    aiRunning = false;
    exploring = null;
    forgetAnalysis();            // the branch's numbers were not about this game
    selected = null;
    chain = null;
    placeMode = null;
    picker = null;
    clearEffect();
    refresh();
  }

  /**
   * Hand the branch to somebody — or take it back.
   *
   * This used to carry the position off to a brand new game, which is why
   * there was no way back to the one it came from: the game was not carried
   * with it. Nothing leaves now. The branch simply changes who is playing it,
   * so the game underneath is still held and "back to the game" is always
   * there. Changing your mind mid-branch is allowed and costs nothing.
   */
  function playBranch(kind, setup) {
    if (!exploring) return;
    closeResumeSheet();          // the click that got here has already sounded
    if (kind === 'hand' || kind === MODE_LOCAL) {
      exploring.play = 'hand';
      aiRunning = false;
      thinking = false;
      refresh();
      return;
    }
    exploring.play = kind === MODE_AI_AI ? 'aiai' : 'ai';
    /* Carrying on as the colour whose turn it is remains the default — the
       interesting question is almost always "what should have been played
       here" — but the setup step may have said otherwise. */
    exploring.side = setup && setup.side !== null && setup.side !== undefined
      ? setup.side : shownState().turn;
    if (setup && setup.levels) {
      level = setup.levels[0];
      duelLevels = [setup.levels[0], setup.levels[1]];
    }
    /* Two engines need to be told to start; one engine simply answers you. */
    aiRunning = exploring.play === 'aiai';
    /* Playing on means playing on from here, so the line stops at the position
       being looked at rather than continuing one further down. */
    if (review !== null) cutBackTo(review);
    refresh();
    afterEffect(scheduleAI);
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
    /* Asking for the ply already on screen is a redraw, never an arrival.
     *
     * Clamping turned a step past either end into a step onto the end you were
     * already standing on, and that played as an arrival: the last move of the
     * game animated and sounded again on every press of the right arrow at the
     * end of it. The buttons on the bar grey out there and said so honestly;
     * the keys had no such thing and kept replaying the move.
     *
     * It still draws before returning. Callers treat this as "show ply n" and
     * expect the view to be right afterwards — loading a stored game with no
     * moves in it asks for ply 0 while already on ply 0, and the result card
     * would never appear if that did nothing at all. */
    if (target === (review === null ? last : review)) { refresh(true); return; }
    /* Moving the board calls off whatever was queued to think about it. The
       search already running cannot be stopped, but the next one has not begun
       and does not have to: an arrow held down then costs one search, not one
       per ply it swept past. */
    clearTimeout(curveTimer);
    clearTimeout(hintTimer);
    review = target >= last ? null : target;
    /* Moving through the game says nothing about the panel. This used to open
       it on the way into a review, which made a look at the previous move cost
       you half the board — and once shut, the next arrow press pushed it open
       again. The two are separate things: the arrows work the same whether the
       panel is up or down. Entering a review deliberately still opens it, from
       the places that mean it — the archive on mount, and "review the game". */
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
    /* The position changes at once; the frame does not have to. Stepping back
       through a game used to snap the board to its new framing on every press,
       which is the same jolt the panel used to give — and the frame only moves
       at all on the plies where a tile was laid, so most presses cost nothing
       either way. `animate` is about the move being replayed, not the camera. */
    refresh();
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
    /* The way out of a branch has to be reachable from the end of it, where
       there is nothing to step back from — so it does not hang off is-back
       the way the live button does during a game. */
    reviewBar.classList.toggle('is-exploring', Boolean(exploring));
    /* Carrying the position off to play it out is analysis, not reading, so it
       waits for the game to be over like the bar and the curve do — and an
       exploration is analysis too, so a position reached by hand can be handed
       on to the engine from there.

       Except at the very end of a game the board itself finished. Six disks
       are six disks: play on from there and it is over before you have moved.
       The offer stands at the last move only when the game stopped for a
       reason outside the position — a flag, a resignation, somebody who did
       not come back, a draw the two players agreed to — because in every one
       of those the position had plenty of game left in it. */
    /*
     * Who is playing the branch — the button that used to carry the position
     * off to a new game.
     *
     * Only inside a branch, because outside one the answer is "the two people
     * whose game this is" and there is nothing to choose. And not while the
     * position on screen is one that ends a game: six disks are six disks, and
     * handing that to an engine gives a game that is over before it starts.
     * Stepping back one move inside the branch offers it again.
     */
    const players = reviewBar.querySelector('[data-action="resume"]');
    const finished = Boolean(checkWinner(shownState()));
    players.hidden = !exploring || finished;
    if (exploring) players.textContent = t('review.playedBy.' + exploring.play);
    reviewBar.querySelector('[data-action="explore"]').hidden = !isReview();
    /* "Back to the game" only while there is a game to be back in. In a review
       there is no present to return to — the last ply is just the last ply, and
       ⏭ already goes there in one press. Mid-game it is the one control that
       says something the arrows do not: stop reading, the board has moved on
       without you. Exploring brings it back with the other meaning it can
       carry: leave the branch, put the game back. */
    const live = reviewBar.querySelector('[data-action="rev-live"]');
    live.hidden = isReview() && !exploring;
    live.textContent = exploring ? t('review.leaveExploring') : t('review.backToLive');
    /*
     * Watching the game play itself is analysis too, so it keeps the same
     * company as the two buttons beside it.
     *
     * Mid-game the arrows are for glancing at the move before and coming
     * straight back; nobody sits through a replay of a game they are in the
     * middle of. Off the bar it takes the speed control and the rule between
     * them with it — three controls, and on a phone the difference between one
     * row of bar and two, which is a row of board.
     */
    const analysing = isReview();
    const playButton = reviewBar.querySelector('[data-action="rev-play"]');
    if (!analysing && isAutoplaying()) stopAutoplay();
    playButton.hidden = !analysing;
    reviewBar.querySelector('.review-sep').hidden = !analysing;
    reviewBar.querySelector('[data-control="rev-speed"]').hidden = !analysing;
    playButton.textContent = isAutoplaying() ? '⏸' : '▶';
    playButton.classList.toggle('is-on', isAutoplaying());
    playButton.title = isAutoplaying() ? t('review.pause') : t('review.play');
  }

  const escapeText = (value) => String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Each half-move is a link into the review: click it and the board goes there. */
  /**
   * How long a move took, short enough to sit beside it.
   *
   * Three shapes, because a game holds all three: a blitz reply is tenths of a
   * second and rounding it to "0s" throws away the only interesting thing
   * about it; a normal move is a handful of seconds; a hard one is minutes,
   * and minutes want a colon.
   *
   * Null for a move whose time nobody recorded — every game played before this
   * existed, and there is no getting it back. Nothing is written in that case:
   * a blank says "not known" where a 0s would say "played instantly".
   */
  function clockText(ms) {
    if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '';
    const seconds = ms / 1000;
    if (seconds < 10) return `${seconds.toFixed(1)}s`;
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const total = Math.round(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function renderMoveList() {
    if (!drawerOpen || drawerTab !== 'moves') return;
    const at = review === null ? timeline.length - 1 : review;
    const cell = (entry, ply, extra) => {
      if (!entry) return '<span></span>';
      const classes = [extra, entry.captured ? 'took' : '', ply === at ? 'is-at' : '']
        .filter(Boolean).join(' ');
      const took = clockText(entry.ms);
      return `<span class="ply ${classes}" data-ply="${ply}">${entry.text}`
        + (took ? `<i class="ply-time">${took}</i>` : '') + '</span>';
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
    /*
     * A shut panel holds nothing, the cursor included.
     *
     * Left and right belong to the chat box while you are typing in it — they
     * are how you move through a word — so the board only gets them when the
     * box does not have the cursor. Putting the panel away left the cursor
     * inside it, in a box nobody could see, and the two keys went on editing
     * text instead of walking through the game. Whichever tab it was on: the
     * chat box keeps the cursor even while the move list is the one showing.
     */
    if (!drawerOpen && drawer.contains(document.activeElement)) document.activeElement.blur();
    buildDrawerButton();
    showDrawerTab(tab || drawerTab);
    measureBelowBoard();
    followTheDrawer();
  }

  /*
   * The board keeps up with the panel instead of catching up after it.
   *
   * The panel slides over about a quarter of a second and the board used to be
   * told once, when it had finished, and told to jump: the drawer glided and
   * the board snapped, which is the jolt. There is nothing to animate here —
   * the box the board is cut to fit is already moving smoothly, so the frame
   * only has to be recut against it on every frame while it does, and the
   * smoothness comes from the thing that was smooth all along.
   */
  function followTheDrawer() {
    cancelAnimationFrame(drawerFollow);
    const until = Date.now() + 380;          // the transition, and a little after
    const tick = () => {
      measureBelowBoard();
      board.reframe(true);
      drawerFollow = Date.now() < until ? requestAnimationFrame(tick) : 0;
    };
    drawerFollow = requestAnimationFrame(tick);
    // One ordinary refresh at the end, for everything that is not the frame.
    clearTimeout(drawerSettle);
    drawerSettle = setTimeout(() => { measureBelowBoard(); refresh(); }, 400);
  }

  function showDrawerTab(name) {
    /* Watching a game shows the moves and nothing else: what the two players
       say over a board is theirs, and the server does not send it here. */
    if (net && net.watching && name === 'chat') name = 'moves';
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
    /* A branch has its own arrangement, and the controls that belong to one —
       the levels, and the button that sets two engines going — belong to it
       just as much as they do to a game set up the same way. */
    const isDuel = exploring ? exploring.play === 'aiai' : mode === MODE_AI_AI;
    const engineHere = exploring
      ? exploring.play !== 'hand'
      : (!net && !archiveId && mode !== MODE_LOCAL);
    const show = (selector, visible) => {
      const node = tools.querySelector(selector);
      if (node) node.style.display = visible ? '' : 'none';
    };
    tools.querySelector('[data-control="mode"]').value = mode;
    /* Online, none of the local controls apply: no mode, no AI, no undo. In a
       stored game none of them do either — there is nothing left to play. */
    const local = !net && !archiveId && !exploring;
    show('[data-control="mode"]', local);
    show('[data-control="side"]', local && mode === MODE_AI);
    show('[data-control="level"]', engineHere && !isDuel);
    show('[data-control="levelBlack"]', engineHere && isDuel);
    show('[data-control="levelWhite"]', engineHere && isDuel);
    show('[data-action="run"]', engineHere && isDuel);
    show('[data-action="step"]', engineHere && isDuel);
    show('[data-action="undo"]', local || Boolean(exploring));
    show('[data-action="new"]', local);
    const seated = Boolean(net) && !net.watching;
    show('[data-action="resign"]', seated);
    show('[data-action="draw"]', seated && !result);
    const draw = tools.querySelector('[data-action="draw"]');
    if (draw) {
      const taking = Boolean(net && net.drawOffered);
      draw.classList.toggle('is-on', taking || Boolean(net && net.drawAsked));
      draw.disabled = Boolean(net && net.drawAsked && !taking);
      draw.title = taking ? t('game.drawAccept')
        : (net && net.drawAsked ? t('game.drawWaiting') : t('game.drawOffer'));
    }

    const run = tools.querySelector('[data-action="run"]');
    run.textContent = aiRunning ? '⏸' : '▶';
    run.classList.toggle('is-on', aiRunning);
    tools.querySelector('[data-action="step"]').disabled = thinking || !!result || aiRunning;
    // Undoing while reading back would rewrite the game under the review.
    tools.querySelector('[data-action="undo"]').disabled =
      thinking || !history.length || review !== null;
    const resignButton = tools.querySelector('[data-action="resign"]');
    if (resignButton) resignButton.disabled = !net || !net.ready || !!result;

    /* No button for an empty menu. Reading back a stored game leaves nothing
       in here at all — no mode to change, no game to resign — and a control
       that opens onto nothing is worse than no control. */
    const anyTool = [...tools.children].some((node) => node.style.display !== 'none');
    const menuButton = barEl.querySelector('.bar-menu');
    if (menuButton) menuButton.hidden = !anyTool;
    if (!anyTool && toolsOpen()) setToolsOpen(false);
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
   * This game is over, so the tools of a review are open.
   *
   * A game still going can be read — stepping back through the moves is part
   * of playing it, and the history stays available throughout. It cannot be
   * analysed. The evaluation bar, the curve and "play from here" all set the
   * engine on the position, and doing that mid-game is the one thing a rated
   * game cannot allow; the difference is between looking at what happened and
   * asking what to do about it. A stored game counts only once it has arrived,
   * or the verdict lands on the empty board it has not replaced yet.
   */
  const isReview = () => Boolean(exploring)
    || (archiveId ? Boolean(archive) : Boolean(result));

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
    if (!isReview()) { evalBar.hidden = true; return; }
    const at = review === null ? timeline.length - 1 : review;
    /* Only what is already known. Judging here would put the search inside the
       redraw, which is inside the animation — the bar keeps its last reading
       for the moment it takes the board to settle, rather than holding the
       board still while it thinks. */
    const verdict = evalCache.get(at);
    if (!verdict) { wantAnalysis(); return; }

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

  /*
   * The move the engine would play in the position on screen.
   *
   * Searched deeper than the bar is — the bar wants a number for every ply and
   * gets a quick one; this wanted the right move for one ply and paid 60 to 320
   * ms for it, on a timer that fired straight into the arrival animation. A
   * single thread cannot animate and search at once, so the review stuttered on
   * every step. It was also a second search for something the first one already
   * knew: judge returns its move now, so the bar's own verdict carries it and
   * the note costs nothing beyond what the bar was already spending.
   */
  function renderEvalHint() {
    const at = review === null ? timeline.length - 1 : review;
    // Nothing to suggest where the game is already over.
    const over = Boolean(result) && at === timeline.length - 1;
    if (!isReview() || over || !timeline[at]) {
      evalHint.hidden = true;
      return;
    }
    const known = evalCache.get(at);
    if (!known) { evalHint.hidden = true; return; }   // waits for the bar's answer
    const move = known.move;
    if (!move) { evalHint.hidden = true; return; }
    evalHint.hidden = false;
    evalHint.textContent = moveNotation(move, cellLabel);
    /* Playable only inside an exploration, which is the one place a move can
       be played without writing over anything. Elsewhere it is a note. */
    const playable = Boolean(exploring) && review === null;
    evalHint.classList.toggle('is-playable', playable);
    evalHint.disabled = !playable;
    evalHint.title = playable ? t('review.hintPlay') : t('review.hintTitle');
  }

  evalHint.addEventListener('click', () => {
    if (!exploring || review !== null) return;
    const known = evalCache.get(timeline.length - 1);
    const suggested = known && known.move;
    if (!suggested) return;
    /* Resolved against the live position rather than played as it was found:
       the search ran on a copy, and a move is only ever committed here after
       the board it belongs to has agreed to it. */
    const real = findLegalMove(state, moveIntent(suggested));
    if (!real) return;
    playSound('ui');
    commit(real);
  });

  /** The judgement for one ply, computed once and remembered. */
  function verdictAt(ply) {
    let found = evalCache.get(ply);
    if (!found) {
      /* Only what came before the ply being judged. Handing it the whole game
         would have the search treat positions that have not happened yet as
         though they had, and call a line drawn on the strength of a repetition
         still in the future. */
      found = judge(cloneState(timeline[ply]),
        { ...JUDGE_BUDGET, history: timeline.slice(0, ply + 1) });
      evalCache.set(ply, found);
    }
    return found;
  }

  /*
   * How hard each ply is thought about.
   *
   * A search cannot be interrupted once it has started — one thread, and it
   * does not yield — so the only lever on how long the page can freeze is how
   * much is asked for at once. Measured over a 42-ply game: at 250ms/depth 6
   * the curve cost 3.3 seconds of blocked thread, single plies reaching 251ms,
   * which is a quarter-second of nothing moving. At this budget the same game
   * costs 857ms and the worst ply is 74 — under a blink, and it lands between
   * frames. The shallower reading moves the bar by a hair, and is the whole
   * difference between a review that glides and one that lurches.
   */

  /**
   * Nothing is judged while anything is moving.
   *
   * A search and an animation want the same single thread, and the search wins
   * every time — it does not yield. Asking for one during the arrival of a move
   * is asking for the move to arrive late, which is what made stepping through
   * a game feel like wading. So the work waits for the board to be still, and
   * any change starts the wait again: stepping quickly never pays for the plies
   * it went past, because their turn never came.
   */
  const boardIsStill = () => !effect && board.remainingEffectMs() <= 0;

  function wantAnalysis() {
    clearTimeout(hintTimer);
    if (!isReview()) return;
    const at = review === null ? timeline.length - 1 : review;
    const needed = !evalCache.has(at) || curveShown();
    if (!needed) return;
    hintTimer = setTimeout(() => {
      if (!boardIsStill()) { wantAnalysis(); return; }     // still moving: wait again
      /* The ply on screen first — it is the one being looked at — and the rest
         of the curve after it, a slice at a time. */
      if (!evalCache.has(at)) {
        verdictAt(at);
        renderEvalBar();
        renderEvalHint();
        wantAnalysis();
        return;
      }
      fillCurve();
    }, 120);
  }

  /**
   * Fill in the plies nobody has looked at yet, a few at a time.
   *
   * Judging a whole game is a second or two of work. Done in one go it is a
   * second or two with the page frozen, so it is done in slices with the
   * browser given the gaps: the curve draws itself in as the answers arrive,
   * which is also a plainer thing to watch than a spinner.
   */
  /** Whether the curve is on screen, and so worth the work behind it. */
  const curveShown = () =>
    isReview() && timeline.length > 1 && drawerOpen && drawerTab === 'moves';

  function fillCurve() {
    clearTimeout(curveTimer);
    if (!curveShown()) return;
    const missing = [];
    for (let i = 0; i < timeline.length; i++) if (!evalCache.has(i)) missing.push(i);
    if (!missing.length) return;
    /* And not while anything is moving: the curve can afford to arrive late,
       an animation cannot. */
    if (!boardIsStill()) { curveTimer = setTimeout(fillCurve, 120); return; }
    /* One at a time with a real gap after it. Two was twice the freeze for the
       same curve, and the curve is in no hurry — what matters is that a tap or
       an arrow lands between the slices rather than behind them. */
    verdictAt(missing[0]);
    /* The bar and the note as well as the curve. This fills whatever ply is
       missing, and the ply on screen is usually the one that just appeared —
       so it was answering the question and then redrawing only the part of the
       page that had not asked it. The note stayed blank and the bar kept the
       previous ply's number until something else forced a redraw, which is
       what pressing an arrow was doing. */
    renderEvalCurve();
    renderEvalBar();
    renderEvalHint();
    curveTimer = setTimeout(fillCurve, 32);
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
    const on = curveShown();
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
    /* A branch says so, and says the game is still there — otherwise moving a
       piece on a game you were reading looks like you have just written on it.
       Ahead of everything else, since a branch is the most immediate truth
       about what is on the board. */
    if (exploring) {
      strip.className = 'net-strip is-on';
      strip.innerHTML = `<span class="net-msg">${
        t('review.exploringFrom', { n: exploring.at })}</span>`;
      return;
    }

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
    } else if (net.drawOffered) {
      message = t('game.drawOfferedBy');
      tone = 'is-warn';
    } else if (net.drawAsked) {
      message = t('game.drawWaiting');
    } else if (net.watching) {
      message = t('game.turnOf', { colour: colourName(state.turn) });
    } else {
      message = state.turn === net.colour ? t('game.yourTurn') : t('game.turnOf', { colour: colourName(state.turn) });
    }

    /* Who is on the other side is written over their pieces; what is left for
       the strip is what is happening and what is at stake. */
    const stakeLabel = net.rated
      ? `<span class="net-stake is-rated" title="${t('online.rated')}">${t('online.rated')}</span>`
      : `<span class="net-stake" title="${t('online.signInToRate')}">${t('online.unrated')}</span>`;

    /* Who is looking on. Said to the players because being watched is worth
       knowing, and to the spectators because a room with others in it is a
       different thing from an empty one. */
    const eyes = net.watchers
      ? `<span class="net-eyes" title="${t('watch.count', { n: net.watchers })}">`
        + `👁 ${net.watchers}</span>`
      : '';
    const asWatcher = net.watching
      ? `<span class="net-stake is-watching">${t('watch.badge')}</span>` : '';

    const drawAnswer = net.drawOffered && !result
      ? `<button class="btn btn--sm btn--primary" data-action="draw">${t('lobby.accept')}</button>`
        + `<button class="btn btn--sm" data-action="draw-decline">${t('lobby.decline')}</button>`
      : '';

    strip.className = `net-strip is-on ${tone}`;
    strip.innerHTML =
      asWatcher
      + `<span class="net-msg">${message}</span>`
      + drawAnswer
      + eyes
      + `<span class="grow"></span>`
      + stakeLabel;

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
    playSound('ui');
    if (which === 'cancel') { closeResumeSheet(); return; }
    if (which === 'back') { openResumeSheet(); return; }
    if (which === 'go') { playBranch(resumeSetup, readResumeSetup(resumeSetup)); return; }
    /* Nobody to arrange for: by hand, and two players on this device, are the
       same thing here — you move both sides — so they start where the others
       stop to ask. */
    if (which === 'hand' || which === MODE_LOCAL) { playBranch(which, null); return; }
    openResumeSetup(which);
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
    /* Into the box rather than straight out as a message, the way the lobby
       does it: an emoji is usually the end of a sentence rather than the whole
       of one, and sending on tap would make the row a way to say exactly one
       thing by accident. */
    const emoji = event.target.closest('[data-emoji]');
    if (emoji) {
      playSound('ui');
      chatInput.value = (chatInput.value + emoji.getAttribute('data-emoji')).slice(0, 300);
      chatInput.focus();
      return;
    }

    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    playSound('ui');
    /* Anything else chosen out of the folded menu is the end of the errand it
       was opened for, so it closes behind them. The selects do not: changing
       the level and then the colour is one errand. */
    if (action !== 'tools' && tools.contains(button)) setToolsOpen(false);
    if (action === 'tools') setToolsOpen(!toolsOpen());
    else if (action === 'undo') undoLast();
    else if (action === 'new') { if (net) { navigate('online'); return; } aiRunning = false; newGame(); }
    else if (action === 'new-online') navigate('online');
    else if (action === 'menu') navigate('home');
    else if (action === 'resign') resign();
    else if (action === 'draw') offerDraw();
    else if (action === 'draw-decline') declineDraw();
    /* Asking to review the game is asking for the whole review, moves and
       curve included — the one place a local game opens the panel by itself,
       now that stepping back no longer does. */
    else if (action === 'review-game') { resultSeen = true; goToPly(0); setDrawer(true, 'moves'); }
    else if (action === 'rematch') askRematch();
    else if (action === 'rev-first') { stopAutoplay(); goToPly(0); }
    else if (action === 'rev-prev') { stopAutoplay(); stepReview(-1); }
    else if (action === 'rev-next') { stopAutoplay(); stepReview(1); }
    else if (action === 'rev-last') { stopAutoplay(); goToPly(timeline.length - 1); }
    else if (action === 'rev-live') {
      stopAutoplay();
      // Two meanings, one button: leave the branch, or catch up to the present.
      if (exploring) stopExploring();
      else goToPly(timeline.length - 1);
    } else if (action === 'resume') { stopAutoplay(); openResumeSheet(); }
    else if (action === 'explore') { stopAutoplay(); startExploring(); }
    else if (action === 'guest-sign-in') { openPanel('account'); }
    else if (action === 'rev-play') {
      if (isAutoplaying()) { stopAutoplay(); renderReviewBar(); } else startAutoplay();
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

  /**
   * Did this press land on something, or beside it?
   *
   * What closes a panel is a press on nothing in particular — the ground
   * around the board, the empty half of the bar, the space beside the pieces
   * in a reserve. A press on something is that thing's press and nothing
   * else's: a cell you are moving to, a piece you are picking up, a button.
   *
   * The distinction matters most where it is easiest to get wrong. On a phone
   * the panel covers half the screen and the rest of it is board, so "tap
   * beside it" has to mean the board — and a tap that both dismissed the panel
   * and played a move would be the worst of both.
   */
  const pressedSomething = (target) => Boolean(target && target.closest
    && target.closest('button, select, input, textarea, a, [data-cell], [data-arm],'
      + ' [data-action], [data-control], [data-ply], [data-emoji], [data-choose]'));

  function onAnyPointer(event) {
    /* A touch anywhere but the menu itself puts it away — including one on the
       board, which is the usual way of deciding you did not want it. The
       button is excluded because its own handler does the toggling, and
       closing it here first would leave the press re-opening it. */
    if (toolsOpen() && !tools.contains(event.target)
      && !(event.target.closest && event.target.closest('.bar-menu'))) {
      setToolsOpen(false);
    }
    /* The sheet asking who plays a branch goes the same way. Its own way out
       is a small "cancel" in a corner, and on a narrow screen the panel can be
       over that corner — so a press anywhere else has to work, which is what
       anyone would try first anyway. The button that opens it is excluded, or
       the press that opens it would close it again. */
    if (!resumeEl.hidden && !resumeEl.contains(event.target)
      && !(event.target.closest && event.target.closest('[data-action="resume"]'))) {
      closeResumeSheet();
      return;                  // one thing closes per press, the nearest first
    }
    /* And the same for the panel below, which on a phone is the larger claim
       on the screen of the two. Not while a piece is in hand: the press that
       began the drag is not a press beside anything. */
    if (drawerOpen && !drawer.contains(event.target) && !pressedSomething(event.target)
      && !(drag && drag.active)) {
      setDrawer(false, drawerTab);
    }
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
      /* Up and down still belong to the panel, even from inside the box.
         Opening the chat puts the cursor there, so once the chat became what an
         online game opens on, the two keys stopped answering at all — and in a
         one-line field they were only ever going to jump the caret to one end
         of what you had typed, which nobody presses them for. Left and right
         stay with the box: those really are how you move through a word. */
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    }
    if (event.key === 'Escape') {
      // The shallowest thing open closes first, and nothing deeper moves.
      if (!resumeEl.hidden) { closeResumeSheet(); return; }
      if (toolsOpen()) { setToolsOpen(false); return; }
      /* Inside a branch, escape leaves the branch. Stepping back within one
         is undone first, so the key walks out the way it came in rather than
         dropping the whole exploration from halfway through reading it. */
      if (exploring) {
        if (review !== null) { goToPly(timeline.length - 1); return; }
        stopExploring();
        return;
      }
      if (review !== null) { goToPly(timeline.length - 1); return; }
      if (premove) { clearPremove(true); return; }
      /* Through setDrawer, so the arrow on the bar turns over with it. Closing
         it by hand left the button still pointing up, offering to open a
         drawer that was already shut. */
      if (drawerOpen) { setDrawer(false, drawerTab); return; }
      selected = null; chain = null; placeMode = null; picker = null; clearEffect(); refresh();
    } else if (event.key === 'Enter' && chain) {
      finishChain();
    } else if (event.key === 'ArrowLeft') { event.preventDefault(); stepReview(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); stepReview(1); }
    /* Up and down for the panel, next to left and right for the moves. Both
       always answer, even when the drawer is already the way the key asks —
       a key that does nothing on the second press is a key that feels broken.
       preventDefault stops the page scrolling out from under the board, which
       on a narrow screen it now can. */
    else if (event.key === 'ArrowUp') { event.preventDefault(); setDrawer(true, drawerTab); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setDrawer(false, drawerTab); }
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
    if (name === 'showValidMoves' || name === 'showLastMove'
      || name === 'showCoordinates') refresh();
    else if (name === 'aiLevel' && !net) { level = getSetting('aiLevel'); buildTools(); refresh(); }
  });
  const stopWatchingLanguage = onLanguageChange(relabel);

  /*
   * A position handed over from a game being read back.
   *
   * It becomes an ordinary local game — nothing here writes anywhere, so the
   * game it came from cannot be affected by whatever happens next.
   */
  newGame();
  /* Against another person the panel opens on the chat: the move list is on
     the board in front of you, and the one thing the board cannot show is the
     person on the other end. Watching a game is the exception — a spectator is
     not part of that conversation and has no chat tab at all. */
  showDrawerTab(net && !net.watching ? 'chat' : 'moves');
  if (archiveId) {
    loadArchive();
    setDrawer(true, 'moves');      // a stored game is nothing but a review

  }
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
      /* Going elsewhere is not the same as sitting there in silence. Say so,
         and the server starts the same countdown a dropped connection does;
         coming back through hx:join calls it off. */
      if (net.watching) request('hx:unwatch', { code: net.code }).catch(() => {});
      else if (!result) request('hx:leave', { code: net.code }).catch(() => {});
      for (const off of net.unsubscribe) { try { off(); } catch { /* already gone */ } }
      net = null;                       // stops in-flight handlers from touching a dead view
    }
    stopWatchingSettings();
    stopWatchingLanguage();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onAnyPointer, true);
    clearTimeout(bubbleTimer);
    clearTimeout(curveTimer);
    clearTimeout(resultTimer);
    clearTimeout(drawerSettle);
    cancelAnimationFrame(drawerFollow);
    window.removeEventListener('resize', onResize);
    /* The bar is part of this view now, so it goes when the view goes; only
       the guard reaches outside. */
    setLeaveGuard(null);
    delete window.__hexaequo;
  };
}
