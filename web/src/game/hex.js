/**
 * Hexagonal geometry for Hexaequo.
 *
 * Axial coordinates (q, r) over pointy-top hexagons. Cells are packed into a
 * single integer key so that board arrays can be flat typed arrays and so that
 * neighbour offsets become plain integer additions:
 *
 *     key = (q + 32) * 64 + (r + 32)      with q, r in [-32, 31]
 *
 * Because the key is linear in q and r, the key of the cell halfway between two
 * cells two steps apart is exactly the average of their keys — used to find
 * which piece a jump flies over.
 */

export const KEY_COUNT = 4096;

export const key = (q, r) => ((q + 32) << 6) | (r + 32);
export const keyQ = (k) => (k >> 6) - 32;
export const keyR = (k) => (k & 63) - 32;
export const inBoard = (k) => k >= 0 && k < KEY_COUNT;

/** The six neighbour directions, clockwise from east. */
export const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

/** Neighbour offsets as key deltas, and the same doubled (a jump landing). */
export const STEP = DIRECTIONS.map(([q, r]) => q * 64 + r);
export const LEAP = STEP.map((d) => d * 2);

/**
 * The twelve cells at hex distance exactly 2: six in a straight line and six
 * "diagonals". This is the ring's full move set.
 */
export const RING_OFFSETS = [
  [2, 0], [2, -2], [0, -2], [-2, 0], [-2, 2], [0, 2],
  [2, -1], [1, -2], [-1, -1], [-2, 1], [-1, 2], [1, 1],
].map(([q, r]) => q * 64 + r);

/** Hex distance between two cells, in steps. */
export function distance(a, b) {
  const dq = keyQ(a) - keyQ(b);
  const dr = keyR(a) - keyR(b);
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

/* ── Pixel geometry ─────────────────────────────────────────────────────── */

export const SQRT3 = Math.sqrt(3);

/** Centre of a cell in user units, for a hexagon of circumradius `size`. */
export const centerX = (k, size) => size * SQRT3 * (keyQ(k) + keyR(k) / 2);
export const centerY = (k, size) => size * 1.5 * keyR(k);

const CORNERS = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return [Math.cos(a), Math.sin(a)];
});

/** SVG path data for a pointy-top hexagon. */
export function hexPath(x, y, size) {
  return CORNERS
    .map(([a, b], i) => (i ? 'L' : 'M') + (x + a * size).toFixed(2) + ' ' + (y + b * size).toFixed(2))
    .join(' ') + 'Z';
}

/* ── Human-readable coordinates ─────────────────────────────────────────── */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Short label such as "I8", used in the move list. */
export function cellLabel(k) {
  const q = keyQ(k) + 8;
  const r = keyR(k) + 8;
  return (q >= 0 && q < 26 ? LETTERS[q] : '?') + r;
}
