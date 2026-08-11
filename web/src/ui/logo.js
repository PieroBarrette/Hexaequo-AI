/**
 * The Hexaequo mark, rebuilt as exact hexagonal geometry.
 *
 * Four pointy-top tiles in the opening block — black at (0,0) and (1,1), white
 * at (1,0) and (0,1) — each carrying one piece, alternating disk and ring. It
 * is literally the starting position of the game.
 *
 * Because the mark is emitted inline it inherits the theme tokens, so the wood
 * palette gives a wooden logo and the metal palette a metal one.
 */

import { hexPath, SQRT3 } from '../game/hex.js';

const SIZE = 160;                       // hexagon circumradius
const STROKE = 11;                      // outline of the light tiles
const DISK_R = 0.38 * SIZE;             // matches the hole of the ring
const RING_OUTER = 0.63 * SIZE;
const RING_INNER = 0.38 * SIZE;
const RING_MID = (RING_OUTER + RING_INNER) / 2;
const RING_W = RING_OUTER - RING_INNER;

const cx = (q, r) => SQRT3 * SIZE * (q + r / 2);
const cy = (q, r) => 1.5 * SIZE * r;

/* tile colour: 'dark' | 'light' · piece: 'disk' | 'ring' */
const CELLS = [
  { q: 0, r: 0, tile: 'dark', piece: 'disk' },
  { q: 1, r: 0, tile: 'light', piece: 'ring' },
  { q: 0, r: 1, tile: 'light', piece: 'disk' },
  { q: 1, r: 1, tile: 'dark', piece: 'ring' },
];

/**
 * @param {object} [options]
 * @param {boolean} [options.solid] use literal black and white instead of theme
 *        tokens — for the favicon and social previews
 */
export function logoMarkSvg(options = {}) {
  const dark = options.solid ? '#000000' : 'var(--tile-dark)';
  const light = options.solid ? '#ffffff' : 'var(--tile-light)';
  const edge = options.solid ? '#000000' : 'var(--tile-dark-edge)';
  const onDark = options.solid ? '#ffffff' : 'var(--piece-light)';
  const onLight = options.solid ? '#000000' : 'var(--piece-dark)';

  let body = '';
  for (const cell of CELLS) {
    const x = cx(cell.q, cell.r);
    const y = cy(cell.q, cell.r);
    const isDark = cell.tile === 'dark';
    const ink = isDark ? onDark : onLight;

    body += `<path d="${hexPath(x, y, SIZE)}" fill="${isDark ? dark : light}"`
          + ` stroke="${isDark ? dark : edge}" stroke-width="${STROKE}"`
          + ` stroke-linejoin="round"/>`;

    body += cell.piece === 'disk'
      ? `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${DISK_R.toFixed(2)}" fill="${ink}"/>`
      : `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${RING_MID.toFixed(2)}"`
        + ` fill="none" stroke="${ink}" stroke-width="${RING_W.toFixed(2)}"/>`;
  }

  // Bounding box of the four hexagons plus half the stroke.
  const pad = STROKE / 2 + 1;
  const minX = cx(0, 0) - SQRT3 * SIZE / 2 - pad;
  const maxX = cx(1, 1) + SQRT3 * SIZE / 2 + pad;
  const minY = cy(0, 0) - SIZE - pad;
  const maxY = cy(0, 1) + SIZE + pad;

  return `<svg class="logo-mark" viewBox="${minX.toFixed(1)} ${minY.toFixed(1)}`
       + ` ${(maxX - minX).toFixed(1)} ${(maxY - minY).toFixed(1)}"`
       + ` xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Hexaequo">${body}</svg>`;
}

/** Mark plus wordmark, for the home page and the site header. */
export function logoLockupHtml(size = 'lg') {
  return `<div class="logo logo--${size}">${logoMarkSvg()}`
       + `<span class="logo-word">HEXAEQUO</span></div>`;
}
