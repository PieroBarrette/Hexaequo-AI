/**
 * User Service
 * 
 * Business logic for user operations.
 */

const { notFound, unauthorized } = require('../middleware/errorHandler');
const bcrypt = require('bcrypt');

// Temporary in-memory storage (replace with database)
const users = new Map();

/**
 * Get user by ID
 */
exports.getUserById = async (userId) => {
    const user = users.get(userId);
    if (!user) {
        throw notFound('User');
    }

    return {
        id: user.id,
        pseudo: user.pseudo,
        email: user.email,
        elo: user.elo,
        stats: user.stats,
        settings: user.settings,
        createdAt: user.createdAt
    };
};

/**
 * Get public profile
 */
exports.getPublicProfile = async (userId) => {
    const user = users.get(userId);
    if (!user) {
        throw notFound('User');
    }

    return {
        id: user.id,
        pseudo: user.pseudo,
        elo: user.elo,
        stats: user.stats,
        createdAt: user.createdAt
    };
};

/**
 * Update user
 */
exports.updateUser = async (userId, updates) => {
    const user = users.get(userId);
    if (!user) {
        throw notFound('User');
    }

    // Allowed updates
    if (updates.pseudo) {
        user.pseudo = updates.pseudo;
    }

    return {
        id: user.id,
        pseudo: user.pseudo,
        settings: user.settings
    };
};

/**
 * Get user settings
 */
exports.getUserSettings = async (userId) => {
    const user = users.get(userId);
    if (!user) {
        throw notFound('User');
    }

    return user.settings;
};

/**
 * Update user settings
 */
exports.updateUserSettings = async (userId, updates) => {
    const user = users.get(userId);
    if (!user) {
        throw notFound('User');
    }

    user.settings = {
        ...user.settings,
        ...updates
    };

    return user.settings;
};

/**
 * Get user match history
 */
exports.getUserMatchHistory = async (userId, { page = 1, limit = 20 }) => {
    // TODO: Implement with database
    return {
        matches: [],
        total: 0,
        page,
        totalPages: 0
    };
};

/**
 * Delete user account
 */
exports.deleteUser = async (userId, password) => {
    const user = users.get(userId);
    if (!user) {
        throw notFound('User');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
        throw unauthorized('Incorrect password');
    }

    users.delete(userId);
};

// Export users map for auth service (temporary)
module.exports = {
    ...exports,
    _users: users
};
