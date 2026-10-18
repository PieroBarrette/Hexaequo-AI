/**
 * What a rated game did for the player, beyond the number.
 *
 * A rating that moves twelve points is a fact; a rating that moves twelve
 * points and lifts you past two people on the leaderboard is a reason to play
 * another. Both answers here are worked out from what the site already
 * publishes -- the leaderboard and your own record -- after the game has been
 * written, so nothing new has to be kept anywhere.
 *
 * Pure functions, so they can be checked without a board or a server.
 */

/**
 * The player's place on the leaderboard before and after the game.
 *
 * `players` is the leaderboard as it stands now, so it already holds both new
 * ratings. Counted rather than looked up: a place is one more than the number
 * of people above you, which reads the same for "before" and "after" -- the
 * one other rating the game moved is the opponent's, and theirs is put back to
 * what it was for the "before" count. `before` is null for a player who was
 * not on the leaderboard yet (their first rated game).
 *
 * Returns null when the player cannot be found among `players`.
 */
export function leaderboardPlace({ players, myId, opponentId, mine, theirs, firstGame }) {
  if (!Array.isArray(players) || !mine || !players.some((p) => p.id === myId)) return null;
  const others = players.filter((p) => p.id !== myId);
  const above = (rating, then) => others.filter((p) => {
    const theirsThen = then && p.id === opponentId && theirs ? theirs.before : p.elo;
    return theirsThen > rating;
  }).length;
  return {
    after: 1 + above(mine.after, false),
    before: firstGame ? null : 1 + above(mine.before, true),
  };
}

/**
 * Whether this game's rating is the best the player has ever had.
 *
 * `stats` is the player's record as it stands after the game: its peak
 * already includes this game, so a new best is a peak equal to the new rating
 * that no earlier point on the curve reached. Never for a first rated game --
 * the first number anyone has is trivially their best -- nor for a game that
 * lost points.
 */
export function isPersonalBest({ stats, mine }) {
  if (!stats || !mine || !(mine.change > 0)) return false;
  if (!stats.rated || stats.rated.played < 2) return false;
  if (stats.peakElo > mine.after) return false;
  const earlier = (stats.curve || []).slice(0, -1);
  return !earlier.some((point) => point.elo >= mine.after);
}

/** "1er", "3e" / "1st", "3rd": a place, the way each language writes one. */
export function ordinal(n, language) {
  if (language === 'fr') return n === 1 ? '1er' : `${n}e`;
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
}
