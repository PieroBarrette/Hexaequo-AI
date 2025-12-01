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

            // Set up one-time listener for the response
            socket.once('create-room-response', (response) => {
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

            socket.emit('create-room', { playerId });
            
            // Timeout after 10 seconds
            setTimeout(() => {
                socket.off('create-room-response');
                reject(new Error('Request timed out'));
            }, 10000);
        });
    }

    // Join an existing room
    function joinRoom(code) {
        return new Promise((resolve, reject) => {
            if (!socket || !socket.connected) {
                reject(new Error('Not connected to server'));
                return;
            }

            // Set up one-time listener for the response
            socket.once('join-room-response', (response) => {
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

            socket.emit('join-room', { roomCode: code.toUpperCase(), playerId });
            
            // Timeout after 10 seconds
            setTimeout(() => {
                socket.off('join-room-response');
                reject(new Error('Request timed out'));
            }, 10000);
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
    function sendMove(gameState, previousState) {
        return new Promise((resolve, reject) => {
            if (!socket || !socket.connected) {
                reject(new Error('Not connected to server'));
                return;
            }

            if (!roomCode) {
                reject(new Error('Not in a room'));
                return;
            }

            // Set up one-time listener for the response
            socket.once('make-move-response', (response) => {
                if (response.success) {
                    resolve();
                } else {
                    reject(new Error(response.error || 'Failed to send move'));
                }
            });

            socket.emit('make-move', {
                roomCode,
                playerId,
                gameState,
                previousState
            });
            
            // Timeout after 10 seconds
            setTimeout(() => {
                socket.off('make-move-response');
                reject(new Error('Request timed out'));
            }, 10000);
        });
    }

    // Leave the current room
    function leaveRoom() {
        return new Promise((resolve) => {
            if (socket && socket.connected && roomCode) {
                socket.once('leave-room-response', () => {
                    clearRoomInfo();
                    resolve();
                });
                socket.emit('leave-room', { roomCode, playerId });
                
                // Don't wait forever
                setTimeout(() => {
                    socket.off('leave-room-response');
                    clearRoomInfo();
                    resolve();
                }, 3000);
            } else {
                clearRoomInfo();
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
