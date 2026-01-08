/**
 * gameHistory.js - Liste historique parties (Phase 4)
 * 
 * Responsabilités:
 * - Liste paginée des parties jouées (GET /api/games?userId=X)
 * - Affichage par partie:
 *   - Cadence (bullet/blitz/rapid/classic icône)
 *   - Pseudo adversaire + ELO actuel (pas celui au moment de la partie)
 *   - Résultat: Victoire (vert), Défaite (rouge), Ex Aequo (gris)
 *   - Date partie
 * - Click sur partie → ouvre replayViewer.js
 * - Pagination (load more ou infinite scroll)
 * 
 * API Response format:
 * {
 *   games: [{
 *     id, time_mode, 
 *     opponent: { pseudo, current_elo },
 *     result: "win" | "loss" | "draw",
 *     played_at
 *   }],
 *   pagination: { page, total_pages, total_games }
 * }
 * 
 * Dépendances:
 * - API: /api/games?userId=X&page=N
 * - replayViewer.js pour visualisation
 * - i18n.js pour traductions
 * 
 * Exports:
 * - GameHistory class ou init function
 * - loadGames(userId, page), loadMore()
 * - openReplay(gameId)
 */

// TODO: Implémenter Phase 4
