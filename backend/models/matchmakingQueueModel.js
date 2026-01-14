/**
 * matchmakingQueueModel.js - File d'attente matchmaking (Phase 2)
 * 
 * Table: matchmaking_queue
 * - id UUID (PK)
 * - user_id UUID (FK → users)
 * - elo INT (ELO actuel du joueur pour la cadence)
 * - time_mode VARCHAR(20) (bullet/blitz/rapid/classic)
 * - preferences JSONB (elo_range, allow_friendly, etc.)
 * - socket_id VARCHAR (pour notifier le joueur)
 * - created_at TIMESTAMP
 * - expires_at TIMESTAMP (défaut: created_at + 5 min)
 * 
 * Responsabilités:
 * - CRUD entrées queue
 * - Recherche joueurs compatibles (même timeMode, ELO dans plage)
 * - Cleanup entrées expirées
 * - Retirer joueur de la queue
 * 
 * Exports:
 * - addToQueue(userId, elo, timeMode, preferences, socketId) → queueEntry
 * - removeFromQueue(userId) → boolean
 * - findMatch(userId, elo, timeMode, preferences) → matchedPlayer | null
 * - cleanupExpired() → deletedCount
 * - getQueueStatus(userId) → queueEntry | null
 */

const { query } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

// Queue expiration time in minutes
const QUEUE_EXPIRATION_MINUTES = 5;

/**
 * Add player to matchmaking queue
 * Replaces existing entry if player is already in queue
 */
async function addToQueue(userId, socketId, pseudo, elo, timeMode, preferences = {}) {
    // First remove any existing entry for this user
    if (userId) {
        await removeFromQueue(userId);
    }
    await removeFromQueueBySocket(socketId);
    
    const expiresAt = new Date(Date.now() + QUEUE_EXPIRATION_MINUTES * 60 * 1000);
    
    const result = await query(
        `INSERT INTO matchmaking_queue (id, user_id, socket_id, pseudo, elo, time_mode, preferences, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [uuidv4(), userId, socketId, pseudo, elo, timeMode, JSON.stringify(preferences), expiresAt]
    );
    
    return formatQueueEntry(result.rows[0]);
}

/**
 * Remove player from queue by userId
 */
async function removeFromQueue(userId) {
    if (!userId) return false;
    
    const result = await query(
        `DELETE FROM matchmaking_queue WHERE user_id = $1 RETURNING id`,
        [userId]
    );
    
    return result.rowCount > 0;
}

/**
 * Remove player from queue by socketId
 */
async function removeFromQueueBySocket(socketId) {
    if (!socketId) return false;
    
    const result = await query(
        `DELETE FROM matchmaking_queue WHERE socket_id = $1 RETURNING id`,
        [socketId]
    );
    
    return result.rowCount > 0;
}

/**
 * Find a match for the given player
 * FIFO: returns the oldest compatible player in queue
 * 
 * Match criteria:
 * - Same time_mode
 * - ELO within acceptable range (intersection of both players' preferences)
 * - Not expired
 */
async function findMatch(userId, socketId, elo, timeMode, preferences = {}) {
    const myEloMin = preferences.elo_range_min ?? -200;
    const myEloMax = preferences.elo_range_max ?? 200;
    
    // Find oldest player with:
    // 1. Same time_mode
    // 2. Their ELO is within my acceptable range (elo + myEloMin to elo + myEloMax)
    // 3. My ELO is within their acceptable range
    // 4. Not expired
    // 5. Not myself
    // Note: pseudo is now stored directly in matchmaking_queue table, no need for JOIN
    const result = await query(
        `SELECT * FROM matchmaking_queue
         WHERE time_mode = $1
           AND expires_at > NOW()
           AND socket_id != $2
           AND ($3::uuid IS NULL OR user_id IS NULL OR user_id != $3)
           AND elo BETWEEN $4 AND $5
           AND $6 BETWEEN (elo + COALESCE((preferences->>'elo_range_min')::int, -200)) 
                       AND (elo + COALESCE((preferences->>'elo_range_max')::int, 200))
         ORDER BY created_at ASC
         LIMIT 1`,
        [timeMode, socketId, userId, elo + myEloMin, elo + myEloMax, elo]
    );
    
    if (result.rows.length === 0) {
        return null;
    }
    
    return formatQueueEntry(result.rows[0]);
}

/**
 * Get queue status for a player
 */
async function getQueueStatus(userId, socketId) {
    let result;
    
    if (userId) {
        result = await query(
            `SELECT * FROM matchmaking_queue WHERE user_id = $1`,
            [userId]
        );
    } else if (socketId) {
        result = await query(
            `SELECT * FROM matchmaking_queue WHERE socket_id = $1`,
            [socketId]
        );
    }
    
    if (!result || result.rows.length === 0) {
        return null;
    }
    
    const entry = result.rows[0];
    
    // Get position in queue (players ahead with same time_mode)
    const positionResult = await query(
        `SELECT COUNT(*) as position FROM matchmaking_queue 
         WHERE time_mode = $1 AND created_at < $2 AND expires_at > NOW()`,
        [entry.time_mode, entry.created_at]
    );
    
    return {
        ...formatQueueEntry(entry),
        position: parseInt(positionResult.rows[0].position) + 1,
        waitTime: Math.floor((Date.now() - new Date(entry.created_at).getTime()) / 1000)
    };
}

/**
 * Clean up expired queue entries
 */
async function cleanupExpired() {
    const result = await query(
        `DELETE FROM matchmaking_queue WHERE expires_at < NOW() RETURNING id`
    );
    
    return result.rowCount;
}

/**
 * Get all players in queue for a specific time mode (for debugging)
 */
async function getQueueByTimeMode(timeMode) {
    const result = await query(
        `SELECT * FROM matchmaking_queue 
         WHERE time_mode = $1 AND expires_at > NOW()
         ORDER BY created_at ASC`,
        [timeMode]
    );
    
    return result.rows.map(formatQueueEntry);
}

/**
 * Format queue entry for external use
 */
function formatQueueEntry(row) {
    if (!row) return null;
    
    return {
        id: row.id,
        userId: row.user_id,
        socketId: row.socket_id,
        pseudo: row.pseudo,
        elo: row.elo,
        timeMode: row.time_mode,
        preferences: typeof row.preferences === 'string' ? JSON.parse(row.preferences) : row.preferences,
        createdAt: row.created_at,
        expiresAt: row.expires_at
    };
}

module.exports = {
    addToQueue,
    removeFromQueue,
    removeFromQueueBySocket,
    findMatch,
    cleanupExpired,
    getQueueStatus,
    getQueueByTimeMode,
    QUEUE_EXPIRATION_MINUTES
};
