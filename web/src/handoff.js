/**
 * A position handed from one screen to the next.
 *
 * Taking a position out of a finished game and playing on from it means moving
 * a whole board between two mounts of the play view. It will not fit in a URL,
 * and putting it in storage would leave it lying around to be picked up by a
 * later visit that never asked for it.
 *
 * So: one slot, read once. Whoever takes it, owns it; whoever arrives after
 * them finds nothing and starts an ordinary game.
 */

let waiting = null;

/**
 * @param {object} handoff
 * @param {object} handoff.position  a game state, already cloned
 * @param {string} handoff.mode      'local' | 'ai' | 'aiai'
 * @param {number} handoff.side      which colour the human takes, for 'ai'
 * @param {string} [handoff.from]    what it was taken from, to say so on screen
 */
export function offerPosition(handoff) {
  waiting = handoff;
}

/** Take the waiting position, if there is one. Leaves the slot empty. */
export function takePosition() {
  const held = waiting;
  waiting = null;
  return held;
}
