/**
 * Hexaequo AI: negamax with alpha-beta pruning, iterative deepening, a
 * capture-only quiescence pass and a Zobrist transposition table.
 *
 * At equal time budget, depth 7 beat depth 2 by 8 games to 0 across both
 * colours, so the search — not just the evaluation — is doing real work.
 */

import { STEP, LEAP, RING_OFFSETS, inBoard, KEY_COUNT } from './hex.js';
import {
  DISK, RING, pieceOwner, pieceType, applyMove, undoMove,
  BLACK, DISKS_PER_PLAYER, RINGS_PER_PLAYER,
} from './state.js';
import { generateMoves, generateCaptures, checkWinner } from './moves.js';

const INFINITY = 1e9;
const MATE = 100000;

/* ── Evaluation ─────────────────────────────────────────────────────────── */

const threatMarks = new Int32Array(KEY_COUNT);
let threatEpoch = 0;

/** How many of `victim`'s pieces the opponent could capture in a single move. */
function countThreatened(s, victim) {
  const foe = 1 - victim;
  let n = 0;
  threatEpoch++;
  const mark = (k) => {
    if (threatMarks[k] !== threatEpoch) { threatMarks[k] = threatEpoch; n++; }
  };
  for (const c of s.tileKeys) {
    const v = s.pieceAt[c];
    if (v < 0 || pieceOwner(v) !== foe) continue;
    if (pieceType(v) === DISK) {
      for (let i = 0; i < 6; i++) {
        const over = c + STEP[i];
        const land = c + LEAP[i];
        if (!inBoard(over) || !inBoard(land)) continue;
        if (s.tileAt[land] < 0 || s.pieceAt[land] >= 0) continue;
        const target = s.pieceAt[over];
        if (target >= 0 && pieceOwner(target) === victim) mark(over);
      }
    } else {
      for (let i = 0; i < 12; i++) {
        const to = c + RING_OFFSETS[i];
        if (!inBoard(to) || s.tileAt[to] < 0) continue;
        const target = s.pieceAt[to];
        if (target >= 0 && pieceOwner(target) === victim) mark(to);
      }
    }
  }
  return n;
}

let noise = 8;
let noiseSeed = 12345;

/* Whether leaf nodes resolve captures before being scored. Off for the
   beginner: seeing every capture chain is most of what makes the search
   sharp, and a player learning the rules should be allowed to get away with
   a loose piece. */
let useQuiescence = true;

/*
 * Leaning on the three ways a game ends was tried here and did not survive
 * being measured.
 *
 * The idea was sound on paper: six disks, three rings or an emptied board, and
 * a count that rises as one of them comes into reach, so the engine could feel
 * the finish before the search could see it and pay material to get there. It
 * was built, gated so it only spoke near the end, and played against the
 * evaluation below over five thousand games at every weight and threshold
 * worth trying. Every version lost — the best of them by about two points a
 * hundred, the rest by more.
 *
 * Why, in hindsight: it re-weights the counters the material terms already
 * count, so it does not tell the engine anything new about the position. All
 * it does is raise the price of a capture it was already going to take, and at
 * shallow depth that buys captures which give more back than they took.
 *
 * What did work is a page down: knowing that a game already over is over, and
 * that going round in circles is worth nothing. The first is why the review's
 * curve told the truth about the last move of a game, and the second is worth
 * a point and a half a hundred on its own.
 */

/** Absolute score; positive favours Black. */
function evaluate(s) {
  let score = 100 * (s.capturedDisks[0] - s.capturedDisks[1])
            + 230 * (s.capturedRings[0] - s.capturedRings[1]);

  const disks = [0, 0], rings = [0, 0], emptyOwn = [0, 0];
  for (const c of s.tileKeys) {
    const v = s.pieceAt[c];
    if (v < 0) emptyOwn[s.tileAt[c]]++;
    else if (pieceType(v) === DISK) disks[pieceOwner(v)]++;
    else rings[pieceOwner(v)]++;
  }

  score += 16 * (disks[0] - disks[1]) + 30 * (rings[0] - rings[1]);
  score += 6 * (s.diskReserve[0] - s.diskReserve[1]) + 12 * (s.ringReserve[0] - s.ringReserve[1]);
  score += 3 * (emptyOwn[0] - emptyOwn[1]) + 2 * (s.tileReserve[0] - s.tileReserve[1]);

  // Being reduced to a single piece on the board is one capture from losing.
  const onBoard0 = disks[0] + rings[0];
  const onBoard1 = disks[1] + rings[1];
  if (onBoard1 === 1) score += 45; else if (onBoard1 === 2) score += 12;
  if (onBoard0 === 1) score -= 45; else if (onBoard0 === 2) score -= 12;

  score += 14 * (countThreatened(s, 1) - countThreatened(s, 0));

  if (noise) {
    let h = (s.h1 ^ noiseSeed) >>> 0;
    h = ((h ^ (h >>> 15)) * 2246822507) >>> 0;
    score += (h % (2 * noise + 1)) - noise;
  }
  return score;
}

const evaluateForSideToMove = (s) => (s.turn === BLACK ? evaluate(s) : -evaluate(s));

/* ── Move ordering ──────────────────────────────────────────────────────── */

/** Compact encoding used only to order the transposition-table move first. */
function encodeMove(m) {
  if (m.type === 'tile') return 0 | (m.cell << 2);
  if (m.type === 'piece') return 1 | (m.cell << 2) | (m.piece << 14);
  if (m.type === 'disk') {
    return 2 | (m.path[0] << 2) | (m.path[m.path.length - 1] << 14) | (m.captures.length << 26);
  }
  return 3 | (m.from << 2) | (m.to << 14) | ((m.capture ? 1 : 0) << 26);
}

function moveScore(m) {
  if (m.type === 'disk') {
    let s = 0;
    for (const c of m.captures) s += pieceType(c.code) === RING ? 260 : 110;
    return s ? s + 600 : 12;
  }
  if (m.type === 'ring') {
    return m.capture ? (pieceType(m.capture.code) === RING ? 260 : 110) + 600 : 22;
  }
  if (m.type === 'piece') return m.piece === RING ? 34 : 44;
  return 8;
}

function sortMoves(list, preferred) {
  for (const m of list) {
    m._order = moveScore(m) + (preferred !== 0 && encodeMove(m) === preferred ? 1e6 : 0);
  }
  list.sort((a, b) => b._order - a._order);
}

/* ── Search ─────────────────────────────────────────────────────────────── */

let nodes = 0;
let deadline = 0;
let aborted = false;
let table = new Map();

/*
 * Positions already reached, so that going round in circles is worth nothing.
 *
 * Two sources. `path` is the line the search is currently walking: coming back
 * to a position it has already stood on means neither side has made progress,
 * and shuffling for ever is a draw. `played` is the game itself — the
 * positions that have actually occurred — and a position that has occurred
 * twice already is one repetition away from being a draw by rule.
 *
 * Without this the engine could not tell a winning plan from a shuffle: both
 * kept the same material, so both scored the same, and it had no reason to
 * prefer the one that finished the game. A player who is ahead should be made
 * to see a repetition for what it is — the win thrown away — which is exactly
 * what scoring it nought does, since anything better than nought now beats it.
 *
 * A draw is nought to both sides, so a player who is behind will steer for one,
 * which is also right: that is how a lost position is saved.
 *
 * The hash carries the side to move, so only every second ply can match; the
 * loop steps by two rather than testing positions that cannot be equal.
 */
const MAX_PLY = 128;
const pathH1 = new Int32Array(MAX_PLY);
const pathH2 = new Int32Array(MAX_PLY);
/** h1 → how many times it has occurred in the game already. */
let played = new Map();

function isRepetition(s, ply) {
  for (let i = ply - 2; i >= 0; i -= 2) {
    if (pathH1[i] === s.h1 && pathH2[i] === s.h2) return true;
  }
  const before = played.get(s.h1);
  return before !== undefined && before.h2 === s.h2 && before.n >= 2;
}

/**
 * Tell the search which positions the game has already been through, so that
 * repeating one is recognised as the draw it is about to become.
 *
 * Takes states — the timeline the review already keeps — and reads their
 * hashes. Anything without one is skipped rather than guessed at.
 */
function rememberPlayed(history) {
  played = new Map();
  if (!Array.isArray(history)) return;
  for (const position of history) {
    if (!position || typeof position.h1 !== 'number') continue;
    const seen = played.get(position.h1);
    if (seen && seen.h2 === position.h2) seen.n++;
    else played.set(position.h1, { h2: position.h2, n: 1 });
  }
}

function outOfTime() {
  if ((++nodes & 511) === 0 && Date.now() > deadline) aborted = true;
  return aborted;
}

function quiesce(s, alpha, beta, ply, depth) {
  if (checkWinner(s)) return -(MATE - ply);
  const stand = evaluateForSideToMove(s);
  if (stand >= beta || depth >= 4 || outOfTime()) return stand;
  if (stand > alpha) alpha = stand;

  const captures = generateCaptures(s);
  if (!captures.length) return stand;
  sortMoves(captures, 0);

  let best = stand;
  for (const m of captures) {
    applyMove(s, m);
    const score = -quiesce(s, -beta, -alpha, ply + 1, depth + 1);
    undoMove(s, m);
    if (aborted) return best;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

function negamax(s, depth, alpha, beta, ply) {
  if (outOfTime()) return 0;
  if (checkWinner(s)) return -(MATE - ply);
  /* Checked before the depth runs out, so that a repetition is a draw however
     deep it is found — and after the winner, because a game that has ended has
     ended whatever position it ended in. */
  if (ply > 0 && isRepetition(s, ply)) return 0;
  if (depth <= 0) return useQuiescence ? quiesce(s, alpha, beta, ply, 0) : evaluateForSideToMove(s);

  const originalAlpha = alpha;
  let preferred = 0;
  const entry = table.get(s.h1);
  if (entry && entry.h2 === s.h2) {
    preferred = entry.move;
    if (entry.depth >= depth) {
      if (entry.flag === 0) return entry.score;
      if (entry.flag === 1 && entry.score > alpha) alpha = entry.score;
      else if (entry.flag === 2 && entry.score < beta) beta = entry.score;
      if (alpha >= beta) return entry.score;
    }
  }

  const moves = generateMoves(s);
  if (!moves.length) return 0;                       // no legal move: a draw
  sortMoves(moves, preferred);

  // On the path from here down, so anything below that comes back here knows it.
  if (ply < MAX_PLY) { pathH1[ply] = s.h1; pathH2[ply] = s.h2; }

  let best = -INFINITY;
  let bestMove = 0;
  for (const m of moves) {
    applyMove(s, m);
    const score = -negamax(s, depth - 1, -beta, -alpha, ply + 1);
    undoMove(s, m);
    if (aborted) return best > -INFINITY ? best : 0;
    if (score > best) { best = score; bestMove = encodeMove(m); }
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }

  if (table.size < 400000) {
    table.set(s.h1, {
      h2: s.h2,
      depth,
      score: best,
      flag: best <= originalAlpha ? 2 : (best >= beta ? 1 : 0),
      move: bestMove,
    });
  }
  return best;
}

/**
 * Difficulty presets.
 *
 * depth is how far ahead it looks, noise how much it lets equal-looking
 * moves shuffle, quiesce whether it resolves capture chains before scoring a
 * position, and blunder how often it plays something other than the best move
 * it found.
 *
 * The beginner sees one reply ahead and no further, and never resolves a
 * capture chain — so it walks into two-move tactics and overlooks captures of
 * its own, while still defending against the reply in front of it. Searching
 * a single ply was tried first and was not a beginner but a broken opponent:
 * blind to every reply, it gave its opening disk away and lost inside ten
 * moves, every game.
 */
export const LEVELS = [
  { ms: 200, depth: 2, noise: 90, quiesce: false, blunder: 0.35 },
  { ms: 250, depth: 2, noise: 30, quiesce: true, blunder: 0 },
  { ms: 1200, depth: 5, noise: 8, quiesce: true, blunder: 0 },
  { ms: 3500, depth: 7, noise: 2, quiesce: true, blunder: 0 },
];

/**
 * A beginner's move: not the best one, but not an absurd one either.
 *
 * Drawn from the better-scoring half of the position's moves, so the AI
 * overlooks a capture it could have made or leaves a piece where it can be
 * taken — while still playing something a person could plausibly have played.
 */
function weakerChoice(scored) {
  const pool = scored.slice(0, Math.max(2, Math.ceil(scored.length / 2)));
  return pool[Math.floor(Math.random() * pool.length)].move;
}

/**
 * Choose a move for the side to move. Returns null when there is none.
 *
 * `history` is the positions the game has already been through — the timeline
 * a game keeps anyway. With it the engine knows which repetitions are one step
 * from a draw, and a player who is ahead stops walking into one.
 */
export function chooseMove(state, level = 1, { history = null } = {}) {
  const config = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level))];
  noise = config.noise;
  useQuiescence = config.quiesce !== false;
  noiseSeed = (Math.random() * 4294967296) | 0;
  nodes = 0;
  aborted = false;
  table.clear();
  rememberPlayed(history);
  deadline = Date.now() + config.ms;

  const root = generateMoves(state);
  if (!root.length) return null;
  sortMoves(root, 0);
  // The position itself is on the path, so a line that comes back to it knows.
  pathH1[0] = state.h1;
  pathH2[0] = state.h2;

  const scored = root.map((move) => ({ move, score: 0 }));
  let best = scored[0].move;
  let ranked = false;              // a depth finished, so the scores mean something

  for (let depth = 1; depth <= config.depth; depth++) {
    let alpha = -INFINITY;
    let bestThisDepth = null;
    let completed = true;

    for (const entry of scored) {
      applyMove(state, entry.move);
      const score = -negamax(state, depth - 1, -INFINITY, -alpha, 1);
      undoMove(state, entry.move);
      if (aborted) { completed = false; break; }
      entry.score = score;
      if (score > alpha) { alpha = score; bestThisDepth = entry.move; }
    }

    if (!completed) break;
    ranked = true;
    scored.sort((a, b) => b.score - a.score);
    best = bestThisDepth || scored[0].move;
    if (Math.abs(scored[0].score) > MATE - 1000) break;
    if (Date.now() > deadline) break;
  }

  /* The beginner does not always play what it found. Only ever on scores that
     were actually computed — a blunder drawn from an unranked list would be a
     random move, which is a different and worse thing. */
  if (ranked && config.blunder && Math.random() < config.blunder) {
    best = weakerChoice(scored);
  }
  return best;
}

/** The scale the bar is read on: a hundred points is one captured disk. */
export const DISK_POINTS = 100;

/** Past this, the search has found the end of the game rather than an edge. */
export const DECISIVE = MATE - 1000;

/**
 * How the position stands, without choosing a move.
 *
 * The same search the opponent uses, run for its number instead of its move.
 * A static evaluation would have been cheaper and wrong: it cannot see that
 * the piece about to be taken is about to be taken, so the bar would lurch
 * every half-move as a capture came into and went out of range.
 *
 * Noise is off. It exists to keep the engine from playing the same game twice,
 * and a bar that shimmers while nothing on the board has changed is a bar
 * nobody can read.
 *
 * The move it settled on comes back with the number, because the search had to
 * pick one to arrive at the number and was throwing it away afterwards. Free,
 * where asking separately would have cost the whole search again — and
 * noise-free like the score, so a position always names the same move instead
 * of choosing differently between two it scores alike.
 *
 * @returns {{ score: number, depth: number, decisive: boolean, move: object|null }}
 *   score is absolute and positive for Black, in points; decisive says the
 *   search reached a finish rather than an estimate; move is what the side to
 *   move should play, or null where there is nothing to play; settledAt is the
 *   depth at which it last changed its mind about that move, which is as close
 *   as a search comes to saying how hard the move was to see.
 */
export function judge(state, { ms = 140, maxDepth = 5, history = null } = {}) {
  /*
   * A finished game is not a position to think about.
   *
   * checkWinner answers for the player who moved last, and after a winning
   * move it is the loser's turn — so from the final position of a game the
   * search happily carried on playing it. It generated the loser's moves,
   * found that none of them was answered by a win *for the loser*, and
   * reported what they could still do with the pieces they had left. On the
   * curve of a game Black won by capture, the last point was a white spike:
   * the search saying White had good prospects in a game that was over, which
   * was true of the pieces and false of the game.
   */
  const over = checkWinner(state);
  if (over) {
    return {
      score: over.winner === BLACK ? MATE : -MATE,
      depth: 0,
      decisive: true,
      move: null,
      settledAt: 0,
    };
  }

  const heldNoise = noise;
  const heldQuiesce = useQuiescence;
  noise = 0;
  useQuiescence = true;
  nodes = 0;
  aborted = false;
  table.clear();
  rememberPlayed(history);
  deadline = Date.now() + ms;

  let value = evaluateForSideToMove(state);
  let reached = 0;
  let best = null;
  /*
   * The depth at which the search last changed its mind.
   *
   * Iterative deepening picks a best move at every depth and throws away all
   * but the last. What it threw away is the one thing that says how hard a
   * move was to find: a move that is best from the first ply is one anybody
   * would play, and a move the search only comes round to at the sixth is one
   * you had to calculate. Free — it is a comparison against the previous
   * depth's answer, and the root list is generated once, so the same move
   * object comes back each time and identity is enough.
   */
  let settledAt = 1;
  let previousBest = null;

  /* The root is walked here rather than left to negamax, which reports a score
     and keeps the move to itself. Same search either way: one ply expanded by
     hand so the choice it makes can be seen. */
  const root = generateMoves(state);
  if (!root.length) {
    noise = heldNoise;
    useQuiescence = heldQuiesce;
    return { score: 0, depth: 0, decisive: false, move: null, settledAt: 0 };
  }
  sortMoves(root, 0);
  pathH1[0] = state.h1;
  pathH2[0] = state.h2;

  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -INFINITY;
    let bestThisDepth = null;
    let completed = true;
    for (const move of root) {
      applyMove(state, move);
      const score = -negamax(state, depth - 1, -INFINITY, -alpha, 1);
      undoMove(state, move);
      // A depth cut short has looked at some moves and not the others, which is
      // worse than the depth below it rather than better.
      if (aborted) { completed = false; break; }
      if (score > alpha || bestThisDepth === null) { alpha = score; bestThisDepth = move; }
    }
    if (!completed) break;
    value = alpha;
    if (previousBest !== null && bestThisDepth !== previousBest) settledAt = depth;
    previousBest = bestThisDepth;
    best = bestThisDepth;
    reached = depth;
    if (Math.abs(value) > DECISIVE) break;
    if (Date.now() > deadline) break;
  }

  noise = heldNoise;
  useQuiescence = heldQuiesce;
  const absolute = state.turn === BLACK ? value : -value;
  return {
    // negamax answers for the side to move; the bar reads the same way round
    // whoever that is. `|| 0` because negating a drawn nought gives -0, which
    // reads as level everywhere but compares as its own thing.
    score: absolute || 0,
    depth: reached,
    decisive: Math.abs(value) > DECISIVE,
    move: best,
    settledAt,
  };
}

/** Exposed for the self-test so it can silence evaluation noise. */
export function setNoise(value) {
  const previous = noise;
  noise = value;
  return previous;
}
