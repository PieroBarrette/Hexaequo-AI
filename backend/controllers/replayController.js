/**
 * Replay Controller
 * 
 * Handles game replay operations.
 */

const replayService = require('../services/replayService');

/**
 * Get replay by game ID
 * GET /api/replays/:gameId
 */
exports.getReplay = async (req, res, next) => {
    try {
        const { gameId } = req.params;
        const replay = await replayService.getReplayByGameId(gameId);

        res.json({
            data: replay
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get user's saved replays
 * GET /api/replays/saved
 */
exports.getSavedReplays = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 20 } = req.query;

        const result = await replayService.getUserSavedReplays(userId, { page, limit });

        res.json({
            data: result.replays,
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
 * Save a replay
 * POST /api/replays/:gameId/save
 */
exports.saveReplay = async (req, res, next) => {
    try {
        const { gameId } = req.params;
        const userId = req.user.id;

        await replayService.saveReplayForUser(gameId, userId);

        res.json({
            data: null,
            meta: {
                message: 'Replay saved successfully'
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Unsave a replay
 * DELETE /api/replays/:gameId/save
 */
exports.unsaveReplay = async (req, res, next) => {
    try {
        const { gameId } = req.params;
        const userId = req.user.id;

        await replayService.unsaveReplayForUser(gameId, userId);

        res.json({
            data: null,
            meta: {
                message: 'Replay removed from saved'
            }
        });
    } catch (error) {
        next(error);
    }
};
