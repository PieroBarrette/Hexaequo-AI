/**
 * Room Model
 * 
 * Database operations for game rooms/lobby.
 */

const { query } = require('../config/database');

// Characters for room codes (excluding confusing ones)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generate a random room code (8 characters)
 */
function generateCode() {
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
    }
    return code;
}

/**
 * Generate a unique room code
 */
async function generateUniqueCode() {
    let attempts = 0;
    while (attempts < 100) {
        const code = generateCode();
        const exists = await findByCode(code);
        if (!exists) return code;
        attempts++;
    }
    throw new Error('Failed to generate unique room code');
}

/**
 * Create a new room
 */
async function create({ hostId, hostPseudo, hostSocketId, timeMode = 'none', allowSpectators = true }) {
    const code = await generateUniqueCode();
    
    const result = await query(
        `INSERT INTO rooms (code, host_id, host_pseudo, host_socket_id, time_mode, allow_spectators, game_state)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING code, host_id, host_pseudo, time_mode, allow_spectators, status, created_at`,
        [code, hostId, hostPseudo, hostSocketId, timeMode, allowSpectators, JSON.stringify(getInitialGameState())]
    );
    
    return result.rows[0];
}

/**
 * Find room by code
 */
async function findByCode(code) {
    const result = await query(
        `SELECT code, host_id, host_pseudo, host_socket_id,
                white_id, white_pseudo, white_socket_id,
                time_mode, allow_spectators, status,
                game_state, active_player, created_at, updated_at
         FROM rooms WHERE code = $1`,
        [code.toUpperCase()]
    );
    
    return result.rows[0] || null;
}

/**
 * Get available rooms (waiting for players)
 */
async function findAvailable({ status = 'waiting', timeMode, allowSpectators, page = 1, limit = 20 }) {
    const conditions = ['status = $1'];
    const params = [status];
    let paramIndex = 2;
    
    if (timeMode) {
        conditions.push(`time_mode = $${paramIndex}`);
        params.push(timeMode);
        paramIndex++;
    }
    
    if (allowSpectators !== undefined) {
        conditions.push(`allow_spectators = $${paramIndex}`);
        params.push(allowSpectators);
        paramIndex++;
    }
    
    const offset = (page - 1) * limit;
    params.push(limit, offset);
    
    const [countResult, dataResult] = await Promise.all([
        query(
            `SELECT COUNT(*) FROM rooms WHERE ${conditions.join(' AND ')}`,
            params.slice(0, -2)
        ),
        query(
            `SELECT code, host_id, host_pseudo, time_mode, allow_spectators, status, created_at
             FROM rooms
             WHERE ${conditions.join(' AND ')}
             ORDER BY created_at DESC
             LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            params
        )
    ]);
    
    const total = parseInt(countResult.rows[0].count);
    
    return {
        rooms: dataResult.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    };
}

/**
 * Join a room as white player (second player)
 */
async function joinAsWhite(code, { whiteId, whitePseudo, whiteSocketId }) {
    const result = await query(
        `UPDATE rooms
         SET white_id = $1, white_pseudo = $2, white_socket_id = $3, status = 'playing'
         WHERE code = $4 AND status = 'waiting'
         RETURNING *`,
        [whiteId, whitePseudo, whiteSocketId, code.toUpperCase()]
    );
    
    return result.rows[0] || null;
}

/**
 * Update game state
 */
async function updateGameState(code, gameState, activePlayer) {
    const result = await query(
        `UPDATE rooms
         SET game_state = $1, active_player = $2
         WHERE code = $3
         RETURNING game_state`,
        [JSON.stringify(gameState), activePlayer, code.toUpperCase()]
    );
    
    return result.rows[0] || null;
}

/**
 * Update player socket ID (for reconnection)
 */
async function updateSocketId(code, color, socketId) {
    const column = color === 'black' ? 'host_socket_id' : 'white_socket_id';
    
    await query(
        `UPDATE rooms SET ${column} = $1 WHERE code = $2`,
        [socketId, code.toUpperCase()]
    );
}

/**
 * Update room status
 */
async function updateStatus(code, status) {
    await query(
        `UPDATE rooms SET status = $1 WHERE code = $2`,
        [status, code.toUpperCase()]
    );
}

/**
 * Reset room for rematch
 */
async function resetForRematch(code) {
    const result = await query(
        `UPDATE rooms
         SET game_state = $1, active_player = 'black', status = 'playing'
         WHERE code = $2
         RETURNING *`,
        [JSON.stringify(getInitialGameState()), code.toUpperCase()]
    );
    
    return result.rows[0] || null;
}

/**
 * Delete room
 */
async function deleteRoom(code) {
    const result = await query(
        `DELETE FROM rooms WHERE code = $1`,
        [code.toUpperCase()]
    );
    
    return result.rowCount > 0;
}

/**
 * Remove white player from room
 */
async function removeWhite(code) {
    const result = await query(
        `UPDATE rooms
         SET white_id = NULL, white_pseudo = NULL, white_socket_id = NULL, status = 'waiting'
         WHERE code = $1
         RETURNING *`,
        [code.toUpperCase()]
    );
    
    return result.rows[0] || null;
}

/**
 * Clean up old rooms (older than 24 hours)
 */
async function cleanupOld() {
    const result = await query(
        `DELETE FROM rooms WHERE updated_at < NOW() - INTERVAL '24 hours'`
    );
    
    return result.rowCount;
}

/**
 * Get initial game state
 */
function getInitialGameState() {
    return {
        tiles: {
            '0,0': 'black',
            '1,0': 'black',
            '-1,1': 'white',
            '0,1': 'white'
        },
        pieces: {
            '1,0': { type: 'disc', color: 'black' },
            '-1,1': { type: 'disc', color: 'white' }
        },
        inventory: {
            black: { tiles: 7, discs: 5, rings: 3 },
            white: { tiles: 7, discs: 5, rings: 3 }
        },
        captured: {
            black_discs: 0,
            black_rings: 0,
            white_discs: 0,
            white_rings: 0
        },
        activePlayer: 'black'
    };
}

module.exports = {
    create,
    findByCode,
    findAvailable,
    joinAsWhite,
    updateGameState,
    updateSocketId,
    updateStatus,
    resetForRematch,
    deleteRoom,
    removeWhite,
    cleanupOld,
    getInitialGameState
};
