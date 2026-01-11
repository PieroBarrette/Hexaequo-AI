/**
 * userPreferencesModel.js - Préférences utilisateur online (Phase 2)
 * 
 * Table: user_preferences
 * - user_id UUID (PK, FK → users)
 * - elo_range_min INT (défaut -200)
 * - elo_range_max INT (défaut 200)
 * - allow_friendly_games BOOLEAN (défaut true)
 * - created_at, updated_at TIMESTAMP
 * 
 * Responsabilités:
 * - CRUD préférences matchmaking utilisateur
 * - Valeurs par défaut pour nouveaux utilisateurs
 * - Validation plage ELO (min: -500, max: +500)
 * 
 * Exports:
 * - getPreferences(userId) → {elo_range_min, elo_range_max, allow_friendly_games}
 * - updatePreferences(userId, prefs) → updated prefs
 * - createDefaultPreferences(userId) → default prefs
 */

const { query } = require('../config/database');

// Default preferences
const DEFAULT_PREFERENCES = {
    elo_range_min: -200,
    elo_range_max: 200,
    allow_friendly_games: true
};

// Validation limits
const ELO_RANGE_MIN_LIMIT = -500;
const ELO_RANGE_MAX_LIMIT = 500;

/**
 * Get user preferences by userId
 * Returns default preferences if not found
 */
async function getPreferences(userId) {
    if (!userId) {
        return { ...DEFAULT_PREFERENCES };
    }
    
    const result = await query(
        `SELECT elo_range_min, elo_range_max, allow_friendly_games 
         FROM user_preferences WHERE user_id = $1`,
        [userId]
    );
    
    if (result.rows.length === 0) {
        return { ...DEFAULT_PREFERENCES };
    }
    
    return {
        elo_range_min: result.rows[0].elo_range_min,
        elo_range_max: result.rows[0].elo_range_max,
        allow_friendly_games: result.rows[0].allow_friendly_games
    };
}

/**
 * Create default preferences for a new user
 */
async function createDefaultPreferences(userId) {
    if (!userId) {
        throw new Error('userId is required');
    }
    
    const result = await query(
        `INSERT INTO user_preferences (user_id, elo_range_min, elo_range_max, allow_friendly_games)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO NOTHING
         RETURNING elo_range_min, elo_range_max, allow_friendly_games`,
        [userId, DEFAULT_PREFERENCES.elo_range_min, DEFAULT_PREFERENCES.elo_range_max, DEFAULT_PREFERENCES.allow_friendly_games]
    );
    
    if (result.rows.length === 0) {
        // Already exists, fetch current
        return getPreferences(userId);
    }
    
    return {
        elo_range_min: result.rows[0].elo_range_min,
        elo_range_max: result.rows[0].elo_range_max,
        allow_friendly_games: result.rows[0].allow_friendly_games
    };
}

/**
 * Update user preferences
 * Validates ELO range limits
 */
async function updatePreferences(userId, prefs) {
    if (!userId) {
        throw new Error('userId is required');
    }
    
    // Validate and clamp ELO range
    let eloRangeMin = prefs.elo_range_min ?? DEFAULT_PREFERENCES.elo_range_min;
    let eloRangeMax = prefs.elo_range_max ?? DEFAULT_PREFERENCES.elo_range_max;
    const allowFriendly = prefs.allow_friendly_games ?? DEFAULT_PREFERENCES.allow_friendly_games;
    
    // Clamp to limits
    eloRangeMin = Math.max(ELO_RANGE_MIN_LIMIT, Math.min(0, eloRangeMin));
    eloRangeMax = Math.min(ELO_RANGE_MAX_LIMIT, Math.max(0, eloRangeMax));
    
    const result = await query(
        `INSERT INTO user_preferences (user_id, elo_range_min, elo_range_max, allow_friendly_games)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
            elo_range_min = EXCLUDED.elo_range_min,
            elo_range_max = EXCLUDED.elo_range_max,
            allow_friendly_games = EXCLUDED.allow_friendly_games,
            updated_at = CURRENT_TIMESTAMP
         RETURNING elo_range_min, elo_range_max, allow_friendly_games`,
        [userId, eloRangeMin, eloRangeMax, allowFriendly]
    );
    
    return {
        elo_range_min: result.rows[0].elo_range_min,
        elo_range_max: result.rows[0].elo_range_max,
        allow_friendly_games: result.rows[0].allow_friendly_games
    };
}

module.exports = {
    getPreferences,
    updatePreferences,
    createDefaultPreferences,
    DEFAULT_PREFERENCES,
    ELO_RANGE_MIN_LIMIT,
    ELO_RANGE_MAX_LIMIT
};
