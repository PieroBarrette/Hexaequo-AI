/**
 * Room Service
 * 
 * Business logic for room operations using PostgreSQL database.
 */

const { notFound, conflict } = require('../middleware/errorHandler');
const { Room, Spectator } = require('../models');

/**
 * Get rooms list
 */
exports.getRooms = async ({ status = 'waiting', timeMode, allowSpectators, page = 1, limit = 20 }) => {
    return await Room.findAvailable({ status, timeMode, allowSpectators, page, limit });
};

/**
 * Get room by code
 */
exports.getRoomByCode = async (code) => {
    const room = await Room.findByCode(code);
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
    const room = await Room.create({
        hostId,
        hostPseudo,
        hostSocketId,
        timeMode,
        allowSpectators
    });
    
    return formatRoomResponse(room);
};

/**
 * Join room as guest
 */
exports.joinRoom = async (code, { guestId, guestPseudo, guestSocketId }) => {
    const room = await Room.findByCode(code);
    if (!room) {
        throw notFound('Room');
    }

    if (room.status !== 'waiting') {
        throw conflict('Room is not available');
    }
    
    const updatedRoom = await Room.joinAsGuest(code, {
        guestId,
        guestPseudo,
        guestSocketId
    });
    
    if (!updatedRoom) {
        throw conflict('Failed to join room');
    }

    return {
        roomCode: code,
        color: 'white',
        timeMode: updatedRoom.time_mode
    };
};

/**
 * Leave room
 */
exports.leaveRoom = async (code, userId) => {
    const room = await Room.findByCode(code);
    if (!room) {
        return; // Room already gone
    }

    // If host leaves, delete room
    if (room.host_id === userId) {
        // Clear spectators first
        await Spectator.clearRoom(code);
        await Room.deleteRoom(code);
        return { deleted: true };
    }

    // If guest leaves, room goes back to waiting
    if (room.guest_id === userId) {
        await Room.removeGuest(code);
        return { deleted: false };
    }
    
    // Check if it's a spectator
    const spectators = await Spectator.findByRoom(code);
    const spectator = spectators.find(s => s.user_id === userId);
    if (spectator) {
        await Spectator.leave(spectator.socket_id);
    }
    
    return { deleted: false };
};

/**
 * Delete room
 */
exports.deleteRoom = async (code) => {
    await Spectator.clearRoom(code);
    await Room.deleteRoom(code);
};

/**
 * Update game state in room
 */
exports.updateGameState = async (code, gameState, activePlayer) => {
    return await Room.updateGameState(code, gameState, activePlayer);
};

/**
 * Update player socket ID (for reconnection)
 */
exports.updateSocketId = async (code, color, socketId) => {
    await Room.updateSocketId(code, color, socketId);
};

/**
 * Update room status
 */
exports.updateStatus = async (code, status) => {
    await Room.updateStatus(code, status);
};

/**
 * Reset room for rematch
 */
exports.resetForRematch = async (code) => {
    return await Room.resetForRematch(code);
};

/**
 * Join room as spectator
 */
exports.joinAsSpectator = async (code, { userId, socketId, pseudo }) => {
    const room = await Room.findByCode(code);
    if (!room) {
        throw notFound('Room');
    }
    
    if (!room.allow_spectators) {
        throw conflict('Spectators not allowed in this room');
    }
    
    await Spectator.join(code, { userId, socketId, pseudo });
    
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
    return await Spectator.leave(socketId);
};

/**
 * Get spectators in room
 */
exports.getSpectators = async (code) => {
    return await Spectator.findByRoom(code);
};

/**
 * Get spectator count
 */
exports.getSpectatorCount = async (code) => {
    return await Spectator.getCount(code);
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
            const cleaned = await Room.cleanupOld();
            if (cleaned > 0) {
                console.log(`Cleaned up ${cleaned} old rooms`);
            }
        } catch (error) {
            console.error('Room cleanup error:', error);
        }
    }, 60 * 60 * 1000); // Every hour
}

module.exports = exports;
