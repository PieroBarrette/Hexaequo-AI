/**
 * Spectator Model
 * 
 * Database operations for game spectators.
 */

const { query } = require('../config/database');

/**
 * Add spectator to room
 */
async function join(roomCode, { userId, socketId, pseudo }) {
    const result = await query(
        `INSERT INTO spectators (room_code, user_id, socket_id, pseudo)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [roomCode.toUpperCase(), userId, socketId, pseudo]
    );
    
    return result.rows[0];
}

/**
 * Remove spectator by socket ID
 */
async function leave(socketId) {
    const result = await query(
        `DELETE FROM spectators WHERE socket_id = $1
         RETURNING room_code`,
        [socketId]
    );
    
    return result.rows[0]?.room_code || null;
}

/**
 * Get all spectators in a room
 */
async function findByRoom(roomCode) {
    const result = await query(
        `SELECT id, user_id, socket_id, pseudo, joined_at
         FROM spectators
         WHERE room_code = $1
         ORDER BY joined_at`,
        [roomCode.toUpperCase()]
    );
    
    return result.rows;
}

/**
 * Get spectator count for a room
 */
async function getCount(roomCode) {
    const result = await query(
        `SELECT COUNT(*) FROM spectators WHERE room_code = $1`,
        [roomCode.toUpperCase()]
    );
    
    return parseInt(result.rows[0].count);
}

/**
 * Remove all spectators from a room
 */
async function clearRoom(roomCode) {
    const result = await query(
        `DELETE FROM spectators WHERE room_code = $1`,
        [roomCode.toUpperCase()]
    );
    
    return result.rowCount;
}

/**
 * Check if user is spectating a room
 */
async function isSpectating(roomCode, userId) {
    const result = await query(
        `SELECT 1 FROM spectators WHERE room_code = $1 AND user_id = $2`,
        [roomCode.toUpperCase(), userId]
    );
    
    return result.rowCount > 0;
}

module.exports = {
    join,
    leave,
    findByRoom,
    getCount,
    clearRoom,
    isSpectating
};
