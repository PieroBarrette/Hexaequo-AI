/**
 * Small static positions used to illustrate the rules.
 *
 * Diagrams are described in axial coordinates and drawn with the same geometry
 * and the same theme tokens as the real board, so an illustration can never
 * drift away from what the game actually looks like.
 */

import { key, hexPath } from '../game/hex.js';
import { BLACK, DISK, makePiece } from '../game/state.js';
import { pieceSvg, cx, cy, SIZE } from './board.js';

/**
 * @param {object} spec
 * @param {Array} [spec.tiles]   [q, r, colour]
 * @param {Array} [spec.pieces]  [q, r, player, type]
 * @param {Array} [spec.spots]   [q, r] — dashed candidate cells
 * @param {Array} [spec.bad]     [q, r] — cells marked as not allowed
 * @param {Array} [spec.dots]    [q, r, 'move' | 'capture']
 * @param {Array} [spec.path]    [[q, r], …] — a travelled route
 */
export function miniBoardSvg(spec) {
  const tiles = spec.tiles || [];
  const pieces = spec.pieces || [];
  const spots = spec.spots || [];
  const bad = spec.bad || [];
  const dots = spec.dots || [];
  const route = spec.path || [];

  const all = [];
  const add = (q, r) => all.push(key(q, r));
  tiles.forEach(([q, r]) => add(q, r));
  spots.forEach(([q, r]) => add(q, r));
  bad.forEach(([q, r]) => add(q, r));
  dots.forEach(([q, r]) => add(q, r));

  let out = '';

  for (const [q, r] of spots) {
    const k = key(q, r);
    out += `<path d="${hexPath(cx(k), cy(k), SIZE * .94)}" fill="var(--spot-fill)"`
      + ` stroke="var(--spot-line)" stroke-width="2" stroke-dasharray="6 4"/>`;
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
