/**
 * User Service
 * 
 * Business logic for user operations using PostgreSQL database.
 */

const { AppError, notFound } = require('../middleware/errorHandler');
const { User, Game } = require('../models');
const accounts = require('./accountService');

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
        elo: user.elo ?? 1000,
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
        elo: user.elo ?? 1000,
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
 *
 * The nickname goes through accountService, as at sign-up and on
 * PUT /api/auth/pseudo: the same shape, the same check against the names
 * already taken in any case, the same BAD_PSEUDO and PSEUDO_TAKEN. This door
 * used to hold it to an older rule of its own (schemas.updateProfile: ASCII
 * only, up to 30, no check for a clash in another case), so it refused names
 * the others allowed and took some they refused. The other fields are
 * written as before.
 */
exports.updateUser = async (userId, updates = {}) => {
    const { pseudo, ...others } = updates;
    const renamed = pseudo === undefined ? null : await accounts.setPseudo(userId, pseudo);
    const user = (await User.update(userId, others)) || renamed;
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
/**
 * What this account has saved, and nothing else.
 *
 * It used to merge in a set of defaults invented here, in an older vocabulary
 * than the one the app actually uses — a theme of "dark" where the app's
 * default is "auto", a showCoordinates of true where the app's is "auto". Sent
 * to a client that owns its own defaults, those are not defaults at all: they
 * are somebody else's answers arriving as though the player had given them. An
 * account that has saved nothing has saved nothing.
 *
 * The column's own default (models/schema.js) is the same mistake one level
 * down, and every new account starts with it. Its theme and showValidMoves are
 * keys the app owns, so the first device to sign in took a dark theme and no
 * move hints from it, as the account's choice, in place of its own. Still
 * exactly as the schema wrote it, it is reported as nothing saved.
 */
const SCHEMA_DEFAULT = { theme: 'dark', sounds: true, animations: true, showValidMoves: false, showPreviousMove: true };
const isSchemaDefault = (settings) =>
    Object.keys(settings).length === Object.keys(SCHEMA_DEFAULT).length
    && Object.entries(SCHEMA_DEFAULT).every(([key, value]) => settings[key] === value);

exports.getUserSettings = async (userId) => {
    const user = await User.findById(userId);
    if (!user) {
        throw notFound('User');
    }
    const settings = user.settings || {};
    return isSchemaDefault(settings) ? {} : settings;
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
 *
 * All of it for the player, the rated games for anyone else, signed in or not:
 * the line /api/profile draws. This history used to list every friendly to
 * whoever asked, which made the profile's discretion a curtain rather than a
 * door — the same games were one address away.
 */
exports.getUserMatchHistory = async (userId, { page = 1, limit = 25, result, timeMode, opponentName, dateFrom, dateTo } = {}, viewerId = null) => {
    const ratedOnly = viewerId !== userId;
    return await Game.getUserMatchHistory(userId, { page, limit, result, timeMode, opponentName, dateFrom, dateTo, ratedOnly });
};

/**
 * Delete user account
 */
exports.deleteUser = async (userId, password) => {
    const user = await User.findById(userId);
    if (!user) {
        throw notFound('User');
    }

    const fullUser = await User.findByEmail(user.email);
    /*
     * The password is a second proof, not the only one: being signed in is
     * already the first. An older account with no password yet has none to
     * give, and asking for one anyway locked it out of ever closing itself --
     * verifyPassword answers false to a hash that does not exist.
     *
     * A wrong one is a 403: the app reads a 401 as the session being over,
     * and signed the player out for a typo.
     */
    if (fullUser && fullUser.password_hash) {
        const isValidPassword = await User.verifyPassword(fullUser, password);
        if (!isValidPassword) {
            throw new AppError('Incorrect password', 403, 'WRONG_PASSWORD');
        }
    }

    await User.deleteUser(userId);
};

/**
 * Get leaderboard
 */
exports.getLeaderboard = async ({ page = 1, limit = 50 } = {}) => {
    return await User.getLeaderboard({ page, limit });
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
        elo: user.elo ?? 1000,
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
