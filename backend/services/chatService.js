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

// Rate limiting tracking: userId -> { count, windowStart }
const userMessageCounts = new Map();

// Rate limit config
const RATE_LIMIT_MAX = 10;       // max messages
const RATE_LIMIT_WINDOW_MS = 60000; // per 1 minute

// Predefined quick message keys (localized on frontend)
const QUICK_MESSAGE_KEYS = [
    'hello',
    'goodLuck',
    'thanks',
    'oops',
    'goodMove',
    'sorry',
    'goodGame',
    'gottaGo'
];

/**
 * Check if a user is rate-limited
 * @param {string} userId
 * @returns {boolean}
 */
function isRateLimited(userId) {
    if (!userId) return false;
    const now = Date.now();
    const entry = userMessageCounts.get(userId);
    if (!entry) return false;
    // Reset window if expired
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        userMessageCounts.delete(userId);
        return false;
    }
    return entry.count >= RATE_LIMIT_MAX;
}

/**
 * Track a message for rate limiting
 * @param {string} userId
 */
function trackMessage(userId) {
    if (!userId) return;
    const now = Date.now();
    const entry = userMessageCounts.get(userId);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        userMessageCounts.set(userId, { count: 1, windowStart: now });
    } else {
        entry.count++;
    }
}

/**
 * Send a chat message
 * @param {string} roomCode
 * @param {string} userId
 * @param {string} pseudo
 * @param {string} message - text content or quick message key
 * @param {string} type - 'text' or 'quick'
 * @returns {{ success: boolean, message?: Object, error?: string }}
 */
function sendMessage(roomCode, userId, pseudo, message, type = 'text') {
    // Rate limit check
    if (isRateLimited(userId)) {
        return { success: false, error: 'rate_limited' };
    }

    // Validate type
    if (type !== 'text' && type !== 'quick') {
        return { success: false, error: 'invalid_type' };
    }

    // Validate quick message key
    if (type === 'quick' && !QUICK_MESSAGE_KEYS.includes(message)) {
        return { success: false, error: 'invalid_quick_message' };
    }

    // Sanitize text messages
    let sanitizedMessage = message;
    if (type === 'text') {
        sanitizedMessage = message
            .substring(0, 200)
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        if (!sanitizedMessage.trim()) {
            return { success: false, error: 'empty_message' };
        }
    }

    // Track for rate limiting
    trackMessage(userId);

    // Store message
    const storedMsg = chatMessageModel.addMessage(roomCode, {
        userId,
        pseudo,
        message: sanitizedMessage,
        type
    });

    return { success: true, message: storedMsg };
}

/**
 * Get messages for a room
 * @param {string} roomCode
 * @returns {Array}
 */
function getMessages(roomCode) {
    return chatMessageModel.getMessages(roomCode);
}

/**
 * Clear all chat data for a room
 * @param {string} roomCode
 */
function clearRoom(roomCode) {
    chatMessageModel.clearRoomMessages(roomCode);
}

/**
 * Get list of quick message keys
 * @returns {string[]}
 */
function getQuickMessages() {
    return QUICK_MESSAGE_KEYS;
}

module.exports = {
    sendMessage,
    getMessages,
    clearRoom,
    isRateLimited,
    getQuickMessages
};
