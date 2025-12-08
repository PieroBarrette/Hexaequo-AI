/**
 * Hexaequo Multiplayer Client Module
 * 
 * Handles WebSocket connection to the game server for online multiplayer.
 */

const Multiplayer = (function () {
    // Configuration
    const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000'
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
    let onConnectionStatusChange = null;
    let onError = null;

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
                if (onOpponentJoined) onOpponentJoined(data);
            });

            socket.on('opponent-moved', (data) => {
                console.log('Opponent moved');
                if (onOpponentMoved) onOpponentMoved(data);
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

        } catch (err) {
            reject(err);
        }
    }

    // Create a new room
    function createRoom() {
        return new Promise((resolve, reject) => {
            if (!socket || !socket.connected) {
                reject(new Error('Not connected to server'));
                return;
            }

            socket.emit('create-room', { playerId }, (response) => {
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
                        waiting: response.waiting
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

            socket.emit('join-room', { roomCode: code.toUpperCase(), playerId }, (response) => {
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
                        opponentConnected: response.opponentConnected
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
                    resolve();
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
        
        // Setters for callbacks
        set onOpponentJoined(fn) { onOpponentJoined = fn; },
        set onOpponentMoved(fn) { onOpponentMoved = fn; },
        set onOpponentDisconnected(fn) { onOpponentDisconnected = fn; },
        set onOpponentReconnected(fn) { onOpponentReconnected = fn; },
        set onOpponentLeft(fn) { onOpponentLeft = fn; },
        set onOpponentReadyRematch(fn) { onOpponentReadyRematch = fn; },
        set onOpponentLeftEndgame(fn) { onOpponentLeftEndgame = fn; },
        set onGameReset(fn) { onGameReset = fn; },
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

// Export for use in game.js
window.Multiplayer = Multiplayer;
