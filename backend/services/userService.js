/**
 * User Service
 * 
 * Business logic for user operations using PostgreSQL database.
 */

const { notFound, unauthorized } = require('../middleware/errorHandler');
const { User, Game } = require('../models');

/**
 * Get user by ID
 */
exports.getUserById = async (userId) => {
    const user = await User.findById(userId);
    if (!user) {
        throw notFound('User');
    }

    return formatUserResponse(user);
};

/**
 * Get public profile
 */
exports.getPublicProfile = async (userId) => {
    const user = await User.findById(userId);
    if (!user) {
        throw notFound('User');
    }

    return {
        id: user.id,
        pseudo: user.pseudo,
        avatarUrl: user.avatar_url,
        countryCode: user.country_code,
        elo: {
            classic: user.elo_classic,
            rapid: user.elo_rapid,
            blitz: user.elo_blitz
        },
        stats: {
            gamesPlayed: user.games_played,
            wins: user.wins,
            losses: user.losses,
            draws: user.draws,
            winRate: user.games_played > 0 
                ? Math.round(user.wins / user.games_played * 100) 
                : 0
        },
        createdAt: user.created_at
    };
};

/**
 * Get user by pseudo
 */
exports.getUserByPseudo = async (pseudo) => {
    const user = await User.findByPseudo(pseudo);
    if (!user) {
        throw notFound('User');
    }

    return {
        id: user.id,
        pseudo: user.pseudo,
        elo: {
            classic: user.elo_classic,
            rapid: user.elo_rapid,
            blitz: user.elo_blitz
        },
        stats: {
            gamesPlayed: user.games_played,
            wins: user.wins,
            losses: user.losses,
            draws: user.draws
        },
        createdAt: user.created_at
    };
};

/**
 * Update user profile
 */
exports.updateUser = async (userId, updates) => {
    const user = await User.update(userId, updates);
    if (!user) {
        throw notFound('User');
    }

    return {
        id: user.id,
        pseudo: user.pseudo,
        avatarUrl: user.avatar_url,
        countryCode: user.country_code
    };
};

/**
 * Get user settings
 */
exports.getUserSettings = async (userId) => {
    const user = await User.findById(userId);
    if (!user) {
        throw notFound('User');
    }

    // Return default settings merged with user settings
    const defaultSettings = {
        theme: 'dark',
        sounds: true,
        animations: true,
        autoSubmitMove: false,
        showCoordinates: true,
        highlightMoves: true
    };

    return {
        ...defaultSettings,
        ...(user.settings || {})
    };
};

/**
 * Update user settings
 */
exports.updateUserSettings = async (userId, updates) => {
    const settings = await User.updateSettings(userId, updates);
    if (!settings) {
        throw notFound('User');
    }

    return settings;
};

/**
 * Get user match history
 */
exports.getUserMatchHistory = async (userId, { page = 1, limit = 20 }) => {
    return await Game.getUserMatchHistory(userId, { page, limit });
};

/**
 * Delete user account
 */
exports.deleteUser = async (userId, password) => {
    const user = await User.findById(userId);
    if (!user) {
        throw notFound('User');
    }

    // Get full user with password for verification
    const fullUser = await User.findByEmail(user.email);
    
    // Verify password
    const isValidPassword = await User.verifyPassword(fullUser, password);
    if (!isValidPassword) {
        throw unauthorized('Incorrect password');
    }

    await User.deleteUser(userId);
};

/**
 * Get leaderboard
 */
exports.getLeaderboard = async (timeMode, { page = 1, limit = 50 }) => {
    return await User.getLeaderboard(timeMode, { page, limit });
};

/**
 * Update user last seen (for online status)
 */
exports.updateLastSeen = async (userId) => {
    await User.updateLastSeen(userId);
};

/**
 * Format user response (internal -> external format)
 */
function formatUserResponse(user) {
    return {
        id: user.id,
        pseudo: user.pseudo,
        email: user.email,
        emailVerified: user.email_verified,
        avatarUrl: user.avatar_url,
        countryCode: user.country_code,
        elo: {
            classic: user.elo_classic,
            rapid: user.elo_rapid,
            blitz: user.elo_blitz
        },
        stats: {
            gamesPlayed: user.games_played,
            wins: user.wins,
            losses: user.losses,
            draws: user.draws
        },
        settings: user.settings || {},
        createdAt: user.created_at,
        lastSeen: user.last_seen
    };
}
