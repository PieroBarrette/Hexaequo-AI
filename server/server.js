/**
 * Hexaequo Online Multiplayer Server
 * 
 * Handles WebSocket connections for real-time multiplayer gameplay.
 * Uses SQLite for persistent game state storage.
 */

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

// Configuration
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';

// Initialize Express
const app = express();
app.use(cors({
    origin: [FRONTEND_URL, 'https://hexaequo.com', 'http://localhost:8080', 'http://127.0.0.1:8080'],
    methods: ['GET', 'POST']
}));
app.use(express.json());

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.IO with CORS
const io = new Server(httpServer, {
    cors: {
        origin: [FRONTEND_URL, 'https://hexaequo.com', 'http://localhost:8080', 'http://127.0.0.1:8080'],
        methods: ['GET', 'POST']
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Initialize SQLite database
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'hexaequo.db');
const db = new Database(dbPath);

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
        room_code TEXT PRIMARY KEY,
        black_player_id TEXT,
        white_player_id TEXT,
        game_state TEXT,
        active_player TEXT DEFAULT 'black',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'waiting'
    );
    
    CREATE TABLE IF NOT EXISTS players (
        player_id TEXT PRIMARY KEY,
        socket_id TEXT,
        room_code TEXT,
        color TEXT,
        connected BOOLEAN DEFAULT 1,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (room_code) REFERENCES rooms(room_code)
    );
`);

// Prepared statements for better performance
const statements = {
    createRoom: db.prepare(`
        INSERT INTO rooms (room_code, black_player_id, game_state, status)
        VALUES (?, ?, ?, 'waiting')
    `),
    getRoom: db.prepare(`SELECT * FROM rooms WHERE room_code = ?`),
    updateRoom: db.prepare(`
        UPDATE rooms 
        SET white_player_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE room_code = ?
    `),
    updateGameState: db.prepare(`
        UPDATE rooms 
        SET game_state = ?, active_player = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE room_code = ?
    `),
    deleteRoom: db.prepare(`DELETE FROM rooms WHERE room_code = ?`),
    
    createPlayer: db.prepare(`
        INSERT OR REPLACE INTO players (player_id, socket_id, room_code, color, connected, last_seen)
        VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `),
    getPlayer: db.prepare(`SELECT * FROM players WHERE player_id = ?`),
    getPlayerBySocket: db.prepare(`SELECT * FROM players WHERE socket_id = ?`),
    getPlayersInRoom: db.prepare(`SELECT * FROM players WHERE room_code = ?`),
    updatePlayerSocket: db.prepare(`
        UPDATE players 
        SET socket_id = ?, connected = 1, last_seen = CURRENT_TIMESTAMP 
        WHERE player_id = ?
    `),
    disconnectPlayer: db.prepare(`
        UPDATE players 
        SET connected = 0, last_seen = CURRENT_TIMESTAMP 
        WHERE socket_id = ?
    `),
    deletePlayersInRoom: db.prepare(`DELETE FROM players WHERE room_code = ?`),
    
    // Cleanup old rooms (older than 24 hours)
    cleanupOldRooms: db.prepare(`
        DELETE FROM rooms 
        WHERE updated_at < datetime('now', '-24 hours')
    `),
    cleanupOldPlayers: db.prepare(`
        DELETE FROM players 
        WHERE last_seen < datetime('now', '-24 hours')
    `)
};

// Generate random 4-character alphanumeric room code
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding confusing chars (0,O,1,I)
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Generate unique room code
function getUniqueRoomCode() {
    let code;
    let attempts = 0;
    do {
        code = generateRoomCode();
        attempts++;
        if (attempts > 100) {
            throw new Error('Failed to generate unique room code');
        }
    } while (statements.getRoom.get(code));
    return code;
}

// Get initial game state
function getInitialGameState() {
    return {
        tiles: {
            '0,0': 'black', '1,0': 'black', '0,1': 'black',
            '-1,0': 'white', '0,-1': 'white', '-1,1': 'white'
        },
        pieces: {
            '1,0': { type: 'disc', color: 'black' },
            '0,1': { type: 'disc', color: 'black' },
            '-1,0': { type: 'disc', color: 'white' },
            '0,-1': { type: 'disc', color: 'white' }
        },
        inventory: {
            black: { tiles: 7, discs: 5, rings: 3 },
            white: { tiles: 7, discs: 5, rings: 3 }
        },
        captured: {
            black_discs: 0, black_rings: 0,
            white_discs: 0, white_rings: 0
        },
        activePlayer: 'black'
    };
}

// Cleanup old data periodically
setInterval(() => {
    try {
        statements.cleanupOldRooms.run();
        statements.cleanupOldPlayers.run();
    } catch (err) {
        console.error('Cleanup error:', err);
    }
}, 60 * 60 * 1000); // Every hour

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Create a new room
    socket.on('create-room', (data, callback) => {
        try {
            const { playerId } = data;
            const roomCode = getUniqueRoomCode();
            const initialState = getInitialGameState();

            // Create room in database
            statements.createRoom.run(roomCode, playerId, JSON.stringify(initialState));
            
            // Create player record
            statements.createPlayer.run(playerId, socket.id, roomCode, 'black');

            // Join socket room
            socket.join(roomCode);

            console.log(`Room ${roomCode} created by player ${playerId}`);

            callback({
                success: true,
                roomCode,
                color: 'black',
                gameState: initialState,
                waiting: true
            });
        } catch (err) {
            console.error('Create room error:', err);
            callback({ success: false, error: err.message });
        }
    });

    // Join an existing room
    socket.on('join-room', (data, callback) => {
        try {
            const { roomCode, playerId } = data;
            const room = statements.getRoom.get(roomCode.toUpperCase());

            if (!room) {
                return callback({ success: false, error: 'Room not found' });
            }

            // Check if player is reconnecting
            const existingPlayer = statements.getPlayer.get(playerId);
            if (existingPlayer && existingPlayer.room_code === roomCode.toUpperCase()) {
                // Reconnecting to same room
                statements.updatePlayerSocket.run(socket.id, playerId);
                socket.join(roomCode.toUpperCase());

                const gameState = JSON.parse(room.game_state);
                
                // Notify other player of reconnection
                socket.to(roomCode.toUpperCase()).emit('opponent-reconnected');

                console.log(`Player ${playerId} reconnected to room ${roomCode}`);

                return callback({
                    success: true,
                    roomCode: roomCode.toUpperCase(),
                    color: existingPlayer.color,
                    gameState,
                    reconnected: true,
                    opponentConnected: room.status === 'playing'
                });
            }

            // Check if room is full
            if (room.status === 'playing') {
                return callback({ success: false, error: 'Room is full' });
            }

            // Join as white player
            statements.updateRoom.run(playerId, 'playing', roomCode.toUpperCase());
            statements.createPlayer.run(playerId, socket.id, roomCode.toUpperCase(), 'white');

            socket.join(roomCode.toUpperCase());

            const gameState = JSON.parse(room.game_state);

            // Notify black player that opponent joined
            socket.to(roomCode.toUpperCase()).emit('opponent-joined', {
                gameState
            });

            console.log(`Player ${playerId} joined room ${roomCode} as white`);

            callback({
                success: true,
                roomCode: roomCode.toUpperCase(),
                color: 'white',
                gameState,
                waiting: false
            });
        } catch (err) {
            console.error('Join room error:', err);
            callback({ success: false, error: err.message });
        }
    });

    // Handle move
    socket.on('make-move', (data, callback) => {
        try {
            const { roomCode, playerId, gameState, previousState } = data;
            const room = statements.getRoom.get(roomCode);

            if (!room) {
                return callback({ success: false, error: 'Room not found' });
            }

            const player = statements.getPlayer.get(playerId);
            if (!player || player.room_code !== roomCode) {
                return callback({ success: false, error: 'Invalid player' });
            }

            // Verify it's the player's turn
            const currentState = JSON.parse(room.game_state);
            if (currentState.activePlayer !== player.color) {
                return callback({ success: false, error: 'Not your turn' });
            }

            // Update game state in database
            statements.updateGameState.run(
                JSON.stringify(gameState),
                gameState.activePlayer,
                roomCode
            );

            // Broadcast move to opponent
            socket.to(roomCode).emit('opponent-moved', {
                gameState,
                previousState
            });

            console.log(`Move in room ${roomCode} by ${player.color}`);

            callback({ success: true });
        } catch (err) {
            console.error('Move error:', err);
            callback({ success: false, error: err.message });
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        try {
            const player = statements.getPlayerBySocket.get(socket.id);
            if (player) {
                statements.disconnectPlayer.run(socket.id);
                
                // Notify opponent
                socket.to(player.room_code).emit('opponent-disconnected');
                
                console.log(`Player ${player.player_id} disconnected from room ${player.room_code}`);
            }
        } catch (err) {
            console.error('Disconnect error:', err);
        }
    });

    // Leave room intentionally
    socket.on('leave-room', (data, callback) => {
        try {
            const { roomCode, playerId } = data;
            const player = statements.getPlayer.get(playerId);
            
            if (player && player.room_code === roomCode) {
                // Remove player
                db.prepare(`DELETE FROM players WHERE player_id = ?`).run(playerId);
                
                const room = statements.getRoom.get(roomCode);
                if (room) {
                    // If both players left, delete room
                    const remainingPlayers = statements.getPlayersInRoom.all(roomCode);
                    if (remainingPlayers.length === 0) {
                        statements.deleteRoom.run(roomCode);
                        console.log(`Room ${roomCode} deleted - no players remaining`);
                    } else {
                        // Notify remaining player
                        socket.to(roomCode).emit('opponent-left');
                    }
                }
                
                socket.leave(roomCode);
                console.log(`Player ${playerId} left room ${roomCode}`);
            }

            callback({ success: true });
        } catch (err) {
            console.error('Leave room error:', err);
            callback({ success: false, error: err.message });
        }
    });

    // Get room status
    socket.on('room-status', (data, callback) => {
        try {
            const { roomCode } = data;
            const room = statements.getRoom.get(roomCode);
            
            if (!room) {
                return callback({ success: false, error: 'Room not found' });
            }

            const players = statements.getPlayersInRoom.all(roomCode);
            
            callback({
                success: true,
                status: room.status,
                players: players.map(p => ({
                    color: p.color,
                    connected: !!p.connected
                })),
                gameState: JSON.parse(room.game_state)
            });
        } catch (err) {
            console.error('Room status error:', err);
            callback({ success: false, error: err.message });
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Room info endpoint (for debugging)
app.get('/room/:code', (req, res) => {
    const room = statements.getRoom.get(req.params.code.toUpperCase());
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }
    const players = statements.getPlayersInRoom.all(req.params.code.toUpperCase());
    res.json({
        roomCode: room.room_code,
        status: room.status,
        activePlayer: room.active_player,
        players: players.map(p => ({ color: p.color, connected: !!p.connected }))
    });
});

// Start server
httpServer.listen(PORT, () => {
    console.log(`Hexaequo server running on port ${PORT}`);
    console.log(`Accepting connections from: ${FRONTEND_URL}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    db.close();
    httpServer.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
