/**
 * Legal move generation and end-of-game detection for Hexaequo.
 */

import { STEP, LEAP, RING_OFFSETS, inBoard } from './hex.js';
import {
  DISK, RING, pieceOwner, pieceType, makePiece,
  tilePlacementSpots, DISKS_PER_PLAYER, RINGS_PER_PLAYER,
} from './state.js';

/**
 * Jumps available to a disk standing on `from`, given the cells already landed
 * on since the last capture.
 *
 * A jump crosses one adjacent occupied tile — friendly or enemy — and lands on
 * the next tile in the same straight line, which must exist and be empty. Only
 * enemy pieces crossed are captured.
 *
 * `visited` / `visitedFrom` implement the anti-loop rule: within one chain a
 * disk may not land again on a cell it has already occupied since its last
 * capture. Without it, hopping back and forth over friendly pieces would never
 * terminate. Resetting the window on each capture still allows genuine chains
 * that return to their starting cell.
 */
export function availableJumps(s, from, player, visited, visitedFrom) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const over = from + STEP[i];
    const land = from + LEAP[i];
    if (!inBoard(over) || !inBoard(land)) continue;
    if (s.tileAt[land] < 0 || s.pieceAt[land] >= 0) continue;
    const crossed = s.pieceAt[over];
    if (crossed < 0) continue;
    let seen = false;
    for (let j = visitedFrom; j < visited.length; j++) {
      if (visited[j] === land) { seen = true; break; }
    }
    if (seen) continue;
    out.push({
      over,
      land,
      capture: pieceOwner(crossed) !== player ? { cell: over, code: crossed } : null,
    });
  }
  return out;
}

const MAX_CHAIN = 24;

/** All moves for one disk. `capturesOnly` restricts output to capturing chains. */
export function generateDiskMoves(s, origin, out, capturesOnly) {
  const player = s.turn;
  const code = makePiece(player, DISK);

  if (!capturesOnly) {
    for (let i = 0; i < 6; i++) {
      const n = origin + STEP[i];
      if (inBoard(n) && s.tileAt[n] >= 0 && s.pieceAt[n] < 0) {
        out.push({ type: 'disk', path: [origin, n], captures: [] });
      }
    }
  }

  // Lift the disk so it can land back on its own starting cell mid-chain.
  s.pieceAt[origin] = -1;
  const path = [origin];
  const captures = [];
  const visited = [origin];
  const emitted = new Set();

  (function walk(current, visitedFrom, depth) {
    if (depth > MAX_CHAIN) return;
    for (const jump of availableJumps(s, current, player, visited, visitedFrom)) {
      if (jump.capture) s.pieceAt[jump.over] = -1;
      path.push(jump.land);
      visited.push(jump.land);
      if (jump.capture) captures.push(jump.capture);

      if (!capturesOnly || captures.length) {
        // Two chains reaching the same cell with the same captures produce the
        // same position; keep only one.
        let signature = jump.land + '|';
        for (const c of captures) signature += c.cell + ',';
        if (!emitted.has(signature)) {
          emitted.add(signature);
          out.push({ type: 'disk', path: path.slice(), captures: captures.slice() });
        }
      }

      walk(jump.land, jump.capture ? visited.length - 1 : visitedFrom, depth + 1);

      if (jump.capture) {
        s.pieceAt[jump.over] = jump.capture.code;
        captures.pop();
      }
      path.pop();
      visited.pop();
    }
  })(origin, 0, 0);

  s.pieceAt[origin] = code;
}

/** All moves for one ring: a single leap to any tile at distance exactly 2. */
export function generateRingMoves(s, from, out, capturesOnly) {
  const player = s.turn;
  for (let i = 0; i < 12; i++) {
    const to = from + RING_OFFSETS[i];
    if (!inBoard(to) || s.tileAt[to] < 0) continue;
    const occupant = s.pieceAt[to];
    if (occupant >= 0 && pieceOwner(occupant) === player) continue;
    if (capturesOnly && occupant < 0) continue;
    out.push({
      type: 'ring',
      from,
      to,
      capture: occupant >= 0 ? { cell: to, code: occupant } : null,
    });
  }
}

/** Every legal move for the side to move. */
export function generateMoves(s, out = []) {
  const player = s.turn;

  if (s.tileReserve[player] > 0) {
    for (const cell of tilePlacementSpots(s)) out.push({ type: 'tile', cell });
  }

  const canPlaceRing = s.ringReserve[player] > 0 && s.capturedDisks[player] > 0;
  if (s.diskReserve[player] > 0 || canPlaceRing) {
    for (const cell of s.tileKeys) {
      if (s.tileAt[cell] !== player || s.pieceAt[cell] >= 0) continue;
      if (s.diskReserve[player] > 0) out.push({ type: 'piece', cell, piece: DISK });
      if (canPlaceRing) out.push({ type: 'piece', cell, piece: RING });
    }
  }

  for (const cell of s.tileKeys) {
    const v = s.pieceAt[cell];
    if (v < 0 || pieceOwner(v) !== player) continue;
    if (pieceType(v) === DISK) generateDiskMoves(s, cell, out, false);
    else generateRingMoves(s, cell, out, false);
  }
  return out;
}

/** Capturing moves only — used by the search's quiescence pass. */
export function generateCaptures(s, out = []) {
  const player = s.turn;
  for (const cell of s.tileKeys) {
    const v = s.pieceAt[cell];
    if (v < 0 || pieceOwner(v) !== player) continue;
    if (pieceType(v) === DISK) generateDiskMoves(s, cell, out, true);
    else generateRingMoves(s, cell, out, true);
  }
  return out;
}

/**
 * Did the player who has just moved win? Checked immediately after `applyMove`,
 * so the winner is the side that is *not* to move.
 */
export function checkWinner(s) {
  const mover = 1 - s.turn;
  if (s.capturedDisks[mover] >= DISKS_PER_PLAYER) return { winner: mover, reason: 'disks' };
  if (s.capturedRings[mover] >= RINGS_PER_PLAYER) return { winner: mover, reason: 'rings' };
  if (s.piecesOnBoard[s.turn] === 0) return { winner: mover, reason: 'cleared' };
  return null;
}

/* ── Move intents ───────────────────────────────────────────────────────── */

/*
 * A client must never be able to declare what it captured. It sends only an
 * *intent* — the smallest description of what it wants to do — and the server
 * generates every legal move for the position and looks for a match. The move
 * that gets applied is therefore always one the server produced itself, so an
 * illegal move is not rejected by a check that might be incomplete: it simply
 * does not exist in the list.
 */

/** Reduce a move to the minimum a peer needs to reproduce it. */
export function moveIntent(move) {
  if (move.type === 'tile') return { type: 'tile', cell: move.cell };
  if (move.type === 'piece') return { type: 'piece', cell: move.cell, piece: move.piece };
  if (move.type === 'disk') return { type: 'disk', path: move.path.slice() };
  return { type: 'ring', from: move.from, to: move.to };
}

function matchesIntent(move, intent) {
  if (move.type !== intent.type) return false;
  if (move.type === 'tile') return move.cell === intent.cell;
  if (move.type === 'piece') return move.cell === intent.cell && move.piece === intent.piece;
  if (move.type === 'ring') return move.from === intent.from && move.to === intent.to;
  if (!Array.isArray(intent.path) || intent.path.length !== move.path.length) return false;
  for (let i = 0; i < move.path.length; i++) {
    if (move.path[i] !== intent.path[i]) return false;
  }
  return true;
}

/**
 * The canonical legal move matching `intent`, or null if there is none.
 * Never trust the caller's captures: the returned move carries the server's own.
 */
export function findLegalMove(s, intent) {
  if (!intent || typeof intent !== 'object') return null;
  for (const move of generateMoves(s)) {
    if (matchesIntent(move, intent)) return move;
  }
  return null;
}

/** Human-readable move notation, e.g. "H8–J8 ×1". */
export function moveNotation(move, cellLabel) {
  if (move.type === 'tile') return 'T ' + cellLabel(move.cell);
  if (move.type === 'piece') return (move.piece === DISK ? 'D ' : 'R ') + cellLabel(move.cell);
  if (move.type === 'disk') {
    return move.path.map(cellLabel).join('–') + (move.captures.length ? ' ×' + move.captures.length : '');
  }
  return 'R ' + cellLabel(move.from) + '⇒' + cellLabel(move.to) + (move.capture ? ' ×1' : '');
}
