import { mountBoardRenderer } from './game/boardRenderer.js';
import { createCanvasGraphics } from './game/canvasGraphics.js';
import {
	updateGameState,
	applySerializedState,
	serializeCurrentState,
	subscribeToGameState
} from './store/gameStore.js';
import { SocketClient } from './utils/socketClient.js';
import { HEX_DIRECTIONS } from '../../shared/game/constants.js';

const socketClient = new SocketClient();

let appState = {
	view: 'splash',
	connectionStatus: 'disconnected',
	roomCode: null,
	playerColor: null
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
	const connectBtn = document.getElementById('connectServerBtn');
	const createRoomBtn = document.getElementById('createRoomDevBtn');

	subscribeToAppState((state) => {
		if (statusEl) statusEl.textContent = state.connectionStatus;
		if (roomEl) roomEl.textContent = state.roomCode ?? '----';
		document.body?.setAttribute('data-view', state.view);
	});

	connectBtn?.addEventListener('click', async () => {
		try {
			await socketClient.connect();
		} catch (err) {
			console.error('Socket connect failed', err);
		}
	});

	createRoomBtn?.addEventListener('click', async () => {
		try {
			await socketClient.ensureConnected();
			const response = await socketClient.createRoom();
			setAppState({ roomCode: response.roomCode, playerColor: response.color, view: 'game' });
		} catch (err) {
			console.error('Create room failed', err);
		}
	});
}

function observeMultiplayer() {
	socketClient.on('connection-status', (status) => {
		setAppState({ connectionStatus: status });
	});

	socketClient.on('error', (message) => {
		setAppState({ connectionStatus: 'error' });
		console.error('Socket error:', message);
	});

	socketClient.on('game-reset', () => {
		setAppView('game');
	});

	socketClient.on('opponent-joined', () => {
		setAppView('game');
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
