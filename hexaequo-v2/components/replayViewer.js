/**
 * replayViewer.js - Lecteur de replay (Phase 4)
 * 
 * Responsabilités:
 * - Modal fullscreen avec canvas pour afficher board
 * - Contrôles de navigation:
 *   - |< Premier coup
 *   - < Coup précédent
 *   - > Coup suivant
 *   - >| Dernier coup
 *   - ▶ Play/Pause auto-play
 * - Progress bar cliquable (timeline des coups)
 * - Affichage info coup actuel: "Move 15/42 - Black places disc"
 * - Bouton X pour fermer et revenir au games history
 * 
 * Reconstruction état:
 * - Charge move history complet: GET /api/games/:id/replay
 * - Applique moves séquentiellement via applyMove(state, move)
 * - Utilise graphics.js pour rendu canvas
 * 
 * Move history format:
 * [{
 *   moveNumber, player, type,
 *   from: {q, r} | null,
 *   to: {q, r},
 *   captures: [{q, r, piece}]
 * }]
 * 
 * Dépendances:
 * - API: /api/games/:id/replay
 * - graphics.js pour rendu board
 * - modules/gameState.js: applyMove() ou reconstruction état
 * - i18n.js pour traductions
 * 
 * Exports:
 * - ReplayViewer class ou init function
 * - openReplay(gameId), closeReplay()
 * - goToMove(moveNumber), nextMove(), prevMove()
 * - toggleAutoPlay()
 */

// TODO: Implémenter Phase 4
