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

/* ── Serialisation ──────────────────────────────────────────────────────── */

/**
 * Compact, JSON-safe snapshot. Typed arrays do not survive JSON, and reserves
 * and hashes are derivable, so only the irreducible facts are written out:
 * which tiles exist and their colour, which pieces stand where, whose turn it
 * is, and what each player has captured.
 */
export function serializeState(s) {
  const tiles = [];
  const pieces = [];
  for (const k of s.tileKeys) {
    tiles.push(k, s.tileAt[k]);
    if (s.pieceAt[k] >= 0) pieces.push(k, s.pieceAt[k]);
  }
  return {
    v: 1,
    tiles,
    pieces,
    turn: s.turn,
    capturedDisks: s.capturedDisks.slice(),
    capturedRings: s.capturedRings.slice(),
  };
}

/** Rebuild a full state — reserves, counters and hash included — from a snapshot. */
export function deserializeState(data) {
  if (!data || data.v !== 1 || !Array.isArray(data.tiles) || !Array.isArray(data.pieces)) {
    throw new Error('Unrecognised state snapshot');
  }
  const s = {
    tileAt: new Int8Array(KEY_COUNT).fill(-1),
    pieceAt: new Int8Array(KEY_COUNT).fill(-1),
    tileKeys: [],
    turn: data.turn === WHITE ? WHITE : BLACK,
    tileReserve: [TILES_PER_PLAYER, TILES_PER_PLAYER],
    diskReserve: [DISKS_PER_PLAYER, DISKS_PER_PLAYER],
    ringReserve: [RINGS_PER_PLAYER, RINGS_PER_PLAYER],
    capturedDisks: [data.capturedDisks[0] | 0, data.capturedDisks[1] | 0],
    capturedRings: [data.capturedRings[0] | 0, data.capturedRings[1] | 0],
    piecesOnBoard: [0, 0],
    h1: 0,
    h2: 0,
  };

  for (let i = 0; i < data.tiles.length; i += 2) {
    const k = data.tiles[i];
    const colour = data.tiles[i + 1];
    if (k < 0 || k >= KEY_COUNT || (colour !== BLACK && colour !== WHITE)) {
      throw new Error('Corrupt tile in snapshot');
    }
    if (s.tileAt[k] >= 0) throw new Error('Duplicate tile in snapshot');
    s.tileAt[k] = colour;
    s.tileKeys.push(k);
    s.tileReserve[colour]--;
  }
  for (let i = 0; i < data.pieces.length; i += 2) {
    const k = data.pieces[i];
    const code = data.pieces[i + 1];
    if (s.tileAt[k] < 0 || code < 0 || code > 3) throw new Error('Corrupt piece in snapshot');
    if (s.pieceAt[k] >= 0) throw new Error('Duplicate piece in snapshot');
    s.pieceAt[k] = code;
    s.piecesOnBoard[pieceOwner(code)]++;
  }

  for (let p = 0; p < 2; p++) {
    let disks = 0;
    let rings = 0;
    for (const k of s.tileKeys) {
      const code = s.pieceAt[k];
      if (code < 0 || pieceOwner(code) !== p) continue;
      if (pieceType(code) === DISK) disks++; else rings++;
    }
    s.diskReserve[p] = DISKS_PER_PLAYER - disks - s.capturedDisks[1 - p];
    s.ringReserve[p] = RINGS_PER_PLAYER - rings - s.capturedRings[1 - p];
    if (s.tileReserve[p] < 0 || s.diskReserve[p] < 0 || s.ringReserve[p] < 0) {
      throw new Error('Snapshot does not conserve material');
    }
  }

  const h = recomputeHash(s);
  s.h1 = h.h1;
  s.h2 = h.h2;
  return s;
}

/** Rebuild both hash words from scratch. Used by deserialisation and the self-test. */
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
