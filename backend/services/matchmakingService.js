/**
 * matchmakingService.js - Logique matchmaking (Phase 2)
 * 
 * Responsabilités:
 * - Gestion file d'attente matchmaking
 * - Algorithme de matching:
 *   1. Même time_mode requis
 *   2. ELO dans plage acceptable (intersection des préférences)
 *   3. Premier arrivé, premier servi si plusieurs matches
 * - Création automatique room si match trouvé
 * - Polling ou event-driven matching (toutes les 2s)
 * - Élargissement progressif plage ELO si pas de match (optionnel)
 * 
 * Flow:
 * 1. Joueur appelle joinQueue(userId, timeMode, preferences)
 * 2. Service ajoute à queue + lance recherche immédiate
 * 3. Si match: crée room, notifie les 2 joueurs, retire de queue
 * 4. Si pas de match: joueur reste en queue, polling continue
 * 5. Joueur peut leaveQueue() à tout moment
 * 
 * Exports:
 * - joinQueue(userId, socketId, timeMode, preferences) → queueEntry
 * - leaveQueue(userId) → boolean
 * - findAndCreateMatch(userId) → {matched, roomCode?, opponent?}
 * - getQueueStatus(userId) → {inQueue, position?, waitTime?}
 * - startMatchmakingLoop() → void (appelé au démarrage serveur)
 */

const matchmakingQueueModel = require('../models/matchmakingQueueModel');
const roomService = require('./roomService');

// TODO: Implémenter Phase 2

module.exports = {
    // joinQueue,
    // leaveQueue,
    // findAndCreateMatch,
    // getQueueStatus,
    // startMatchmakingLoop
};
