/**
 * Socket Client - WebSocket communication for multiplayer
 */

const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://hexaequo-server.onrender.com';

/**
 * Socket Client Class
 */
export class SocketClient {
    constructor() {
        this.socket = null;
        this.playerId = null;
        this.roomCode = null;
        this.playerColor = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;

        // Event callbacks
        this.callbacks = {
            onOpponentJoined: null,
            onOpponentMoved: null,
            onOpponentDisconnected: null,
            onOpponentReconnected: null,
            onOpponentLeft: null,
            onOpponentReadyRematch: null,
            onOpponentLeftEndgame: null,
            onGameReset: null,
            onConnectionStatusChange: null,
            onError: null
        };
    }

    /**
     * Get or create player ID from localStorage
     */
    getPlayerId() {
        let id = localStorage.getItem('hexaequoPlayerId');
        if (!id) {
            id = 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('hexaequoPlayerId', id);
        }
        return id;
    }

    /**
     * Connect to the server
     */
    async connect() {
        return new Promise((resolve, reject) => {
            if (this.socket?.connected) {
                resolve();
                return;
            }

            // Load Socket.IO if not loaded
            if (typeof io === 'undefined') {
                const script = document.createElement('script');
                script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
                script.onload = () => this.initializeSocket(resolve, reject);
                script.onerror = () => reject(new Error('Failed to load Socket.IO'));
                document.head.appendChild(script);
            } else {
                this.initializeSocket(resolve, reject);
            }
        });
    }

    /**
     * Initialize socket connection
     */
    initializeSocket(resolve, reject) {
        try {
            this.playerId = this.getPlayerId();

            this.socket = io(SERVER_URL, {
                transports: ['websocket', 'polling'],
                timeout: 10000,
                reconnection: true,
                reconnectionAttempts: this.maxReconnectAttempts,
                reconnectionDelay: 1000
            });

            this.socket.on('connect', () => {
                console.log('Connected to server');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.callbacks.onConnectionStatusChange?.('connected');

                // Rejoin room if reconnecting
                if (this.roomCode && this.playerColor) {
                    this.rejoinRoom();
                }

                resolve();
            });

            this.socket.on('disconnect', () => {
                console.log('Disconnected from server');
                this.isConnected = false;
                this.callbacks.onConnectionStatusChange?.('disconnected');
            });

            this.socket.on('connect_error', (err) => {
                console.error('Connection error:', err);
                this.reconnectAttempts++;
                if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                    reject(new Error('Failed to connect to server'));
                }
            });

            // Game events
            this.socket.on('opponent-joined', (data) => {
                this.callbacks.onOpponentJoined?.(data);
            });

            this.socket.on('opponent-moved', (data) => {
                this.callbacks.onOpponentMoved?.(data);
            });

            this.socket.on('opponent-disconnected', () => {
                this.callbacks.onOpponentDisconnected?.();
            });

            this.socket.on('opponent-reconnected', () => {
                this.callbacks.onOpponentReconnected?.();
            });

            this.socket.on('opponent-left', () => {
                this.callbacks.onOpponentLeft?.();
            });

            this.socket.on('opponent-ready-rematch', (data) => {
                this.callbacks.onOpponentReadyRematch?.(data);
            });

            this.socket.on('opponent-left-endgame', () => {
                this.callbacks.onOpponentLeftEndgame?.();
            });

            this.socket.on('game-reset', (data) => {
                this.callbacks.onGameReset?.(data);
            });

        } catch (error) {
            reject(error);
        }
    }

    /**
     * Disconnect from server
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.isConnected = false;
        this.roomCode = null;
        this.playerColor = null;
    }

    /**
     * Create a new room
     */
    async createRoom(settings = {}) {
        return new Promise((resolve, reject) => {
            this.socket.emit('create-room', {
                playerId: this.playerId,
                settings
            }, (response) => {
                if (response.success) {
                    this.roomCode = response.roomCode;
                    this.playerColor = response.color;
                    resolve(response);
                } else {
                    reject(new Error(response.error));
                }
            });
        });
    }

    /**
     * Join an existing room
     */
    async joinRoom(roomCode) {
        return new Promise((resolve, reject) => {
            this.socket.emit('join-room', {
                roomCode,
                playerId: this.playerId
            }, (response) => {
                if (response.success) {
                    this.roomCode = response.roomCode;
                    this.playerColor = response.color;
                    resolve(response);
                } else {
                    reject(new Error(response.error));
                }
            });
        });
    }

    /**
     * Rejoin room after reconnection
     */
    async rejoinRoom() {
        if (!this.roomCode) return;

        try {
            const response = await this.joinRoom(this.roomCode);
            console.log('Rejoined room:', response);
        } catch (error) {
            console.error('Failed to rejoin room:', error);
            this.roomCode = null;
            this.playerColor = null;
        }
    }

    /**
     * Send a move
     */
    async makeMove(gameState, previousState, jumpPath = null) {
        return new Promise((resolve, reject) => {
            this.socket.emit('make-move', {
                roomCode: this.roomCode,
                playerId: this.playerId,
                gameState,
                previousState,
                jumpPath
            }, (response) => {
                if (response.success) {
                    resolve(response);
                } else {
                    reject(new Error(response.error));
                }
            });
        });
    }

    /**
     * Leave the current room
     */
    async leaveRoom() {
        return new Promise((resolve) => {
            if (!this.roomCode) {
                resolve();
                return;
            }

            this.socket.emit('leave-room', {
                roomCode: this.roomCode,
                playerId: this.playerId
            }, () => {
                this.roomCode = null;
                this.playerColor = null;
                resolve();
            });
        });
    }

    /**
     * Request rematch
     */
    async requestRematch() {
        return new Promise((resolve, reject) => {
            this.socket.emit('request-rematch', {
                roomCode: this.roomCode,
                playerId: this.playerId
            }, (response) => {
                if (response.success) {
                    resolve(response);
                } else {
                    reject(new Error(response.error));
                }
            });
        });
    }

    /**
     * Set event callback
     */
    on(event, callback) {
        if (event in this.callbacks) {
            this.callbacks[event] = callback;
        }
    }

    /**
     * Remove event callback
     */
    off(event) {
        if (event in this.callbacks) {
            this.callbacks[event] = null;
        }
    }
}

export default SocketClient;
