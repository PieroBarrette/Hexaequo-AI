/**
 * Room Service
 * 
 * Business logic for room operations.
 */

const crypto = require('crypto');
const { notFound, conflict } = require('../middleware/errorHandler');

// Temporary in-memory storage (replace with database)
const rooms = new Map();

/**
 * Generate room code
 */
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * Get unique room code
 */
function getUniqueRoomCode() {
    let code;
    let attempts = 0;
    do {
        code = generateRoomCode();
        attempts++;
        if (attempts > 100) {
            throw new Error('Failed to generate unique room code');
        }
    } while (rooms.has(code));
    return code;
}

/**
 * Get rooms list
 */
exports.getRooms = async ({ status = 'waiting', timeMode, allowSpectators, page = 1, limit = 20 }) => {
    let roomList = Array.from(rooms.values());

    // Filter by status
    if (status) {
        roomList = roomList.filter(r => r.status === status);
    }

    // Filter by time mode
    if (timeMode) {
        roomList = roomList.filter(r => r.timeMode === timeMode);
    }

    // Filter by spectators
    if (allowSpectators !== undefined) {
        roomList = roomList.filter(r => r.allowSpectators === allowSpectators);
    }

    // Sort by created date (newest first)
    roomList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Paginate
    const total = roomList.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginatedRooms = roomList.slice(start, start + limit);

    return {
        rooms: paginatedRooms.map(r => ({
            code: r.code,
            host: r.host,
            timeMode: r.timeMode,
            allowSpectators: r.allowSpectators,
            status: r.status,
            createdAt: r.createdAt
        })),
        total,
        page,
        totalPages
    };
};

/**
 * Get room by code
 */
exports.getRoomByCode = async (code) => {
    const room = rooms.get(code);
    if (!room) {
        throw notFound('Room');
    }
    return room;
};

/**
 * Create room
 */
exports.createRoom = async ({ hostId, timeMode = 'none', allowSpectators = true }) => {
    const code = getUniqueRoomCode();

    const room = {
        code,
        host: {
            id: hostId,
            color: 'black'
        },
        guest: null,
        timeMode,
        allowSpectators,
        status: 'waiting',
        createdAt: new Date().toISOString()
    };

    rooms.set(code, room);
    return room;
};

/**
 * Join room
 */
exports.joinRoom = async (code, userId) => {
    const room = rooms.get(code);
    if (!room) {
        throw notFound('Room');
    }

    if (room.status !== 'waiting') {
        throw conflict('Room is not available');
    }

    room.guest = {
        id: userId,
        color: 'white'
    };
    room.status = 'playing';

    return {
        roomCode: code,
        color: 'white',
        timeMode: room.timeMode
    };
};

/**
 * Leave room
 */
exports.leaveRoom = async (code, userId) => {
    const room = rooms.get(code);
    if (!room) {
        return; // Room already gone
    }

    // If host leaves, delete room
    if (room.host?.id === userId) {
        rooms.delete(code);
        return;
    }

    // If guest leaves, room goes back to waiting
    if (room.guest?.id === userId) {
        room.guest = null;
        room.status = 'waiting';
    }
};

/**
 * Delete room
 */
exports.deleteRoom = async (code) => {
    rooms.delete(code);
};

// Cleanup old rooms periodically
setInterval(() => {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const [code, room] of rooms.entries()) {
        if (now - new Date(room.createdAt).getTime() > maxAge) {
            rooms.delete(code);
        }
    }
}, 60 * 60 * 1000); // Every hour

module.exports = exports;
