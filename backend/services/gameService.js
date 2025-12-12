/**
 * Game Service
 * 
 * Business logic for game operations.
 */

const { notFound } = require('../middleware/errorHandler');

// Temporary in-memory storage (replace with database)
const games = new Map();

/**
 * Get games list
 */
exports.getGames = async ({ status, timeMode, page = 1, limit = 20 }) => {
    let gameList = Array.from(games.values());

    // Filter by status
    if (status) {
        gameList = gameList.filter(g => g.status === status);
    }

    // Filter by time mode
    if (timeMode) {
        gameList = gameList.filter(g => g.timeMode === timeMode);
    }

    // Sort by created date (newest first)
    gameList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Paginate
    const total = gameList.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginatedGames = gameList.slice(start, start + limit);

    return {
        games: paginatedGames,
        total,
        page,
        totalPages
    };
};

/**
 * Get game by ID
 */
exports.getGameById = async (gameId) => {
    const game = games.get(gameId);
    if (!game) {
        throw notFound('Game');
    }
    return game;
};

/**
 * Get game replay
 */
exports.getGameReplay = async (gameId) => {
    const game = games.get(gameId);
    if (!game) {
        throw notFound('Game');
    }

    return {
        gameId: game.id,
        players: game.players,
        moves: game.moves || [],
        result: game.result,
        timeMode: game.timeMode,
        createdAt: game.createdAt
    };
};

/**
 * Get leaderboard
 */
exports.getLeaderboard = async ({ timeMode = 'classic', page = 1, limit = 50 }) => {
    // TODO: Implement with database
    return {
        players: [],
        total: 0,
        page,
        totalPages: 0
    };
};

/**
 * Create game record
 */
exports.createGame = async (data) => {
    const gameId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const game = {
        id: gameId,
        roomCode: data.roomCode,
        players: data.players,
        timeMode: data.timeMode,
        status: 'playing',
        moves: [],
        createdAt: new Date().toISOString()
    };

    games.set(gameId, game);
    return game;
};

/**
 * Record move
 */
exports.recordMove = async (gameId, move) => {
    const game = games.get(gameId);
    if (!game) {
        throw notFound('Game');
    }

    game.moves.push({
        ...move,
        timestamp: new Date().toISOString()
    });
};

/**
 * End game
 */
exports.endGame = async (gameId, result) => {
    const game = games.get(gameId);
    if (!game) {
        throw notFound('Game');
    }

    game.status = 'finished';
    game.result = result;
    game.finishedAt = new Date().toISOString();

    return game;
};

module.exports = exports;
