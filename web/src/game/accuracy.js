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

/** A disk, in the engine's points. */
export const SACRIFICE_POINTS = 100;

/*
 * What makes a move worth an exclamation mark.
 *
 * The first version asked only for a sacrifice — material given up, ground
 * held — and it marked the wrong moves: it missed the ones that look hardest
 * and decorated trades that happened to come out even. The trouble is that
 * "spectacular" is not a fact about material at all. It is a fact about how
 * far you had to see.
 *
 * The first attempt at measuring that judged every position a second time at
 * two plies and asked whether the shallow reading disliked the move. It never
 * fired once in seven hundred moves, and the distribution said why: the
 * shallow value of the position *before* a move already assumes a good move
 * will be played, so the two readings track each other whatever happens. The
 * median gap was zero; so was the ninety-fifth percentile.
 *
 * What does answer the question was being computed all along and thrown away.
 * Iterative deepening picks a best move at every depth; the depth at which it
 * last changed its mind is exactly how far down you had to look before this
 * move won the argument. A third of best moves are best from the first ply —
 * those are the ones anybody plays.
 *
 * Depth alone is not enough, though, and measuring said so too. Taken alone it
 * marks every quiet move the search is slow to settle on, and to somebody
 * watching the board nothing happened at all — which is half of what was wrong
 * with the first version. A move looks spectacular when something visible
 * happens *and* you would not have seen it coming. So both are required:
 * material has to move decisively, and it has to have taken real calculation.
 * Measured over a thousand moves, that is about one a game — and a sacrifice
 * the search saw immediately, which used to be marked, no longer is.
 */
export const SETTLED_DEPTH = 5;             // how far down the search had to go
export const BIG_GAIN = 2 * SACRIFICE_POINTS;

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
export function weigh({ before, after, mover, played, engineMove, material, settledAt = 0 }) {
  const sign = mover === 0 ? 1 : -1;
  const wasWorth = winShare(sign * before);
  const isWorth = winShare(sign * after);
  const loss = Math.max(0, wasWorth - isWorth);
  const band = bandOf(loss);
  const matched = Boolean(engineMove && played
    && JSON.stringify(engineMove) === JSON.stringify(played));

  /*
   * Three gates, before any of the three ways in.
   *
   * The game has to still be a game: late in a won one the curve is flat --
   * nothing costs anything when you are four disks up -- so every trade looked
   * free and a single game collected five brilliancies. The engine has to
   * agree it was the strongest move on the board, which is the whole
   * difference between "you gave up a piece and got away with it" and "you
   * gave up a piece and it was right". And it has to have cost nothing.
   */
  const contested = wasWorth > 0.15 && wasWorth < 0.85;
  const worthy = matched && contested && loss < BANDS[0].upTo;

  const calculated = worthy && settledAt >= SETTLED_DEPTH;
  const sacrifice = Boolean(calculated && material !== undefined && material <= -SACRIFICE_POINTS);
  const haul = Boolean(calculated && material !== undefined && material >= BIG_GAIN);
  const brilliant = sacrifice || haul;

  return {
    loss,
    band,
    matched,
    brilliant,
    /* Which of the three it was. The same mark means a different thing each
       time, and a player learns more from being told which. */
    why: sacrifice ? 'sacrifice' : (haul ? 'haul' : null),
    accuracy: moveAccuracy(loss),
  };
}

/** Every move one player made, as the line a review prints above the list. */
export function summarise(weighed) {
  const counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  let accuracy = 0;
  let matched = 0;
  let brilliancies = 0;
  for (const move of weighed) {
    counts[move.band]++;
    accuracy += move.accuracy;
    if (move.matched) matched++;
    if (move.brilliant) brilliancies++;
  }
  const n = weighed.length;
  return {
    moves: n,
    counts,
    brilliancies,
    accuracy: n ? Math.round(accuracy / n) : null,
    /* Against roughly eighteen legal moves at every point of the game, picking
       the engine's own by accident is a one-in-eighteen event -- so this is a
       number well clear of its own noise, unlike the same statistic in chess
       where the opening is memorised and the endgame is forced. */
    engineMoves: n ? Math.round((100 * matched) / n) : null,
  };
}
