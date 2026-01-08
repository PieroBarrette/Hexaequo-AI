/**
 * matchmakingController.js - Endpoints matchmaking REST (Phase 2)
 * 
 * Note: La majorité du matchmaking passe par Socket.IO pour le temps réel.
 * Ces endpoints REST sont complémentaires pour:
 * - Statut queue (polling fallback)
 * - Préférences utilisateur
 * - Statistiques matchmaking (admin)
 * 
 * Routes:
 * - GET /api/matchmaking/status → statut dans queue
 * - POST /api/matchmaking/preferences → mise à jour préférences
 * - GET /api/matchmaking/stats → stats queue (admin)
 * 
 * Socket.IO events (dans socketHandler.js):
 * - join-matchmaking-queue → rejoindre queue
 * - leave-matchmaking-queue → quitter queue
 * - match-found → notification match (server → client)
 * 
 * Exports:
 * - getQueueStatus(req, res)
 * - updatePreferences(req, res)
 * - getStats(req, res) [admin]
 */

const matchmakingService = require('../services/matchmakingService');

// TODO: Implémenter Phase 2

module.exports = {
    // getQueueStatus,
    // updatePreferences,
    // getStats
};
