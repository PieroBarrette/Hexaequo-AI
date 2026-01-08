/**
 * chatMessageModel.js - Messages chat temporaires (Phase 3)
 * 
 * Note: Les messages peuvent être gérés en mémoire uniquement
 * car ils ne sont pas sauvegardés après la partie.
 * Ce modèle est optionnel si on préfère le stockage mémoire.
 * 
 * Table (optionnelle): chat_messages
 * - id UUID (PK)
 * - room_code VARCHAR(10) (FK → rooms)
 * - user_id UUID (FK → users, nullable pour guests)
 * - pseudo VARCHAR (pour affichage)
 * - message TEXT (max 200 chars)
 * - message_type VARCHAR(20) ('text' | 'quick')
 * - created_at TIMESTAMP
 * 
 * Alternative mémoire:
 * - Map<roomCode, Array<{userId, pseudo, message, type, timestamp}>>
 * - Cleanup automatique quand room fermée
 * - TTL 2h max par sécurité
 * 
 * Exports:
 * - addMessage(roomCode, userId, pseudo, message, type) → messageId
 * - getMessages(roomCode, limit?) → messages[]
 * - clearRoomMessages(roomCode) → void
 */

// In-memory storage (préféré pour chat éphémère)
const chatMessages = new Map();

// TODO: Implémenter Phase 3

module.exports = {
    // addMessage,
    // getMessages,
    // clearRoomMessages,
    chatMessages // Exposer pour tests
};
