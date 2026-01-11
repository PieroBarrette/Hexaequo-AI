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
const matchmakingService = require('../services/matchmakingService');
const invitationService = require('../services/invitationService');
const { User } = require('../models');

// Track connected sockets
const connectedSockets = new Map(); // socketId -> { userId, pseudo, roomCode }

/**
 * Initialize Socket.IO with the HTTP server
 */
function initializeSocket(httpServer) {
    console.log('🔌 Initializing Socket.IO server...');
    
    // Debug: log the FRONTEND_URL being used
    console.log('🔌 FRONTEND_URL from env:', FRONTEND_URL);
    
    const allowedOrigins = [
        FRONTEND_URL,
        'https://hexaequo.com',
        'https://www.hexaequo.com',
        'http://hexaequo.com',
        'http://www.hexaequo.com',
        'https://hexaequo-server.onrender.com',
        'https://pierobarrette.github.io',
        'http://localhost:8080',
        'http://localhost:5500',
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:8080',
        'http://127.0.0.1:5500',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001'
    ];
    
    console.log('🔌 Allowed CORS origins:', allowedOrigins);
    
    const io = new Server(httpServer, {
        path: '/socket.io/',
        cors: {
            origin: allowedOrigins,
            methods: ['GET', 'POST'],
            credentials: true,
            allowedHeaders: ['Content-Type', 'Authorization']
        },
        // Allow both transports - polling as fallback for WebSocket issues
        transports: ['polling', 'websocket'],
        // Longer timeouts for Render's cold starts
        pingTimeout: 120000,
        pingInterval: 25000,
        // Allow upgrades from polling to websocket
        allowUpgrades: true,
        // Required for Render.com and Socket.IO v3+ compatibility
        allowEIO3: true,
        // Serve client files (helps with debugging)
        serveClient: false
    });

    console.log('✅ Socket.IO server created with CORS origins:', allowedOrigins.length, 'origins');
    console.log('✅ Socket.IO transports:', io.engine.opts.transports);
    console.log('✅ Socket.IO path:', io.path());

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
            userId: playerId,
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

        // ===== Resign / Draw =====

        /**
         * Player resigns
         */
        socket.on('resign', async (data, callback) => {
            try {
                const { roomCode, playerId, playerColor } = data;
                
                const room = await roomService.getByCode(roomCode);
                if (!room) {
                    return callback({ success: false, error: 'Room not found' });
                }

                // Determine winner (opposite color of resigning player)
                const winnerColor = playerColor === 'black' ? 'white' : 'black';
                
                // Notify opponent
                socket.to(roomCode).emit('opponent-resigned', {
                    winnerColor,
                    resignedColor: playerColor
                });

                // Update room status
                await roomService.updateStatus(roomCode, 'finished');
                
                console.log(`Player ${playerColor} resigned in room ${roomCode}`);

                callback({ success: true, winnerColor });
            } catch (err) {
                console.error('Resign error:', err);
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Player proposes a draw
         */
        socket.on('propose-draw', async (data, callback) => {
            try {
                const { roomCode, playerId, playerColor } = data;
                
                const room = await roomService.getByCode(roomCode);
                if (!room) {
                    return callback({ success: false, error: 'Room not found' });
                }

                // Notify opponent of draw proposal
                socket.to(roomCode).emit('draw-proposed', {
                    proposedBy: playerColor
                });

                console.log(`Player ${playerColor} proposed draw in room ${roomCode}`);

                callback({ success: true });
            } catch (err) {
                console.error('Propose draw error:', err);
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Player accepts a draw proposal
         */
        socket.on('accept-draw', async (data, callback) => {
            try {
                const { roomCode, playerId, playerColor } = data;
                
                const room = await roomService.getByCode(roomCode);
                if (!room) {
                    return callback({ success: false, error: 'Room not found' });
                }

                // Notify opponent that draw was accepted
                socket.to(roomCode).emit('draw-accepted');

                // Update room status
                await roomService.updateStatus(roomCode, 'finished');
                
                console.log(`Draw accepted in room ${roomCode}`);

                callback({ success: true, isDraw: true });
            } catch (err) {
                console.error('Accept draw error:', err);
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Player declines a draw proposal
         */
        socket.on('decline-draw', async (data, callback) => {
            try {
                const { roomCode, playerId, playerColor } = data;
                
                const room = await roomService.getByCode(roomCode);
                if (!room) {
                    return callback({ success: false, error: 'Room not found' });
                }

                // Notify opponent that draw was declined
                socket.to(roomCode).emit('draw-declined');

                console.log(`Draw declined by ${playerColor} in room ${roomCode}`);

                callback({ success: true });
            } catch (err) {
                console.error('Decline draw error:', err);
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

            // Remove from matchmaking queue on disconnect
            await matchmakingService.leaveQueue(socket.userId, socket.id);

            connectedSockets.delete(socket.id);
            console.log(`Client disconnected: ${socket.id}`);
        });

        // ===== Matchmaking (Phase 2) =====

        /**
         * Join matchmaking queue
         * Event-driven: immediately searches for a match when joining
         */
        socket.on('join-matchmaking-queue', async (data, callback) => {
            try {
                const { timeMode, elo, preferences } = data;
                const pseudo = socket.pseudo || data.pseudo || 'Guest';
                const userElo = elo || 1000; // Default ELO
                
                console.log(`[Matchmaking] ${pseudo} joining queue - timeMode: ${timeMode}, elo: ${userElo}`);
                
                const result = await matchmakingService.joinQueue(
                    socket.userId,
                    socket.id,
                    pseudo,
                    userElo,
                    timeMode || 'classic',
                    preferences || {}
                );
                
                if (result.matched) {
                    // Match found! Notify both players
                    const { room, opponent } = result;
                    
                    // Get opponent's socket
                    const opponentSocket = io.sockets.sockets.get(opponent.socketId);
                    
                    if (opponentSocket) {
                        // Opponent is the host (black) - they were waiting longer
                        opponentSocket.join(result.roomCode);
                        opponentSocket.emit('match-found', {
                            roomCode: result.roomCode,
                            color: 'black',
                            gameState: room.gameState,
                            timeMode: room.timeMode,
                            opponentInfo: {
                                name: pseudo,
                                elo: userElo,
                                isGuest: !socket.userId
                            }
                        });
                    }
                    
                    // Current player is the guest (white) - they triggered the match
                    socket.join(result.roomCode);
                    
                    // Update socket tracking
                    const socketInfo = connectedSockets.get(socket.id);
                    if (socketInfo) socketInfo.roomCode = result.roomCode;
                    
                    callback({
                        success: true,
                        matched: true,
                        roomCode: result.roomCode,
                        color: 'white',
                        gameState: room.gameState,
                        timeMode: room.timeMode,
                        opponentInfo: {
                            name: opponent.pseudo,
                            elo: opponent.elo,
                            isGuest: !opponent.userId
                        }
                    });
                } else {
                    // No match yet, player is in queue
                    callback({
                        success: true,
                        matched: false,
                        inQueue: true,
                        position: result.queueEntry?.position
                    });
                }
            } catch (err) {
                console.error('[Matchmaking] Join queue error:', err);
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Leave matchmaking queue
         */
        socket.on('leave-matchmaking-queue', async (data, callback) => {
            try {
                const removed = await matchmakingService.leaveQueue(socket.userId, socket.id);
                console.log(`[Matchmaking] ${socket.pseudo || 'Guest'} left queue`);
                callback({ success: true, removed });
            } catch (err) {
                console.error('[Matchmaking] Leave queue error:', err);
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Get matchmaking queue status
         */
        socket.on('matchmaking-status', async (data, callback) => {
            try {
                const status = await matchmakingService.getQueueStatus(socket.userId, socket.id);
                callback({ success: true, ...status });
            } catch (err) {
                console.error('[Matchmaking] Status error:', err);
                callback({ success: false, error: err.message });
            }
        });

        // ===== Invitations (Phase 2) =====

        /**
         * Create invitation link
         */
        socket.on('create-invitation', async (data, callback) => {
            try {
                const { timeMode, allowSpectators } = data;
                const pseudo = socket.pseudo || data.pseudo || 'Guest';
                
                const roomSettings = {
                    timeMode: timeMode || 'classic',
                    allowSpectators: allowSpectators !== false
                };
                
                const invitation = await invitationService.createInvitation(
                    socket.userId,
                    pseudo,
                    roomSettings
                );
                
                console.log(`[Invitation] Created by ${pseudo}: ${invitation.code}`);
                
                callback({
                    success: true,
                    code: invitation.code,
                    url: invitation.url,
                    expiresAt: invitation.expiresAt
                });
            } catch (err) {
                console.error('[Invitation] Create error:', err);
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Get invitation info (before accepting)
         */
        socket.on('get-invitation-info', async (data, callback) => {
            try {
                const { code } = data;
                const info = await invitationService.getInvitationInfo(code);
                
                if (!info.valid) {
                    return callback({ success: false, error: info.reason });
                }
                
                callback({
                    success: true,
                    creatorPseudo: info.creatorPseudo,
                    timeMode: info.timeMode,
                    expiresAt: info.expiresAt
                });
            } catch (err) {
                console.error('[Invitation] Get info error:', err);
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Accept invitation and join game
         */
        socket.on('accept-invitation', async (data, callback) => {
            try {
                const { code } = data;
                const pseudo = socket.pseudo || data.pseudo || 'Guest';
                
                const result = await invitationService.acceptInvitation(
                    code,
                    socket.userId,
                    pseudo,
                    socket.id
                );
                
                if (!result.valid) {
                    return callback({ success: false, error: result.error });
                }
                
                console.log(`[Invitation] ${pseudo} accepted invitation ${code} → room ${result.roomCode}`);
                
                // Join the room as guest (white)
                const room = await roomService.joinRoom(result.roomCode, {
                    guestId: socket.userId,
                    guestPseudo: pseudo,
                    guestSocketId: socket.id
                });
                
                socket.join(result.roomCode);
                
                // Update socket tracking
                const socketInfo = connectedSockets.get(socket.id);
                if (socketInfo) socketInfo.roomCode = result.roomCode;
                
                // Notify the host if they're connected
                socket.to(result.roomCode).emit('opponent-joined', {
                    pseudo,
                    isGuest: !socket.userId
                });
                
                callback({
                    success: true,
                    roomCode: result.roomCode,
                    color: 'white',
                    timeMode: result.timeMode,
                    gameState: room.gameState,
                    opponentInfo: {
                        name: result.creatorPseudo,
                        isGuest: !result.creatorId
                    }
                });
            } catch (err) {
                console.error('[Invitation] Accept error:', err);
                callback({ success: false, error: err.message });
            }
        });

        /**
         * Cancel invitation
         */
        socket.on('cancel-invitation', async (data, callback) => {
            try {
                const { code } = data;
                const cancelled = await invitationService.cancelInvitation(code, socket.userId);
                callback({ success: true, cancelled });
            } catch (err) {
                console.error('[Invitation] Cancel error:', err);
                callback({ success: false, error: err.message });
            }
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
