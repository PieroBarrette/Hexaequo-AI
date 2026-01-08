/**
 * matchmaking.js - Système Play/Invite (Phase 2)
 * 
 * Responsabilités:
 * - Bouton "Play": rejoint queue matchmaking selon critères utilisateur
 *   - Affiche loader "waiting for opponent..." avec timer
 *   - Bouton "Cancel" pour quitter la queue
 * - Bouton "Invite": ouvre modal QR code (qrCodeModal.js)
 * - Gestion événement "match-found" → transition vers game
 * 
 * Critères matchmaking:
 * - Time control (bullet/blitz/rapid/classic)
 * - Plage ELO (user_preferences: elo_range_min/max)
 * - Friendly mode toggle
 * 
 * Dépendances:
 * - multiplayer.js: joinMatchmakingQueue(), leaveMatchmakingQueue()
 * - Socket events: join-matchmaking-queue, leave-queue, match-found
 * - qrCodeModal.js pour invitations
 * 
 * Exports:
 * - Matchmaking class ou init function
 * - joinQueue(preferences), leaveQueue()
 * - onMatchFound(callback)
 */

// TODO: Implémenter Phase 2
