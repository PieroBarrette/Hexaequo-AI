/**
 * profile.js - Page profil utilisateur (Phase 4)
 * 
 * Responsabilités:
 * - Affichage pseudo + ELO (par cadence)
 * - Settings "online" au-dessus des onglets:
 *   - Plage ELO: ± X points (défaut ±200)
 *   - Toggle "Allow friendly games" (contre guests)
 * - Onglets:
 *   1. "Games History" (actif) → gameHistory.js
 *   2. "Stats" (coming soon)
 * - Navigation profil ↔ lobby
 * 
 * Settings sauvegardés dans:
 * - Table user_preferences (elo_range_min, elo_range_max, allow_friendly_games)
 * - API: GET/PUT /api/users/:id/preferences
 * 
 * Dépendances:
 * - API: /api/users/me, /api/users/:id/preferences
 * - gameHistory.js pour liste parties
 * - i18n.js pour traductions
 * 
 * Exports:
 * - Profile class ou init function
 * - loadProfile(userId), savePreferences(prefs)
 * - showTab(tabName)
 */

// TODO: Implémenter Phase 4
