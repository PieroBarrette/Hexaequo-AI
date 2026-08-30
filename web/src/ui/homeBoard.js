/**
 * A game breathing behind the home screen.
 *
 * The point is not to be watched. It is a board that keeps moving slowly under
 * the menu, blurred well past reading, so the page feels like it belongs to a
 * game rather than to a form. Nobody should be able to follow it, and nobody
 * should be able to say what it cost.
 *
 * The moves are decided in advance and stored here rather than played by the
 * engine at load: a search on the home screen would be work spent on something
 * the reader is not looking at, and the whole idea is that it costs nothing.
 * They are the intents of a real game the engine played against itself, kept in
 * the shortest form that still replays exactly:
 *
 *     ['t', cell]                  lay a tile
 *     ['p', cell, piece]           place a disk (0) or a ring (1)
 *     ['d', from, …, to]           a disk, with every cell of its jump chain
 *     ['r', from, to]              a ring
 *
 * One move every few seconds, and when the game runs out it starts again from
 * an empty board — a breath out and a breath in.
 */

import { createState, applyMove, pieceOwner, pieceType } from '../game/state.js';
import { findLegalMove } from '../game/moves.js';
import { keyQ, keyR } from '../game/hex.js';
import { miniBoardSvg } from './miniBoard.js';

const MOVES = [['t', 2145], ['p', 2081, 0], ['p', 2080, 0], ['d', 2081, 2145], ['d', 2144, 2081], ['t', 2018], ['d', 2081, 2018], ['t', 2208], ['p', 2144, 0], ['p', 2208, 0], ['d', 2144, 2081], ['t', 2082], ['p', 2144, 0], ['p', 2082, 0], ['t', 2146], ['d', 2145, 2146], ['d', 2081, 2145], ['p', 2081, 0], ['t', 2016], ['t', 2207], ['d', 2144, 2016], ['d', 2146, 2144], ['d', 2018, 2146], ['d', 2081, 2207], ['t', 2271], ['p', 2018, 1], ['p', 2271, 0], ['r', 2018, 2080], ['t', 2079], ['p', 2018, 0], ['t', 1954], ['d', 2207, 2081, 2079], ['d', 2271, 2145], ['p', 2081, 1], ['p', 2271, 0], ['r', 2080, 2145], ['d', 2271, 2208], ['r', 2145, 2080], ['p', 2145, 0], ['r', 2081, 2016], ['t', 2143], ['r', 2016, 1954], ['d', 2145, 2271], ['r', 1954, 2081], ['d', 2208, 2207], ['d', 2144, 2016], ['p', 1954, 0], ['r', 2080, 1954], ['p', 2145, 1], ['r', 2081, 2146], ['r', 2145, 2017], ['t', 2142], ['p', 2144, 1], ['r', 1954, 2081], ['r', 2017, 2082], ['r', 2146, 2144], ['d', 2271, 2143, 2145, 2017], ['d', 2018, 2146], ['d', 2017, 2018], ['p', 2208, 0], ['p', 1954, 1], ['d', 2016, 2142], ['d', 2207, 2271], ['d', 2208, 2145], ['r', 1954, 2082], ['t', 2078], ['r', 2082, 2208], ['d', 2146, 2144], ['r', 2208, 2146], ['p', 2082, 0], ['d', 2018, 1954], ['t', 2019]];

/*
 * The window on the game, held still.
 *
 * Wide enough for eight or nine tiles across at the size the real board draws
 * them, and centred a little below the opening cell, which is where this game
 * spreads. Fixed rather than fitted to what has been played: a frame that grows
 * with the board rezooms the whole picture every time a tile is laid, and a
 * backdrop that keeps changing scale is the one thing a backdrop must not do.
 */
const FRAME = [-470, -340, 980, 700];

/** Turn one of the short forms back into something the engine will match. */
function intentOf(row) {
  const [kind] = row;
  if (kind === 't') return { type: 'tile', cell: row[1] };
  if (kind === 'p') return { type: 'piece', cell: row[1], piece: row[2] };
  if (kind === 'd') return { type: 'disk', path: row.slice(1) };
  return { type: 'ring', from: row[1], to: row[2] };
}

/** The position as the little board draws it: coordinates, not keys. */
function spec(state) {
  const tiles = [];
  const pieces = [];
  for (const k of state.tileKeys) {
    tiles.push([keyQ(k), keyR(k), state.tileAt[k]]);
    /* Empty is -1, not 0, and 0 is a real piece — a falsy test here would have
       dropped every black disk on the board. */
    const piece = state.pieceAt[k];
    if (piece >= 0) {
      pieces.push([keyQ(k), keyR(k), pieceOwner(piece), pieceType(piece)]);
    }
  }
  return { tiles, pieces, showSpots: false, spots: [], frame: FRAME };
}

/**
 * Start the board behind `host`. Returns a function that stops it.
 *
 * Stopped when the home screen is left, so nothing keeps ticking behind a page
 * that is no longer there — and never started at all for a reader who has asked
 * their system for less movement, for whom a page that will not sit still is
 * the problem rather than the decoration.
 */
export function startHomeBoard(host) {
  const still = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let state = createState();
  let at = 0;
  let timer = 0;

  const draw = () => { host.innerHTML = miniBoardSvg(spec(state)); };

  draw();
  if (still) return () => {};      // the opening position, and no more

  const step = () => {
    if (at >= MOVES.length) {
      // Out of moves: back to the opening, which is a pause of its own.
      state = createState();
      at = 0;
    } else {
      const move = findLegalMove(state, intentOf(MOVES[at]));
      at += 1;
      /* A move the position will not take can only mean the list and the rules
         have drifted apart. Start over rather than stopping dead: this is
         scenery, and scenery that vanishes is worse than scenery that repeats. */
      if (!move) { state = createState(); at = 0; } else applyMove(state, move);
    }
    draw();
    timer = setTimeout(step, 2600 + Math.random() * 1400);
  };

  timer = setTimeout(step, 1200);
  return () => clearTimeout(timer);
}
