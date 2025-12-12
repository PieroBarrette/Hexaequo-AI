// Lightweight global store for session state, lobby preferences, and HUD metadata.

const PREF_STORAGE_KEY = 'hexaequo.app.preferences';

const DEFAULT_LOBBY_PREFS = {
	pseudo: 'Guest Hexer',
	timeMode: 'rapid',
	allowSpectators: true
};

const DEFAULT_MATCH_SETTINGS = {
	timerMode: 'none',
	allowSpectators: true
};

const DEFAULT_PLAYERS = {
	black: { pseudo: 'Player Black', elo: null },
	white: { pseudo: 'Player White', elo: null }
};

const DEFAULT_STATE = {
	view: 'game',
	connectionStatus: 'disconnected',
	roomCode: null,
	playerColor: null,
	lastError: null,
	theme: 'dark',
	uiSoundsEnabled: true,
	gameplaySoundsEnabled: true,
	animationsEnabled: true,
	showValidMoves: false,
	showPreviousMove: true,
	navExpanded: true,
	activeFlyout: '',
	lobby: { ...DEFAULT_LOBBY_PREFS },
	matchSettings: { ...DEFAULT_MATCH_SETTINGS },
	players: { ...DEFAULT_PLAYERS },
	learnView: 'tutorial'
};

let appState = applyStateGuards({
	...DEFAULT_STATE,
	...loadPersistedPreferences()
});
const subscribers = new Set();

export function getAppState() {
	return appState;
}

export function setAppState(patch, options = {}) {
	const updates = typeof patch === 'function' ? patch(appState) : patch;
	if (!updates) {
		return appState;
	}
	const nextState = applyStateGuards({ ...appState, ...updates }, appState);
	if (nextState === appState) {
		return appState;
	}
	appState = nextState;
	if (options.skipPersist !== true) {
		persistPreferences(appState);
	}
	if (options.skipNotify !== true) {
		notifySubscribers();
	}
	return appState;
}

export function resetAppState(overrides = {}) {
	appState = applyStateGuards({ ...DEFAULT_STATE, ...overrides });
	persistPreferences(appState);
	notifySubscribers();
}

export function subscribeToAppState(listener, options = {}) {
	subscribers.add(listener);
	if (options.emitInitial !== false) {
		listener(appState);
	}
	return () => subscribers.delete(listener);
}

export function updateLobbyPreferences(patch = {}) {
	setAppState((state) => ({
		lobby: {
			...state.lobby,
			...patch
		}
	}));
}

export function updateMatchSettings(patch = {}) {
	setAppState((state) => ({
		matchSettings: {
			...state.matchSettings,
			...patch
		}
	}));
}

export function updatePlayerProfile(color, patch = {}) {
	if (!color || !patch) return;
	const normalized = color === 'white' ? 'white' : 'black';
	setAppState((state) => ({
		players: {
			...state.players,
			[normalized]: {
				...state.players?.[normalized],
				...patch
			}
		}
	}));
}

function notifySubscribers() {
	subscribers.forEach((listener) => {
		try {
			listener(appState);
		} catch (err) {
			console.error('appStore listener error', err);
		}
	});
}

function applyStateGuards(state, previous = null) {
	const next = { ...state };
	next.theme = next.theme === 'light' ? 'light' : 'dark';
	next.navExpanded = next.navExpanded !== false;
	next.activeFlyout = next.navExpanded ? (next.activeFlyout ?? '') : '';
	next.animationsEnabled = next.animationsEnabled !== false;
	next.showValidMoves = Boolean(next.showValidMoves);
	next.showPreviousMove = next.showPreviousMove !== false;
	next.lobby = mergeStructured(next.lobby, DEFAULT_LOBBY_PREFS, previous?.lobby);
	next.matchSettings = mergeStructured(next.matchSettings, DEFAULT_MATCH_SETTINGS, previous?.matchSettings);
	next.players = mergeStructured(next.players, DEFAULT_PLAYERS, previous?.players);
	if (previous && shallowEqual(next, previous)) {
		return previous;
	}
	return next;
}

function mergeStructured(candidate, defaults, previousValue) {
	const merged = { ...defaults, ...(candidate ?? {}) };
	if (previousValue && shallowEqual(merged, previousValue)) {
		return previousValue;
	}
	return merged;
}

function shallowEqual(a, b) {
	if (a === b) return true;
	if (!a || !b) return false;
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const key of keys) {
		if (!Object.is(a[key], b[key])) {
			return false;
		}
	}
	return true;
}

function loadPersistedPreferences() {
	if (typeof window === 'undefined') {
		return {};
	}
	try {
		const raw = window.localStorage.getItem(PREF_STORAGE_KEY);
		if (!raw) {
			return {};
		}
		const parsed = JSON.parse(raw);
		return {
			theme: parsed.theme,
			uiSoundsEnabled: parsed.uiSoundsEnabled,
			gameplaySoundsEnabled: parsed.gameplaySoundsEnabled,
			animationsEnabled: parsed.animationsEnabled,
			showValidMoves: parsed.showValidMoves,
			showPreviousMove: parsed.showPreviousMove,
			lobby: parsed.lobby,
			matchSettings: parsed.matchSettings,
			players: parsed.players
		};
	} catch (err) {
		console.warn('Failed to load stored preferences', err);
		return {};
	}
}

function persistPreferences(state) {
	if (typeof window === 'undefined') {
		return;
	}
	const payload = {
		theme: state.theme,
		uiSoundsEnabled: state.uiSoundsEnabled,
		gameplaySoundsEnabled: state.gameplaySoundsEnabled,
		animationsEnabled: state.animationsEnabled,
		showValidMoves: state.showValidMoves,
		showPreviousMove: state.showPreviousMove,
		lobby: state.lobby,
		matchSettings: state.matchSettings,
		players: state.players
	};
	try {
		window.localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(payload));
	} catch (err) {
		console.warn('Failed to persist app preferences', err);
	}
}
