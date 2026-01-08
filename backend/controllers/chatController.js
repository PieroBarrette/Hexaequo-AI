/**
 * chatController.js - Endpoints chat REST (Phase 3)
 * 
 * Note: La majorité du chat passe par Socket.IO pour le temps réel.
 * Ces endpoints REST sont optionnels pour:
 * - Récupérer historique messages (reconnexion)
 * - Liste messages rapides pré-définis
 * 
 * Routes:
 * - GET /api/chat/:roomCode/messages → historique messages
 * - GET /api/chat/quick-messages → liste messages rapides
 * 
 * Socket.IO events (dans socketHandler.js):
 * - send-chat-message → envoyer message
 * - chat-message → réception message (server → client)
 * 
 * Exports:
 * - getMessages(req, res)
 * - getQuickMessages(req, res)
 */

const chatService = require('../services/chatService');

// TODO: Implémenter Phase 3

module.exports = {
    // getMessages,
    // getQuickMessages
};
