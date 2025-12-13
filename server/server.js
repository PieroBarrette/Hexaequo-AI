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

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
    FRONTEND_URL,
    'https://hexaequo.com',
    'https://www.hexaequo.com',
    'https://pierobarrette.github.io',
    'http://localhost:8080',
    'http://127.0.0.1:8080'
];

// Initialize Express
const app = express();
app.use(cors({
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json());

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.IO with CORS
const io = new Server(httpServer, {
    cors: {
        origin: ALLOWED_ORIGINS,
        methods: ['GET', 'POST'],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Initialize SQLite database
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'hexaequo.db');
const db = new Database(dbPath);

// Simple password hashing (for production, use bcrypt)
const crypto = require('crypto');
function hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'hexaequo_salt').digest('hex');
}

// Generate session token
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        pseudo TEXT,
        elo INTEGER DEFAULT 1000,
        games_played INTEGER DEFAULT 0,
        games_won INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME DEFAULT (datetime('now', '+7 days')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

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

// Add ELO column if it doesn't exist (for existing databases)
try {
    db.exec(`ALTER TABLE users ADD COLUMN elo INTEGER DEFAULT 1000`);
} catch (e) {
    // Column likely already exists
}

// Rename display_name to pseudo if needed (migration)
try {
    db.exec(`ALTER TABLE users RENAME COLUMN display_name TO pseudo`);
} catch (e) {
    // Column likely already renamed or doesn't exist
}

// Add time_control column if it doesn't exist
try {
    db.exec(`ALTER TABLE rooms ADD COLUMN time_control TEXT DEFAULT 'classic'`);
} catch (e) {
    // Column likely already exists
}

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
    
    // Auth statements
    createUser: db.prepare(`
        INSERT INTO users (username, password_hash, pseudo)
        VALUES (?, ?, ?)
    `),
    getUserByUsername: db.prepare(`SELECT * FROM users WHERE username = ?`),
    getUserById: db.prepare(`SELECT id, username, pseudo, elo, games_played, games_won, created_at FROM users WHERE id = ?`),
    updateUserLogin: db.prepare(`UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?`),
    updateUserStats: db.prepare(`
        UPDATE users SET games_played = games_played + 1, games_won = games_won + ? WHERE id = ?
    `),
    createSession: db.prepare(`
        INSERT INTO sessions (token, user_id) VALUES (?, ?)
    `),
    getSession: db.prepare(`
        SELECT s.*, u.username, u.pseudo 
        FROM sessions s JOIN users u ON s.user_id = u.id 
        WHERE s.token = ? AND s.expires_at > datetime('now')
    `),
    deleteSession: db.prepare(`DELETE FROM sessions WHERE token = ?`),
    
    // Room list - get all waiting rooms
    getWaitingRooms: db.prepare(`
        SELECT room_code, black_player_id, time_control, created_at 
        FROM rooms 
        WHERE status = 'waiting'
        ORDER BY created_at DESC
    `),
    cleanupSessions: db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`),
        // ELO updates
    updateUserElo: db.prepare(`
        UPDATE users SET elo = ?, games_played = games_played + 1, games_won = games_won + ? WHERE id = ?
    `),
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

// ==================== ELO Calculation ====================
// Standard ELO rating system
// K-factor: 32 (standard for most players)
// Formula: Rnew = Rold + K * (S - E)
// where E = 1 / (1 + 10^((Ropponent - Rplayer) / 400))
// S = 1 for win, 0.5 for draw, 0 for loss

function calculateEloChange(playerElo, opponentElo, result) {
    // result: 1 = win, 0.5 = draw, 0 = loss
    const K = 32;
    
    // Expected score based on rating difference
    const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
    
    // ELO change (rounded to nearest integer)
    const change = Math.round(K * (result - expectedScore));
    
    return change;
}

function processGameResult(roomCode, winnerColor, isDraw) {
    const blackInfo = roomPlayerInfo.get(`${roomCode}:black`);
    const whiteInfo = roomPlayerInfo.get(`${roomCode}:white`);
    
    // Get room info for time control
    const room = statements.getRoom.get(roomCode);
    const timeControl = room?.time_control || 'none';
    
    const result = {
        black: { oldElo: null, newElo: null, change: 0, isGuest: true },
        white: { oldElo: null, newElo: null, change: 0, isGuest: true }
    };
    
    // Get current ELOs (default 1000 for guests who don't have stored ELO)
    const blackElo = blackInfo?.elo || 1000;
    const whiteElo = whiteInfo?.elo || 1000;
    
    result.black.oldElo = blackElo;
    result.white.oldElo = whiteElo;
    result.black.isGuest = blackInfo?.isGuest !== false;
    result.white.isGuest = whiteInfo?.isGuest !== false;
    
    // Check if ELO should be adjusted:
    // - No adjustment if either player is a guest
    // - No adjustment if no timer (time control is 'none')
    const hasGuest = result.black.isGuest || result.white.isGuest;
    const hasNoTimer = timeControl === 'none';
    
    if (hasGuest || hasNoTimer) {
        // No ELO change - set newElo same as oldElo
        result.black.newElo = blackElo;
        result.white.newElo = whiteElo;
        result.black.change = 0;
        result.white.change = 0;
        
        console.log(`[ELO] No adjustment: hasGuest=${hasGuest}, hasNoTimer=${hasNoTimer}`);
        return result;
    }
    
    if (isDraw) {
        // Draw: both get 0.5 result
        result.black.change = calculateEloChange(blackElo, whiteElo, 0.5);
        result.white.change = calculateEloChange(whiteElo, blackElo, 0.5);
    } else if (winnerColor === 'black') {
        // Black wins
        result.black.change = calculateEloChange(blackElo, whiteElo, 1);
        result.white.change = calculateEloChange(whiteElo, blackElo, 0);
    } else {
        // White wins
        result.white.change = calculateEloChange(whiteElo, blackElo, 1);
        result.black.change = calculateEloChange(blackElo, whiteElo, 0);
    }
    
    result.black.newElo = blackElo + result.black.change;
    result.white.newElo = whiteElo + result.white.change;
    
    // Update database for non-guest users
    if (!result.black.isGuest && blackInfo?.oderId) {
        const won = winnerColor === 'black' ? 1 : 0;
        statements.updateUserElo.run(result.black.newElo, won, blackInfo.oderId);
        console.log(`[ELO] Updated black player (${blackInfo.name}): ${blackElo} -> ${result.black.newElo}`);
    }
    
    if (!result.white.isGuest && whiteInfo?.oderId) {
        const won = winnerColor === 'white' ? 1 : 0;
        statements.updateUserElo.run(result.white.newElo, won, whiteInfo.oderId);
        console.log(`[ELO] Updated white player (${whiteInfo.name}): ${whiteElo} -> ${result.white.newElo}`);
    }
    
    return result;
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
            '0,0': 'black', '1,0': 'black',
            '-1,1': 'white', '0,1': 'white'
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
            black_discs: 0, black_rings: 0,
            white_discs: 0, white_rings: 0
        },
        activePlayer: 'black'
    };
}

// Check if a game has any moves played (differs from initial state)
function hasGameStarted(gameState) {
    const initial = getInitialGameState();
    // If game state differs from initial, at least one move was made
    // Check tiles count and inventory as quick indicators
    const currentTileCount = Object.keys(gameState.tiles || {}).length;
    const initialTileCount = Object.keys(initial.tiles).length;
    
    // If tile count differs, moves were made
    if (currentTileCount !== initialTileCount) return true;
    
    // Check if active player changed (at least one move was made)
    if (gameState.activePlayer !== 'black') return true;
    
    // Check inventory changes
    const blackInv = gameState.inventory?.black;
    const whiteInv = gameState.inventory?.white;
    if (blackInv && (blackInv.tiles !== 7 || blackInv.discs !== 5 || blackInv.rings !== 3)) return true;
    if (whiteInv && (whiteInv.tiles !== 7 || whiteInv.discs !== 5 || whiteInv.rings !== 3)) return true;
    
    return false;
}

// Cleanup old data periodically
setInterval(() => {
    try {
        statements.cleanupOldRooms.run();
        statements.cleanupOldPlayers.run();
        statements.cleanupSessions.run();
    } catch (err) {
        console.error('Cleanup error:', err);
    }
}, 60 * 60 * 1000); // Every hour

// ==================== AUTH API ENDPOINTS ====================

// Register new user
app.post('/api/auth/register', (req, res) => {
    try {
        const { username, password, displayName } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        
        if (username.length < 3 || username.length > 20) {
            return res.status(400).json({ error: 'Username must be 3-20 characters' });
        }
        
        if (password.length < 4) {
            return res.status(400).json({ error: 'Password must be at least 4 characters' });
        }
        
        // Check if username exists
        const existing = statements.getUserByUsername.get(username.toLowerCase());
        if (existing) {
            return res.status(409).json({ error: 'Username already taken' });
        }
        
        // Create user
        const passwordHash = hashPassword(password);
        const result = statements.createUser.run(
            username.toLowerCase(),
            passwordHash,
            displayName || username
        );
        
        // Create session
        const token = generateSessionToken();
        statements.createSession.run(token, result.lastInsertRowid);
        
        res.json({
            success: true,
            token,
            user: {
                id: result.lastInsertRowid,
                username: username.toLowerCase(),
                pseudo: displayName || username,
                elo: 1000,
                gamesPlayed: 0,
                gamesWon: 0
            }
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        
        const user = statements.getUserByUsername.get(username.toLowerCase());
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const passwordHash = hashPassword(password);
        if (user.password_hash !== passwordHash) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Update last login
        statements.updateUserLogin.run(user.id);
        
        // Create session
        const token = generateSessionToken();
        statements.createSession.run(token, user.id);
        
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                pseudo: user.pseudo,
                elo: user.elo || 1000,
                gamesPlayed: user.games_played,
                gamesWon: user.games_won
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            statements.deleteSession.run(token);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Logout error:', err);
        res.status(500).json({ error: 'Logout failed' });
    }
});

// Get current user (validate session)
app.get('/api/auth/me', (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }
        
        const session = statements.getSession.get(token);
        if (!session) {
            return res.status(401).json({ error: 'Invalid or expired session' });
        }
        
        const user = statements.getUserById.get(session.user_id);
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                pseudo: user.pseudo,
                elo: user.elo || 1000,
                gamesPlayed: user.games_played,
                gamesWon: user.games_won
            }
        });
    } catch (err) {
        console.error('Auth check error:', err);
        res.status(500).json({ error: 'Auth check failed' });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Socket.IO connection handling
// Store user info in memory (keyed by room code and player color)
const roomPlayerInfo = new Map();

// Store timer state per room
const roomTimers = new Map();

// Timer presets (time in milliseconds)
const TIME_CONTROLS = {
    none: { time: null, increment: 0 },
    classic: { time: 15 * 60 * 1000, increment: 0 },
    rapid: { time: 10 * 60 * 1000, increment: 5 * 1000 },
    blitz: { time: 5 * 60 * 1000, increment: 3 * 1000 },
    bullet: { time: 2 * 60 * 1000, increment: 1 * 1000 }
};

// Initialize timer state for a room
function initRoomTimer(roomCode, timeControl) {
    const control = TIME_CONTROLS[timeControl] || TIME_CONTROLS.classic;
    roomTimers.set(roomCode, {
        timeControl,
        blackTime: control.time,
        whiteTime: control.time,
        activeTimer: null,
        lastMoveTime: null,
        gameStarted: false,  // Timer only starts after first move
        increment: control.increment
    });
    console.log(`[Timer] Initialized for room ${roomCode}:`, timeControl, control);
}

// Get timer state for a room, calculating current time if running
function getRoomTimerState(roomCode) {
    const timer = roomTimers.get(roomCode);
    if (!timer || timer.blackTime === null) {
        return null;
    }
    
    // If timer is running, calculate elapsed time since last move
    if (timer.gameStarted && timer.activeTimer && timer.lastMoveTime) {
        const elapsed = Date.now() - timer.lastMoveTime;
        const result = { ...timer };
        
        if (timer.activeTimer === 'black') {
            result.blackTime = Math.max(0, timer.blackTime - elapsed);
        } else {
            result.whiteTime = Math.max(0, timer.whiteTime - elapsed);
        }
        
        return result;
    }
    
    return timer;
}

// Process a move and update timer
function processTimerMove(roomCode, playerColor) {
    const timer = roomTimers.get(roomCode);
    if (!timer || timer.blackTime === null) {
        return null;
    }
    
    const now = Date.now();
    
    // First move of the game - start the timer
    if (!timer.gameStarted) {
        timer.gameStarted = true;
        timer.activeTimer = playerColor === 'black' ? 'white' : 'black';  // Switch to opponent
        timer.lastMoveTime = now;
        console.log(`[Timer] Game started in room ${roomCode}, ${timer.activeTimer}'s turn`);
        return getRoomTimerState(roomCode);
    }
    
    // Calculate elapsed time for the player who just moved
    if (timer.lastMoveTime) {
        const elapsed = now - timer.lastMoveTime;
        
        if (playerColor === 'black') {
            timer.blackTime = Math.max(0, timer.blackTime - elapsed);
            // Add increment after moving
            timer.blackTime += timer.increment;
        } else {
            timer.whiteTime = Math.max(0, timer.whiteTime - elapsed);
            // Add increment after moving
            timer.whiteTime += timer.increment;
        }
    }
    
    // Switch timer to opponent
    timer.activeTimer = playerColor === 'black' ? 'white' : 'black';
    timer.lastMoveTime = now;
    
    console.log(`[Timer] Move by ${playerColor} in room ${roomCode}. Black: ${Math.round(timer.blackTime/1000)}s, White: ${Math.round(timer.whiteTime/1000)}s`);
    
    return getRoomTimerState(roomCode);
}

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Get list of waiting rooms for the lobby
    socket.on('get-room-list', (callback) => {
        try {
            const waitingRooms = statements.getWaitingRooms.all();
            
            // Enrich room data with player info
            const roomList = waitingRooms.map(room => {
                const creatorInfo = roomPlayerInfo.get(`${room.room_code}:black`) || { name: 'Guest', elo: null, isGuest: true };
                return {
                    roomCode: room.room_code,
                    timeControl: room.time_control || 'classic',
                    creatorName: creatorInfo.name || 'Guest',
                    creatorElo: creatorInfo.elo,
                    isGuest: creatorInfo.isGuest !== false,
                    createdAt: room.created_at
                };
            });
            
            console.log(`[Room List] Returning ${roomList.length} waiting rooms`);
            callback({ success: true, rooms: roomList });
        } catch (err) {
            console.error('Get room list error:', err);
            callback({ success: false, error: err.message, rooms: [] });
        }
    });

    // Create a new room
    socket.on('create-room', (data, callback) => {
        try {
            const { playerId, userInfo, timeControl } = data;
            
            // Check if this player already has a room - clean it up first
            const existingPlayer = statements.getPlayer.get(playerId);
            if (existingPlayer) {
                const existingRoom = statements.getRoom.get(existingPlayer.room_code);
                if (existingRoom) {
                    // Clean up any existing room (waiting or playing)
                    const oldRoomCode = existingPlayer.room_code;
                    const wasWaiting = existingRoom.status === 'waiting';
                    
                    db.prepare(`DELETE FROM players WHERE player_id = ?`).run(playerId);
                    const remainingPlayers = statements.getPlayersInRoom.all(oldRoomCode);
                    
                    if (remainingPlayers.length === 0) {
                        statements.deleteRoom.run(oldRoomCode);
                        roomTimers.delete(oldRoomCode);
                        roomPlayerInfo.delete(`${oldRoomCode}:black`);
                        roomPlayerInfo.delete(`${oldRoomCode}:white`);
                        if (wasWaiting) {
                            io.emit('room-cancelled', { roomCode: oldRoomCode });
                        }
                        console.log(`Cleaned up existing room ${oldRoomCode} for player ${playerId}`);
                    } else {
                        // Notify remaining player that opponent left
                        socket.to(oldRoomCode).emit('opponent-left');
                    }
                }
            }
            
            const roomCode = getUniqueRoomCode();
            const initialState = getInitialGameState();
            const roomTimeControl = timeControl || 'classic';

            // Create room in database with time control
            statements.createRoom.run(roomCode, playerId, JSON.stringify(initialState));
            
            // Update time control
            db.prepare('UPDATE rooms SET time_control = ? WHERE room_code = ?').run(roomTimeControl, roomCode);
            
            // Initialize timer for this room
            initRoomTimer(roomCode, roomTimeControl);
            
            // Create player record
            statements.createPlayer.run(playerId, socket.id, roomCode, 'black');

            // Store user info for this room
            roomPlayerInfo.set(`${roomCode}:black`, userInfo || { name: 'Guest', elo: null, isGuest: true });

            // Join socket room
            socket.join(roomCode);

            // Get initial timer state
            const timerState = getRoomTimerState(roomCode);

            // Get creator info for the room-created broadcast
            const creatorInfo = roomPlayerInfo.get(`${roomCode}:black`);

            console.log(`Room ${roomCode} created by player ${playerId} with time control ${roomTimeControl}`);

            // Broadcast to all clients that a new room is available
            socket.broadcast.emit('room-created', {
                roomCode,
                timeControl: roomTimeControl,
                creatorName: creatorInfo?.name || 'Guest',
                creatorElo: creatorInfo?.elo,
                isGuest: creatorInfo?.isGuest !== false,
                createdAt: new Date().toISOString()
            });

            callback({
                success: true,
                roomCode,
                color: 'black',
                gameState: initialState,
                timeControl: roomTimeControl,
                timerState,
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
            const { roomCode, playerId, userInfo } = data;
            const room = statements.getRoom.get(roomCode.toUpperCase());

            if (!room) {
                return callback({ success: false, error: 'Room not found' });
            }

            // Check if player is trying to join their own room
            if (room.created_by === playerId) {
                return callback({ success: false, error: "Can't join your own room" });
            }

            // Check if player is reconnecting
            const existingPlayer = statements.getPlayer.get(playerId);
            if (existingPlayer && existingPlayer.room_code === roomCode.toUpperCase()) {
                // Reconnecting to same room
                statements.updatePlayerSocket.run(socket.id, playerId);
                socket.join(roomCode.toUpperCase());

                const gameState = JSON.parse(room.game_state);
                
                // Get opponent info
                const opponentColor = existingPlayer.color === 'black' ? 'white' : 'black';
                const opponentInfo = roomPlayerInfo.get(`${roomCode.toUpperCase()}:${opponentColor}`);
                
                // Notify other player of reconnection
                socket.to(roomCode.toUpperCase()).emit('opponent-reconnected');

                // Get current timer state
                const timerState = getRoomTimerState(roomCode.toUpperCase());

                console.log(`Player ${playerId} reconnected to room ${roomCode}`);

                return callback({
                    success: true,
                    roomCode: roomCode.toUpperCase(),
                    color: existingPlayer.color,
                    gameState,
                    reconnected: true,
                    opponentConnected: room.status === 'playing',
                    opponentInfo,
                    timeControl: room.time_control || 'classic',
                    timerState
                });
            }
            
            // If player has an existing waiting room, cancel it before joining another
            if (existingPlayer) {
                const existingRoom = statements.getRoom.get(existingPlayer.room_code);
                if (existingRoom && existingRoom.status === 'waiting') {
                    const oldRoomCode = existingPlayer.room_code;
                    db.prepare(`DELETE FROM players WHERE player_id = ?`).run(playerId);
                    const remainingPlayers = statements.getPlayersInRoom.all(oldRoomCode);
                    if (remainingPlayers.length === 0) {
                        statements.deleteRoom.run(oldRoomCode);
                        roomTimers.delete(oldRoomCode);
                        roomPlayerInfo.delete(`${oldRoomCode}:black`);
                        roomPlayerInfo.delete(`${oldRoomCode}:white`);
                        io.emit('room-cancelled', { roomCode: oldRoomCode });
                        console.log(`Cancelled room ${oldRoomCode} - player ${playerId} joining another room`);
                    }
                    socket.leave(oldRoomCode);
                }
            }

            // Check if room is full
            if (room.status === 'playing') {
                return callback({ success: false, error: 'Room is full' });
            }

            // Join as white player
            statements.updateRoom.run(playerId, 'playing', roomCode.toUpperCase());
            statements.createPlayer.run(playerId, socket.id, roomCode.toUpperCase(), 'white');
            
            // Store white player's user info
            const whiteUserInfo = userInfo || { name: 'Guest', elo: null, isGuest: true };
            roomPlayerInfo.set(`${roomCode.toUpperCase()}:white`, whiteUserInfo);

            socket.join(roomCode.toUpperCase());

            const gameState = JSON.parse(room.game_state);

            // Get black player's info
            const blackPlayerInfo = roomPlayerInfo.get(`${roomCode.toUpperCase()}:black`);

            // Get timer state
            const timerState = getRoomTimerState(roomCode.toUpperCase());

            // Notify black player that opponent joined (with opponent's info and timer state)
            socket.to(roomCode.toUpperCase()).emit('opponent-joined', {
                gameState,
                opponentInfo: whiteUserInfo,
                timerState
            });

            // Broadcast to all clients that this room is no longer available
            io.emit('room-filled', { roomCode: roomCode.toUpperCase() });

            console.log(`Player ${playerId} joined room ${roomCode} as white with time control ${room.time_control}`);

            callback({
                success: true,
                roomCode: roomCode.toUpperCase(),
                color: 'white',
                gameState,
                waiting: false,
                opponentInfo: blackPlayerInfo,
                timeControl: room.time_control || 'classic',
                timerState
            });
        } catch (err) {
            console.error('Join room error:', err);
            callback({ success: false, error: err.message });
        }
    });

    // Handle move
    socket.on('make-move', (data, callback) => {
        try {
            const { roomCode, playerId, gameState, previousState, jumpPath } = data;
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

            // Process timer for this move
            const timerState = processTimerMove(roomCode, player.color);
            
            // Check for timeout
            if (timerState) {
                if (timerState.blackTime <= 0 || timerState.whiteTime <= 0) {
                    const loser = timerState.blackTime <= 0 ? 'black' : 'white';
                    const winner = loser === 'black' ? 'white' : 'black';
                    
                    // Broadcast timeout to both players
                    io.to(roomCode).emit('game-timeout', {
                        winner,
                        loser,
                        timerState
                    });
                    
                    console.log(`Game in room ${roomCode} ended: ${loser} ran out of time`);
                    return callback({ success: true, timerState, timeout: true, winner });
                }
            }

            // Update game state in database
            statements.updateGameState.run(
                JSON.stringify(gameState),
                gameState.activePlayer,
                roomCode
            );

            // Broadcast move to opponent (includes jumpPath for multi-jump highlighting and timer state)
            socket.to(roomCode).emit('opponent-moved', {
                gameState,
                previousState,
                jumpPath,
                timerState
            });

            console.log(`Move in room ${roomCode} by ${player.color}`);

            callback({ success: true, timerState });
        } catch (err) {
            console.error('Move error:', err);
            callback({ success: false, error: err.message });
        }
    });

    // Handle game ended - process ELO changes
    socket.on('game-ended', (data, callback) => {
        try {
            const { roomCode, winnerColor, reason, isDraw } = data;
            
            console.log(`[ELO] Game ended in room ${roomCode}: winner=${winnerColor}, isDraw=${isDraw}, reason=${reason}`);
            
            // Process ELO changes
            const eloResult = processGameResult(roomCode, winnerColor, isDraw);
            
            // Get player info to identify who is who
            const blackInfo = roomPlayerInfo.get(`${roomCode}:black`);
            const whiteInfo = roomPlayerInfo.get(`${roomCode}:white`);
            
            // Emit ELO updates to each player individually
            // Each player only sees their own ELO change
            const blackPlayer = statements.getPlayersInRoom.all(roomCode).find(p => p.color === 'black');
            const whitePlayer = statements.getPlayersInRoom.all(roomCode).find(p => p.color === 'white');
            
            if (blackPlayer) {
                io.to(blackPlayer.socket_id).emit('elo-updated', {
                    oldElo: eloResult.black.oldElo,
                    newElo: eloResult.black.newElo,
                    change: eloResult.black.change,
                    isGuest: eloResult.black.isGuest
                });
            }
            
            if (whitePlayer) {
                io.to(whitePlayer.socket_id).emit('elo-updated', {
                    oldElo: eloResult.white.oldElo,
                    newElo: eloResult.white.newElo,
                    change: eloResult.white.change,
                    isGuest: eloResult.white.isGuest
                });
            }
            
            console.log(`[ELO] Results - Black: ${eloResult.black.oldElo} -> ${eloResult.black.newElo} (${eloResult.black.change > 0 ? '+' : ''}${eloResult.black.change}), White: ${eloResult.white.oldElo} -> ${eloResult.white.newElo} (${eloResult.white.change > 0 ? '+' : ''}${eloResult.white.change})`);
            
            callback({ success: true });
        } catch (err) {
            console.error('Game ended error:', err);
            callback({ success: false, error: err.message });
        }
    });

    // Handle resign
    socket.on('resign', (data, callback) => {
        try {
            const { roomCode, playerId } = data;
            const player = statements.getPlayer.get(playerId);
            
            if (!player || player.room_code !== roomCode) {
                return callback({ success: false, error: 'Invalid player' });
            }
            
            const winnerColor = player.color === 'black' ? 'white' : 'black';
            
            // Notify opponent that player resigned
            socket.to(roomCode).emit('opponent-resigned', {
                resignedColor: player.color,
                winnerColor
            });
            
            console.log(`Player ${playerId} (${player.color}) resigned in room ${roomCode}`);
            
            callback({ success: true, winnerColor });
        } catch (err) {
            console.error('Resign error:', err);
            callback({ success: false, error: err.message });
        }
    });

    // Handle draw proposal
    socket.on('propose-draw', (data, callback) => {
        try {
            const { roomCode, playerId } = data;
            const player = statements.getPlayer.get(playerId);
            
            if (!player || player.room_code !== roomCode) {
                return callback({ success: false, error: 'Invalid player' });
            }
            
            // Get proposer's name
            const proposerInfo = roomPlayerInfo.get(`${roomCode}:${player.color}`);
            const proposerName = proposerInfo?.name || 'Opponent';
            
            // Notify opponent of draw proposal
            socket.to(roomCode).emit('draw-proposed', {
                proposerColor: player.color,
                proposerName
            });
            
            console.log(`Player ${playerId} (${player.color}) proposed draw in room ${roomCode}`);
            
            callback({ success: true });
        } catch (err) {
            console.error('Propose draw error:', err);
            callback({ success: false, error: err.message });
        }
    });

    // Handle draw response (accept or decline)
    socket.on('respond-draw', (data, callback) => {
        try {
            const { roomCode, playerId, accepted } = data;
            const player = statements.getPlayer.get(playerId);
            
            if (!player || player.room_code !== roomCode) {
                return callback({ success: false, error: 'Invalid player' });
            }
            
            if (accepted) {
                // Notify both players that draw was accepted
                io.to(roomCode).emit('draw-accepted');
                console.log(`Draw accepted in room ${roomCode}`);
            } else {
                // Get decliner's name
                const declinerInfo = roomPlayerInfo.get(`${roomCode}:${player.color}`);
                const declinerName = declinerInfo?.name || 'Opponent';
                
                // Notify proposer that draw was declined
                socket.to(roomCode).emit('draw-declined', {
                    declinerName
                });
                console.log(`Draw declined by ${player.color} in room ${roomCode}`);
            }
            
            callback({ success: true });
        } catch (err) {
            console.error('Respond draw error:', err);
            callback({ success: false, error: err.message });
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        try {
            const player = statements.getPlayerBySocket.get(socket.id);
            if (player) {
                const roomCode = player.room_code;
                const room = statements.getRoom.get(roomCode);
                
                // Mark player as disconnected
                statements.disconnectPlayer.run(socket.id);
                
                // If room was waiting (no opponent yet), clean it up completely
                if (room && room.status === 'waiting') {
                    db.prepare(`DELETE FROM players WHERE player_id = ?`).run(player.player_id);
                    const remainingPlayers = statements.getPlayersInRoom.all(roomCode);
                    if (remainingPlayers.length === 0) {
                        statements.deleteRoom.run(roomCode);
                        roomTimers.delete(roomCode);
                        roomPlayerInfo.delete(`${roomCode}:black`);
                        roomPlayerInfo.delete(`${roomCode}:white`);
                        io.emit('room-cancelled', { roomCode });
                        console.log(`Room ${roomCode} cancelled - creator disconnected while waiting`);
                    }
                } else if (room && room.status === 'playing') {
                    // Active game - check if moves were made (abandonment)
                    const gameState = JSON.parse(room.game_state);
                    if (hasGameStarted(gameState)) {
                        // Treat as abandonment - process ELO
                        const winnerColor = player.color === 'black' ? 'white' : 'black';
                        const eloResult = processGameResult(roomCode, winnerColor, false);
                        
                        // Notify opponent they won by abandonment
                        socket.to(roomCode).emit('opponent-resigned', {
                            resignedColor: player.color,
                            winnerColor,
                            reason: 'abandonment'
                        });
                        
                        // Send ELO update to remaining player
                        const remainingPlayers = statements.getPlayersInRoom.all(roomCode);
                        const winner = remainingPlayers.find(p => p.color === winnerColor);
                        if (winner && eloResult) {
                            const winnerEloChange = eloResult[winnerColor]?.change || 0;
                            const winnerNewElo = eloResult[winnerColor]?.newElo;
                            const winnerOldElo = eloResult[winnerColor]?.oldElo;
                            const winnerIsGuest = eloResult[winnerColor]?.isGuest;
                            
                            if (!winnerIsGuest && winnerNewElo !== null) {
                                io.to(winner.socket_id).emit('elo-updated', {
                                    oldElo: winnerOldElo,
                                    newElo: winnerNewElo,
                                    change: winnerEloChange,
                                    result: 'win'
                                });
                            }
                        }
                        
                        console.log(`Player ${player.player_id} (${player.color}) abandoned game in room ${roomCode}`);
                    } else {
                        // No moves made yet - game ends with no consequences
                        socket.to(roomCode).emit('game-cancelled-early', {
                            reason: 'Opponent has left the game before any moves were made.'
                        });
                        console.log(`Player ${player.player_id} left before moves - game cancelled without penalty`);
                    }
                } else {
                    // Notify opponent of disconnect (for other cases)
                    socket.to(roomCode).emit('opponent-disconnected');
                }
                
                console.log(`Player ${player.player_id} disconnected from room ${roomCode}`);
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
                // Check if room was in waiting status (to broadcast room-cancelled)
                const room = statements.getRoom.get(roomCode);
                const wasWaiting = room && room.status === 'waiting';
                const wasPlaying = room && room.status === 'playing';
                
                // Check if game had moves - treat as abandonment
                if (wasPlaying && room.game_state) {
                    const gameState = JSON.parse(room.game_state);
                    if (hasGameStarted(gameState)) {
                        // Treat as abandonment - process ELO
                        const winnerColor = player.color === 'black' ? 'white' : 'black';
                        const eloResult = processGameResult(roomCode, winnerColor, false);
                        
                        // Notify opponent they won by abandonment
                        socket.to(roomCode).emit('opponent-resigned', {
                            resignedColor: player.color,
                            winnerColor,
                            reason: 'abandonment'
                        });
                        
                        // Send ELO update to remaining player
                        const remainingPlayersBeforeDelete = statements.getPlayersInRoom.all(roomCode);
                        const winner = remainingPlayersBeforeDelete.find(p => p.color === winnerColor);
                        if (winner && eloResult) {
                            const winnerEloChange = eloResult[winnerColor]?.change || 0;
                            const winnerNewElo = eloResult[winnerColor]?.newElo;
                            const winnerOldElo = eloResult[winnerColor]?.oldElo;
                            const winnerIsGuest = eloResult[winnerColor]?.isGuest;
                            
                            if (!winnerIsGuest && winnerNewElo !== null) {
                                io.to(winner.socket_id).emit('elo-updated', {
                                    oldElo: winnerOldElo,
                                    newElo: winnerNewElo,
                                    change: winnerEloChange,
                                    result: 'win'
                                });
                            }
                        }
                        
                        console.log(`Player ${playerId} (${player.color}) abandoned game in room ${roomCode}`);
                    } else {
                        // No moves made yet - game ends with no consequences
                        socket.to(roomCode).emit('game-cancelled-early', {
                            reason: 'Opponent has left the game before any moves were made.'
                        });
                        console.log(`Player ${playerId} left before moves - game cancelled without penalty`);
                    }
                }
                
                // Remove player
                db.prepare(`DELETE FROM players WHERE player_id = ?`).run(playerId);
                
                if (room) {
                    // If both players left, delete room
                    const remainingPlayers = statements.getPlayersInRoom.all(roomCode);
                    if (remainingPlayers.length === 0) {
                        statements.deleteRoom.run(roomCode);
                        // Clean up timer state
                        roomTimers.delete(roomCode);
                        roomPlayerInfo.delete(`${roomCode}:black`);
                        roomPlayerInfo.delete(`${roomCode}:white`);
                        
                        // Broadcast that room is no longer available
                        if (wasWaiting) {
                            io.emit('room-cancelled', { roomCode });
                        }
                        
                        console.log(`Room ${roomCode} deleted - no players remaining`);
                    } else if (!wasPlaying) {
                        // Only send opponent-left if not already handled as abandonment
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

    // Request rematch after game ends
    socket.on('request-rematch', (data, callback) => {
        try {
            const { roomCode, playerId } = data;
            const room = statements.getRoom.get(roomCode);
            
            if (!room) {
                return callback({ success: false, error: 'Room not found' });
            }

            const player = statements.getPlayer.get(playerId);
            if (!player || player.room_code !== roomCode) {
                return callback({ success: false, error: 'Invalid player' });
            }

            // Notify opponent that this player is ready for rematch
            socket.to(roomCode).emit('opponent-ready-rematch', {
                color: player.color
            });

            console.log(`Player ${playerId} (${player.color}) requested rematch in room ${roomCode}`);

            callback({ success: true });
        } catch (err) {
            console.error('Request rematch error:', err);
            callback({ success: false, error: err.message });
        }
    });

    // Start new game (both players ready)
    socket.on('start-rematch', (data, callback) => {
        try {
            const { roomCode, playerId } = data;
            const room = statements.getRoom.get(roomCode);
            
            if (!room) {
                return callback({ success: false, error: 'Room not found' });
            }

            const player = statements.getPlayer.get(playerId);
            if (!player || player.room_code !== roomCode) {
                return callback({ success: false, error: 'Invalid player' });
            }

            // Reset game state to initial
            const initialState = getInitialGameState();
            statements.updateGameState.run(
                JSON.stringify(initialState),
                'black',
                roomCode
            );

            // Notify both players to start new game
            io.to(roomCode).emit('game-reset', {
                gameState: initialState
            });

            console.log(`Rematch started in room ${roomCode}`);

            callback({ success: true, gameState: initialState });
        } catch (err) {
            console.error('Start rematch error:', err);
            callback({ success: false, error: err.message });
        }
    });

    // Notify when a player leaves during end game screen
    socket.on('leave-endgame', (data, callback) => {
        try {
            const { roomCode, playerId } = data;
            const player = statements.getPlayer.get(playerId);
            
            if (player && player.room_code === roomCode) {
                // Notify opponent that this player left
                socket.to(roomCode).emit('opponent-left-endgame');
                
                console.log(`Player ${playerId} left endgame screen in room ${roomCode}`);
            }

            callback({ success: true });
        } catch (err) {
            console.error('Leave endgame error:', err);
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
