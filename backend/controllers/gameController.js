/**
 * Game Controller
 * 
 * Handles game-related operations.
 */

const gameService = require('../services/gameService');

/**
 * Get active games list
 * GET /api/games
 */
exports.getGames = async (req, res, next) => {
    try {
        const { status, timeMode, page = 1, limit = 20 } = req.query;

        const result = await gameService.getGames({ status, timeMode, page, limit });

        res.json({
            data: result.games,
            meta: {
                total: result.total,
                page: result.page,
                totalPages: result.totalPages
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get game by ID
 * GET /api/games/:id
 */
exports.getGameById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const game = await gameService.getGameById(id);

        res.json({
            data: game
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get game replay data
 * GET /api/games/:id/replay
 */
exports.getReplay = async (req, res, next) => {
    try {
        const { id } = req.params;
        const replay = await gameService.getGameReplay(id);

        res.json({
            data: replay
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get leaderboard
 * GET /api/games/leaderboard
 */
exports.getLeaderboard = async (req, res, next) => {
    try {
        const { timeMode = 'classic', page = 1, limit = 50 } = req.query;

        const result = await gameService.getLeaderboard({ timeMode, page, limit });

        res.json({
            data: result.players,
            meta: {
                total: result.total,
                page: result.page,
                totalPages: result.totalPages
            }
        });
    } catch (error) {
        next(error);
    }
};
