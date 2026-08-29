/**
 * What a player can look back on: their record, their rating over time, and
 * every game they have played.
 *
 * The record is computed from the games themselves rather than read off the
 * counters on the user row. Those counters only move for rated games, so
 * trusting them would quietly hide every friendly a player ever played.
 */

const { query } = require('../config/database');

const CURVE_POINTS = 60;
const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** A game as it looks to one of its two players. */
function asSeenBy(row, userId) {
    const iAmBlack = row.black_player_id === userId;
    const mine = iAmBlack ? 'black' : 'white';
    const outcome = row.winner === 'draw' || row.winner === null
        ? 'draw'
        : (row.winner === mine ? 'win' : 'loss');
    const before = iAmBlack ? row.black_elo_before : row.white_elo_before;
    const after = iAmBlack ? row.black_elo_after : row.white_elo_after;
    return {
        id: row.id,
        playedAt: row.finished_at || row.started_at,
        colour: iAmBlack ? 0 : 1,
        outcome,
        reason: row.result_reason,
        timeControl: row.time_mode,
        plies: Number(row.plies) || 0,
        // Rated is not a column: it is what the elo columns being filled means.
        rated: before !== null && after !== null,
        ratingBefore: before,
        ratingAfter: after,
        ratingChange: before !== null && after !== null ? after - before : null,
        opponent: {
            userId: iAmBlack ? row.white_player_id : row.black_player_id,
            pseudo: (iAmBlack ? row.white_pseudo : row.black_pseudo) || null,
            elo: iAmBlack ? row.white_elo_before : row.black_elo_before,
        },
    };
}

const GAME_COLUMNS = `
    g.id, g.black_player_id, g.black_pseudo, g.black_elo_before, g.black_elo_after,
    g.white_player_id, g.white_pseudo, g.white_elo_before, g.white_elo_after,
    g.time_mode, g.winner, g.result_reason, g.started_at, g.finished_at,
    (SELECT count(*) FROM moves m WHERE m.game_id = g.id) AS plies`;

/** Every game this player has been in, most recent first. */
async function history(userId, { page = 1, limit = PAGE_SIZE } = {}) {
    const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(limit) || PAGE_SIZE));
    const offset = (Math.max(1, Number(page) || 1) - 1) * size;

    const { rows } = await query(
        `SELECT ${GAME_COLUMNS} FROM games g
         WHERE g.black_player_id = $1 OR g.white_player_id = $1
         ORDER BY COALESCE(g.finished_at, g.started_at) DESC
         LIMIT $2 OFFSET $3`,
        [userId, size, offset]
    );
    const total = await query(
        `SELECT count(*)::int AS n FROM games
         WHERE black_player_id = $1 OR white_player_id = $1`,
        [userId]
    );
    return {
        games: rows.map((row) => asSeenBy(row, userId)),
        page: Math.max(1, Number(page) || 1),
        pageSize: size,
        total: total.rows[0].n,
    };
}

async function stats(userId) {
    const account = await query(
        'SELECT id, pseudo, elo, created_at FROM users WHERE id = $1', [userId]);
    if (!account.rows.length) return null;

    /* One pass over the player's games, split by whether the rating moved and
       by cadence, so the page can show both the honest total and the rated
       record without asking three more questions. */
    const tally = await query(
        `SELECT
            g.time_mode,
            (CASE WHEN g.black_player_id = $1 THEN g.black_elo_after ELSE g.white_elo_after END)
                IS NOT NULL AS rated,
            (CASE
                WHEN g.winner = 'draw' OR g.winner IS NULL THEN 'draw'
                WHEN (g.winner = 'black') = (g.black_player_id = $1) THEN 'win'
                ELSE 'loss'
             END) AS outcome,
            count(*)::int AS n
         FROM games g
         WHERE g.black_player_id = $1 OR g.white_player_id = $1
         GROUP BY 1, 2, 3`,
        [userId]
    );

    const blank = () => ({ played: 0, wins: 0, losses: 0, draws: 0 });
    const all = blank();
    const ratedOnly = blank();
    const byCadence = {};
    for (const row of tally.rows) {
        const cadence = row.time_mode || 'none';
        byCadence[cadence] = byCadence[cadence] || blank();
        for (const bucket of [all, byCadence[cadence], ...(row.rated ? [ratedOnly] : [])]) {
            bucket.played += row.n;
            if (row.outcome === 'win') bucket.wins += row.n;
            else if (row.outcome === 'loss') bucket.losses += row.n;
            else bucket.draws += row.n;
        }
    }

    const curve = await query(
        `SELECT elo_after, created_at FROM elo_history
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, CURVE_POINTS]
    );
    const peak = await query(
        'SELECT max(elo_after)::int AS peak FROM elo_history WHERE user_id = $1', [userId]);

    const user = account.rows[0];
    return {
        pseudo: user.pseudo,
        elo: user.elo,
        peakElo: Math.max(peak.rows[0].peak || 0, user.elo),
        memberSince: user.created_at,
        all,
        rated: ratedOnly,
        byCadence,
        // Oldest first, which is the direction a curve is read in.
        curve: curve.rows.reverse().map((row) => ({ elo: row.elo_after, at: row.created_at })),
    };
}

/**
 * One game, in full, for the review board.
 *
 * The ordered moves are the game; the client replays them through the same
 * engine both players used, so what it draws is what was played rather than a
 * summary of it.
 */
async function replay(gameId, viewerId) {
    const { rows } = await query(
        `SELECT ${GAME_COLUMNS}, g.room_code, g.final_state FROM games g WHERE g.id = $1`,
        [gameId]
    );
    if (!rows.length) return null;
    const game = rows[0];

    const moves = await query(
        `SELECT intent, notation FROM moves
         WHERE game_id = $1 ORDER BY move_number ASC`,
        [gameId]
    );
    /* Games recorded before the move columns existed kept only a projection of
       each move, which cannot be replayed. Say so rather than drawing a board
       that never happened. */
    const complete = moves.rows.length > 0 && moves.rows.every((row) => row.intent);

    return {
        ...asSeenBy(game, viewerId),
        roomCode: game.room_code,
        black: { userId: game.black_player_id, pseudo: game.black_pseudo, elo: game.black_elo_before },
        white: { userId: game.white_player_id, pseudo: game.white_pseudo, elo: game.white_elo_before },
        winner: game.winner,
        replayable: complete,
        moves: complete ? moves.rows.map((row) => row.intent) : [],
        notations: complete ? moves.rows.map((row) => row.notation || '') : [],
        finalState: game.final_state,
    };
}

/**
 * The record between two players, from the first one's side.
 *
 * The question anyone looks at another player's page to answer is "how do I do
 * against them", and it is one query rather than a second page of history to
 * read and count by hand.
 */
async function versus(userId, otherId) {
    if (!userId || !otherId || userId === otherId) return null;
    const { rows } = await query(
        `SELECT
            (CASE
                WHEN g.winner = 'draw' OR g.winner IS NULL THEN 'draw'
                WHEN (g.winner = 'black') = (g.black_player_id = $1) THEN 'win'
                ELSE 'loss'
             END) AS outcome,
            count(*)::int AS n
         FROM games g
         WHERE (g.black_player_id = $1 AND g.white_player_id = $2)
            OR (g.black_player_id = $2 AND g.white_player_id = $1)
         GROUP BY 1`,
        [userId, otherId]
    );
    const record = { played: 0, wins: 0, losses: 0, draws: 0 };
    for (const row of rows) {
        record.played += row.n;
        if (row.outcome === 'win') record.wins += row.n;
        else if (row.outcome === 'loss') record.losses += row.n;
        else record.draws += row.n;
    }
    return record.played ? record : null;
}

module.exports = { stats, history, replay, versus, PAGE_SIZE };
