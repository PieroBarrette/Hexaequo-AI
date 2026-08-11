/**
 * The rules, each one paired with a worked example.
 *
 * Every diagram is generated from the same geometry and tokens as the live
 * board, so the illustrations follow the theme and cannot fall out of step with
 * the implementation.
 */

import { t } from '../i18n.js';
import { miniBoardSvg } from '../ui/miniBoard.js';
import { logoMarkSvg } from '../ui/logo.js';
import { BLACK, WHITE, DISK, RING } from '../game/state.js';
import { RING_OFFSETS, keyQ, keyR, key } from '../game/hex.js';

/* The opening block, reused by several diagrams. */
const OPENING = [[0, 0, BLACK], [1, 0, BLACK], [-1, 1, WHITE], [0, 1, WHITE]];

/* Cells at distance two from the origin, for the ring diagram. */
const RING_TARGETS = RING_OFFSETS.map((delta) => {
  const k = key(0, 0) + delta;
  return [keyQ(k), keyR(k)];
});

const FIGURES = {
  setup: {
    tiles: OPENING,
    pieces: [[1, 0, BLACK, DISK], [-1, 1, WHITE, DISK]],
  },

  tilePlacement: {
    tiles: OPENING,
    pieces: [[1, 0, BLACK, DISK], [-1, 1, WHITE, DISK]],
    spots: [[-1, 0], [1, -1], [1, 1], [-1, 2]],
    bad: [[2, 0]],
  },

  piecePlacement: {
    tiles: [[0, 0, BLACK], [1, 0, BLACK], [-1, 1, WHITE], [0, 1, WHITE], [1, -1, BLACK]],
    pieces: [[1, 0, BLACK, DISK], [-1, 1, WHITE, DISK]],
    dots: [[0, 0, 'move'], [1, -1, 'move']],
  },

  diskJump: {
    tiles: [
      [0, 0, BLACK], [1, 0, WHITE], [2, 0, BLACK], [3, 0, WHITE], [4, 0, BLACK],
      [0, 1, WHITE], [1, 1, BLACK], [2, 1, WHITE],
    ],
    pieces: [[0, 0, BLACK, DISK], [1, 0, WHITE, DISK], [3, 0, WHITE, DISK]],
    dots: [[2, 0, 'move'], [4, 0, 'move']],
    path: [[0, 0], [2, 0], [4, 0]],
  },

  ringLeap: {
    tiles: [
      [0, 0, BLACK],
      ...RING_TARGETS.map(([q, r], i) => [q, r, i % 2 ? WHITE : BLACK]),
    ],
    pieces: [[0, 0, BLACK, RING], [2, 0, WHITE, DISK], [-1, 2, WHITE, RING]],
    dots: RING_TARGETS.map(([q, r]) => {
      const isEnemy = (q === 2 && r === 0) || (q === -1 && r === 2);
      return [q, r, isEnemy ? 'capture' : 'move'];
    }),
  },
};

function figure(nameKey, textKey, figureName, captionKey) {
  return `
    <section class="rule-block">
      <h3>${t(nameKey)}</h3>
      <p>${t(textKey)}</p>
      <div class="rule-figure">
        <div class="mini">${miniBoardSvg(FIGURES[figureName])}</div>
        <p class="caption">${t(captionKey)}</p>
      </div>
    </section>`;
}

export function mountRules(outlet) {
  outlet.innerHTML = `
    <div class="page"><div class="page-inner">
      <h1>${t('rules.title')}</h1>
      <p class="lede">${t('rules.lede')}</p>

      <h2>${t('rules.goalTitle')}</h2>
      <p>${t('rules.goalIntro')}</p>
      <ul>
        <li>${t('rules.goalDisks')}</li>
        <li>${t('rules.goalRings')}</li>
        <li>${t('rules.goalCleared')}</li>
      </ul>

      <h2>${t('rules.materialTitle')}</h2>
      <p>${t('rules.materialText')}</p>
      <div class="legend">
        <span><span class="token">${miniTile(BLACK)}</span>${t('common.tile')} ${t('common.black').toLowerCase()}</span>
        <span><span class="token">${miniTile(WHITE)}</span>${t('common.tile')} ${t('common.white').toLowerCase()}</span>
        <span><span class="token">${miniPiece(BLACK, DISK)}</span>${t('common.disk')}</span>
        <span><span class="token">${miniPiece(BLACK, RING)}</span>${t('common.ring')}</span>
      </div>

      ${figure('rules.setupTitle', 'rules.setupText', 'setup', 'rules.setupCaption')}

      <h2>${t('rules.turnTitle')}</h2>
      <p>${t('rules.turnText')}</p>

      ${figure('rules.tileTitle', 'rules.tileText', 'tilePlacement', 'rules.tileCaption')}
      ${figure('rules.placeTitle', 'rules.placeText', 'piecePlacement', 'rules.placeCaption')}
      ${figure('rules.diskTitle', 'rules.diskText', 'diskJump', 'rules.diskCaption')}
      <p>${t('rules.diskLoop')}</p>
      ${figure('rules.ringTitle', 'rules.ringText', 'ringLeap', 'rules.ringCaption')}

      <h2>${t('rules.finePrintTitle')}</h2>
      <ul>
        <li>${t('rules.finePrint1')}</li>
        <li>${t('rules.finePrint2')}</li>
        <li>${t('rules.finePrint3')}</li>
        <li>${t('rules.finePrint4')}</li>
      </ul>

      <h2>${t('rules.drawTitle')}</h2>
      <p>${t('rules.drawText')}</p>

      <div style="display:flex;justify-content:center;margin:34px 0 10px;opacity:.5">
        <div style="height:52px">${logoMarkSvg()}</div>
      </div>
    </div></div>`;
}

/* Tiny standalone glyphs for the legend. */
function miniTile(colour) {
  return miniBoardSvg({ tiles: [[0, 0, colour]] });
}
function miniPiece(player, type) {
  return miniBoardSvg({ tiles: [[0, 0, player === BLACK ? WHITE : BLACK]], pieces: [[0, 0, player, type]] });
}
