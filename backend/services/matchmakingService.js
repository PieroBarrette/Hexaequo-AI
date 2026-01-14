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
 * - Event-driven matching (when player joins queue)
 * - Élargissement progressif plage ELO si pas de match (optionnel)
 * 
 * Flow:
 * 1. Joueur appelle joinQueue(userId, timeMode, preferences)
 * 2. Service ajoute à queue + lance recherche immédiate
 * 3. Si match: crée room, notifie les 2 joueurs, retire de queue
 * 4. Si pas de match: joueur reste en queue
 * 5. Joueur peut leaveQueue() à tout moment
 * 
 * Exports:
 * - joinQueue(userId, socketId, timeMode, preferences) → queueEntry
 * - leaveQueue(userId, socketId) → boolean
 * - findAndCreateMatch(userId, socketId, elo, timeMode, preferences) → {matched, roomCode?, opponent?}
 * - getQueueStatus(userId, socketId) → {inQueue, position?, waitTime?}
 */

const matchmakingQueueModel = require('../models/matchmakingQueueModel');
const userPreferencesModel = require('../models/userPreferencesModel');
const roomService = require('./roomService');

// In-memory fallback for queue (when DB unavailable)
const memoryQueue = new Map(); // socketId -> queueEntry
let useMemoryStore = false;

/**
 * Join the matchmaking queue
 * Immediately searches for a match
 */
async function joinQueue(userId, socketId, pseudo, elo, timeMode, preferences = {}) {
    try {
        // Get user preferences if not provided
        if (!preferences.elo_range_min && !preferences.elo_range_max) {
            const userPrefs = await userPreferencesModel.getPreferences(userId);
            preferences = { ...userPrefs, ...preferences };
        }
        
        // Add to queue (pass pseudo so it's stored in DB for opponents to see)
        const queueEntry = await withFallback(
            () => matchmakingQueueModel.addToQueue(userId, socketId, pseudo, elo, timeMode, preferences),
            () => addToMemoryQueue(userId, socketId, pseudo, elo, timeMode, preferences)
        );
        
        // Immediately try to find a match
        const matchResult = await findAndCreateMatch(userId, socketId, pseudo, elo, timeMode, preferences);
        
        if (matchResult.matched) {
            return {
                inQueue: false,
                matched: true,
                ...matchResult
            };
        }
        
        return {
            inQueue: true,
            matched: false,
            queueEntry
        };
    } catch (err) {
        console.error('[Matchmaking] Join queue error:', err);
        throw err;
    }
}

/**
 * Leave the matchmaking queue
 */
async function leaveQueue(userId, socketId) {
    try {
        let removed = false;
        
        if (userId) {
            removed = await withFallback(
                () => matchmakingQueueModel.removeFromQueue(userId),
                () => removeFromMemoryQueueByUser(userId)
            );
        }
        
        if (!removed && socketId) {
            removed = await withFallback(
                () => matchmakingQueueModel.removeFromQueueBySocket(socketId),
                () => removeFromMemoryQueue(socketId)
            );
        }
        
        return removed;
    } catch (err) {
        console.error('[Matchmaking] Leave queue error:', err);
        return false;
    }
}

/**
 * Find a match and create a room if found
 * Event-driven: called when a new player joins the queue
 */
async function findAndCreateMatch(userId, socketId, pseudo, elo, timeMode, preferences = {}) {
    try {
        // Find the oldest compatible player
        const opponent = await withFallback(
            () => matchmakingQueueModel.findMatch(userId, socketId, elo, timeMode, preferences),
            () => findMatchInMemory(userId, socketId, elo, timeMode, preferences)
        );
        
        if (!opponent) {
            return { matched: false };
        }
        
        console.debug('[Matchmaking] Found opponent:', { id: opponent.id, pseudo: opponent.pseudo, elo: opponent.elo, socketId: opponent.socketId });
        
        // Remove both players from queue
        await leaveQueue(userId, socketId);
        await leaveQueue(opponent.userId, opponent.socketId);
        
        // Create room for the match
        // The player who was waiting longer (opponent) becomes the host (black)
        const room = await roomService.createRoom({
            hostId: opponent.userId,
            hostPseudo: opponent.pseudo || 'Guest',
            hostSocketId: opponent.socketId,
            timeMode: timeMode,
            allowSpectators: true
        });
        
        // Join the new player as guest (white)
        const joinedRoom = await roomService.joinRoom(room.code, {
            guestId: userId,
            guestPseudo: pseudo || 'Guest',
            guestSocketId: socketId
        });
        
        return {
            matched: true,
            roomCode: room.code,
            room: joinedRoom,
            opponent: {
                id: opponent.id,
                userId: opponent.userId,
                socketId: opponent.socketId,
                pseudo: opponent.pseudo,
                elo: opponent.elo
            },
            joiner: {
                userId: userId,
                socketId: socketId,
                pseudo: pseudo,
                elo: elo
            }
        };
    } catch (err) {
        console.error('[Matchmaking] Find match error:', err);
        return { matched: false, error: err.message };
    }
}

/**
 * Get queue status for a player
 */
async function getQueueStatus(userId, socketId) {
    try {
        const status = await withFallback(
            () => matchmakingQueueModel.getQueueStatus(userId, socketId),
            () => getMemoryQueueStatus(socketId)
        );
        
        if (!status) {
            return { inQueue: false };
        }
        
        return {
            inQueue: true,
            ...status
        };
    } catch (err) {
        console.error('[Matchmaking] Get status error:', err);
        return { inQueue: false };
    }
}

/**
 * Cleanup expired entries (call periodically)
 */
async function cleanupExpired() {
    try {
        const count = await withFallback(
            () => matchmakingQueueModel.cleanupExpired(),
            () => cleanupMemoryQueue()
        );
        
        if (count > 0) {
            console.log(`[Matchmaking] Cleaned up ${count} expired entries`);
        }
        
        return count;
    } catch (err) {
        console.error('[Matchmaking] Cleanup error:', err);
        return 0;
    }
}

// ==================== Memory Fallback ====================

function addToMemoryQueue(userId, socketId, pseudo, elo, timeMode, preferences) {
    const entry = {
        id: `mem_${Date.now()}`,
        userId,
        socketId,
        pseudo,
        elo,
        timeMode,
        preferences,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    };
    
    memoryQueue.set(socketId, entry);
    return entry;
}

function removeFromMemoryQueue(socketId) {
    return memoryQueue.delete(socketId);
}

function removeFromMemoryQueueByUser(userId) {
    for (const [socketId, entry] of memoryQueue.entries()) {
        if (entry.userId === userId) {
            memoryQueue.delete(socketId);
            return true;
        }
    }
    return false;
}

function findMatchInMemory(userId, socketId, elo, timeMode, preferences) {
    const myEloMin = preferences.elo_range_min ?? -200;
    const myEloMax = preferences.elo_range_max ?? 200;
    const now = new Date();
    
    let oldestMatch = null;
    let oldestTime = null;
    
    for (const [entrySocketId, entry] of memoryQueue.entries()) {
        // Skip self and expired
        if (entrySocketId === socketId) continue;
        if (entry.userId && entry.userId === userId) continue;
        if (entry.expiresAt < now) continue;
        
        // Check time mode
        if (entry.timeMode !== timeMode) continue;
        
        // Check ELO ranges
        const theirEloMin = entry.preferences?.elo_range_min ?? -200;
        const theirEloMax = entry.preferences?.elo_range_max ?? 200;
        
        // My ELO must be in their range
        if (elo < entry.elo + theirEloMin || elo > entry.elo + theirEloMax) continue;
        
        // Their ELO must be in my range
        if (entry.elo < elo + myEloMin || entry.elo > elo + myEloMax) continue;
        
        // FIFO: keep oldest
        if (!oldestMatch || entry.createdAt < oldestTime) {
            oldestMatch = entry;
            oldestTime = entry.createdAt;
        }
    }
    
    return oldestMatch;
}

function getMemoryQueueStatus(socketId) {
    const entry = memoryQueue.get(socketId);
    if (!entry) return null;
    
    // Count position (entries with same timeMode created before)
    let position = 1;
    const now = new Date();
    for (const [, e] of memoryQueue.entries()) {
        if (e.timeMode === entry.timeMode && e.createdAt < entry.createdAt && e.expiresAt > now) {
            position++;
        }
    }
    
    return {
        ...entry,
        position,
        waitTime: Math.floor((Date.now() - entry.createdAt.getTime()) / 1000)
    };
}

function cleanupMemoryQueue() {
    const now = new Date();
    let count = 0;
    
    for (const [socketId, entry] of memoryQueue.entries()) {
        if (entry.expiresAt < now) {
            memoryQueue.delete(socketId);
            count++;
        }
    }
    
    return count;
}

// Wrapper to try database first, then memory store
async function withFallback(dbOperation, memoryOperation) {
    if (useMemoryStore) {
        return memoryOperation();
    }
    try {
        return await dbOperation();
    } catch (err) {
        console.log('[Matchmaking] Database unavailable, using memory store');
        useMemoryStore = true;
        return memoryOperation();
    }
}

module.exports = {
    joinQueue,
    leaveQueue,
    findAndCreateMatch,
    getQueueStatus,
    cleanupExpired
};
