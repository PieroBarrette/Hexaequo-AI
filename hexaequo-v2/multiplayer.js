/**
 * Hexaequo Multiplayer Client Module
 * 
 * Handles WebSocket connection to the game server for online multiplayer.
 */

const Multiplayer = (function () {
    // Configuration
    // Port 3000: Backend with REST API + Socket.IO
    const BACKEND_PORT = 3000;
    const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? `http://localhost:${BACKEND_PORT}`
        : 'https://hexaequo-server.onrender.com'; // Update this after deployment

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

    // Get or create player ID (persisted in localStorage)
    function getPlayerId() {
        let id = localStorage.getItem('hexaequoPlayerId');
        if (!id) {
            id = 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('hexaequoPlayerId', id);
        }
        return id;
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
                script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
                script.onload = () => initializeSocket(resolve, reject);
                script.onerror = () => reject(new Error('Failed to load Socket.IO'));
                document.head.appendChild(script);
            } else {
                initializeSocket(resolve, reject);
            }
        });
    }

    function initializeSocket(resolve, reject) {
        try {
            playerId = getPlayerId();
            
            socket = io(SERVER_URL, {
                transports: ['websocket', 'polling'],
                timeout: 10000,
                reconnection: true,
                reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
                reconnectionDelay: 1000
            });

            socket.on('connect', () => {
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

            socket.on('disconnect', () => {
                console.log('Disconnected from server');
                isConnected = false;
                if (onConnectionStatusChange) onConnectionStatusChange('disconnected');
            });

            socket.on('connect_error', (err) => {
                console.error('Connection error:', err);
                reconnectAttempts++;
                if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                    if (onError) onError('Unable to connect to server. Please try again later.');
                    reject(err);
                }
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
                oderId: currentUser.id,  // User ID for ELO updates
                name: currentUser.pseudo || currentUser.username,
                elo: currentUser.elo || 1000,
                isGuest: false
            };
            console.log('[Multiplayer] Returning userInfo:', userInfo);
            return userInfo;
        }
        console.log('[Multiplayer] No user found, returning Guest');
        return { name: 'Guest', elo: null, isGuest: true };
    }

    // Create a new room
    function createRoom(timeControl) {
        return new Promise((resolve, reject) => {
            if (!socket || !socket.connected) {
                reject(new Error('Not connected to server'));
                return;
            }

            const userInfo = getUserInfo();
            console.log('[Multiplayer] Creating room with userInfo:', userInfo, 'timeControl:', timeControl);
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

            const userInfo = getUserInfo();
            console.log('[Multiplayer] Joining room with userInfo:', userInfo);
            socket.emit('join-room', { roomCode: code.toUpperCase(), playerId, userInfo }, (response) => {
                console.log('[Multiplayer] Join room response:', response);
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
                reject(new Error('Not connected to server'));
                return;
            }

            if (!roomCode) {
                reject(new Error('Not in a room'));
                return;
            }

            socket.emit('make-move', {
                roomCode,
                playerId,
                gameState,
                previousState,
                jumpPath
            }, (response) => {
                if (response.success) {
                    // Sync timer from server response
                    if (response.timerState && window.GameTimer) {
                        window.GameTimer.syncFromServer(response.timerState);
                    }
                    resolve(response);
                } else {
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
            socket.emit('resign', { roomCode, playerId }, (response) => {
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
            socket.emit('propose-draw', { roomCode, playerId }, (response) => {
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
            socket.emit('respond-draw', { roomCode, playerId, accepted }, (response) => {
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
