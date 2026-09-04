/**
 * SVG board renderer.
 *
 * The board is redrawn wholesale on every change — it never exceeds a few dozen
 * shapes — while anything that must survive a redraw lives in a separate effects
 * layer: the flying piece of a move, the ghosts of captured pieces, and the
 * piece being dragged. That split is what lets an animation keep playing while
 * the rest of the board re-renders underneath it.
 */

import { keyQ, keyR, hexPath, SQRT3, centerX, centerY, cellLabel } from '../game/hex.js';
import { BLACK, DISK, pieceOwner, pieceType } from '../game/state.js';

export const SIZE = 40;
export const cx = (k) => centerX(k, SIZE);
export const cy = (k) => centerY(k, SIZE);

/**
 * Each cell's own coordinate, printed on it — the label the move list writes.
 *
 * Round the rim is where these started, a letter per column and a number per
 * row, and on a board that grows a cell at a time it would not keep still: lay
 * one tile and the whole ladder of markings shuffles along the edge. On the
 * tile the label belongs to, it never moves again. It also says the whole thing
 * at once, so reading "J10" off the board takes no counting.
 *
 * Smaller than a disc, so a piece landing on the tile covers it, the way a
 * printed board works. Never a hit target: it has to be there when looked for
 * and out of the way when not.
 *
 * The ink follows the tile under it. One grey for both was legible on the dark
 * tiles and all but gone on the pale ones — the mark has to contrast with what
 * it is printed on, not with the page.
 *
 * @param {Array} cells    cells to label
 * @param {Function} [ink] k → the colour to write it in; defaults to the ink
 *                         for a pale tile, which is what the rules figures use
 */
export function coordinateLabels(cells, ink) {
  let out = '';
  for (const k of cells) {
    const colour = typeof ink === 'function' ? ink(k) : 'var(--coord-on-light)';
    out += `<text class="coord" x="${cx(k).toFixed(1)}" y="${cy(k).toFixed(1)}"`
      + ` font-size="${(SIZE * .26).toFixed(1)}" fill="${colour}"`
      + ` text-anchor="middle" dominant-baseline="central"`
      + ` pointer-events="none">${cellLabel(k)}</text>`;
  }
  return out;
}

/** One piece as SVG. `scale` shrinks it for the inline piece chooser. */
export function pieceSvg(x, y, code, scale) {
  const r = SIZE * (scale || 1);
  const isDark = pieceOwner(code) === BLACK;
  const shadow = scale ? 1 : 2;
  const fill = isDark ? 'var(--piece-dark)' : 'var(--piece-light)';
  const edge = isDark ? 'var(--piece-dark-edge)' : 'var(--piece-light-edge)';
  const gloss = isDark ? 'var(--piece-gloss)' : 'var(--piece-gloss-light)';

  if (pieceType(code) === DISK) {
    return `<g pointer-events="none">`
      + `<circle cx="${x}" cy="${y + shadow}" r="${r * .42}" fill="var(--piece-shadow)"/>`
      + `<circle cx="${x}" cy="${y}" r="${r * .42}" fill="${fill}" stroke="${edge}" stroke-width="${2.5 * (scale || 1)}"/>`
      + `<circle cx="${x - r * .13}" cy="${y - r * .15}" r="${r * .1}" fill="rgba(255,255,255,${gloss})"/>`
      + `</g>`;
  }
  /*
   * A ring is a hole, and the hole is meant to be one.
   *
   * The shadow used to be a filled circle the width of the whole piece, so it
   * lay across the middle as well as under the band — and it is a translucent
   * black, between a quarter and a half of it, so the tile seen through the
   * ring came out tinted. Not an illusion: a wash of shadow over the thing you
   * were looking through. Stroked to the same width as the band it falls
   * under, it shades what casts it and nothing else.
   */
  return `<g pointer-events="none">`
    + `<circle cx="${x}" cy="${y + shadow}" r="${r * .44}" fill="none"`
    + ` stroke="var(--piece-shadow)" stroke-width="${r * .26}"/>`
    + `<circle cx="${x}" cy="${y}" r="${r * .44}" fill="none" stroke="${fill}" stroke-width="${r * .26}"/>`
    + `<circle cx="${x}" cy="${y}" r="${r * .57}" fill="none" stroke="${edge}" stroke-width="${1.6 * (scale || 1)}"/>`
    + `<circle cx="${x}" cy="${y}" r="${r * .31}" fill="none" stroke="${edge}" stroke-width="${1.6 * (scale || 1)}"/>`
    + `</g>`;
}

const lerp = (a, b, t) => a + (b - a) * t;
const viewBoxString = (v) => `${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}`;

export function createBoard(container) {
  container.innerHTML =
    '<svg class="board" xmlns="http://www.w3.org/2000/svg">'
    + '<g class="board-main"></g><g class="board-fx"></g></svg>';
  const svg = container.querySelector('svg');
  const main = svg.querySelector('.board-main');
  const fxLayer = svg.querySelector('.board-fx');

  let view = null;
  let from = null;
  let to = null;
  let startedAt = 0;
  let takes = 0;
  let raf = 0;

  /*
   * How long a re-framing takes: as far as it has to go, within reason.
   *
   * One fixed length made a nudge of a few pixels crawl and a jump across the
   * whole board hurry, and both read as the same wrong thing — a camera that
   * does not move the way a hand would. Measured against the frame itself, so
   * it means the same on a phone as on a desktop.
   */
  const SHORTEST = 240;
  const LONGEST = 620;
  function glideMs(a, b) {
    const span = Math.max(
      Math.abs(a.x - b.x) / a.w, Math.abs(a.y - b.y) / a.h,
      Math.abs(a.w - b.w) / a.w, Math.abs(a.h - b.h) / a.h,
    );
    return Math.min(LONGEST, SHORTEST + span * 900);
  }

  function step(now) {
    const u = Math.min(1, (now - startedAt) / takes);
    const e = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    view = {
      x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e),
      w: lerp(from.w, to.w, e), h: lerp(from.h, to.h, e),
    };
    svg.setAttribute('viewBox', viewBoxString(view));
    raf = u < 1 ? requestAnimationFrame(step) : 0;
  }

  /** Frame the board; glides unless `instant`. */
  function setView(target, instant) {
    if (!view || instant) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      view = { ...target };
      svg.setAttribute('viewBox', viewBoxString(view));
      return;
    }
    const reference = raf ? to : view;
    if (Math.abs(target.x - reference.x) < .5 && Math.abs(target.y - reference.y) < .5
      && Math.abs(target.w - reference.w) < .5 && Math.abs(target.h - reference.h) < .5) return;
    from = { ...view };
    to = { ...target };
    takes = glideMs(view, target);
    startedAt = performance.now();
    if (!raf) raf = requestAnimationFrame(step);
  }

  /** Convert client coordinates into board user units. */
  function toUserSpace(clientX, clientY) {
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  }

  /** Where a point of the board actually is on screen, in CSS pixels. */
  function toScreenSpace(x, y) {
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = y;
    return point.matrixTransform(matrix);
  }

  /* Framing follows the tiles and the cells where the board may still grow,
     so it only shifts when a tile is laid — or when the box it is cut to fit
     changes shape underneath it. */
  function frame(v, instant) {
    const outline = v.state.tileKeys.concat(v.spots);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const k of outline) {
      const x = cx(k), y = cy(k);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    /*
     * Margin round the outermost cells.
     *
     * The outline is centres, so a cell reaches SIZE above and below its own
     * and SQRT3/2 * SIZE to either side: anything under one SIZE clips the
     * edge cells. 1.25 leaves a tenth of a cell of air beyond that and no
     * more, because on a small board the margin is most of the picture — at
     * the old 1.85 it was very nearly half the width of the frame, and every
     * pixel of it was paid for by the pieces.
     *
     * It used to be set to SQRT3 * SIZE, the distance to the ring of cells
     * that appears when a tile is laid, so that during the 500 ms re-framing
     * glide a brand new cell was already on screen and could be clicked. What
     * that guards against barely happens: laying a tile ends your turn, so the
     * cells it creates are not yours to click while the board is still moving,
     * and by the time the turn comes round the glide is long over.
     */
    const pad = SIZE * 1.25;

    /*
     * How far in we are willing to zoom, shaped like the box we draw into.
     *
     * The floor used to be five cells across and five down whatever the screen
     * — a frame half again wider than it is tall. A phone held upright is far
     * taller than that, so the drawing was pinned by its width and a fifth of
     * the board area was letterboxed away above and below it: dead space that
     * grew every time something else on the page gave up height, while the
     * pieces themselves never got any bigger for it.
     *
     * The same number of cells stays in view; the frame simply takes the box's
     * proportions, so a tall box sees fewer columns and more rows and spends
     * that height on the board. Only ever narrowed: a frame already wider than
     * the box is left alone, which is every desktop.
     *
     * The floor is a floor. Whatever is actually on the board still sets the
     * frame the moment it outgrows this, so no cell is ever framed out — which
     * is why it can afford to be close in. Four and a half cells rather than
     * five: the opening is four tiles and the ring of places they allow, and
     * showing it at arm's length to leave room for a board that does not exist
     * yet only makes the pieces small at the one moment there is nothing else
     * to look at. They give that size back a little at a time as the board
     * grows, which is the right way round.
     */
    let floorW = SIZE * SQRT3 * 4.5;
    let floorH = SIZE * 1.5 * 4.5;
    const box = svg.getBoundingClientRect();
    if (box.width > 0 && box.height > 0 && box.width / box.height < floorW / floorH) {
      const cells = floorW * floorH;
      floorW = Math.sqrt(cells * (box.width / box.height));
      floorH = cells / floorW;
    }
    let w = Math.max((x1 - x0) + 2 * pad, floorW);
    let h = Math.max((y1 - y0) + 2 * pad, floorH);
    /* Then out to the shape of the box. A frame that does not match its box is
       drawn in the middle of it with a band of nothing along two edges, and on
       a phone that band was the better part of a hundred pixels. Growing the
       short side is free — the other one is what sets the scale — and it only
       ever grows, so nothing on the board can fall outside it. */
    if (box.width > 0 && box.height > 0) {
      const boxShape = box.width / box.height;
      if (w / h < boxShape) w = h * boxShape;
      else h = w / boxShape;
    }
    setView({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h }, instant);
  }

  /* The last position drawn, so the frame can be recut without redrawing it. */
  let framed = null;

  function render(v) {
    const s = v.state;
    const aid = v.showValidMoves;

    framed = v;
    frame(v, v.instant);

    const emphasise = v.placeMode === 'tile';
    let out = '';

    /* Cells where a tile may be laid.
       A playable cell must always carry a paint: fill="none" leaves the interior
       transparent to the pointer, so only the dashed stroke would be clickable.
       With the move aid off the cell is painted `transparent` — invisible, but
       still a hit target. */
    for (const k of v.spots) {
      const x = cx(k), y = cy(k);
      const live = v.spotsLive;
      const lit = live && aid;
      // With the aid on, the dashed outline is the whole signal. With it off,
      // the cell is painted `transparent` and left unmarked: invisible, but
      // still a hit target, since fill="none" would not catch a click.
      out += `<path class="cell${live ? ' is-clickable' : ''}"${live ? ` data-cell="${k}"` : ''}`
        + ` d="${hexPath(x, y, SIZE * .94)}"`
        + ` fill="${lit ? (emphasise ? 'var(--spot-fill-strong)' : 'var(--spot-fill)') : 'transparent'}"`
        + (lit
          ? ` stroke="var(--spot-line)" stroke-width="${emphasise ? 2.6 : 2}" stroke-dasharray="6 4"`
          : ' stroke="none"')
        + `/>`;
    }

    /* Tiles. */
    for (const k of s.tileKeys) {
      const colour = s.tileAt[k];
      const clickable = v.targets.has(k) || v.hints.has(k) || k === v.chainCurrent || v.movable.has(k);
      out += `<path class="cell${clickable ? ' is-clickable' : ''}" data-cell="${k}"`
        + `${v.newTile === k ? ' data-fx="tile"' : ''}`
        + ` d="${hexPath(cx(k), cy(k), SIZE * .94)}"`
        + ` fill="${colour === BLACK ? 'var(--tile-dark)' : 'var(--tile-light)'}"`
        + ` stroke="${colour === BLACK ? 'var(--tile-dark-edge)' : 'var(--tile-light-edge)'}"`
        + ` stroke-width="1.6"/>`;
    }

    /*
     * Trace of the previous move.
     *
     * A wash inside the outline as well as the outline itself: a thin line at
     * half opacity was nearly invisible against a pale tile, and knowing what
     * the opponent just did is the one thing you always want to see.
     */
    for (const k of v.lastMoveCells) {
      out += `<path d="${hexPath(cx(k), cy(k), SIZE * .94)}"`
        + ` fill="var(--last-move-fill)" stroke="var(--last-move-edge)"`
        + ` stroke-width="3" pointer-events="none"/>`;
    }


    /* A move lined up for our turn: dashed, because it has not happened and
       may yet turn out to be illegal. */
    for (const k of v.premoveCells || []) {
      out += `<path d="${hexPath(cx(k), cy(k), SIZE * .94)}" fill="none"`
        + ` stroke="var(--accent)" stroke-width="3" stroke-dasharray="7 6"`
        + ` pointer-events="none"/>`;
    }

    const focus = v.chainCurrent != null ? v.chainCurrent : v.selected;
    if (focus != null) {
      out += `<path d="${hexPath(cx(focus), cy(focus), SIZE * .94)}" fill="none"`
        + ` stroke="var(--accent)" stroke-width="4" pointer-events="none"/>`;
    }

    /* Path already travelled in a multi-jump. */
    if (v.chainPath.length > 1) {
      let d = '';
      v.chainPath.forEach((k, i) => { d += (i ? 'L' : 'M') + cx(k).toFixed(1) + ' ' + cy(k).toFixed(1); });
      out += `<path d="${d}" fill="none" stroke="var(--accent)" stroke-opacity=".55"`
        + ` stroke-width="3" stroke-dasharray="7 5" pointer-events="none"/>`;
    }

    /* Pieces, minus the one in flight and the one under the pointer. */
    for (const k of s.tileKeys) {
      const code = s.pieceAt[k];
      if (code < 0 || k === v.hidden || k === v.held) continue;
      const glyph = pieceSvg(cx(k), cy(k), code);
      out += v.newPiece === k ? `<g data-fx="drop">${glyph}</g>` : glyph;
    }
    if (v.chainCurrent != null && v.chainCurrent !== v.hidden && v.chainCurrent !== v.held) {
      out += pieceSvg(cx(v.chainCurrent), cy(v.chainCurrent), v.chainPiece);
    }

    /*
     * The coordinates, over everything the board has put down.
     *
     * They used to go under the pieces, so a tile with a piece on it lost its
     * name — which is the tile you most often want to name, since it is the
     * one something is happening on. Over the top now, small enough to read
     * past and written in whatever contrasts with what it lands on.
     *
     * The empty cells a tile may still be laid on are named too. They are
     * where the next move goes, so they are the squares worth saying out loud,
     * and until now they were the only ones without a name.
     */
    if (v.showCoordinates) {
      const ink = (k) => {
        if (s.tileAt[k] < 0) return 'var(--coord-on-board)';
        const code = s.pieceAt[k];
        /* Through the hole of a ring you see the tile, so the tile is what the
           mark has to stand out from. A disk covers the tile, so the disk is.
           A piece in flight or under the pointer is not on its cell to be
           stood on. */
        const onADisk = code >= 0 && pieceType(code) === DISK
          && k !== v.hidden && k !== v.held;
        const dark = onADisk ? pieceOwner(code) === BLACK : s.tileAt[k] === BLACK;
        return dark ? 'var(--coord-on-dark)' : 'var(--coord-on-light)';
      };
      out += coordinateLabels(s.tileKeys.concat(v.spots), ink);
    }

    /* Move aids. */
    if (aid) {
      for (const k of v.hints) {
        out += `<circle cx="${cx(k)}" cy="${cy(k)}" r="${SIZE * .13}" fill="none"`
          + ` stroke="var(--accent)" stroke-opacity=".45" stroke-width="2"`
          + ` stroke-dasharray="3 3" pointer-events="none"/>`;
      }
    }
    for (const [k, target] of v.targets) {
      const x = cx(k), y = cy(k);
      if (!aid) {
        // The aid is off: keep the cell clickable but show nothing.
        out += `<circle class="cell is-clickable" data-cell="${k}" cx="${x}" cy="${y}"`
          + ` r="${SIZE * .3}" fill="transparent"/>`;
      } else if (target.kind === 'capture') {
        out += `<circle class="cell is-clickable pulse" data-cell="${k}" cx="${x}" cy="${y}"`
          + ` r="${SIZE * .55}" fill="none" stroke="var(--danger)" stroke-width="4"/>`;
      } else {
        out += `<circle class="cell is-clickable" data-cell="${k}" cx="${x}" cy="${y}"`
          + ` r="${SIZE * (target.kind === 'place' ? .2 : .19)}"`
          + ` fill="var(--accent)" fill-opacity="${target.kind === 'place' ? .75 : .55}"/>`;
      }
    }

    /*
     * The cell a piece is being chosen for.
     *
     * The choice itself is drawn in HTML above the board rather than here: two
     * targets squeezed inside one hexagon came out around thirteen pixels
     * across on a phone, which is a third of what a finger needs.
     */
    if (v.picker) {
      const x = cx(v.picker.cell), y = cy(v.picker.cell);
      out += `<path d="${hexPath(x, y, SIZE * .94)}" fill="var(--spot-fill-strong)"`
        + ` stroke="var(--accent)" stroke-width="3" pointer-events="none"/>`;
    }

    main.innerHTML = out;
  }

  /* ── Effects layer ────────────────────────────────────────────────────── */

  let timer = 0;
  let endsAt = 0;

  function clearEffects() {
    clearTimeout(timer);
    endsAt = 0;
    fxLayer.innerHTML = '';
  }

  /**
   * Animate a move that has already been applied to the state.
   * `effect` carries the flight path, the captured pieces with the jump index at
   * which each is taken, and which freshly drawn shapes should pop in.
   * Returns the total duration in milliseconds.
   */
  function playEffects(effect, onSettled) {
    fxLayer.innerHTML = '';
    const steps = effect.path ? effect.path.length - 1 : 0;
    const flight = steps ? Math.min(180 + 150 * steps, 820) : 0;
    let total = 0;

    if (effect.captured.length) {
      let ghosts = '';
      for (const c of effect.captured) {
        ghosts += `<g class="fx-ghost">${pieceSvg(cx(c.cell), cy(c.cell), c.code)}</g>`;
      }
      fxLayer.insertAdjacentHTML('beforeend', ghosts);
    }

    if (steps) {
      const last = effect.path[steps];
      fxLayer.insertAdjacentHTML('beforeend',
        `<g class="fx-flyer">${pieceSvg(cx(last), cy(last), effect.code)}</g>`);
      fxLayer.querySelector('.fx-flyer').animate(
        effect.path.map((k) => ({
          transform: `translate(${(cx(k) - cx(last)).toFixed(2)}px,${(cy(k) - cy(last)).toFixed(2)}px)`,
          easing: 'cubic-bezier(.45,0,.25,1)',
        })),
        { duration: flight });
      total = flight;
    }

    const ghostNodes = fxLayer.querySelectorAll('.fx-ghost');
    effect.captured.forEach((c, i) => {
      const node = ghostNodes[i];
      if (!node) return;
      const delay = steps ? Math.max(0, flight * Math.min(1, c.step / steps) - 80) : 0;
      node.animate(
        [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.15)' }],
        { duration: 300, delay, easing: 'ease-in', fill: 'forwards' });
      total = Math.max(total, delay + 300);
    });

    if (effect.newTile != null) {
      const node = main.querySelector('[data-fx="tile"]');
      if (node) {
        node.animate([{ opacity: 0, transform: 'scale(.25)' }, { opacity: 1, transform: 'scale(1)' }],
          { duration: 340, easing: 'cubic-bezier(.2,1.5,.4,1)' });
        total = Math.max(total, 340);
      }
    }
    if (effect.newPiece != null) {
      const node = main.querySelector('[data-fx="drop"]');
      if (node) {
        node.animate([
          { opacity: 0, transform: 'scale(2.6)' },
          { opacity: 1, transform: 'scale(.93)' },
          { opacity: 1, transform: 'scale(1)' },
        ], { duration: 330, easing: 'cubic-bezier(.3,.7,.3,1)' });
        total = Math.max(total, 330);
      }
    }

    endsAt = Date.now() + total;
    clearTimeout(timer);
    timer = setTimeout(() => { fxLayer.innerHTML = ''; if (onSettled) onSettled(); }, total + 40);
    return total;
  }

  /** Show a piece following the pointer during a drag. */
  function beginDrag(k, code) {
    fxLayer.innerHTML = `<g class="fx-flyer">${pieceSvg(cx(k), cy(k), code)}</g>`;
    return fxLayer.querySelector('.fx-flyer');
  }

  return {
    svg,
    render,
    /*
     * Cut the frame again against the box as it stands now.
     *
     * The frame is measured against the box, and the board is not the last
     * thing drawn into the page: the bar under it gains a row when a game ends
     * and the review controls arrive, the network strip appears, the result
     * card is put up. Each of those changes how much room the board has, after
     * the board has already decided what to do with it. Called once everything
     * else has been laid out, this is the second look. Nothing is redrawn —
     * only the window onto the drawing moves.
     */
    reframe: (instant) => { if (framed) frame(framed, Boolean(instant)); },
    setView,
    toUserSpace,
    toScreenSpace,
    playEffects,
    clearEffects,
    beginDrag,
    remainingEffectMs: () => Math.max(0, endsAt - Date.now()),
  };
}
