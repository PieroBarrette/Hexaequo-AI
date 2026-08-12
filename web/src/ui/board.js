/**
 * SVG board renderer.
 *
 * The board is redrawn wholesale on every change — it never exceeds a few dozen
 * shapes — while anything that must survive a redraw lives in a separate effects
 * layer: the flying piece of a move, the ghosts of captured pieces, and the
 * piece being dragged. That split is what lets an animation keep playing while
 * the rest of the board re-renders underneath it.
 */

import { keyQ, keyR, hexPath, SQRT3, centerX, centerY } from '../game/hex.js';
import { BLACK, DISK, pieceOwner, pieceType } from '../game/state.js';

export const SIZE = 40;
export const cx = (k) => centerX(k, SIZE);
export const cy = (k) => centerY(k, SIZE);

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
  return `<g pointer-events="none">`
    + `<circle cx="${x}" cy="${y + shadow}" r="${r * .44}" fill="var(--piece-shadow)"/>`
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
  let raf = 0;

  function step(now) {
    const u = Math.min(1, (now - startedAt) / 500);
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

  function render(v) {
    const s = v.state;
    const aid = v.showValidMoves;

    /* Framing follows the tiles and the cells where the board may still grow,
       so it only shifts when a tile is laid. */
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const k of s.tileKeys.concat(v.spots)) {
      const x = cx(k), y = cy(k);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    /* The padding is not decoration: it keeps every clickable cell on screen
       *during* the re-framing glide.
       Laying a tile can only create new placement cells one ring beyond it, so
       at most SQRT3 * SIZE away. Padding wider than that puts tomorrow's cells
       inside today's frame. Since the framed box never shrinks — a cell only
       leaves `spots` by becoming a tile — every intermediate frame of the tween
       contains the previous one, and therefore contains those cells too. Without
       this, a click landing during the 500 ms glide could fall on a cell that
       had not been scrolled into view yet, and silently do nothing. */
    const pad = SIZE * 1.85;
    const w = Math.max((x1 - x0) + 2 * pad, SIZE * SQRT3 * 5);
    const h = Math.max((y1 - y0) + 2 * pad, SIZE * 1.5 * 5);
    setView({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h }, v.instant);

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
      const fill = emphasise && aid ? 'var(--spot-fill-strong)'
        : (lit ? 'var(--spot-fill)' : (live ? 'transparent' : 'none'));
      out += `<path class="cell${live ? ' is-clickable' : ''}"${live ? ` data-cell="${k}"` : ''}`
        + ` d="${hexPath(x, y, SIZE * .94)}"`
        + ` fill="${fill}"`
        + ` stroke="${emphasise && aid ? 'var(--accent)' : (lit ? 'var(--spot-line)' : 'var(--ghost-line)')}"`
        + ` stroke-width="${emphasise && aid ? 2.2 : 1.6}" stroke-dasharray="6 4"/>`;
      if (lit) {
        out += `<path d="M${x - 9} ${y}h18M${x} ${y - 9}v18" fill="none"`
          + ` stroke="var(--accent)" stroke-opacity="${emphasise ? .95 : .34}"`
          + ` stroke-width="${emphasise ? 2.8 : 2.2}" stroke-linecap="round" pointer-events="none"/>`;
      }
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

    /* Trace of the previous move. */
    for (const k of v.lastMoveCells) {
      out += `<path d="${hexPath(cx(k), cy(k), SIZE * .94)}" fill="none"`
        + ` stroke="var(--accent)" stroke-opacity=".5" stroke-width="2.5" pointer-events="none"/>`;
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

    /* Inline piece chooser, shown only when both a disk and a ring are legal. */
    if (v.picker) {
      const x = cx(v.picker.cell), y = cy(v.picker.cell);
      const n = v.picker.options.length;
      out += `<path d="${hexPath(x, y, SIZE * .94)}" fill="var(--spot-fill-strong)"`
        + ` stroke="var(--accent)" stroke-width="3" pointer-events="none"/>`;
      v.picker.options.forEach((option, i) => {
        const gx = n === 1 ? x : x + (i ? SIZE * .31 : -SIZE * .31);
        const r = n === 1 ? SIZE * .44 : SIZE * .33;
        out += `<circle cx="${gx}" cy="${y}" r="${r}" fill="var(--spot-fill-strong)"`
          + ` stroke="var(--accent)" stroke-width="1.6" pointer-events="none"/>`;
        out += pieceSvg(gx, y, v.picker.pieceCode(option), n === 1 ? .66 : .52);
        out += `<circle class="cell is-clickable" data-cell="${v.picker.cell}" data-piece="${option}"`
          + ` cx="${gx}" cy="${y}" r="${r}" fill="transparent"/>`;
      });
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
    setView,
    toUserSpace,
    playEffects,
    clearEffects,
    beginDrag,
    remainingEffectMs: () => Math.max(0, endsAt - Date.now()),
  };
}
