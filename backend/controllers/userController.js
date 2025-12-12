/**
 * User Controller
 * 
 * Handles user profile operations.
 */

const userService = require('../services/userService');

/**
 * Get current user profile
 * GET /api/users/me
 */
exports.getProfile = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const user = await userService.getUserById(userId);

        res.json({
            data: {
                id: user.id,
                pseudo: user.pseudo,
                email: user.email,
                elo: user.elo,
                stats: user.stats,
                settings: user.settings,
                createdAt: user.createdAt
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update current user profile
 * PATCH /api/users/me
 */
exports.updateProfile = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const updates = req.body;

        const user = await userService.updateUser(userId, updates);

        res.json({
            data: {
                id: user.id,
                pseudo: user.pseudo,
                settings: user.settings
            },
            meta: {
                message: 'Profile updated successfully'
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get user by ID (public profile)
 * GET /api/users/:id
 */
exports.getUserById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const user = await userService.getPublicProfile(id);

        res.json({
            data: {
                id: user.id,
                pseudo: user.pseudo,
                elo: user.elo,
                stats: user.stats,
                createdAt: user.createdAt
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get user match history
 * GET /api/users/:id/matches
 */
exports.getMatchHistory = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { page = 1, limit = 20 } = req.query;

        const result = await userService.getUserMatchHistory(id, { page, limit });

        res.json({
            data: result.matches,
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
 * Get user settings
 * GET /api/users/me/settings
 */
exports.getSettings = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const settings = await userService.getUserSettings(userId);

        res.json({
            data: settings
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update user settings
 * PATCH /api/users/me/settings
 */
exports.updateSettings = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const updates = req.body;

        const settings = await userService.updateUserSettings(userId, updates);

        res.json({
            data: settings,
            meta: {
                message: 'Settings updated successfully'
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Delete user account
 * DELETE /api/users/me
 */
exports.deleteAccount = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { password } = req.body;

        await userService.deleteUser(userId, password);

        res.json({
            data: null,
            meta: {
                message: 'Account deleted successfully'
            }
        });
    } catch (error) {
        next(error);
    }
};
