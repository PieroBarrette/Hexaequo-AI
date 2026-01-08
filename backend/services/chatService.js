/**
 * chatService.js - Gestion chat in-game (Phase 3)
 * 
 * Responsabilités:
 * - Stockage messages en mémoire par room
 * - Validation messages (max 200 chars, rate limiting)
 * - Types de messages: 'text' (libre) et 'quick' (pré-définis)
 * - Cleanup automatique quand room fermée
 * - Rate limiting: 10 messages/minute par utilisateur
 * 
 * Messages rapides pré-définis:
 * - "Hello", "Good Luck", "Thanks", "Oops"
 * - "Good move", "Sorry", "Good game", "Gotta go"
 * - Emojis: 👍 👎 😊 😢 🎉
 * 
 * Notes:
 * - Messages NON persistés en DB (éphémères)
 * - Non visibles par spectateurs ou dans replays
 * - Sanitization HTML pour éviter XSS
 * 
 * Exports:
 * - sendMessage(roomCode, userId, pseudo, message, type) → {success, messageId?}
 * - getMessages(roomCode) → messages[]
 * - clearRoom(roomCode) → void
 * - isRateLimited(userId) → boolean
 * - getQuickMessages() → string[] (liste messages pré-définis)
 */

const chatMessageModel = require('../models/chatMessageModel');

// Rate limiting tracking
const userMessageCounts = new Map();

// TODO: Implémenter Phase 3

module.exports = {
    // sendMessage,
    // getMessages,
    // clearRoom,
    // isRateLimited,
    // getQuickMessages
};
