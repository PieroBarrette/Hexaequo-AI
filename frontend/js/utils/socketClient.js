// Thin ES module wrapper around the legacy multiplayer client so the modern SPA
// can share the live Render server without re-writing the protocol yet.

const SOCKET_IO_CDN = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
const ROOM_STORAGE_KEY = 'hexaequoRoom';
const PLAYER_STORAGE_KEY = 'hexaequoPlayerId';

let socketIoScriptPromise = null;

export class SocketClient {
	constructor(options = {}) {
		this.serverUrl = options.serverUrl ?? deriveDefaultServerUrl();
		this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
		this.socket = null;
		this.playerId = null;
		this.roomCode = null;
		this.playerColor = null;
		this.isOnline = false;
		this.profile = null;
		this.lastRoomSettings = null;
		this.reconnectAttempts = 0;
		this.handlers = new Map();
	}

	async connect() {
		if (this.socket?.connected) {
			return;
		}

		if (!this.playerId) {
			this.playerId = getOrCreatePlayerId();
		}

		await ensureSocketIoLoaded();

		this.socket = window.io(this.serverUrl, {
			transports: ['websocket', 'polling'],
			timeout: 10000,
			reconnection: true,
			reconnectionAttempts: this.maxReconnectAttempts,
			reconnectionDelay: 1000
		});

		return new Promise((resolve, reject) => {
			const handleConnect = () => {
				this.reconnectAttempts = 0;
				this.emit('connection-status', 'connected');
				if (this.roomCode && this.playerColor) {
					this.rejoinRoom().catch(() => {});
				}
				resolve();
			};

			const handleConnectError = (err) => {
				this.reconnectAttempts += 1;
				if (this.reconnectAttempts >= this.maxReconnectAttempts) {
					this.emit('error', 'Unable to connect to server.');
					reject(err);
				}
			};

			this.socket.once('connect', handleConnect);
			this.socket.on('connect_error', handleConnectError);
			this.socket.on('disconnect', () => {
				this.emit('connection-status', 'disconnected');
			});

			forwardServerEvents(this.socket, (eventName, payload) => {
				this.emit(eventName, payload);
			});
		});
	}

	async createRoom(options = {}) {
		await this.ensureConnected();
		return new Promise((resolve, reject) => {
			const payload = {
				playerId: this.playerId,
				settings: normalizeRoomSettings(options.settings ?? options),
				profile: normalizeProfile(options.profile ?? options)
			};
			this.socket.emit('create-room', payload, (response) => {
				if (response.success) {
					this.roomCode = response.roomCode;
					this.playerColor = response.color;
					this.isOnline = true;
					this.profile = payload.profile;
					this.lastRoomSettings = payload.settings;
					saveRoomInfo(this.roomCode, this.playerColor);
					resolve(response);
				} else {
					reject(new Error(response.error || 'Failed to create room'));
				}
			});
		});
	}

	async joinRoom(code, options = {}) {
		await this.ensureConnected();
		return new Promise((resolve, reject) => {
			const payload = {
				roomCode: code?.toUpperCase(),
				playerId: this.playerId,
				profile: normalizeProfile(options.profile ?? options)
			};
			this.socket.emit('join-room', payload, (response) => {
				if (response.success) {
					this.roomCode = response.roomCode;
					this.playerColor = response.color;
					this.isOnline = true;
					this.profile = payload.profile;
					saveRoomInfo(this.roomCode, this.playerColor);
					resolve(response);
				} else {
					reject(new Error(response.error || 'Failed to join room'));
				}
			});
		});
	}

	async rejoinRoom() {
		const stored = loadRoomInfo();
		if (!stored) return null;
		try {
			return await this.joinRoom(stored.roomCode);
		} catch (err) {
			clearRoomInfo();
			return null;
		}
	}

	async sendMove(gameState, previousState, jumpPath = null) {
		await this.ensureConnected();
		if (!this.roomCode) {
			throw new Error('Not currently in a room');
		}

		return new Promise((resolve, reject) => {
			this.socket.emit(
				'make-move',
				{ roomCode: this.roomCode, playerId: this.playerId, gameState, previousState, jumpPath },
				(response) => {
					if (response.success) {
						resolve();
					} else {
						reject(new Error(response.error || 'Failed to send move'));
					}
				}
			);
		});
	}

	async leaveRoom() {
		if (!this.socket || !this.roomCode) {
			clearRoomInfo();
			this.roomCode = null;
			this.playerColor = null;
			this.isOnline = false;
			return;
		}

		return new Promise((resolve) => {
			this.socket.emit('leave-room', { roomCode: this.roomCode, playerId: this.playerId }, () => {
				clearRoomInfo();
				this.roomCode = null;
				this.playerColor = null;
				this.isOnline = false;
				resolve();
			});
		});
	}

	async requestRematch() {
		await this.ensureConnected();
		return emitWithAck(this.socket, 'request-rematch', { roomCode: this.roomCode, playerId: this.playerId });
	}

	async startRematch() {
		await this.ensureConnected();
		return emitWithAck(this.socket, 'start-rematch', { roomCode: this.roomCode, playerId: this.playerId });
	}

	async leaveEndgame() {
		if (!this.socket || !this.roomCode) return;
		return emitWithAck(this.socket, 'leave-endgame', { roomCode: this.roomCode, playerId: this.playerId });
	}

	disconnect() {
		if (this.socket) {
			this.socket.disconnect();
			this.socket = null;
		}
		this.emit('connection-status', 'disconnected');
	}

	on(eventName, handler) {
		if (!this.handlers.has(eventName)) {
			this.handlers.set(eventName, new Set());
		}
		const listeners = this.handlers.get(eventName);
		listeners.add(handler);
		return () => {
			listeners.delete(handler);
			if (listeners.size === 0) {
				this.handlers.delete(eventName);
			}
		};
	}

	emit(eventName, payload) {
		const listeners = this.handlers.get(eventName);
		if (!listeners) return;
		listeners.forEach((handler) => {
			try {
				handler(payload);
			} catch (err) {
				console.error(`[SocketClient] handler error for ${eventName}`, err);
			}
		});
	}

	async ensureConnected() {
		if (!this.socket || !this.socket.connected) {
			await this.connect();
		}
	}
}

function deriveDefaultServerUrl() {
	if (typeof window === 'undefined') {
		return 'https://hexaequo-server.onrender.com';
	}
	return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
		? 'http://localhost:3000'
		: 'https://hexaequo-server.onrender.com';
}

function getOrCreatePlayerId() {
	if (typeof window === 'undefined') return null;
	let id = window.localStorage.getItem(PLAYER_STORAGE_KEY);
	if (!id) {
		id = `player_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
		window.localStorage.setItem(PLAYER_STORAGE_KEY, id);
	}
	return id;
}

function saveRoomInfo(roomCode, playerColor) {
	if (typeof window === 'undefined') return;
	window.localStorage.setItem(
		ROOM_STORAGE_KEY,
		JSON.stringify({ roomCode, playerColor, timestamp: Date.now() })
	);
}

function loadRoomInfo() {
	if (typeof window === 'undefined') return null;
	try {
		const raw = window.localStorage.getItem(ROOM_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (Date.now() - (parsed.timestamp ?? 0) > 24 * 60 * 60 * 1000) {
			clearRoomInfo();
			return null;
		}
		return parsed;
	} catch (err) {
		console.error('Failed to parse stored room info', err);
		return null;
	}
}

function clearRoomInfo() {
	if (typeof window === 'undefined') return;
	window.localStorage.removeItem(ROOM_STORAGE_KEY);
}

function emitWithAck(socket, event, payload) {
	return new Promise((resolve, reject) => {
		if (!socket) {
			reject(new Error('Socket not connected'));
			return;
		}
		socket.emit(event, payload, (response) => {
			if (response?.success) {
				resolve(response);
			} else {
				reject(new Error(response?.error || `Failed to handle ${event}`));
			}
		});
	});
}

function ensureSocketIoLoaded() {
	if (typeof window === 'undefined') {
		return Promise.reject(new Error('Socket.IO client requires a browser environment'));
	}
	if (window.io) {
		return Promise.resolve();
	}
	if (!socketIoScriptPromise) {
		socketIoScriptPromise = new Promise((resolve, reject) => {
			const script = document.createElement('script');
			script.src = SOCKET_IO_CDN;
			script.async = true;
			script.onload = () => resolve();
			script.onerror = () => reject(new Error('Failed to load Socket.IO client script'));
			document.head.appendChild(script);
		});
	}
	return socketIoScriptPromise;
}

function forwardServerEvents(socket, emitFn) {
	const events = [
		'opponent-joined',
		'opponent-moved',
		'opponent-disconnected',
		'opponent-reconnected',
		'opponent-left',
		'opponent-ready-rematch',
		'opponent-left-endgame',
		'game-reset'
	];
	events.forEach((eventName) => {
		socket.on(eventName, (payload) => emitFn(eventName, payload));
	});
}

function normalizeRoomSettings(settings = {}) {
	const allowedModes = new Set(['none', 'classic', 'rapid', 'blitz']);
	const desiredMode = typeof settings.timeMode === 'string' ? settings.timeMode.toLowerCase() : 'none';
	return {
		allowSpectators: settings.allowSpectators !== false,
		timeMode: allowedModes.has(desiredMode) ? desiredMode : 'none'
	};
}

function normalizeProfile(candidate = {}) {
	const pseudo = typeof candidate.pseudo === 'string' ? candidate.pseudo.trim() : '';
	const safePseudo = pseudo ? pseudo.slice(0, 24) : null;
	const elo = Number.isFinite(candidate.elo) ? Math.max(0, Math.floor(candidate.elo)) : null;
	return safePseudo || elo ? { pseudo: safePseudo, elo } : null;
}
