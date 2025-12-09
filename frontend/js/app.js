import { mountBoardRenderer } from './game/boardRenderer.js';
import { createCanvasGraphics } from './game/canvasGraphics.js';
import {
	updateGameState,
	applySerializedState,
	serializeCurrentState,
	subscribeToGameState,
	getPreviousGameState
} from './store/gameStore.js';
import { serializeState } from './game/gameState.js';
import { SocketClient } from './utils/socketClient.js';
import { HEX_DIRECTIONS } from '../../shared/game/constants.js';

const socketClient = new SocketClient();

let appState = {
	view: 'splash',
	connectionStatus: 'disconnected',
	roomCode: null,
	playerColor: null,
	lastError: null
};

const appSubscribers = new Set();

document.addEventListener('DOMContentLoaded', () => {
	initializeApp();
});

function initializeApp() {
	initializeCanvas();
	wireDevButtons();
	wireStatusPanel();
	observeMultiplayer();
	exposeDebugHelpers();
	setAppView('game');
}

function initializeCanvas() {
	const canvas = document.getElementById('modernGameCanvas');
	if (!canvas) {
		console.warn('No canvas element found for the modern renderer.');
		return;
	}

	const graphicsApi = createCanvasGraphics(canvas, { hexSize: 40, verbose: false });
	mountBoardRenderer({ graphicsApi });
}

function wireDevButtons() {
	const addTileBtn = document.getElementById('devAddTile');
	const addDiscBtn = document.getElementById('devAddDisc');

	addTileBtn?.addEventListener('click', () => {
		updateGameState((state) => {
			const tiles = { ...state.tiles };
			const candidate = findPlacementSpot(tiles);
			if (!candidate) return state;
			tiles[`${candidate.q},${candidate.r}`] = Math.random() > 0.5 ? 'black' : 'white';
			return { ...state, tiles };
		}, { reason: 'dev-tile' });
	});

	addDiscBtn?.addEventListener('click', () => {
		updateGameState((state) => {
			const placement = findPiecePlacement(state);
			if (!placement) return state;
			const pieces = { ...state.pieces };
			pieces[`${placement.q},${placement.r}`] = {
				type: placement.type,
				color: placement.color
			};
			return { ...state, pieces };
		}, { reason: 'dev-piece' });
	});
}

function wireStatusPanel() {
	const statusEl = document.querySelector('[data-connection-status]');
	const roomEl = document.querySelector('[data-room-code]');
	const errorEl = document.querySelector('[data-error-msg]');
	const connectBtn = document.getElementById('connectServerBtn');
	const createRoomBtn = document.getElementById('createRoomDevBtn');
	const joinRoomBtn = document.getElementById('joinRoomDevBtn');
	const leaveRoomBtn = document.getElementById('leaveRoomDevBtn');
	const roomInput = document.getElementById('roomCodeInput');
	const sendStateBtn = document.getElementById('sendStateBtn');

	subscribeToAppState((state) => {
		if (statusEl) statusEl.textContent = state.connectionStatus;
		if (roomEl) roomEl.textContent = state.roomCode ?? '----';
		if (errorEl) errorEl.textContent = state.lastError ?? '';
		document.body?.setAttribute('data-view', state.view);
	});

	connectBtn?.addEventListener('click', async () => {
		try {
			await socketClient.connect();
			setAppState({ lastError: null });
		} catch (err) {
			console.error('Socket connect failed', err);
			setAppState({ lastError: err.message });
		}
	});

	createRoomBtn?.addEventListener('click', async () => {
		try {
			await socketClient.ensureConnected();
			const response = await socketClient.createRoom();
			hydrateFromServerState(response.gameState);
			setAppState({
				roomCode: response.roomCode,
				playerColor: response.color,
				view: 'game',
				lastError: null
			});
		} catch (err) {
			console.error('Create room failed', err);
			setAppState({ lastError: err.message });
		}
	});

	joinRoomBtn?.addEventListener('click', async () => {
		try {
			await socketClient.ensureConnected();
			const code = roomInput?.value?.trim();
			if (!code) {
				setAppState({ lastError: 'Enter a room code to join.' });
				return;
			}
			const response = await socketClient.joinRoom(code);
			hydrateFromServerState(response.gameState);
			setAppState({
				roomCode: response.roomCode,
				playerColor: response.color,
				view: 'game',
				lastError: null
			});
		} catch (err) {
			console.error('Join room failed', err);
			setAppState({ lastError: err.message });
		}
	});

	leaveRoomBtn?.addEventListener('click', async () => {
		try {
			await socketClient.leaveRoom();
			setAppState({ roomCode: null, playerColor: null, lastError: null });
		} catch (err) {
			console.error('Leave room failed', err);
			setAppState({ lastError: err.message });
		}
	});

	sendStateBtn?.addEventListener('click', async () => {
		try {
			await socketClient.ensureConnected();
			if (!appState.roomCode) {
				setAppState({ lastError: 'Create or join a room first.' });
				return;
			}
			const current = serializeCurrentState();
			const previous = serializeState(getPreviousGameState());
			await socketClient.sendMove(current, previous, null);
			setAppState({ lastError: null });
		} catch (err) {
			console.error('Send state failed', err);
			setAppState({ lastError: err.message });
		}
	});
}

function observeMultiplayer() {
	socketClient.on('connection-status', (status) => {
		setAppState({ connectionStatus: status });
	});

	socketClient.on('error', (message) => {
		setAppState({ connectionStatus: 'error', lastError: message });
		console.error('Socket error:', message);
	});

	socketClient.on('game-reset', ({ gameState }) => {
		hydrateFromServerState(gameState);
		setAppView('game');
	});

	socketClient.on('opponent-joined', () => {
		setAppView('game');
	});

	socketClient.on('opponent-moved', ({ gameState }) => {
		hydrateFromServerState(gameState);
	});
}

function exposeDebugHelpers() {
	window.hexaequoApp = {
		socketClient,
		serializeCurrentState,
		applySerializedState,
		setView: setAppView,
		subscribeToGameState,
		get state() {
			return appState;
		}
	};
}

function setAppView(view) {
	setAppState({ view });
}

function setAppState(patch) {
	const nextState = { ...appState, ...patch };
	const changed = Object.keys(patch).some((key) => appState[key] !== nextState[key]);
	if (!changed) return;
	appState = nextState;
	notifyAppSubscribers();
}

function hydrateFromServerState(snapshot) {
	if (!snapshot) return;
	applySerializedState(snapshot, { reason: 'server-sync' });
}

function subscribeToAppState(listener, options = {}) {
	appSubscribers.add(listener);
	if (options.emitInitial !== false) {
		listener(appState);
	}
	return () => appSubscribers.delete(listener);
}

function notifyAppSubscribers() {
	appSubscribers.forEach((listener) => {
		try {
			listener(appState);
		} catch (err) {
			console.error('appState listener error', err);
		}
	});
}

function findPlacementSpot(tiles) {
	const occupied = new Set(Object.keys(tiles));
	const candidates = [];
	for (const key of occupied) {
		const [q, r] = key.split(',').map(Number);
		for (const [dq, dr] of HEX_DIRECTIONS) {
			const cq = q + dq;
			const cr = r + dr;
			const cKey = `${cq},${cr}`;
			if (!occupied.has(cKey)) {
				candidates.push({ q: cq, r: cr });
			}
		}
	}
	if (candidates.length === 0) return null;
	return candidates[Math.floor(Math.random() * candidates.length)];
}

function findPiecePlacement(state) {
	const tiles = state.tiles || {};
	const pieces = state.pieces || {};
	const emptyTiles = Object.keys(tiles).filter((key) => !pieces[key]);
	if (emptyTiles.length === 0) return null;
	const [q, r] = emptyTiles[Math.floor(Math.random() * emptyTiles.length)].split(',').map(Number);
	const type = Math.random() > 0.7 ? 'ring' : 'disc';
	const color = Math.random() > 0.5 ? 'black' : 'white';
	return { q, r, type, color };
}
