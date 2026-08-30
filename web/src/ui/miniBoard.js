/**
 * Small static positions used to illustrate the rules.
 *
 * Diagrams are described in axial coordinates and drawn with the same geometry
 * and the same theme tokens as the real board, so an illustration can never
 * drift away from what the game actually looks like.
 */

import { key, hexPath } from '../game/hex.js';
import { BLACK, DISK, makePiece } from '../game/state.js';
import { pieceSvg, cx, cy, SIZE, coordinateLabels } from './board.js';

/**
 * `lastMove` and `coords` are opt-in, and the rules figures do not ask for
 * them: a diagram explaining how a ring moves should show that and nothing
 * else. The settings preview asks for both, because there its whole job is to
 * show what the switches do.
 *
 * @param {object} spec
 * @param {Array} [spec.tiles]     [q, r, colour]
 * @param {Array} [spec.pieces]    [q, r, player, type]
 * @param {Array} [spec.spots]     [q, r] — dashed candidate cells
 * @param {Array} [spec.bad]       [q, r] — cells marked as not allowed
 * @param {Array} [spec.dots]      [q, r, 'move' | 'capture']
 * @param {Array} [spec.path]      [[q, r], …] — a travelled route
 * @param {Array} [spec.lastMove]  [[q, r], …] — cells traced as the move just played
 * @param {boolean} [spec.coords]  axial coordinates around the rim
 * @param {boolean} [spec.showSpots]  false draws no candidate cells but still frames them
 */
export function miniBoardSvg(spec) {
  const tiles = spec.tiles || [];
  const pieces = spec.pieces || [];
  const spots = spec.spots || [];
  const bad = spec.bad || [];
  const dots = spec.dots || [];
  const route = spec.path || [];
  const lastMove = spec.lastMove || [];

  const all = [];
  const add = (q, r) => all.push(key(q, r));
  tiles.forEach(([q, r]) => add(q, r));
  spots.forEach(([q, r]) => add(q, r));
  bad.forEach(([q, r]) => add(q, r));
  dots.forEach(([q, r]) => add(q, r));

  let out = '';

  /* Framed either way, drawn only when asked — which is what the real board
     does with the move aid off: the cell is still there and still a hit target,
     it just stops announcing itself. Dropping the cells instead would resize
     the picture, and a preview that changes shape is answering a question
     nobody asked. */
  if (spec.showSpots !== false) {
    for (const [q, r] of spots) {
      const k = key(q, r);
      out += `<path d="${hexPath(cx(k), cy(k), SIZE * .94)}" fill="var(--spot-fill)"`
        + ` stroke="var(--spot-line)" stroke-width="2" stroke-dasharray="6 4"/>`;
    }
  }
  for (const [q, r] of bad) {
    const k = key(q, r);
    out += `<path d="${hexPath(cx(k), cy(k), SIZE * .94)}" fill="none"`
      + ` stroke="var(--danger)" stroke-width="2" stroke-dasharray="6 4"/>`;
    const x = cx(k), y = cy(k), d = SIZE * .28;
    out += `<path d="M${x - d} ${y - d}L${x + d} ${y + d}M${x + d} ${y - d}L${x - d} ${y + d}"`
      + ` stroke="var(--danger)" stroke-width="3" stroke-linecap="round" fill="none"/>`;
  }
  for (const [q, r, colour] of tiles) {
    const k = key(q, r);
    out += `<path d="${hexPath(cx(k), cy(k), SIZE * .94)}"`
      + ` fill="${colour === BLACK ? 'var(--tile-dark)' : 'var(--tile-light)'}"`
      + ` stroke="${colour === BLACK ? 'var(--tile-dark-edge)' : 'var(--tile-light-edge)'}"`
      + ` stroke-width="1.6"/>`;
  }
  /* Over the tiles and under the pieces, the way the real board lays it. */
  for (const [q, r] of lastMove) {
    const k = key(q, r);
    out += `<path d="${hexPath(cx(k), cy(k), SIZE * .94)}"`
      + ` fill="var(--last-move-fill)" stroke="var(--last-move-edge)" stroke-width="3"/>`;
  }
  // Same place in the order as the real board: on the tiles, under the pieces.
  if (spec.coords) {
    const dark = new Set(tiles.filter(([, , c]) => c === BLACK).map(([q, r]) => key(q, r)));
    out += coordinateLabels(tiles.map(([q, r]) => key(q, r)), (k) => dark.has(k));
  }
  if (route.length > 1) {
    let d = '';
    route.forEach(([q, r], i) => {
      const k = key(q, r);
      d += (i ? 'L' : 'M') + cx(k).toFixed(1) + ' ' + cy(k).toFixed(1);
    });
    out += `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="3"`
      + ` stroke-dasharray="7 5" stroke-linecap="round"/>`;
  }
  for (const [q, r, player, type] of pieces) {
    const k = key(q, r);
    out += pieceSvg(cx(k), cy(k), makePiece(player, type === undefined ? DISK : type));
  }
  for (const [q, r, kind] of dots) {
    const k = key(q, r);
    const x = cx(k), y = cy(k);
    out += kind === 'capture'
      ? `<circle cx="${x}" cy="${y}" r="${SIZE * .55}" fill="none" stroke="var(--danger)" stroke-width="4"/>`
      : `<circle cx="${x}" cy="${y}" r="${SIZE * .19}" fill="var(--accent)" fill-opacity=".7"/>`;
  }

  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const k of all) {
    const x = cx(k), y = cy(k);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const pad = SIZE * 1.15;
  const vb = [x0 - pad, y0 - pad, (x1 - x0) + 2 * pad, (y1 - y0) + 2 * pad];

  return `<svg viewBox="${vb.map((n) => n.toFixed(1)).join(' ')}"`
    + ` preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"`
    + ` role="img" aria-hidden="true">${out}</svg>`;
}
