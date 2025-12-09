import { mountBoardRenderer } from './game/boardRenderer.js';
import { createCanvasGraphics } from './game/canvasGraphics.js';
import {
	applySerializedState,
	serializeCurrentState,
	subscribeToGameState,
	getPreviousGameState
} from './store/gameStore.js';
import { serializeState } from './game/gameState.js';
import { SocketClient } from './utils/socketClient.js';
import { mountHud } from './game/hud/index.js';
import { initGameController } from './game/gameController.js';
import { initEndgameWatcher } from './game/endgameWatcher.js';

const socketClient = new SocketClient();
let disposeHud = () => {};
let disposeController = () => {};
let disposeEndgame = () => {};
let boardGraphicsApi = null;
let canvasResizeHandler = null;

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
	disposeHud = mountHud();
	disposeEndgame = initEndgameWatcher();
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

	syncCanvasSize(canvas);

	const defaultHexSize = 40;
	const graphicsApi = createCanvasGraphics(canvas, {
		hexSize: defaultHexSize,
		verbose: false,
		padding: 56,
		minHexSize: 28,
		maxHexSize: 72
	});
	boardGraphicsApi = graphicsApi;

	if (canvasResizeHandler) {
		window.removeEventListener('resize', canvasResizeHandler);
	}

	canvasResizeHandler = () => {
		if (syncCanvasSize(canvas)) {
			boardGraphicsApi?.rerenderLastFrame?.();
		}
	};

	window.addEventListener('resize', canvasResizeHandler);

	mountBoardRenderer({ graphicsApi });
	disposeController = initGameController(canvas, {
		hexSize: defaultHexSize,
		getLayout: () => graphicsApi.getLayout?.(),
		subscribeToLayout: graphicsApi.subscribeLayout
	});
}

function syncCanvasSize(canvas) {
	const rect = canvas.getBoundingClientRect();
	const targetWidth = Math.max(1, Math.floor(rect.width));
	const targetHeight = Math.max(1, Math.floor(rect.height));
	const needsResize = canvas.width !== targetWidth || canvas.height !== targetHeight;
	if (needsResize) {
		canvas.width = targetWidth;
		canvas.height = targetHeight;
	}
	return needsResize;
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
		refreshHud() {
			disposeHud?.();
			disposeHud = mountHud();
		},
		refreshController() {
			disposeController?.();
			const canvas = document.getElementById('modernGameCanvas');
			if (canvas) {
				disposeController = initGameController(canvas, { hexSize: 40 });
			}
		},
		refreshEndgameWatcher() {
			disposeEndgame?.();
			disposeEndgame = initEndgameWatcher();
		},
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

