/**
 * Reading a game back: how well each side played, measured against the engine.
 *
 * The search is somewhere else — this file is the arithmetic, so the worker
 * that does the thinking and the view that draws the result agree on what the
 * numbers mean by sharing them rather than by both being careful.
 *
 * The measure is the one chess sites use, adapted where this game differs.
 * Every position is given a value; a move is worth the difference between the
 * value of the position it left and the value of the position it reached, read
 * from the mover's side. That difference is taken in *win probability* rather
 * than in points, because a disk thrown away when the game is already lost is
 * not the same mistake as a disk thrown away when it was level, and points say
 * it is.
 *
 * Two things about Hexaequo make this cleaner here than in chess. There are no
 * forced moves to speak of — two positions in twenty-four thousand offered a
 * single legal move — so nothing has to be filtered out to stop recaptures
 * flattering everybody. And there is no opening book, so the numbers mean the
 * same thing from the first move as from the fortieth, where a chess engine
 * has to skip the memorised part of the game.
 */

/* The eval bar's own curve, and for the same reason: the difference between
   level and a disk down matters, and the difference between five disks down
   and six does not. Kept at the bar's scale so a move that visibly moves the
   bar is a move that visibly costs accuracy. */
export const SHARE_SCALE = 250;

export function winShare(score) {
  return 1 / (1 + Math.exp(-score / SHARE_SCALE));
}

/*
 * Turning a loss into a mark out of a hundred.
 *
 * The obvious mapping — a hundred minus the loss — was measured over a
 * thousand moves across the four engine levels and puts every one of them
 * between 95 and 99: the signal is there (a beginner gives away four times
 * what a strong player does) but a scale that fine cannot show it. At k=20 the
 * same measurements spread across 60, 72, 83 and 84 — a range a person can
 * read, and in the right order.
 *
 * Applied per move and then averaged, rather than to the average: one thrown
 * game should cost one move's worth of a player's accuracy, not drag the whole
 * number down through an average taken before the curve.
 */
export const ACCURACY_K = 20;

export function moveAccuracy(loss) {
  return 100 * Math.exp(-ACCURACY_K * loss);
}

/*
 * What each mark is worth, in win probability given away.
 *
 * The cuts are where the engine levels separate. Measured over the four of
 * them, judged at the depth the review uses: a beginner puts 15% of their
 * moves in `mistake` and 3% in `blunder`, the strongest level puts none in
 * either and none in `inaccuracy` — every one of its moves lands in the top
 * two bands. A scale that calls a good player's ordinary move an inaccuracy is
 * a scale nobody trusts twice.
 *
 * The depth matters to these numbers and not only to their sharpness. Judged
 * at depth five the two strongest levels came out in the wrong order — the
 * analyst was that strong itself and could not see past it. At seven they
 * separate: 31, 43, 63 and 83 per cent of moves matching its own choice.
 */
export const BANDS = [
  { name: 'best', upTo: 0.01 },
  { name: 'good', upTo: 0.03 },
  { name: 'inaccuracy', upTo: 0.07 },
  { name: 'mistake', upTo: 0.15 },
  { name: 'blunder', upTo: Infinity },
];

/* The marks a reader already knows. Chess has written `?!`, `?` and `??` for a
   century and a half; borrowing them costs no icons, no colour and no legend.
   The two good bands are left unmarked on purpose — half of a strong player's
   moves are in them, and a mark on half the list is not a mark. */
export const BAND_MARK = {
  best: '', good: '', inaccuracy: '?!', mistake: '?', blunder: '??',
};

export function bandOf(loss) {
  for (const band of BANDS) if (loss < band.upTo) return band.name;
  return 'blunder';
}

/** A disk, in the engine's points. A sacrifice has to give up at least one. */
export const SACRIFICE_POINTS = 100;

/**
 * One move, weighed.
 *
 * `before` and `after` are absolute scores — positive for Black — for the
 * position the move left and the position it reached. `mover` says whose move
 * it was, so both can be read from the side that played it.
 *
 * A move can come out better than the engine's own, which is not a player
 * outplaying the search but the search seeing one ply further from the later
 * position than from the earlier one. Those are floored at zero rather than
 * paid out as credit.
 */
export function weigh({ before, after, mover, played, engineMove, material }) {
  const sign = mover === 0 ? 1 : -1;
  const wasWorth = winShare(sign * before);
  const isWorth = winShare(sign * after);
  const loss = Math.max(0, wasWorth - isWorth);
  const band = bandOf(loss);
  const matched = Boolean(engineMove && played
    && JSON.stringify(engineMove) === JSON.stringify(played));

  /*
   * A move that hands over material and does not hand over the game.
   *
   * Three conditions, and the first two were learned by getting it wrong: a
   * first version asked only for a piece given up at no cost in win
   * probability, and found five of them in one game. Two reasons. Late in a
   * won game the curve is flat -- nothing costs anything when you are four
   * disks up -- so every trade looked free; and a trade you come off worse in
   * is attrition, not a sacrifice.
   *
   * So the game has to still be a game, and the engine has to agree the move
   * was best. That second one is what makes the mark worth printing: not "you
   * gave up a piece and got away with it" but "you gave up a piece and it was
   * the strongest move on the board".
   */
  const contested = wasWorth > 0.15 && wasWorth < 0.85;
  const sacrifice = Boolean(material !== undefined
    && material <= -SACRIFICE_POINTS
    && loss < BANDS[0].upTo
    && matched
    && contested);

  return { loss, band, matched, sacrifice, accuracy: moveAccuracy(loss) };
}

/** Every move one player made, as the line a review prints above the list. */
export function summarise(weighed) {
  const counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  let accuracy = 0;
  let matched = 0;
  let sacrifices = 0;
  for (const move of weighed) {
    counts[move.band]++;
    accuracy += move.accuracy;
    if (move.matched) matched++;
    if (move.sacrifice) sacrifices++;
  }
  const n = weighed.length;
  return {
    moves: n,
    counts,
    sacrifices,
    accuracy: n ? Math.round(accuracy / n) : null,
    /* Against roughly eighteen legal moves at every point of the game, picking
       the engine's own by accident is a one-in-eighteen event -- so this is a
       number well clear of its own noise, unlike the same statistic in chess
       where the opening is memorised and the endgame is forced. */
    engineMoves: n ? Math.round((100 * matched) / n) : null,
  };
}
