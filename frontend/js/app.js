import { mountBoardRenderer } from './game/boardRenderer.js';
import { createCanvasGraphics } from './game/canvasGraphics.js';
import {
	applySerializedState,
	serializeCurrentState,
	subscribeToGameState,
	getPreviousGameState
} from './store/gameStore.js';
import { getAppState, setAppState, subscribeToAppState } from './store/appStore.js';
import { serializeState } from './game/gameState.js';
import { SocketClient } from './utils/socketClient.js';
import { mountHud } from './game/hud/index.js';
import { initGameController } from './game/gameController.js';
import { initEndgameWatcher } from './game/endgameWatcher.js';
import { soundManager } from './utils/soundManager.js';
import { initLobbyPanel } from './lobby/panel.js';

const socketClient = new SocketClient();
let disposeHud = () => {};
let disposeController = () => {};
let disposeEndgame = () => {};
let disposeLobby = () => {};
let boardGraphicsApi = null;
let canvasResizeHandler = null;

document.addEventListener('DOMContentLoaded', () => {
	initializeApp();
});

function initializeApp() {
	initializeCanvas();
	disposeHud = mountHud();
	disposeEndgame = initEndgameWatcher();
	initializeNavigationPanels();
	observeLayoutChrome();
	disposeLobby = initLobbyPanel({
		socketClient,
		onHydrateGameState: hydrateFromServerState,
		onNavigateToGame: setAppView
	});
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
		maxHexSize: 72,
		getPreferences: () => {
			const state = getAppState();
			return {
				showValidMoves: state.showValidMoves,
				showPreviousMove: state.showPreviousMove
			};
		}
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

	mountBoardRenderer({
		graphicsApi,
		animateMultiJumps: () => getAppState().animationsEnabled,
		skipMoveAnimation: () => !getAppState().animationsEnabled,
		onQueueBuilt: (queueResult) => soundManager.handleQueue(queueResult)
	});
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
	});

	connectBtn?.addEventListener('click', async () => {
		soundManager.playUiClick();
		try {
			await socketClient.connect();
			setAppState({ lastError: null });
		} catch (err) {
			console.error('Socket connect failed', err);
			setAppState({ lastError: err.message });
		}
	});

	createRoomBtn?.addEventListener('click', async () => {
		soundManager.playUiClick();
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
		soundManager.playUiClick();
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
		soundManager.playUiClick();
		try {
			await socketClient.leaveRoom();
			setAppState({ roomCode: null, playerColor: null, lastError: null });
		} catch (err) {
			console.error('Leave room failed', err);
			setAppState({ lastError: err.message });
		}
	});

	sendStateBtn?.addEventListener('click', async () => {
		soundManager.playUiClick();
		try {
			await socketClient.ensureConnected();
			if (!getAppState().roomCode) {
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

function initializeNavigationPanels() {
	const navToggleBtn = document.querySelector('[data-nav-toggle]');
	const navPeekBtn = document.querySelector('[data-nav-peek]');
	const flyoutPanel = document.querySelector('[data-flyout-panel]');
	const flyoutCloseBtn = document.querySelector('[data-flyout-close]');
	const flyoutTriggers = document.querySelectorAll('[data-flyout-trigger]');
	const themeToggle = document.querySelector('[data-theme-toggle]');
	const animationToggle = document.querySelector('[data-animation-toggle]');
	const soundToggles = document.querySelectorAll('[data-sound-toggle]');
	const validMovesToggle = document.querySelector('[data-visual-toggle="valid"]');
	const previousMoveToggle = document.querySelector('[data-visual-toggle="previous"]');
	const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
	const emitUiSound = () => soundManager.playUiClick();

	navToggleBtn?.addEventListener('click', () => {
		emitUiSound();
		toggleNavExpansion();
	});
	navPeekBtn?.addEventListener('click', () => {
		emitUiSound();
		toggleNavExpansion(true);
	});
	flyoutCloseBtn?.addEventListener('click', () => {
		emitUiSound();
		setAppState({ activeFlyout: '' });
	});

	flyoutTriggers.forEach((trigger) => {
		const flyoutId = trigger.getAttribute('data-flyout-trigger');
		if (!flyoutId) return;

		trigger.addEventListener('click', (event) => {
			event.preventDefault();
			emitUiSound();
			const current = getAppState();
			const isSame = current.activeFlyout === flyoutId && current.navExpanded;
			setAppState({
				navExpanded: true,
				activeFlyout: isSame ? '' : flyoutId
			});
		});

		if (supportsHover) {
			trigger.addEventListener('mouseenter', () => {
				if (!getAppState().navExpanded) return;
				setAppState({ activeFlyout: flyoutId });
			});
		}

		trigger.addEventListener('focus', () => {
			if (!getAppState().navExpanded) return;
			setAppState({ activeFlyout: flyoutId });
		});
	});

	if (supportsHover && flyoutPanel) {
		flyoutPanel.addEventListener('mouseleave', () => {
			setAppState({ activeFlyout: '' });
		});
	}

	themeToggle?.addEventListener('click', () => {
		emitUiSound();
		const theme = getAppState().theme;
		setTheme(theme === 'dark' ? 'light' : 'dark');
	});

	soundToggles.forEach((toggle) => {
		const category = toggle.getAttribute('data-sound-toggle');
		toggle.addEventListener('click', () => {
			emitUiSound();
			const state = getAppState();
			if (category === 'ui') {
				setAppState({ uiSoundsEnabled: !state.uiSoundsEnabled });
			} else if (category === 'game') {
				setAppState({ gameplaySoundsEnabled: !state.gameplaySoundsEnabled });
			}
		});
	});

	animationToggle?.addEventListener('click', () => {
		emitUiSound();
		const state = getAppState();
		setAppState({ animationsEnabled: !state.animationsEnabled });
	});

	validMovesToggle?.addEventListener('click', () => {
		emitUiSound();
		const current = getAppState();
		setAppState({ showValidMoves: !current.showValidMoves });
	});

	previousMoveToggle?.addEventListener('click', () => {
		emitUiSound();
		const current = getAppState();
		setAppState({ showPreviousMove: !current.showPreviousMove });
	});
}

function observeLayoutChrome() {
	const appShell = document.querySelector('[data-app-shell]');
	const themeToggle = document.querySelector('[data-theme-toggle]');
	const themeLabel = document.querySelector('[data-theme-toggle-label]');
	const uiSoundToggle = document.querySelector('[data-sound-toggle="ui"]');
	const uiSoundLabel = document.querySelector('[data-ui-sound-label]');
	const gameSoundToggle = document.querySelector('[data-sound-toggle="game"]');
	const gameSoundLabel = document.querySelector('[data-game-sound-label]');
	const animationToggle = document.querySelector('[data-animation-toggle]');
	const animationLabel = document.querySelector('[data-animation-label]');
	const validMovesToggle = document.querySelector('[data-visual-toggle="valid"]');
	const validMovesLabel = document.querySelector('[data-valid-moves-label]');
	const previousMoveToggle = document.querySelector('[data-visual-toggle="previous"]');
	const previousMoveLabel = document.querySelector('[data-previous-move-label]');
	const initialState = getAppState();
	let lastNavExpanded = initialState.navExpanded;
	let lastFlyout = initialState.activeFlyout;
	let lastShowValidMoves = initialState.showValidMoves;
	let lastShowPreviousMove = initialState.showPreviousMove;

	subscribeToAppState((state) => {
		document.body?.setAttribute('data-view', state.view);
		document.body?.setAttribute('data-theme', state.theme);
		if (appShell) {
			appShell.setAttribute('data-nav-expanded', state.navExpanded ? 'true' : 'false');
			appShell.setAttribute('data-flyout-active', state.activeFlyout ?? '');
		}

		const isDarkTheme = state.theme === 'dark';
		themeToggle?.setAttribute('aria-pressed', isDarkTheme ? 'true' : 'false');
		if (themeLabel) themeLabel.textContent = isDarkTheme ? 'Dark' : 'Light';

		uiSoundToggle?.setAttribute('aria-pressed', state.uiSoundsEnabled ? 'true' : 'false');
		if (uiSoundLabel) uiSoundLabel.textContent = state.uiSoundsEnabled ? 'On' : 'Muted';

		const gameplayEnabled = state.gameplaySoundsEnabled;
		gameSoundToggle?.setAttribute('aria-pressed', gameplayEnabled ? 'true' : 'false');
		if (gameSoundLabel) gameSoundLabel.textContent = gameplayEnabled ? 'On' : 'Muted';

		soundManager.setUiEnabled(state.uiSoundsEnabled);
		soundManager.setGameplayEnabled(gameplayEnabled);

		animationToggle?.setAttribute('aria-pressed', state.animationsEnabled ? 'true' : 'false');
		if (animationLabel) animationLabel.textContent = state.animationsEnabled ? 'On' : 'Off';

		validMovesToggle?.setAttribute('aria-pressed', state.showValidMoves ? 'true' : 'false');
		if (validMovesLabel) validMovesLabel.textContent = state.showValidMoves ? 'On' : 'Off';

		previousMoveToggle?.setAttribute('aria-pressed', state.showPreviousMove ? 'true' : 'false');
		if (previousMoveLabel) previousMoveLabel.textContent = state.showPreviousMove ? 'On' : 'Off';

		if (state.navExpanded !== lastNavExpanded) {
			lastNavExpanded = state.navExpanded;
			queueCanvasResize();
		}
		if (state.activeFlyout !== lastFlyout) {
			lastFlyout = state.activeFlyout;
			queueCanvasResize();
		}
		if (state.showValidMoves !== lastShowValidMoves || state.showPreviousMove !== lastShowPreviousMove) {
			lastShowValidMoves = state.showValidMoves;
			lastShowPreviousMove = state.showPreviousMove;
			boardGraphicsApi?.rerenderLastFrame?.();
		}
	});
}

function toggleNavExpansion(forceState) {
	const current = getAppState();
	const desired = typeof forceState === 'boolean' ? forceState : !current.navExpanded;
	setAppState({ navExpanded: desired });
}

function setTheme(theme) {
	if (theme !== 'dark' && theme !== 'light') return;
	setAppState({ theme });
}

function queueCanvasResize() {
	const canvas = document.getElementById('modernGameCanvas');
	if (!canvas) return;
	requestAnimationFrame(() => {
		if (syncCanvasSize(canvas)) {
			boardGraphicsApi?.rerenderLastFrame?.();
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
		setTheme,
		toggleNav(state) {
			toggleNavExpansion(state);
		},
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
			return getAppState();
		}
	};
}

function setAppView(view) {
	const current = getAppState();
	const patch = { view };
	if (view === 'game' && current.view !== 'game' && current.navExpanded) {
		patch.navExpanded = false;
	} else if (view !== 'game' && current.view === 'game' && !current.navExpanded) {
		patch.navExpanded = true;
	}
	setAppState(patch);
}

function hydrateFromServerState(snapshot) {
	if (!snapshot) return;
	applySerializedState(snapshot, { reason: 'server-sync' });
}


