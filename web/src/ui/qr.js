/**
 * A QR code, drawn from scratch.
 *
 * The site has no build step and a strict offline-first service worker, so a
 * library is not available and a "make me a QR" web service would be a network
 * call the app cannot rely on. What is needed is narrow — one short URL, no
 * logos, no colours — and the standard is small at that size, so it is written
 * out here.
 *
 * Byte mode, error correction level M, versions 1 to 10 (up to 213 characters,
 * where an invitation link runs to about sixty). Everything else the format
 * allows is left out.
 */

/* ── The field GF(256), for Reed–Solomon ─────────────────────────────────
 *
 * Multiplication in this field is addition of logarithms, so the two tables
 * below turn every product into two lookups and a sum.
 */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;          // the QR standard's primitive polynomial
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/**
 * The generator polynomial for `degree` error-correction codewords.
 *
 * The product of (x − α^i) for i below the degree. Coefficients run
 * highest-power first, so multiplying by x keeps an index and multiplying by
 * the constant moves one along — getting those two the wrong way round builds
 * the polynomial backwards, which is a code that scans as damaged beyond
 * repair rather than one that fails loudly.
 */
function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];                       // the x term
      next[j + 1] ^= mul(poly[j], EXP[i]);      // the constant term
    }
    poly = next;
  }
  return poly;
}

/** The error-correction codewords for one block. */
function remainder(data, degree) {
  const gen = generator(degree);
  const out = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ out[0];
    out.copyWithin(0, 1);
    out[degree - 1] = 0;
    for (let i = 0; i < degree; i++) out[i] ^= mul(gen[i + 1], factor);
  }
  return out;
}

/* ── The tables the format needs ─────────────────────────────────────────
 *
 * Per version at level M: total codewords, error-correction codewords per
 * block, and how many blocks. Only what versions 1–10 need.
 */
const VERSIONS = [
  null,
  { total: 26, ecc: 10, blocks: [1, 16] },
  { total: 44, ecc: 16, blocks: [1, 28] },
  { total: 70, ecc: 26, blocks: [1, 44] },
  { total: 100, ecc: 18, blocks: [2, 32] },
  { total: 134, ecc: 24, blocks: [2, 43] },
  { total: 172, ecc: 16, blocks: [4, 27] },
  { total: 196, ecc: 18, blocks: [4, 31] },
  { total: 242, ecc: 22, blocks: [2, 38, 2, 39] },
  { total: 292, ecc: 22, blocks: [3, 36, 2, 37] },
  { total: 346, ecc: 26, blocks: [4, 43, 1, 44] },
];

/** Where the alignment patterns go, per version. */
const ALIGNMENT = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

/* Format information for level M and each of the eight masks, pre-computed:
   fifteen bits of BCH-protected mask and level, already XORed with 0x5412. */
const FORMAT = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
];

/** Version information for versions 7 and up: eighteen BCH-protected bits. */
const VERSION_BITS = {
  7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3,
};

/** A bit writer, since everything here is measured in bits and not bytes. */
function bitStream() {
  const bits = [];
  return {
    push(value, length) {
      for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    },
    get length() { return bits.length; },
    bytes() {
      const out = new Uint8Array(Math.ceil(bits.length / 8));
      bits.forEach((bit, i) => { if (bit) out[i >> 3] |= 0x80 >> (i & 7); });
      return out;
    },
  };
}

/** The smallest version that will hold this many bytes at level M. */
function pickVersion(byteLength) {
  for (let version = 1; version <= 10; version++) {
    const { total, ecc, blocks } = VERSIONS[version];
    const blockCount = blocks[0] + (blocks[2] || 0);
    const capacity = total - ecc * blockCount;
    const lengthBits = version < 10 ? 8 : 16;
    if (byteLength + 2 + Math.ceil(lengthBits / 8) <= capacity) return version;
  }
  return null;
}

/** Mode indicator, length, payload, terminator and padding. */
function encodeData(bytes, version) {
  const { total, ecc, blocks } = VERSIONS[version];
  const blockCount = blocks[0] + (blocks[2] || 0);
  const capacity = total - ecc * blockCount;

  const stream = bitStream();
  stream.push(0b0100, 4);                                  // byte mode
  stream.push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) stream.push(byte, 8);
  const room = capacity * 8;
  stream.push(0, Math.min(4, room - stream.length));       // terminator
  while (stream.length % 8) stream.push(0, 1);

  const out = Array.from(stream.bytes());
  const PAD = [0xec, 0x11];
  for (let i = 0; out.length < capacity; i++) out.push(PAD[i % 2]);
  return out;
}

/** Split into blocks, add the check words, and interleave as the format says. */
function withErrorCorrection(data, version) {
  const { ecc, blocks } = VERSIONS[version];
  const groups = [];
  let at = 0;
  for (let g = 0; g < blocks.length; g += 2) {
    for (let i = 0; i < blocks[g]; i++) {
      const size = blocks[g + 1];
      groups.push(data.slice(at, at + size));
      at += size;
    }
  }
  const checks = groups.map((block) => remainder(block, ecc));

  const out = [];
  const longest = Math.max(...groups.map((b) => b.length));
  for (let i = 0; i < longest; i++) {
    for (const block of groups) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecc; i++) for (const check of checks) out.push(check[i]);
  return out;
}

/* ── The grid ────────────────────────────────────────────────────────── */

function blankModules(size) {
  return Array.from({ length: size }, () => new Int8Array(size).fill(-1));
}

function placeFinder(m, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const y = row + r;
      const x = col + c;
      if (y < 0 || x < 0 || y >= m.length || x >= m.length) continue;
      const edge = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      m[y][x] = edge === 2 || edge > 3 ? 0 : 1;
    }
  }
}

function placeFunctionPatterns(m, version) {
  const size = m.length;
  placeFinder(m, 0, 0);
  placeFinder(m, 0, size - 7);
  placeFinder(m, size - 7, 0);

  for (let i = 8; i < size - 8; i++) {                     // timing
    m[6][i] = i % 2 === 0 ? 1 : 0;
    m[i][6] = i % 2 === 0 ? 1 : 0;
  }

  /*
   * Alignment patterns sit at every crossing of the centre list except the
   * three that would land on a finder. Deciding that by looking for an
   * occupied cell instead of by position is wrong from version seven on: the
   * middle centres cross the timing lines, which are occupied but are a place
   * an alignment pattern belongs. Below version seven the two tests happen to
   * agree, which is why it went unnoticed until a longer link needed a bigger
   * symbol.
   */
  const centres = ALIGNMENT[version];
  const first = centres[0];
  const last = centres[centres.length - 1];
  for (const r of centres) {
    for (const c of centres) {
      const onFinder = (r === first && c === first)
        || (r === first && c === last)
        || (r === last && c === first);
      if (onFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          m[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) === 1 ? 0 : 1;
        }
      }
    }
  }

  m[size - 8][8] = 1;                                      // the lone dark module

  // Reserve the format areas so the data walk skips them.
  for (let i = 0; i < 9; i++) {
    if (m[8][i] === -1) m[8][i] = 0;
    if (m[i][8] === -1) m[i][8] = 0;
  }
  for (let i = 0; i < 8; i++) {
    if (m[8][size - 1 - i] === -1) m[8][size - 1 - i] = 0;
    if (m[size - 1 - i][8] === -1) m[size - 1 - i][8] = 0;
  }
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        m[size - 11 + j][i] = 0;
        m[i][size - 11 + j] = 0;
      }
    }
  }
}

/** Which modules the data may be written into. */
function reservedMap(version, size) {
  const probe = blankModules(size);
  placeFunctionPatterns(probe, version);
  return probe.map((row) => row.map((cell) => cell !== -1));
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Walk the two-module-wide columns, bottom-right to top-left, skipping six. */
function placeData(m, reserved, bits) {
  const size = m.length;
  let bit = 0;
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--;                              // the timing column
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (reserved[row][col]) continue;
        const value = bit < bits.length ? bits[bit] : 0;
        m[row][col] = value;
        bit++;
      }
    }
    upward = !upward;
  }
}

/** The penalty rules, which decide which mask to keep. */
function penalty(m) {
  const size = m.length;
  let score = 0;

  const runScore = (line) => {
    let total = 0;
    let run = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) { run++; continue; }
      if (run >= 5) total += 3 + (run - 5);
      run = 1;
    }
    return total;
  };
  for (let i = 0; i < size; i++) {
    score += runScore(m[i]);
    score += runScore(m.map((row) => row[i]));
  }

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }

  const FINDER = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const looksLikeFinder = (line, at) => FINDER.every((v, i) => line[at + i] === v);
  for (let i = 0; i < size; i++) {
    const row = m[i];
    const col = m.map((r) => r[i]);
    for (let j = 0; j + 11 <= size; j++) {
      if (looksLikeFinder(row, j)) score += 40;
      if (looksLikeFinder(col, j)) score += 40;
      const back = FINDER.slice().reverse();
      if (back.every((v, k) => row[j + k] === v)) score += 40;
      if (back.every((v, k) => col[j + k] === v)) score += 40;
    }
  }

  let dark = 0;
  for (const row of m) for (const cell of row) dark += cell;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/*
 * The fifteen format bits, written twice.
 *
 * Both copies run along row eight and column eight, but not in the same
 * direction and not without gaps — the timing modules and the dark module sit
 * in the middle of the run. The indices below are the standard's, spelled out
 * as (row, column) rather than the (x, y) the specification uses, because
 * everything else in this file is indexed by row first.
 */
function placeFormat(m, mask) {
  const size = m.length;
  const bits = FORMAT[mask];
  const at = (i) => (bits >> i) & 1;

  // First copy: down the left of the top-left finder, then along the top.
  for (let i = 0; i <= 5; i++) m[i][8] = at(i);
  m[7][8] = at(6);
  m[8][8] = at(7);
  m[8][7] = at(8);
  for (let i = 9; i <= 14; i++) m[8][14 - i] = at(i);

  // Second copy: along the top right, then up the bottom left.
  for (let i = 0; i <= 7; i++) m[8][size - 1 - i] = at(i);
  for (let i = 8; i <= 14; i++) m[size - 15 + i][8] = at(i);
  m[size - 8][8] = 1;                      // always dark
}

function placeVersion(m, version) {
  if (version < 7) return;
  const size = m.length;
  const bits = VERSION_BITS[version];
  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const r = Math.floor(i / 3);
    const c = i % 3;
    m[size - 11 + c][r] = bit;
    m[r][size - 11 + c] = bit;
  }
}

/**
 * Build the grid for `text`.
 * @returns {number[][]|null} rows of 0/1, or null if it will not fit
 */
export function qrMatrix(text, { mask: forced = null } = {}) {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  const version = pickVersion(bytes.length);
  if (!version) return null;

  const codewords = withErrorCorrection(encodeData(bytes, version), version);
  const bits = [];
  for (const byte of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }

  const size = version * 4 + 17;
  const reserved = reservedMap(version, size);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    if (forced !== null && mask !== forced) continue;
    const m = blankModules(size);
    placeFunctionPatterns(m, version);
    placeData(m, reserved, bits);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!reserved[r][c] && MASKS[mask](r, c)) m[r][c] ^= 1;
      }
    }
    placeFormat(m, mask);
    placeVersion(m, version);
    const grid = m.map((row) => Array.from(row));
    const score = penalty(grid);
    if (!best || score < best.score) best = { score, grid };
  }
  return best.grid;
}

/**
 * The same thing as an SVG string, ready to drop into the page.
 *
 * One path for every dark module rather than one rect each: a version-4 code
 * is over a thousand modules, and a single path is one node instead of a
 * thousand.
 */
export function qrSvg(text, { quiet = 4 } = {}) {
  const grid = qrMatrix(text);
  if (!grid) return '';
  const size = grid.length;
  const span = size + quiet * 2;
  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return `<svg class="qr" viewBox="0 0 ${span} ${span}" shape-rendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg" role="img">
      <rect width="${span}" height="${span}" fill="#fff"/>
      <path d="${path}" fill="#000"/>
    </svg>`;
}
