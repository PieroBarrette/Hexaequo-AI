/**
 * Game Model
 * 
 * A player's match history, for GET /api/users/:id/matches.
 *
 * Finished games are written by services/ratedGameService.js and read for the
 * app by services/profileService.js. The older writes that used to live here
 * went with the previous front end's game service on 2026-10-23.
 */

const { query } = require('../config/database');

/*
 * The line /api/profile draws between a player's own history and what anyone
 * else may see of it: a friendly belongs to the two who played it, so a
 * visitor is shown the rated games only. Taken from profileService rather than
 * written again, so the two histories cannot come to disagree.
 */
const { RATED_FOR } = require('../services/profileService');

/**
 * Get user's match history with filters
 *
 * ratedOnly leaves out the games that did not move this player's rating — set
 * for anyone but the player.
 */
async function getUserMatchHistory(userId, { page = 1, limit = 25, result: resultFilter, timeMode, opponentName, dateFrom, dateTo, ratedOnly = false } = {}) {
    const offset = (page - 1) * limit;

    // Build dynamic WHERE clause
    const conditions = ['(g.black_player_id = $1 OR g.white_player_id = $1)', 'g.winner IS NOT NULL'];
    const params = [userId];
    let paramIndex = 2;

    // Someone else's history: the rated games only, counted the same way
    if (ratedOnly) {
        conditions.push(`(${RATED_FOR('$1')})`);
    }

    // Time mode filter
    if (timeMode) {
        conditions.push(`g.time_mode = $${paramIndex}`);
        params.push(timeMode);
        paramIndex++;
    }

    // Opponent name filter (ILIKE search on the opponent's pseudo)
    if (opponentName) {
        conditions.push(`(CASE WHEN g.black_player_id = $1 THEN g.white_pseudo ELSE g.black_pseudo END) ILIKE $${paramIndex}`);
        params.push(`%${opponentName}%`);
        paramIndex++;
    }

    // Date range filters
    if (dateFrom) {
        conditions.push(`g.finished_at >= $${paramIndex}`);
        params.push(dateFrom);
        paramIndex++;
    }
    if (dateTo) {
        conditions.push(`g.finished_at <= $${paramIndex}`);
        params.push(dateTo);
        paramIndex++;
    }

    // Result filter (win, loss, draw) — applied as a subquery wrapping the CASE expression
    let resultCondition = '';
    if (resultFilter && resultFilter.length > 0 && resultFilter.length < 3) {
        const resultCases = resultFilter.map(r => {
            if (r === 'win') return `((g.black_player_id = $1 AND g.winner = 'black') OR (g.white_player_id = $1 AND g.winner = 'white'))`;
            if (r === 'loss') return `((g.black_player_id = $1 AND g.winner = 'white') OR (g.white_player_id = $1 AND g.winner = 'black'))`;
            if (r === 'draw') return `g.winner = 'draw'`;
            return null;
        }).filter(Boolean);
        if (resultCases.length > 0) {
            resultCondition = `AND (${resultCases.join(' OR ')})`;
        }
    }

    const whereClause = `WHERE ${conditions.join(' AND ')} ${resultCondition}`;

    // Count and data params
    const countParams = params.slice();
    const dataParams = [...params, limit, offset];

    const [countResult, dataResult] = await Promise.all([
        query(
            `SELECT COUNT(*) FROM games g ${whereClause}`,
            countParams
        ),
        query(
            `SELECT
                g.id,
                g.time_mode,
                g.winner,
                g.result_reason,
                g.finished_at,
                CASE
                    WHEN g.black_player_id = $1 THEN 'black'
                    ELSE 'white'
                END as player_color,
                CASE
                    WHEN g.black_player_id = $1 THEN g.white_pseudo
                    ELSE g.black_pseudo
                END as opponent_pseudo,
                CASE
                    WHEN g.black_player_id = $1 THEN g.white_elo_before
                    ELSE g.black_elo_before
                END as opponent_elo,
                CASE
                    WHEN g.black_player_id = $1 THEN g.black_elo_after - g.black_elo_before
                    ELSE g.white_elo_after - g.white_elo_before
                END as elo_change,
                CASE
                    WHEN (g.black_player_id = $1 AND g.winner = 'black') OR
                         (g.white_player_id = $1 AND g.winner = 'white') THEN 'win'
                    WHEN g.winner = 'draw' THEN 'draw'
                    ELSE 'loss'
                END as result
             FROM games g
             ${whereClause}
             ORDER BY g.finished_at DESC
             LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            dataParams
        )
    ]);

    const total = parseInt(countResult.rows[0].count);

    return {
        matches: dataResult.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    };
}

module.exports = {
    getUserMatchHistory
};
