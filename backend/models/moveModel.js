/**
 * Move Model
 * 
 * Database operations for move history.
 */

const { query } = require('../config/database');

/**
 * Record a move
 */
async function create({
    gameId,
    moveNumber,
    player,
    moveType,
    fromQ,
    fromR,
    toQ,
    toR,
    captures,
    stateSnapshot,
    timeRemainingBlack,
    timeRemainingWhite,
    moveTime
}) {
    const result = await query(
        `INSERT INTO moves (
            game_id, move_number, player, move_type,
            from_q, from_r, to_q, to_r,
            captures, state_snapshot,
            time_remaining_black, time_remaining_white, move_time
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [
            gameId, moveNumber, player, moveType,
            fromQ, fromR, toQ, toR,
            captures ? JSON.stringify(captures) : null,
            stateSnapshot ? JSON.stringify(stateSnapshot) : null,
            timeRemainingBlack, timeRemainingWhite, moveTime
        ]
    );
    
    return result.rows[0];
}

/**
 * Get all moves for a game
 */
async function findByGameId(gameId) {
    const result = await query(
        `SELECT id, move_number, player, move_type,
                from_q, from_r, to_q, to_r,
                captures, state_snapshot,
                time_remaining_black, time_remaining_white, move_time,
                created_at
         FROM moves
         WHERE game_id = $1
         ORDER BY move_number`,
        [gameId]
    );
    
    return result.rows;
}

/**
 * Get move at specific position
 */
async function findAtPosition(gameId, moveNumber) {
    const result = await query(
        `SELECT * FROM moves
         WHERE game_id = $1 AND move_number = $2`,
        [gameId, moveNumber]
    );
    
    return result.rows[0] || null;
}

/**
 * Get last move of a game
 */
async function getLastMove(gameId) {
    const result = await query(
        `SELECT * FROM moves
         WHERE game_id = $1
         ORDER BY move_number DESC
         LIMIT 1`,
        [gameId]
    );
    
    return result.rows[0] || null;
}

/**
 * Get move count for a game
 */
async function getCount(gameId) {
    const result = await query(
        `SELECT COUNT(*) FROM moves WHERE game_id = $1`,
        [gameId]
    );
    
    return parseInt(result.rows[0].count);
}

/**
 * Delete all moves for a game
 */
async function deleteByGameId(gameId) {
    const result = await query(
        `DELETE FROM moves WHERE game_id = $1`,
        [gameId]
    );
    
    return result.rowCount;
}

/**
 * Get moves in a range
 */
async function findInRange(gameId, startMove, endMove) {
    const result = await query(
        `SELECT * FROM moves
         WHERE game_id = $1 AND move_number >= $2 AND move_number <= $3
         ORDER BY move_number`,
        [gameId, startMove, endMove]
    );
    
    return result.rows;
}

module.exports = {
    create,
    findByGameId,
    findAtPosition,
    getLastMove,
    getCount,
    deleteByGameId,
    findInRange
};
