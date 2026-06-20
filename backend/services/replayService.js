/**
 * Replay Service
 * 
 * Business logic for replay operations.
 */

const { notFound } = require('../middleware/errorHandler');
const gameService = require('./gameService');

// Temporary in-memory storage (replace with database)
const savedReplays = new Map(); // userId -> Set of gameIds

/**
 * Get replay by game ID
 */
exports.getReplayByGameId = async (gameId) => {
    return await gameService.getGameReplay(gameId);
};

/**
 * Get user's saved replays
 */
exports.getUserSavedReplays = async (userId, { page = 1, limit = 20 }) => {
    const userSaved = savedReplays.get(userId) || new Set();
    const gameIds = Array.from(userSaved);

    // Paginate
    const total = gameIds.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginatedIds = gameIds.slice(start, start + limit);

    // Fetch replays
    const replays = [];
    for (const gameId of paginatedIds) {
        try {
            const replay = await gameService.getGameReplay(gameId);
            replays.push(replay);
        } catch (error) {
            // Game may have been deleted
            userSaved.delete(gameId);
        }
    }

    return {
        replays,
        total,
        page,
        totalPages
    };
};

/**
 * Save replay for user
 */
exports.saveReplayForUser = async (gameId, userId) => {
    // Verify game exists
    await gameService.getGameById(gameId);

    if (!savedReplays.has(userId)) {
        savedReplays.set(userId, new Set());
    }
    savedReplays.get(userId).add(gameId);
};

/**
 * Unsave replay for user
 */
exports.unsaveReplayForUser = async (gameId, userId) => {
    const userSaved = savedReplays.get(userId);
    if (userSaved) {
        userSaved.delete(gameId);
    }
};

module.exports = exports;
