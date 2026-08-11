/**
 * Game state for Hexaequo: board, reserves, captures, and reversible moves.
 *
 * The state is mutated in place by `applyMove` / `undoMove` rather than cloned,
 * because the AI walks hundreds of thousands of nodes per turn. A Zobrist hash
 * (two 32-bit words) is maintained incrementally alongside every change.
 *
 * The hash covers everything that defines a position: tiles, pieces, both
 * capture counts, and the side to move. Reserves are *derived* from those, so
 * they need no hashing of their own:
 *
 *     diskReserve[p]  = 6 - disks(p) on board - capturedDisks[opponent]
 *     ringReserve[p]  = 3 - rings(p) on board - capturedRings[opponent]
 *     tileReserve[p]  = 9 - tiles of colour p on board
 */

import { KEY_COUNT, key, STEP, inBoard } from './hex.js';

export const BLACK = 0;
export const WHITE = 1;
export const DISK = 0;
export const RING = 1;

/** Pieces are encoded as `player * 2 + type`. */
export const pieceOwner = (v) => v >> 1;
export const pieceType = (v) => v & 1;
export const makePiece = (player, type) => player * 2 + type;

export const TILES_PER_PLAYER = 9;
export const DISKS_PER_PLAYER = 6;
export const RINGS_PER_PLAYER = 3;

/* ── Zobrist tables ─────────────────────────────────────────────────────── */

const OFF_TILE = 0;
const OFF_PIECE = 16384;
const OFF_CAPTURED_DISKS = 49152;
const OFF_CAPTURED_RINGS = 49184;
const OFF_TURN = 49204;

const Z = new Int32Array(49206);
for (let i = 0; i < Z.length; i++) Z[i] = (Math.random() * 4294967296) | 0;

const zTile = (k, colour) => OFF_TILE + ((k << 1) + colour) * 2;
const zPiece = (k, v) => OFF_PIECE + ((k << 2) + v) * 2;
const zCapturedDisks = (p, n) => OFF_CAPTURED_DISKS + (p * 8 + n) * 2;
const zCapturedRings = (p, n) => OFF_CAPTURED_RINGS + (p * 5 + n) * 2;

/** XOR one Zobrist entry into a state's two hash words. */
export function xorHash(state, base) {
  state.h1 ^= Z[base];
  state.h2 ^= Z[base + 1];
}
export { zCapturedDisks, zCapturedRings, OFF_TURN };

/* ── Construction ───────────────────────────────────────────────────────── */

/**
 * The opening position: the two black tiles and the two white tiles are laid
 * against each other in a compact block of four. A disk of the matching colour
 * sits on each of the two opposite tiles — the only pair in the block that do
 * not touch.
 *
 *      ⬢⬢     black  (0,0) (1,0)          disk on (1,0)
 *     ⬢⬢      white (-1,1) (0,1)          disk on (-1,1)
 */
const OPENING_TILES = [
  [0, 0, BLACK], [1, 0, BLACK],
  [-1, 1, WHITE], [0, 1, WHITE],
];
const OPENING_DISKS = [[1, 0, BLACK], [-1, 1, WHITE]];

export function createState() {
  const state = {
    tileAt: new Int8Array(KEY_COUNT).fill(-1),   // -1 none, else tile colour
    pieceAt: new Int8Array(KEY_COUNT).fill(-1),  // -1 empty, else piece code
    tileKeys: [],                                // placed tiles, in placement order
    turn: BLACK,
    tileReserve: [TILES_PER_PLAYER, TILES_PER_PLAYER],
    diskReserve: [DISKS_PER_PLAYER, DISKS_PER_PLAYER],
    ringReserve: [RINGS_PER_PLAYER, RINGS_PER_PLAYER],
    capturedDisks: [0, 0],   // enemy disks this player holds
    capturedRings: [0, 0],
    piecesOnBoard: [0, 0],
    h1: 0,
    h2: 0,
  };

  for (let p = 0; p < 2; p++) {
    xorHash(state, zCapturedDisks(p, 0));
    xorHash(state, zCapturedRings(p, 0));
  }
  for (const [q, r, colour] of OPENING_TILES) {
    const k = key(q, r);
    state.tileAt[k] = colour;
    state.tileKeys.push(k);
    state.tileReserve[colour]--;
    xorHash(state, zTile(k, colour));
  }
  for (const [q, r, player] of OPENING_DISKS) {
    const k = key(q, r);
    const code = makePiece(player, DISK);
    state.pieceAt[k] = code;
    xorHash(state, zPiece(k, code));
    state.piecesOnBoard[player]++;
    state.diskReserve[player]--;
  }
  return state;
}

export function cloneState(s) {
  return {
    tileAt: s.tileAt.slice(),
    pieceAt: s.pieceAt.slice(),
    tileKeys: s.tileKeys.slice(),
    turn: s.turn,
    tileReserve: s.tileReserve.slice(),
    diskReserve: s.diskReserve.slice(),
    ringReserve: s.ringReserve.slice(),
    capturedDisks: s.capturedDisks.slice(),
    capturedRings: s.capturedRings.slice(),
    piecesOnBoard: s.piecesOnBoard.slice(),
    h1: s.h1,
    h2: s.h2,
  };
}

/** A collision-free position signature, used for the threefold-repetition rule. */
export function positionKey(s) {
  let out = s.turn + '|' + s.capturedDisks.join(',') + '|' + s.capturedRings.join(',') + '|';
  const sorted = s.tileKeys.slice().sort((a, b) => a - b);
  for (const k of sorted) out += k + ':' + s.tileAt[k] + s.pieceAt[k] + ';';
  return out;
}

/** A copy of `s` with the piece on `k` lifted off, for computing its own jumps. */
export function withPieceLifted(s, k) {
  const t = cloneState(s);
  t.pieceAt[k] = -1;
  return t;
}

/* ── Move application ───────────────────────────────────────────────────── */

/*
 * Move shapes:
 *   { type: 'tile',  cell }
 *   { type: 'piece', cell, piece: DISK | RING }
 *   { type: 'disk',  path: [cell, ...], captures: [{ cell, code }, ...] }
 *   { type: 'ring',  from, to, capture: { cell, code } | null }
 */

function capturePiece(s, capturer, cell, code) {
  s.pieceAt[cell] = -1;
  xorHash(s, zPiece(cell, code));
  s.piecesOnBoard[pieceOwner(code)]--;
  if (pieceType(code) === DISK) {
    xorHash(s, zCapturedDisks(capturer, s.capturedDisks[capturer]));
    s.capturedDisks[capturer]++;
    xorHash(s, zCapturedDisks(capturer, s.capturedDisks[capturer]));
  } else {
    xorHash(s, zCapturedRings(capturer, s.capturedRings[capturer]));
    s.capturedRings[capturer]++;
    xorHash(s, zCapturedRings(capturer, s.capturedRings[capturer]));
  }
}

function restorePiece(s, capturer, cell, code) {
  if (pieceType(code) === DISK) {
    xorHash(s, zCapturedDisks(capturer, s.capturedDisks[capturer]));
    s.capturedDisks[capturer]--;
    xorHash(s, zCapturedDisks(capturer, s.capturedDisks[capturer]));
  } else {
    xorHash(s, zCapturedRings(capturer, s.capturedRings[capturer]));
    s.capturedRings[capturer]--;
    xorHash(s, zCapturedRings(capturer, s.capturedRings[capturer]));
  }
  s.piecesOnBoard[pieceOwner(code)]++;
  s.pieceAt[cell] = code;
  xorHash(s, zPiece(cell, code));
}

export function applyMove(s, move) {
  const player = s.turn;
  const opponent = 1 - player;

  if (move.type === 'tile') {
    s.tileAt[move.cell] = player;
    s.tileKeys.push(move.cell);
    s.tileReserve[player]--;
    xorHash(s, zTile(move.cell, player));

  } else if (move.type === 'piece') {
    const code = makePiece(player, move.piece);
    s.pieceAt[move.cell] = code;
    xorHash(s, zPiece(move.cell, code));
    s.piecesOnBoard[player]++;
    if (move.piece === DISK) {
      s.diskReserve[player]--;
    } else {
      // Placing a ring costs one captured enemy disk, handed back to its owner.
      s.ringReserve[player]--;
      xorHash(s, zCapturedDisks(player, s.capturedDisks[player]));
      s.capturedDisks[player]--;
      xorHash(s, zCapturedDisks(player, s.capturedDisks[player]));
      s.diskReserve[opponent]++;
    }

  } else if (move.type === 'disk') {
    const code = makePiece(player, DISK);
    const from = move.path[0];
    const to = move.path[move.path.length - 1];
    s.pieceAt[from] = -1;
    xorHash(s, zPiece(from, code));
    for (const c of move.captures) capturePiece(s, player, c.cell, c.code);
    s.pieceAt[to] = code;
    xorHash(s, zPiece(to, code));

  } else {
    const code = makePiece(player, RING);
    s.pieceAt[move.from] = -1;
    xorHash(s, zPiece(move.from, code));
    if (move.capture) capturePiece(s, player, move.capture.cell, move.capture.code);
    s.pieceAt[move.to] = code;
    xorHash(s, zPiece(move.to, code));
  }

  s.turn = opponent;
  xorHash(s, OFF_TURN);
}

export function undoMove(s, move) {
  xorHash(s, OFF_TURN);
  s.turn = 1 - s.turn;
  const player = s.turn;
  const opponent = 1 - player;

  if (move.type === 'tile') {
    xorHash(s, zTile(move.cell, player));
    s.tileAt[move.cell] = -1;
    s.tileKeys.pop();
    s.tileReserve[player]++;

  } else if (move.type === 'piece') {
    const code = makePiece(player, move.piece);
    xorHash(s, zPiece(move.cell, code));
    s.pieceAt[move.cell] = -1;
    s.piecesOnBoard[player]--;
    if (move.piece === DISK) {
      s.diskReserve[player]++;
    } else {
      s.ringReserve[player]++;
      xorHash(s, zCapturedDisks(player, s.capturedDisks[player]));
      s.capturedDisks[player]++;
      xorHash(s, zCapturedDisks(player, s.capturedDisks[player]));
      s.diskReserve[opponent]--;
    }

  } else if (move.type === 'disk') {
    const code = makePiece(player, DISK);
    const from = move.path[0];
    const to = move.path[move.path.length - 1];
    xorHash(s, zPiece(to, code));
    s.pieceAt[to] = -1;
    for (let i = move.captures.length - 1; i >= 0; i--) {
      restorePiece(s, player, move.captures[i].cell, move.captures[i].code);
    }
    s.pieceAt[from] = code;
    xorHash(s, zPiece(from, code));

  } else {
    const code = makePiece(player, RING);
    xorHash(s, zPiece(move.to, code));
    s.pieceAt[move.to] = -1;
    if (move.capture) restorePiece(s, player, move.capture.cell, move.capture.code);
    s.pieceAt[move.from] = code;
    xorHash(s, zPiece(move.from, code));
  }
}

/** Rebuild both hash words from scratch. Used only by the self-test. */
export function recomputeHash(s) {
  const h = { h1: 0, h2: 0 };
  for (const k of s.tileKeys) {
    xorHash(h, zTile(k, s.tileAt[k]));
    if (s.pieceAt[k] >= 0) xorHash(h, zPiece(k, s.pieceAt[k]));
  }
  for (let p = 0; p < 2; p++) {
    xorHash(h, zCapturedDisks(p, s.capturedDisks[p]));
    xorHash(h, zCapturedRings(p, s.capturedRings[p]));
  }
  if (s.turn === WHITE) xorHash(h, OFF_TURN);
  return h;
}

/** Cells where the given player could legally lay a tile. */
export function tilePlacementSpots(s) {
  const seen = new Set();
  const out = [];
  for (const c of s.tileKeys) {
    for (let i = 0; i < 6; i++) {
      const n = c + STEP[i];
      if (!inBoard(n) || s.tileAt[n] >= 0 || seen.has(n)) continue;
      seen.add(n);
      let touching = 0;
      for (let j = 0; j < 6; j++) {
        const m = n + STEP[j];
        if (inBoard(m) && s.tileAt[m] >= 0) touching++;
      }
      if (touching >= 2) out.push(n);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}
