/**
 * The engine's opinion of every position in a game, off the main thread.
 *
 * A search cannot be interrupted once it starts — one thread, and it does not
 * yield — so the only lever the review ever had on how long the page froze was
 * how little to ask for. That is why the eval curve thinks for 120ms at depth
 * five: at 250ms and depth six the curve cost 3.3 seconds of blocked thread
 * and the review lurched.
 *
 * An accuracy report cannot be bought at that price. Measured on this machine:
 * depth 5 costs 35ms a position, depth 6 costs 144, depth 7 costs 507 — about
 * fifty seconds for a full game. On the page that is fifty seconds of nothing
 * moving. In here it is fifty seconds of the page behaving normally with a
 * progress bar filling, which is the whole reason this file exists.
 *
 * Depth rather than a clock, and this matters: the same position judged for
 * 120ms and for 400ms reached depth five and depth seven, and depth five picks
 * a different move from depth seven in a third of positions. A number that
 * changes with how busy the machine was is not a number about the game. At a
 * fixed depth the answer is the same everywhere, every time — so two players
 * reading the same game read the same report.
 *
 * It sends each verdict as it arrives rather than the lot at the end: the
 * curve sharpens while you watch, and a game half analysed is half a report
 * rather than none.
 */

import { createState, cloneState, applyMove } from './state.js';
import { findLegalMove } from './moves.js';
import { judge } from './ai.js';

self.addEventListener('message', (event) => {
  const request = event.data;
  if (!request || request.type !== 'analyse') return;
  try {
    run(request);
  } catch (error) {
    self.postMessage({ type: 'failed', reason: String(error && error.message || error) });
  }
});

function run({ moves, depth, token }) {
  /* Replayed from the opening rather than handed the positions, because the
     intents are what a stored game keeps and replaying them is how the review
     itself rebuilds the board. Anything that cannot be replayed is a game the
     review would not be drawing either. */
  const state = createState();
  const timeline = [cloneState(state)];
  for (const intent of moves) {
    const move = findLegalMove(state, intent);
    if (!move) {
      self.postMessage({ type: 'failed', token, reason: 'UNPLAYABLE', ply: timeline.length - 1 });
      return;
    }
    applyMove(state, move);
    timeline.push(cloneState(state));
  }

  self.postMessage({ type: 'started', token, plies: timeline.length });

  for (let ply = 0; ply < timeline.length; ply++) {
    /* Only what came before it. Handing over the whole game would let the
       search treat positions that have not happened yet as though they had,
       and call a line drawn on a repetition still in the future. */
    const history = timeline.slice(0, ply + 1);
    const verdict = judge(cloneState(timeline[ply]),
      { ms: Infinity, maxDepth: depth, history });
    self.postMessage({
      type: 'verdict',
      token,
      ply,
      score: verdict.score,
      depth: verdict.depth,
      decisive: verdict.decisive,
      move: verdict.move,
      /* How deep the search had to go before it stopped changing its mind --
         which is as close as it comes to saying how hard the move was to see.
         Computed on the way to the verdict and otherwise thrown away. */
      settledAt: verdict.settledAt,
    });
  }

  self.postMessage({ type: 'done', token });
}
