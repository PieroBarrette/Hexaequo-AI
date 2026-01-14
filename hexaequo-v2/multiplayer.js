/**
 * Hexaequo Multiplayer Client Module
 * 
 * Handles WebSocket connection to the game server for online multiplayer.
 */

const Multiplayer = (function () {
    // Configuration
    // Port 3001: Backend with REST API + Socket.IO (PostgreSQL)
    const BACKEND_PORT = 3001;
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    // Production URL - Update this after deploying to Render
    const PRODUCTION_URL = 'https://hexaequo-server.onrender.com';
    
    const SERVER_URL = isLocalDev
        ? `http://localhost:${BACKEND_PORT}`
        : PRODUCTION_URL;

    // State
    let socket = null;
    let playerId = null;
    let roomCode = null;
    let playerColor = null;
    let isConnected = false;
    let isOnlineMode = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;

    // Callbacks
    let onOpponentJoined = null;
    let onOpponentMoved = null;
    let onOpponentDisconnected = null;
    let onOpponentReconnected = null;
    let onOpponentLeft = null;
    let onOpponentReadyRematch = null;
    let onOpponentLeftEndgame = null;
    let onGameReset = null;
    let onGameTimeout = null;
    let onEloUpdated = null;
    let onGameCancelledEarly = null;
    let onConnectionStatusChange = null;
    let onError = null;
    // Resign and draw callbacks
    let onOpponentResigned = null;
    let onDrawProposed = null;
    let onDrawAccepted = null;
    let onDrawDeclined = null;

    // Get or create player ID
    // Requires authenticated user - guests are no longer supported for online play
    function getPlayerId() {
        // Check if user is authenticated via GameLobby
        const currentUser = window.GameLobby?.getUser();
        if (currentUser && currentUser.id) {
            console.debug('[getPlayerId] Using authenticated user ID:', currentUser.id);
            return currentUser.id;
        }
        // No authenticated user - this shouldn't happen as online play requires sign-in
        console.warn('[getPlayerId] No authenticated user found');
        return null;
    }

    // Initialize Socket.IO connection
    function connect() {
        return new Promise((resolve, reject) => {
            if (socket && socket.connected) {
                resolve();
                return;
            }

            // Load Socket.IO client if not loaded
            if (typeof io === 'undefined') {
                const script = document.createElement('script');
                script.src = 'https://cdn.socket.io/4.8.1/socket.io.min.js';
                script.onload = () => initializeSocket(resolve, reject);
                script.onerror = () => reject(new Error('Failed to load Socket.IO'));
                document.head.appendChild(script);
            } else {
                initializeSocket(resolve, reject);
            }
        });
    }

    // Debug logging (enabled in production for multiplayer debugging)
    const DEBUG = true;
    function debugLog(...args) {
        if (DEBUG) {
            console.log('[Multiplayer Debug]', new Date().toISOString(), ...args);
        }
    }
    function debugError(...args) {
        if (DEBUG) {
            console.error('[Multiplayer Debug]', new Date().toISOString(), ...args);
        }
    }

    function initializeSocket(resolve, reject) {
        try {
            playerId = getPlayerId();
            
            debugLog('=== Socket.IO Connection Attempt ===');
            debugLog('Server URL:', SERVER_URL);
            debugLog('Current origin:', window.location.origin);
            debugLog('Is local dev:', isLocalDev);
            debugLog('Player ID:', playerId);
            
            // Test server reachability first
            debugLog('Testing server health endpoint...');
            fetch(`${SERVER_URL}/health`)
                .then(res => {
                    debugLog('Health check response:', res.status, res.statusText);
                    return res.json();
                })
                .then(data => debugLog('Health check data:', data))
                .catch(err => debugError('Health check failed:', err.message));
            
            // Get auth token for authenticated socket connection
            const authToken = localStorage.getItem('hexaequo_session');
            debugLog('Auth token present:', !!authToken);
            
            socket = io(SERVER_URL, {
                // Start with polling then upgrade to websocket (more reliable on cloud platforms)
                transports: ['polling', 'websocket'],
                upgrade: true,
                timeout: 20000,
                reconnection: true,
                reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
                reconnectionDelay: 1000,
                // Force new connection each time
                forceNew: true,
                // Explicit path
                path: '/socket.io/',
                // Pass auth token if available
                auth: authToken ? { token: authToken } : {}
            });
            
            debugLog('Socket.IO instance created, waiting for events...');

            socket.on('connect', () => {
                debugLog('✅ Connected successfully!');
                debugLog('Socket ID:', socket.id);
                debugLog('Transport:', socket.io.engine.transport.name);
                console.log('Connected to server');
                isConnected = true;
                reconnectAttempts = 0;
                if (onConnectionStatusChange) onConnectionStatusChange('connected');
                
                // If we have a room code, try to rejoin
                if (roomCode && playerColor) {
                    rejoinRoom();
                }
                
                resolve();
            });

            socket.on('disconnect', (reason) => {
                debugLog('❌ Disconnected:', reason);
                console.log('Disconnected from server');
                isConnected = false;
                if (onConnectionStatusChange) onConnectionStatusChange('disconnected');
            });

            socket.on('connect_error', (err) => {
                debugError('❌ Connection error:', err.message);
                debugError('Error type:', err.type);
                debugError('Error description:', err.description);
                debugError('Transport:', socket.io?.engine?.transport?.name || 'unknown');
                debugError('Reconnect attempts:', reconnectAttempts + 1, '/', MAX_RECONNECT_ATTEMPTS);
                
                // Log additional context for CORS issues
                if (err.message.includes('xhr') || err.message.includes('poll')) {
                    debugError('⚠️ Possible CORS issue detected');
                    debugError('Check that server allows origin:', window.location.origin);
                    debugError('Expected server CORS origins should include:', window.location.origin);
                }
                
                console.error('Connection error:', err);
                reconnectAttempts++;
                if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                    if (onError) onError('Unable to connect to server. Please try again later.');
                    reject(err);
                }
            });
            
            // Additional debug events
            socket.io.on('error', (err) => {
                debugError('Manager error:', err);
            });
            
            socket.io.on('reconnect_attempt', (attempt) => {
                debugLog('Reconnect attempt:', attempt);
            });
            
            socket.io.on('reconnect_failed', () => {
                debugError('❌ Reconnection failed after all attempts');
            });

            // Game events
            socket.on('opponent-joined', (data) => {
                console.log('Opponent joined');
                // Sync timer when opponent joins
                if (data.timerState && window.GameTimer) {
                    window.GameTimer.syncFromServer(data.timerState);
                }
                if (onOpponentJoined) onOpponentJoined(data);
            });

            socket.on('opponent-moved', (data) => {
                console.log('Opponent moved');
                // Sync timer from server
                if (data.timerState && window.GameTimer) {
                    window.GameTimer.syncFromServer(data.timerState);
                }
                if (onOpponentMoved) onOpponentMoved(data);
            });

            socket.on('game-timeout', (data) => {
                console.log('Game timeout:', data);
                // Sync final timer state
                if (data.timerState && window.GameTimer) {
                    window.GameTimer.syncFromServer(data.timerState);
                    window.GameTimer.stop();
                }
                if (onGameTimeout) onGameTimeout(data);
            });

            socket.on('opponent-disconnected', () => {
                console.log('Opponent disconnected');
                if (onOpponentDisconnected) onOpponentDisconnected();
            });

            socket.on('opponent-reconnected', () => {
                console.log('Opponent reconnected');
                if (onOpponentReconnected) onOpponentReconnected();
            });

            socket.on('opponent-left', () => {
                console.log('Opponent left');
                if (onOpponentLeft) onOpponentLeft();
            });

            socket.on('game-cancelled-early', (data) => {
                console.log('Game cancelled early - no moves made');
                if (onGameCancelledEarly) onGameCancelledEarly(data);
            });

            // Rematch events
            socket.on('opponent-ready-rematch', (data) => {
                console.log('Opponent ready for rematch');
                if (onOpponentReadyRematch) onOpponentReadyRematch(data);
            });

            socket.on('opponent-left-endgame', () => {
                console.log('Opponent left endgame screen');
                if (onOpponentLeftEndgame) onOpponentLeftEndgame();
            });

            socket.on('game-reset', (data) => {
                console.log('Game reset for rematch');
                if (onGameReset) onGameReset(data);
            });

            // ELO update after game end
            socket.on('elo-updated', (data) => {
                console.log('ELO updated:', data);
                if (onEloUpdated) onEloUpdated(data);
            });

            // Resign and draw events
            socket.on('opponent-resigned', (data) => {
                console.log('Opponent resigned');
                if (onOpponentResigned) onOpponentResigned(data);
            });

            socket.on('draw-proposed', (data) => {
                console.log('Draw proposed by opponent');
                if (onDrawProposed) onDrawProposed(data);
            });

            socket.on('draw-accepted', (data) => {
                console.log('Draw accepted');
                if (onDrawAccepted) onDrawAccepted(data);
            });

            socket.on('draw-declined', (data) => {
                console.log('Draw declined');
                if (onDrawDeclined) onDrawDeclined(data);
            });

            // Matchmaking events (Phase 2)
            socket.on('match-found', (data) => {
                console.log('Match found:', data.roomCode);
                roomCode = data.roomCode;
                playerColor = data.color;
                isOnlineMode = true;
                saveRoomInfo();
                
                // Notify Matchmaking component
                if (window.Matchmaking) {
                    window.Matchmaking.handleMatchFound(data);
                }
                
                // Also trigger onOpponentJoined for compatibility
                if (onOpponentJoined) onOpponentJoined(data);
            });

        } catch (err) {
            reject(err);
        }
    }

    // Get current user info from lobby
    function getUserInfo() {
        const currentUser = window.GameLobby?.getUser();
        console.log('[Multiplayer] getUserInfo - currentUser:', currentUser);
        if (currentUser) {
            const userInfo = {
                userId: currentUser.id,  // User ID for ELO updates
                name: currentUser.pseudo || currentUser.username,
                elo: currentUser.elo || 1000
            };
            console.log('[Multiplayer] Returning userInfo:', userInfo);
            return userInfo;
        }
        console.log('[Multiplayer] No user found - authentication required');
        return null;
    }

    // Create a new room
    function createRoom(timeControl) {
        return new Promise((resolve, reject) => {
            if (!socket || !socket.connected) {
                reject(new Error('Not connected to server'));
                return;
            }

            // Refresh playerId in case user logged in after socket init
            playerId = getPlayerId();
            const userInfo = getUserInfo();
            console.log('[Multiplayer] Creating room with userInfo:', userInfo, 'timeControl:', timeControl, 'playerId:', playerId);
            socket.emit('create-room', { playerId, userInfo, timeControl: timeControl || 'classic' }, (response) => {
                if (response.success) {
                    roomCode = response.roomCode;
                    playerColor = response.color;
                    isOnlineMode = true;
                    
                    // Save room info for reconnection
                    saveRoomInfo();
                    
                    resolve({
                        roomCode: response.roomCode,
                        color: response.color,
                        gameState: response.gameState,
                        waiting: response.waiting,
                        timeControl: response.timeControl,
                        timerState: response.timerState
                    });
                } else {
                    reject(new Error(response.error || 'Failed to create room'));
                }
            });
        });
    }

    // Join an existing room
    function joinRoom(code) {
        return new Promise((resolve, reject) => {
            if (!socket || !socket.connected) {
                reject(new Error('Not connected to server'));
                return;
            }

            // Refresh playerId in case user logged in after socket init
            playerId = getPlayerId();
            const userInfo = getUserInfo();
            console.log('[Multiplayer] Joining room with userInfo:', userInfo, 'playerId:', playerId);
            console.debug('[joinRoom] Before emit - playerId:', playerId, 'socket.id:', socket.id);
            socket.emit('join-room', { roomCode: code.toUpperCase(), playerId, userInfo }, (response) => {
                console.log('[Multiplayer] Join room response:', response);
                console.debug('[joinRoom] After response - stored roomCode:', response.roomCode, 'socket.id:', socket.id);
                if (response.success) {
                    roomCode = response.roomCode;
                    playerColor = response.color;
                    isOnlineMode = true;
                    console.debug('[joinRoom] Stored module vars - roomCode:', roomCode, 'playerColor:', playerColor, 'playerId:', playerId);
                    
                    // Save room info for reconnection
                    saveRoomInfo();
                    
                    resolve({
                        roomCode: response.roomCode,
                        color: response.color,
                        gameState: response.gameState,
                        waiting: response.waiting,
                        reconnected: response.reconnected,
                        opponentConnected: response.opponentConnected,
                        opponentInfo: response.opponentInfo,
                        timeControl: response.timeControl,
                        timerState: response.timerState
                    });
                } else {
                    reject(new Error(response.error || 'Failed to join room'));
                }
            });
        });
    }

    // Rejoin room after reconnection
    function rejoinRoom() {
        const savedRoom = loadRoomInfo();
        if (savedRoom) {
            joinRoom(savedRoom.roomCode).catch((err) => {
                console.error('Failed to rejoin room:', err);
                clearRoomInfo();
            });
        }
    }

    // Send a move to the server
    function sendMove(gameState, previousState, jumpPath = null) {
        return new Promise((resolve, reject) => {
            if (!socket || !socket.connected) {
                console.warn('[Multiplayer] sendMove prevented: Socket not connected');
                reject(new Error('Not connected to server'));
                return;
            }

            if (!roomCode) {
                console.warn('[Multiplayer] sendMove prevented: No roomCode set');
                reject(new Error('Not in a room'));
                return;
            }

            console.debug('[sendMove] Sending move:', {
                roomCode,
                playerId,
                socketId: socket.id
            });

            // Get current timer state to sync with opponent
            let timerState = null;
            if (window.GameTimer && window.GameTimer.isEnabled()) {
                timerState = window.GameTimer.getState();
            }

            socket.emit('make-move', {
                roomCode,
                playerId,
                gameState,
                previousState,
                jumpPath,
                timerState
            }, (response) => {
                if (response.success) {
                    // Sync timer from server response
                    if (response.timerState && window.GameTimer) {
                        window.GameTimer.syncFromServer(response.timerState);
                    }
                    resolve(response);
                } else {
                    console.error('[Multiplayer] sendMove failed response:', response);
                    reject(new Error(response.error || 'Failed to send move'));
                }
            });
        });
    }

    // Leave the current room
    function leaveRoom() {
        return new Promise((resolve) => {
            if (socket && socket.connected && roomCode) {
                socket.emit('leave-room', { roomCode, playerId }, () => {
                    clearRoomInfo();
                    resolve();
                });
            } else {
                clearRoomInfo();
                resolve();
            }
        });
    }

    // Request a rematch after game ends
    function requestRematch() {
        return new Promise((resolve, reject) => {
            if (!socket || !socket.connected) {
                reject(new Error('Not connected to server'));
                return;
            }

            if (!roomCode) {
                reject(new Error('Not in a room'));
                return;
            }

            socket.emit('request-rematch', { roomCode, playerId }, (response) => {
                if (response.success) {
                    resolve();
                } else {
                    reject(new Error(response.error || 'Failed to request rematch'));
                }
            });
        });
    }

    // Start a rematch (called when both players are ready)
    function startRematch() {
        return new Promise((resolve, reject) => {
            if (!socket || !socket.connected) {
                reject(new Error('Not connected to server'));
                return;
            }

            if (!roomCode) {
                reject(new Error('Not in a room'));
                return;
            }

            socket.emit('start-rematch', { roomCode, playerId }, (response) => {
                if (response.success) {
                    resolve(response.gameState);
                } else {
                    reject(new Error(response.error || 'Failed to start rematch'));
                }
            });
        });
    }

    // Report game result to server for ELO calculation
    // winnerColor: 'black', 'white', or null for draw
    // reason: 'capturing 6 discs', 'on time', 'stalemate', etc.
    function reportGameResult(winnerColor, reason, isDraw = false) {
        return new Promise((resolve, reject) => {
            if (!socket || !socket.connected || !roomCode) {
                console.log('[Multiplayer] Cannot report game result - not in a room');
                resolve({ success: false });
                return;
            }
            
            console.log(`[Multiplayer] Reporting game result: winner=${winnerColor}, reason=${reason}, isDraw=${isDraw}`);
            
            socket.emit('game-ended', {
                roomCode,
                winnerColor,
                reason,
                isDraw
            }, (response) => {
                if (response.success) {
                    console.log('[Multiplayer] Game result reported successfully');
                    resolve(response);
                } else {
                    console.error('[Multiplayer] Failed to report game result:', response.error);
                    reject(new Error(response.error));
                }
            });
        });
    }

    // Set room info (used when match is found via matchmaking callback)
    function setRoomInfo(code, color) {
        // Refresh playerId in case user logged in after socket init
        playerId = getPlayerId();
        roomCode = code;
        playerColor = color;
        isOnlineMode = true;
        saveRoomInfo();
        console.log(`[Multiplayer] Room info set: roomCode=${roomCode}, color=${playerColor}, playerId=${playerId}`);
    }

    // Notify opponent that player is leaving the endgame screen (before leaving room)
    function leaveEndgame() {
        return new Promise((resolve) => {
            if (socket && socket.connected && roomCode) {
                socket.emit('leave-endgame', { roomCode, playerId }, () => {
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    // Resign the game
    function resign() {
        return new Promise((resolve, reject) => {
            if (!socket || !socket.connected || !roomCode) {
                reject(new Error('Not connected to a game'));
                return;
            }
            socket.emit('resign', { roomCode, playerId, playerColor }, (response) => {
                if (response && response.success) {
                    console.log('[Multiplayer] Resigned successfully');
                    resolve(response);
                } else {
                    console.error('[Multiplayer] Failed to resign:', response?.error);
                    reject(new Error(response?.error || 'Failed to resign'));
                }
            });
        });
    }

    // Propose a draw (Ex Aequo)
    function proposeDraw() {
        return new Promise((resolve, reject) => {
            if (!socket || !socket.connected || !roomCode) {
                reject(new Error('Not connected to a game'));
                return;
            }
            socket.emit('propose-draw', { roomCode, playerId, playerColor }, (response) => {
                if (response && response.success) {
                    console.log('[Multiplayer] Draw proposed successfully');
                    resolve(response);
                } else {
                    console.error('[Multiplayer] Failed to propose draw:', response?.error);
                    reject(new Error(response?.error || 'Failed to propose draw'));
                }
            });
        });
    }

    // Respond to a draw proposal
    function respondDraw(accepted) {
        return new Promise((resolve, reject) => {
            if (!socket || !socket.connected || !roomCode) {
                reject(new Error('Not connected to a game'));
                return;
            }
            const event = accepted ? 'accept-draw' : 'decline-draw';
            socket.emit(event, { roomCode, playerId, playerColor }, (response) => {
                if (response && response.success) {
                    console.log('[Multiplayer] Draw response sent:', accepted ? 'accepted' : 'declined');
                    resolve(response);
                } else {
                    console.error('[Multiplayer] Failed to respond to draw:', response?.error);
                    reject(new Error(response?.error || 'Failed to respond to draw'));
                }
            });
        });
    }

    // Disconnect from server
    function disconnect() {
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        isConnected = false;
        isOnlineMode = false;
    }

    // Save room info to localStorage for reconnection
    function saveRoomInfo() {
        localStorage.setItem('hexaequoRoom', JSON.stringify({
            roomCode,
            playerColor,
            timestamp: Date.now()
        }));
    }

    // Load room info from localStorage
    function loadRoomInfo() {
        try {
            const data = localStorage.getItem('hexaequoRoom');
            if (data) {
                const room = JSON.parse(data);
                // Room info is valid for 24 hours
                if (Date.now() - room.timestamp < 24 * 60 * 60 * 1000) {
                    return room;
                }
            }
        } catch (e) {
            console.error('Error loading room info:', e);
        }
        return null;
    }

    // Clear room info from localStorage
    function clearRoomInfo() {
        localStorage.removeItem('hexaequoRoom');
        roomCode = null;
        playerColor = null;
        isOnlineMode = false;
    }

    // Check if it's this player's turn
    function isMyTurn(activePlayer) {
        return playerColor === activePlayer;
    }

    // Public API
    return {
        connect,
        createRoom,
        joinRoom,
        sendMove,
        leaveRoom,
        requestRematch,
        startRematch,
        leaveEndgame,
        reportGameResult,
        setRoomInfo,
        resign,
        proposeDraw,
        respondDraw,
        disconnect,
        clearRoomInfo,
        loadRoomInfo,
        isMyTurn,
        
        // Getters
        get isConnected() { return isConnected; },
        get isOnlineMode() { return isOnlineMode; },
        get roomCode() { return roomCode; },
        get playerColor() { return playerColor; },
        get playerId() { return playerId; },
        
        // Get raw socket for lobby
        getSocket() { return socket; },
        
        // Setters for callbacks
        set onOpponentJoined(fn) { onOpponentJoined = fn; },
        set onOpponentMoved(fn) { onOpponentMoved = fn; },
        set onOpponentDisconnected(fn) { onOpponentDisconnected = fn; },
        set onOpponentReconnected(fn) { onOpponentReconnected = fn; },
        set onOpponentLeft(fn) { onOpponentLeft = fn; },
        set onOpponentReadyRematch(fn) { onOpponentReadyRematch = fn; },
        set onOpponentLeftEndgame(fn) { onOpponentLeftEndgame = fn; },
        set onGameReset(fn) { onGameReset = fn; },
        set onGameTimeout(fn) { onGameTimeout = fn; },
        set onEloUpdated(fn) { onEloUpdated = fn; },
        set onGameCancelledEarly(fn) { onGameCancelledEarly = fn; },
        set onOpponentResigned(fn) { onOpponentResigned = fn; },
        set onDrawProposed(fn) { onDrawProposed = fn; },
        set onDrawAccepted(fn) { onDrawAccepted = fn; },
        set onDrawDeclined(fn) { onDrawDeclined = fn; },
        set onConnectionStatusChange(fn) { onConnectionStatusChange = fn; },
        set onError(fn) { onError = fn; },
        
        // Set online mode (used when mode changes)
        setOnlineMode(value) {
            isOnlineMode = value;
            if (!value) {
                clearRoomInfo();
            }
        }
    };
})();

// Export for use in game.js and lobby.js
window.Multiplayer = Multiplayer;
window.GameMultiplayer = Multiplayer;
