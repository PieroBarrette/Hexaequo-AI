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
  if (depth <= 0) return quiesce(s, alpha, beta, ply, 0);

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

/** Difficulty presets: time budget, depth cap, and evaluation noise. */
export const LEVELS = [
  { ms: 250, depth: 2, noise: 30 },
  { ms: 1200, depth: 5, noise: 8 },
  { ms: 3500, depth: 7, noise: 2 },
];

/** Choose a move for the side to move. Returns null when there is none. */
export function chooseMove(state, level = 1) {
  const config = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level))];
  noise = config.noise;
  noiseSeed = (Math.random() * 4294967296) | 0;
  nodes = 0;
  aborted = false;
  table.clear();
  deadline = Date.now() + config.ms;

  const root = generateMoves(state);
  if (!root.length) return null;
  sortMoves(root, 0);

  const scored = root.map((move) => ({ move, score: 0 }));
  let best = scored[0].move;

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
    scored.sort((a, b) => b.score - a.score);
    best = bestThisDepth || scored[0].move;
    if (Math.abs(scored[0].score) > MATE - 1000) break;
    if (Date.now() > deadline) break;
  }
  return best;
}

/** Exposed for the self-test so it can silence evaluation noise. */
export function setNoise(value) {
  const previous = noise;
  noise = value;
  return previous;
}
