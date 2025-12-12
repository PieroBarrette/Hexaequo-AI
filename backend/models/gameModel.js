/**
 * Game Model
 * 
 * Database operations for completed games.
 */

const { query, transaction } = require('../config/database');

/**
 * Create a new game record
 */
async function create({
    roomCode,
    blackPlayerId,
    blackPseudo,
    blackEloBefore,
    whitePlayerId,
    whitePseudo,
    whiteEloBefore,
    timeMode
}) {
    const result = await query(
        `INSERT INTO games (
            room_code, black_player_id, black_pseudo, black_elo_before,
            white_player_id, white_pseudo, white_elo_before, time_mode
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [roomCode, blackPlayerId, blackPseudo, blackEloBefore, whitePlayerId, whitePseudo, whiteEloBefore, timeMode]
    );
    
    return result.rows[0];
}

/**
 * Find game by ID
 */
async function findById(id) {
    const result = await query(
        `SELECT g.*,
                COUNT(m.id) as move_count
         FROM games g
         LEFT JOIN moves m ON m.game_id = g.id
         WHERE g.id = $1
         GROUP BY g.id`,
        [id]
    );
    
    return result.rows[0] || null;
}

/**
 * Get games list with filters
 */
async function findAll({ status, timeMode, playerId, page = 1, limit = 20 }) {
    const conditions = [];
    const params = [];
    let paramIndex = 1;
    
    if (status === 'finished') {
        conditions.push('winner IS NOT NULL');
    } else if (status === 'playing') {
        conditions.push('winner IS NULL');
    }
    
    if (timeMode) {
        conditions.push(`time_mode = $${paramIndex}`);
        params.push(timeMode);
        paramIndex++;
    }
    
    if (playerId) {
        conditions.push(`(black_player_id = $${paramIndex} OR white_player_id = $${paramIndex})`);
        params.push(playerId);
        paramIndex++;
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    
    params.push(limit, offset);
    
    const [countResult, dataResult] = await Promise.all([
        query(
            `SELECT COUNT(*) FROM games ${whereClause}`,
            params.slice(0, -2)
        ),
        query(
            `SELECT id, room_code, black_player_id, black_pseudo, white_player_id, white_pseudo,
                    time_mode, winner, result_reason, started_at, finished_at
             FROM games
             ${whereClause}
             ORDER BY started_at DESC
             LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            params
        )
    ]);
    
    const total = parseInt(countResult.rows[0].count);
    
    return {
        games: dataResult.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    };
}

/**
 * Get user's match history
 */
async function getUserMatchHistory(userId, { page = 1, limit = 20 }) {
    const offset = (page - 1) * limit;
    
    const [countResult, dataResult] = await Promise.all([
        query(
            `SELECT COUNT(*) FROM games 
             WHERE (black_player_id = $1 OR white_player_id = $1) AND winner IS NOT NULL`,
            [userId]
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
             WHERE (g.black_player_id = $1 OR g.white_player_id = $1) AND g.winner IS NOT NULL
             ORDER BY g.finished_at DESC
             LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
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

/**
 * Complete a game
 */
async function complete(id, {
    winner,
    resultReason,
    finalState,
    blackEloAfter,
    whiteEloAfter
}) {
    const result = await query(
        `UPDATE games
         SET winner = $1, result_reason = $2, final_state = $3,
             black_elo_after = $4, white_elo_after = $5, finished_at = NOW()
         WHERE id = $6
         RETURNING *`,
        [winner, resultReason, JSON.stringify(finalState), blackEloAfter, whiteEloAfter, id]
    );
    
    return result.rows[0] || null;
}

/**
 * Get game replay (game + all moves)
 */
async function getReplay(gameId) {
    const [gameResult, movesResult] = await Promise.all([
        query(`SELECT * FROM games WHERE id = $1`, [gameId]),
        query(
            `SELECT move_number, player, move_type, from_q, from_r, to_q, to_r,
                    captures, state_snapshot, time_remaining_black, time_remaining_white, 
                    move_time, created_at
             FROM moves
             WHERE game_id = $1
             ORDER BY move_number`,
            [gameId]
        )
    ]);
    
    if (!gameResult.rows[0]) return null;
    
    return {
        game: gameResult.rows[0],
        moves: movesResult.rows
    };
}

/**
 * Get head-to-head stats between two players
 */
async function getHeadToHead(playerId1, playerId2) {
    const result = await query(
        `SELECT 
            COUNT(*) as total_games,
            SUM(CASE WHEN 
                (black_player_id = $1 AND winner = 'black') OR 
                (white_player_id = $1 AND winner = 'white') 
                THEN 1 ELSE 0 END) as player1_wins,
            SUM(CASE WHEN 
                (black_player_id = $2 AND winner = 'black') OR 
                (white_player_id = $2 AND winner = 'white') 
                THEN 1 ELSE 0 END) as player2_wins,
            SUM(CASE WHEN winner = 'draw' THEN 1 ELSE 0 END) as draws
         FROM games
         WHERE ((black_player_id = $1 AND white_player_id = $2) OR
                (black_player_id = $2 AND white_player_id = $1))
               AND winner IS NOT NULL`,
        [playerId1, playerId2]
    );
    
    return result.rows[0];
}

module.exports = {
    create,
    findById,
    findAll,
    getUserMatchHistory,
    complete,
    getReplay,
    getHeadToHead
};
