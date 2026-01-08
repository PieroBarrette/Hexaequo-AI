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

const pool = require('../config/database');

// TODO: Implémenter Phase 2

module.exports = {
    // addToQueue,
    // removeFromQueue,
    // findMatch,
    // cleanupExpired,
    // getQueueStatus
};
