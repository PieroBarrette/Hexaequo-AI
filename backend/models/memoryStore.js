/**
 * In-Memory Room Storage
 * 
 * Fallback storage when PostgreSQL is not available.
 * Used for development and testing.
 */

// In-memory room storage
const rooms = new Map();
const spectators = new Map(); // roomCode -> [{ userId, socketId, pseudo }]

// Characters for room codes
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode() {
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
    }
    return code;
}

function generateUniqueCode() {
    let attempts = 0;
    while (attempts < 100) {
        const code = generateCode();
        if (!rooms.has(code)) return code;
        attempts++;
    }
    throw new Error('Failed to generate unique room code');
}

function getInitialGameState() {
    return {
        tiles: {
            '0,0': 'black',
            '1,0': 'black',
            '-1,1': 'white',
            '0,1': 'white'
        },
        pieces: {
            '1,0': { type: 'disc', color: 'black' },
            '-1,1': { type: 'disc', color: 'white' }
        },
        inventory: {
            black: { tiles: 7, discs: 5, rings: 3 },
            white: { tiles: 7, discs: 5, rings: 3 }
        },
        captured: {
            black_discs: 0,
            black_rings: 0,
            white_discs: 0,
            white_rings: 0
        },
        activePlayer: 'black'
    };
}

async function create({ hostId, hostPseudo, hostSocketId, timeMode = 'none', allowSpectators = true }) {
    const code = generateUniqueCode();
    const room = {
        code,
        host_id: hostId,
        host_pseudo: hostPseudo,
        host_socket_id: hostSocketId,
        white_id: null,
        white_pseudo: null,
        white_socket_id: null,
        time_mode: timeMode,
        allow_spectators: allowSpectators,
        status: 'waiting',
        game_state: getInitialGameState(),
        active_player: 'black',
        created_at: new Date(),
        updated_at: new Date()
    };
    
    rooms.set(code, room);
    spectators.set(code, []);
    
    return room;
}

async function findByCode(code) {
    return rooms.get(code?.toUpperCase()) || null;
}

async function findAvailable({ status = 'waiting', timeMode, allowSpectators, page = 1, limit = 20 }) {
    let roomList = Array.from(rooms.values());
    
    if (status) {
        roomList = roomList.filter(r => r.status === status);
    }
    if (timeMode) {
        roomList = roomList.filter(r => r.time_mode === timeMode);
    }
    if (allowSpectators !== undefined) {
        roomList = roomList.filter(r => r.allow_spectators === allowSpectators);
    }
    
    roomList.sort((a, b) => b.created_at - a.created_at);
    
    const total = roomList.length;
    const offset = (page - 1) * limit;
    
    return {
        rooms: roomList.slice(offset, offset + limit),
        total,
        page,
        totalPages: Math.ceil(total / limit)
    };
}

async function joinAsWhite(code, { whiteId, whitePseudo, whiteSocketId }) {
    const room = rooms.get(code?.toUpperCase());
    if (!room || room.status !== 'waiting') return null;
    
    console.debug('[memoryStore.joinAsWhite] Setting white player - code:', code, 'whiteId:', whiteId, 'whiteSocketId:', whiteSocketId);
    room.white_id = whiteId;
    room.white_pseudo = whitePseudo;
    room.white_socket_id = whiteSocketId;
    room.status = 'playing';
    room.updated_at = new Date();
    console.debug('[memoryStore.joinAsWhite] Room after update:', { host_socket_id: room.host_socket_id, white_socket_id: room.white_socket_id, status: room.status });
    
    return room;
}

async function updateGameState(code, gameState, activePlayer) {
    const room = rooms.get(code?.toUpperCase());
    if (!room) return null;
    
    room.game_state = gameState;
    room.active_player = activePlayer;
    room.updated_at = new Date();
    
    return { game_state: gameState };
}

async function updateSocketId(code, color, socketId) {
    const room = rooms.get(code?.toUpperCase());
    if (!room) return;
    
    console.debug('[memoryStore.updateSocketId] Updating - code:', code, 'color:', color, 'newSocketId:', socketId);
    if (color === 'black') {
        room.host_socket_id = socketId;
    } else {
        room.white_socket_id = socketId;
    }
    room.updated_at = new Date();
    console.debug('[memoryStore.updateSocketId] Room after update:', { host_socket_id: room.host_socket_id, white_socket_id: room.white_socket_id });
}

async function updateStatus(code, status) {
    const room = rooms.get(code?.toUpperCase());
    if (!room) return;
    
    room.status = status;
    room.updated_at = new Date();
}

async function resetForRematch(code) {
    const room = rooms.get(code?.toUpperCase());
    if (!room) return null;
    
    room.game_state = getInitialGameState();
    room.active_player = 'black';
    room.status = 'playing';
    room.updated_at = new Date();
    
    return room;
}

async function deleteRoom(code) {
    spectators.delete(code?.toUpperCase());
    return rooms.delete(code?.toUpperCase());
}

async function removeWhite(code) {
    const room = rooms.get(code?.toUpperCase());
    if (!room) return null;
    
    room.white_id = null;
    room.white_pseudo = null;
    room.white_socket_id = null;
    room.status = 'waiting';
    room.updated_at = new Date();
    
    return room;
}

async function cleanupOld() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;
    let cleaned = 0;
    
    for (const [code, room] of rooms.entries()) {
        if (now - room.updated_at.getTime() > maxAge) {
            rooms.delete(code);
            spectators.delete(code);
            cleaned++;
        }
    }
    
    return cleaned;
}

// Spectator operations
async function joinSpectator(roomCode, { userId, socketId, pseudo }) {
    const code = roomCode?.toUpperCase();
    if (!spectators.has(code)) {
        spectators.set(code, []);
    }
    spectators.get(code).push({ userId, socketId, pseudo, joined_at: new Date() });
    return { id: Date.now() };
}

async function leaveSpectator(socketId) {
    for (const [code, list] of spectators.entries()) {
        const index = list.findIndex(s => s.socketId === socketId);
        if (index !== -1) {
            list.splice(index, 1);
            return code;
        }
    }
    return null;
}

async function findSpectatorsByRoom(roomCode) {
    return spectators.get(roomCode?.toUpperCase()) || [];
}

async function getSpectatorCount(roomCode) {
    return (spectators.get(roomCode?.toUpperCase()) || []).length;
}

async function clearRoomSpectators(roomCode) {
    const list = spectators.get(roomCode?.toUpperCase()) || [];
    spectators.set(roomCode?.toUpperCase(), []);
    return list.length;
}

async function isSpectating(roomCode, userId) {
    const list = spectators.get(roomCode?.toUpperCase()) || [];
    return list.some(s => s.userId === userId);
}

module.exports = {
    create,
    findByCode,
    findAvailable,
    joinAsWhite,
    updateGameState,
    updateSocketId,
    updateStatus,
    resetForRematch,
    deleteRoom,
    removeWhite,
    cleanupOld,
    getInitialGameState,
    // Spectator exports
    joinSpectator,
    leaveSpectator,
    findSpectatorsByRoom,
    getSpectatorCount,
    clearRoomSpectators,
    isSpectating
};
