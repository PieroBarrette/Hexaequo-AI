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

const pool = require('../config/database');

// TODO: Implémenter Phase 2

module.exports = {
    // getPreferences,
    // updatePreferences,
    // createDefaultPreferences
};
