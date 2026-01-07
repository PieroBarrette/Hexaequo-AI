/**
 * Socket.IO Handler
 * 
 * Real-time WebSocket communication for multiplayer games.
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, FRONTEND_URL } = require('../config/env');
const roomService = require('../services/roomService');
const gameService = require('../services/gameService');
const { User } = require('../models');

// Track connected sockets
const connectedSockets = new Map(); // socketId -> { userId, pseudo, roomCode }

/**
 * Initialize Socket.IO with the HTTP server
 */
function initializeSocket(httpServer) {
    const io = new Server(httpServer, {
        cors: {
            origin: [
                FRONTEND_URL,
                'https://hexaequo.com',
                'https://www.hexaequo.com',
                'http://hexaequo.com',
                'http://www.hexaequo.com',
                'https://hexaequo-backend.onrender.com',
                'https://pierobarrette.github.io',
                'http://localhost:8080',
                'http://localhost:5500',
                'http://localhost:3000',
                'http://localhost:3001',
                'http://127.0.0.1:8080',
                'http://127.0.0.1:5500',
                'http://127.0.0.1:3000',
                'http://127.0.0.1:3001'
            ],
            methods: ['GET', 'POST'],
            credentials: true
        },
        // Allow both transports - polling as fallback for WebSocket issues
        transports: ['polling', 'websocket'],
        // Longer timeouts for Render's cold starts
        pingTimeout: 120000,
        pingInterval: 25000,
        // Allow upgrades from polling to websocket
        allowUpgrades: true,
        // Required for Render.com
        allowEIO3: true
    });

    // Optional authentication middleware
    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token;
        
        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                socket.userId = decoded.userId;
                socket.pseudo = decoded.pseudo;
            } catch (err) {
                // Token invalid but allow anonymous connections
                socket.userId = null;
                socket.pseudo = null;
            }
        }
        
        // Generate guest ID if not authenticated
        if (!socket.userId) {
            socket.guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }
        
        next();
    });

    io.on('connection', (socket) => {
        const playerId = socket.userId || socket.guestId;
        console.log(`Client connected: ${socket.id} (${socket.pseudo || 'guest'})`);

        // Store socket info
        connectedSockets.set(socket.id, {
            oderId: playerId,
            pseudo: socket.pseudo || 'Guest',
            roomCode: null
        });

        // ===== Room Management =====

        /**
         * Create a new room
         */
        socket.on('create-room', async (data, callback) => {
            try {
                const { timeMode, allowSpectators } = data;
                const pseudo = socket.pseudo || data.pseudo || 'Guest';

                const room = await roomService.createRoom({
                    hostId: playerId,
                    hostPseudo: pseudo,
                    hostSocketId: socket.id,
                    timeMode: timeMode || 'none',
                    allowSpectators: allowSpectators !== false
                });

                // Join socket room
                socket.join(room.code);
                
                // Update socket tracking
                const socketInfo = connectedSockets.get(socket.id);
                if (socketInfo) socketInfo.roomCode = room.code;

                console.log(`Room ${room.code} created by ${pseudo}`);

                callback({
                    success: true,
                    roomCode: room.code,
                    color: 'black',
                    gameState: room.gameState,
                    waiting: true
                });
            } catch (err) {
                console.error('Create room error:', err);
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Join an existing room
         */
        socket.on('join-room', async (data, callback) => {
            try {
                const { roomCode } = data;
                const pseudo = socket.pseudo || data.pseudo || 'Guest';

                const room = await roomService.getRoomByCode(roomCode);
                
                if (!room) {
                    return callback({ success: false, error: 'Room not found' });
                }

                // Check if reconnecting as host
                if (room.host.id === playerId) {
                    await roomService.updateSocketId(roomCode, 'black', socket.id);
                    socket.join(roomCode);
                    
                    socket.to(roomCode).emit('opponent-reconnected');
                    
                    return callback({
                        success: true,
                        roomCode,
                        color: 'black',
                        gameState: room.gameState,
                        reconnected: true,
                        opponentConnected: !!room.guest
                    });
                }

                // Check if reconnecting as guest
                if (room.guest?.id === playerId) {
                    await roomService.updateSocketId(roomCode, 'white', socket.id);
                    socket.join(roomCode);
                    
                    socket.to(roomCode).emit('opponent-reconnected');
                    
                    return callback({
                        success: true,
                        roomCode,
                        color: 'white',
                        gameState: room.gameState,
                        reconnected: true,
                        opponentConnected: true
                    });
                }

                // Check if room is full
                if (room.status === 'playing') {
                    return callback({ success: false, error: 'Room is full' });
                }

                // Join as guest (white)
                await roomService.joinRoom(roomCode, {
                    guestId: playerId,
                    guestPseudo: pseudo,
                    guestSocketId: socket.id
                });

                socket.join(roomCode);
                
                // Update socket tracking
                const socketInfo = connectedSockets.get(socket.id);
                if (socketInfo) socketInfo.roomCode = roomCode;

                // Create game record
                const gameRecord = await gameService.createGame({
                    roomCode,
                    blackPlayerId: room.host.id,
                    blackPseudo: room.host.pseudo,
                    whitePlayerId: playerId,
                    whitePseudo: pseudo,
                    timeMode: room.timeMode
                });

                // Notify host that opponent joined
                socket.to(roomCode).emit('opponent-joined', {
                    gameState: room.gameState,
                    gameId: gameRecord.gameId,
                    opponent: {
                        pseudo,
                        color: 'white'
                    }
                });

                console.log(`${pseudo} joined room ${roomCode} as white`);

                callback({
                    success: true,
                    roomCode,
                    color: 'white',
                    gameState: room.gameState,
                    gameId: gameRecord.gameId,
                    waiting: false,
                    opponent: {
                        pseudo: room.host.pseudo,
                        color: 'black'
                    }
                });
            } catch (err) {
                console.error('Join room error:', err);
                callback({ success: false, error: err.message });
            }
        });

        // ===== Game Actions =====

        /**
         * Handle move
         */
        socket.on('make-move', async (data, callback) => {
            try {
                const { roomCode, gameState, previousState, jumpPath, moveData } = data;

                const room = await roomService.getRoomByCode(roomCode);
                if (!room) {
                    return callback({ success: false, error: 'Room not found' });
                }

                // Verify player is in this room
                const isHost = room.host.socketId === socket.id;
                const isGuest = room.guest?.socketId === socket.id;
                if (!isHost && !isGuest) {
                    return callback({ success: false, error: 'Not in this room' });
                }

                // Verify it's player's turn
                const playerColor = isHost ? 'black' : 'white';
                const currentState = room.gameState;
                if (currentState.activePlayer !== playerColor) {
                    return callback({ success: false, error: 'Not your turn' });
                }

                // Update game state
                await roomService.updateGameState(roomCode, gameState, gameState.activePlayer);

                // Record move in database if we have a gameId
                if (moveData && moveData.gameId) {
                    await gameService.recordMove(moveData.gameId, {
                        moveNumber: moveData.moveNumber,
                        player: playerColor,
                        moveType: moveData.type,
                        from: moveData.from,
                        to: moveData.to,
                        captures: moveData.captures,
                        stateSnapshot: gameState,
                        timeRemainingBlack: moveData.timeRemainingBlack,
                        timeRemainingWhite: moveData.timeRemainingWhite,
                        moveTime: moveData.moveTime
                    });
                }

                // Broadcast to opponent
                socket.to(roomCode).emit('opponent-moved', {
                    gameState,
                    previousState,
                    jumpPath
                });

                console.log(`Move in room ${roomCode} by ${playerColor}`);

                callback({ success: true });
            } catch (err) {
                console.error('Move error:', err);
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Game ended
         */
        socket.on('game-ended', async (data, callback) => {
            try {
                const { roomCode, gameId, winner, reason, finalState } = data;

                if (gameId) {
                    const result = await gameService.endGame(gameId, {
                        winner,
                        resultReason: reason,
                        finalState
                    });

                    // Broadcast result to room
                    io.to(roomCode).emit('game-result', {
                        winner,
                        reason,
                        eloChanges: result.eloChanges
                    });
                }

                await roomService.updateStatus(roomCode, 'finished');

                console.log(`Game ended in room ${roomCode}: ${winner} wins by ${reason}`);

                callback({ success: true });
            } catch (err) {
                console.error('Game ended error:', err);
                callback({ success: false, error: err.message });
            }
        });

        // ===== Rematch =====

        socket.on('request-rematch', async (data, callback) => {
            try {
                const { roomCode } = data;
                
                socket.to(roomCode).emit('opponent-ready-rematch');
                
                callback({ success: true });
            } catch (err) {
                console.error('Request rematch error:', err);
                callback({ success: false, error: err.message });
            }
        });

        socket.on('start-rematch', async (data, callback) => {
            try {
                const { roomCode } = data;
                
                const room = await roomService.resetForRematch(roomCode);
                
                if (room) {
                    io.to(roomCode).emit('game-reset', {
                        gameState: room.game_state
                    });
                }

                callback({ success: true, gameState: room?.game_state });
            } catch (err) {
                console.error('Start rematch error:', err);
                callback({ success: false, error: err.message });
            }
        });

        // ===== Spectating =====

        socket.on('spectate-room', async (data, callback) => {
            try {
                const { roomCode } = data;
                const pseudo = socket.pseudo || 'Spectator';

                const result = await roomService.joinAsSpectator(roomCode, {
                    userId: playerId,
                    socketId: socket.id,
                    pseudo
                });

                socket.join(roomCode);

                // Notify players
                socket.to(roomCode).emit('spectator-joined', { pseudo });

                callback({
                    success: true,
                    ...result
                });
            } catch (err) {
                console.error('Spectate error:', err);
                callback({ success: false, error: err.message });
            }
        });

        // ===== Room Status =====

        socket.on('room-status', async (data, callback) => {
            try {
                const { roomCode } = data;
                const room = await roomService.getRoomByCode(roomCode);
                
                if (!room) {
                    return callback({ success: false, error: 'Room not found' });
                }

                const spectatorCount = await roomService.getSpectatorCount(roomCode);

                callback({
                    success: true,
                    status: room.status,
                    players: {
                        black: { pseudo: room.host.pseudo, connected: !!room.host.socketId },
                        white: room.guest ? { pseudo: room.guest.pseudo, connected: !!room.guest.socketId } : null
                    },
                    spectators: spectatorCount,
                    gameState: room.gameState
                });
            } catch (err) {
                console.error('Room status error:', err);
                callback({ success: false, error: err.message });
            }
        });

        // ===== Leave/Disconnect =====

        socket.on('leave-room', async (data, callback) => {
            try {
                const { roomCode } = data;
                
                const result = await roomService.leaveRoom(roomCode, playerId);
                socket.leave(roomCode);

                if (!result?.deleted) {
                    socket.to(roomCode).emit('opponent-left');
                }

                // Update socket tracking
                const socketInfo = connectedSockets.get(socket.id);
                if (socketInfo) socketInfo.roomCode = null;

                console.log(`Player left room ${roomCode}`);

                callback({ success: true });
            } catch (err) {
                console.error('Leave room error:', err);
                callback({ success: false, error: err.message });
            }
        });

        socket.on('leave-endgame', (data, callback) => {
            const { roomCode } = data;
            socket.to(roomCode).emit('opponent-left-endgame');
            callback({ success: true });
        });

        socket.on('disconnect', async () => {
            const socketInfo = connectedSockets.get(socket.id);
            
            if (socketInfo?.roomCode) {
                socket.to(socketInfo.roomCode).emit('opponent-disconnected');
                
                // Also handle spectator disconnect
                await roomService.leaveAsSpectator(socket.id);
            }

            connectedSockets.delete(socket.id);
            console.log(`Client disconnected: ${socket.id}`);
        });

        // ===== Chat (optional) =====

        socket.on('chat-message', (data) => {
            const { roomCode, message } = data;
            const pseudo = socket.pseudo || 'Guest';
            
            socket.to(roomCode).emit('chat-message', {
                pseudo,
                message: message.substring(0, 200), // Limit message length
                timestamp: Date.now()
            });
        });
    });

    return io;
}

module.exports = { initializeSocket };
