/**
 * Room Service
 * 
 * Business logic for room operations.
 * Uses PostgreSQL when available, falls back to in-memory storage.
 */

const { notFound, conflict } = require('../middleware/errorHandler');

// Try to use database models, fall back to memory store
let Room, Spectator;
let useMemoryStore = false;

try {
    const models = require('../models');
    Room = models.Room;
    Spectator = models.Spectator;
} catch (err) {
    useMemoryStore = true;
}

// Use memory store if database queries fail
const memoryStore = require('../models/memoryStore');

// Wrapper to try database first, then memory store
async function withFallback(dbOperation, memoryOperation) {
    if (useMemoryStore) {
        return memoryOperation();
    }
    try {
        return await dbOperation();
    } catch (err) {
        // If database fails, use memory store
        console.log('Database unavailable, using memory store');
        useMemoryStore = true;
        return memoryOperation();
    }
}

/**
 * Get rooms list
 */
exports.getRooms = async ({ status = 'waiting', timeMode, allowSpectators, page = 1, limit = 20 }) => {
    return withFallback(
        () => Room.findAvailable({ status, timeMode, allowSpectators, page, limit }),
        () => memoryStore.findAvailable({ status, timeMode, allowSpectators, page, limit })
    );
};

/**
 * Get room by code
 */
exports.getRoomByCode = async (code) => {
    const room = await withFallback(
        () => Room.findByCode(code),
        () => memoryStore.findByCode(code)
    );
    if (!room) {
        throw notFound('Room');
    }
    
    // Convert to external format
    return formatRoomResponse(room);
};

/**
 * Create room
 */
exports.createRoom = async ({ hostId, hostPseudo, hostSocketId, timeMode = 'none', allowSpectators = true }) => {
    const room = await withFallback(
        () => Room.create({ hostId, hostPseudo, hostSocketId, timeMode, allowSpectators }),
        () => memoryStore.create({ hostId, hostPseudo, hostSocketId, timeMode, allowSpectators })
    );
    
    return formatRoomResponse(room);
};

/**
 * Join room as guest
 */
exports.joinRoom = async (code, { guestId, guestPseudo, guestSocketId }) => {
    const room = await withFallback(
        () => Room.findByCode(code),
        () => memoryStore.findByCode(code)
    );
    if (!room) {
        throw notFound('Room');
    }

    if (room.status !== 'waiting') {
        throw conflict('Room is not available');
    }
    
    const updatedRoom = await withFallback(
        () => Room.joinAsGuest(code, { guestId, guestPseudo, guestSocketId }),
        () => memoryStore.joinAsGuest(code, { guestId, guestPseudo, guestSocketId })
    );
    
    if (!updatedRoom) {
        throw conflict('Failed to join room');
    }

    // Return full formatted room for matchmaking compatibility
    return formatRoomResponse(updatedRoom);
};

/**
 * Leave room
 */
exports.leaveRoom = async (code, userId) => {
    const room = await withFallback(
        () => Room.findByCode(code),
        () => memoryStore.findByCode(code)
    );
    if (!room) {
        return; // Room already gone
    }

    // If host leaves, delete room
    if (room.host_id === userId) {
        await withFallback(
            () => Spectator.clearRoom(code),
            () => memoryStore.clearRoomSpectators(code)
        );
        await withFallback(
            () => Room.deleteRoom(code),
            () => memoryStore.deleteRoom(code)
        );
        return { deleted: true };
    }

    // If guest leaves, room goes back to waiting
    if (room.guest_id === userId) {
        await withFallback(
            () => Room.removeGuest(code),
            () => memoryStore.removeGuest(code)
        );
        return { deleted: false };
    }
    
    // Check if it's a spectator
    const spectators = await withFallback(
        () => Spectator.findByRoom(code),
        () => memoryStore.findSpectatorsByRoom(code)
    );
    const spectator = spectators.find(s => s.user_id === userId || s.userId === userId);
    if (spectator) {
        await withFallback(
            () => Spectator.leave(spectator.socket_id || spectator.socketId),
            () => memoryStore.leaveSpectator(spectator.socket_id || spectator.socketId)
        );
    }
    
    return { deleted: false };
};

/**
 * Delete room
 */
exports.deleteRoom = async (code) => {
    await withFallback(
        () => Spectator.clearRoom(code),
        () => memoryStore.clearRoomSpectators(code)
    );
    await withFallback(
        () => Room.deleteRoom(code),
        () => memoryStore.deleteRoom(code)
    );
};

/**
 * Update game state in room
 */
exports.updateGameState = async (code, gameState, activePlayer) => {
    return withFallback(
        () => Room.updateGameState(code, gameState, activePlayer),
        () => memoryStore.updateGameState(code, gameState, activePlayer)
    );
};

/**
 * Update player socket ID (for reconnection)
 */
exports.updateSocketId = async (code, color, socketId) => {
    await withFallback(
        () => Room.updateSocketId(code, color, socketId),
        () => memoryStore.updateSocketId(code, color, socketId)
    );
};

/**
 * Update room status
 */
exports.updateStatus = async (code, status) => {
    await withFallback(
        () => Room.updateStatus(code, status),
        () => memoryStore.updateStatus(code, status)
    );
};

/**
 * Reset room for rematch
 */
exports.resetForRematch = async (code) => {
    return withFallback(
        () => Room.resetForRematch(code),
        () => memoryStore.resetForRematch(code)
    );
};

/**
 * Join room as spectator
 */
exports.joinAsSpectator = async (code, { userId, socketId, pseudo }) => {
    const room = await withFallback(
        () => Room.findByCode(code),
        () => memoryStore.findByCode(code)
    );
    if (!room) {
        throw notFound('Room');
    }
    
    if (!room.allow_spectators) {
        throw conflict('Spectators not allowed in this room');
    }
    
    await withFallback(
        () => Spectator.join(code, { userId, socketId, pseudo }),
        () => memoryStore.joinSpectator(code, { userId, socketId, pseudo })
    );
    
    return {
        roomCode: code,
        gameState: room.game_state,
        host: room.host_pseudo,
        guest: room.guest_pseudo
    };
};

/**
 * Leave as spectator
 */
exports.leaveAsSpectator = async (socketId) => {
    return withFallback(
        () => Spectator.leave(socketId),
        () => memoryStore.leaveSpectator(socketId)
    );
};

/**
 * Get spectators in room
 */
exports.getSpectators = async (code) => {
    return withFallback(
        () => Spectator.findByRoom(code),
        () => memoryStore.findSpectatorsByRoom(code)
    );
};

/**
 * Get spectator count
 */
exports.getSpectatorCount = async (code) => {
    return withFallback(
        () => Spectator.getCount(code),
        () => memoryStore.getSpectatorCount(code)
    );
};

/**
 * Format room response (internal -> external)
 */
function formatRoomResponse(room) {
    return {
        code: room.code,
        host: {
            id: room.host_id,
            pseudo: room.host_pseudo,
            socketId: room.host_socket_id,
            color: 'black'
        },
        guest: room.guest_id ? {
            id: room.guest_id,
            pseudo: room.guest_pseudo,
            socketId: room.guest_socket_id,
            color: 'white'
        } : null,
        timeMode: room.time_mode,
        allowSpectators: room.allow_spectators,
        status: room.status,
        gameState: room.game_state,
        activePlayer: room.active_player,
        createdAt: room.created_at
    };
}

// Schedule periodic cleanup of old rooms
// This runs when the service is loaded
if (process.env.NODE_ENV !== 'test') {
    setInterval(async () => {
        try {
            const cleaned = await withFallback(
                () => Room.cleanupOld(),
                () => memoryStore.cleanupOld()
            );
            if (cleaned > 0) {
                console.log(`Cleaned up ${cleaned} old rooms`);
            }
        } catch (error) {
            console.error('Room cleanup error:', error);
        }
    }, 60 * 60 * 1000); // Every hour
}

module.exports = exports;
