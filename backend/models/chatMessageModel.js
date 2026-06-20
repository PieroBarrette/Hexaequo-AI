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
 * - user_id UUID (FK → users)
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

// Max messages per room to prevent memory issues
const MAX_MESSAGES_PER_ROOM = 100;

/**
 * Add a message to a room's chat history
 * @param {string} roomCode 
 * @param {Object} msg - { userId, pseudo, message, type, timestamp }
 * @returns {Object} The stored message with generated id
 */
function addMessage(roomCode, msg) {
    if (!chatMessages.has(roomCode)) {
        chatMessages.set(roomCode, []);
    }
    const messages = chatMessages.get(roomCode);
    const storedMsg = {
        id: `${roomCode}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ...msg,
        timestamp: msg.timestamp || Date.now()
    };
    messages.push(storedMsg);
    // Cap at MAX_MESSAGES_PER_ROOM
    if (messages.length > MAX_MESSAGES_PER_ROOM) {
        messages.shift();
    }
    return storedMsg;
}

/**
 * Get all messages for a room
 * @param {string} roomCode 
 * @returns {Array} messages
 */
function getMessages(roomCode) {
    return chatMessages.get(roomCode) || [];
}

/**
 * Clear all messages for a room
 * @param {string} roomCode 
 */
function clearRoomMessages(roomCode) {
    chatMessages.delete(roomCode);
}

module.exports = {
    addMessage,
    getMessages,
    clearRoomMessages,
    chatMessages
};
