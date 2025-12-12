/**
 * App Store - Application State Management
 * 
 * Manages UI state, user preferences, and session data.
 * Persists preferences to localStorage.
 */

const STORAGE_KEY = 'hexaequo.app.preferences';

/**
 * @typedef {Object} AppState
 * @property {string} view - Current view/screen
 * @property {string} connectionStatus - Network status
 * @property {string|null} roomCode - Current room code
 * @property {string|null} playerColor - Player's color in online mode
 * @property {string|null} lastError - Last error message
 * @property {string} theme - Color theme
 * @property {boolean} uiSoundsEnabled - UI sound effects
 * @property {boolean} gameplaySoundsEnabled - Gameplay sound effects
 * @property {boolean} animationsEnabled - Animations enabled
 * @property {boolean} showValidMoves - Show valid move indicators
 * @property {boolean} showPreviousMove - Show previous move highlight
 * @property {boolean} navExpanded - Navigation rail expanded
 * @property {string} activeFlyout - Active flyout panel
 * @property {string} gameMode - Current game mode
 * @property {number} aiDifficulty - AI difficulty level
 * @property {boolean} aiThinking - AI is computing
 * @property {Object} lobby - Lobby preferences
 * @property {Object} matchSettings - Match settings
 * @property {Object} players - Player profiles
 * @property {string} learnView - Current learn view
 */

/**
 * Default application state
 */
const DEFAULT_STATE = {
    // View state
    view: 'game',
    connectionStatus: 'disconnected',
    roomCode: null,
    playerColor: null,
    lastError: null,

    // User preferences (persisted)
    theme: 'dark',
    uiSoundsEnabled: true,
    gameplaySoundsEnabled: true,
    animationsEnabled: true,
    showValidMoves: false,
    showPreviousMove: true,

    // UI state
    navExpanded: false,
    activeFlyout: null,

    // Game mode
    gameMode: 'local',
    aiDifficulty: 3,
    aiThinking: false,

    // Lobby settings
    lobby: {
        pseudo: 'Player',
        timeMode: 'none',
        allowSpectators: true
    },

    // Match settings
    matchSettings: {
        timerMode: 'none',
        allowSpectators: true
    },

    // Player profiles
    players: {
        black: { pseudo: 'Black', elo: null },
        white: { pseudo: 'White', elo: null }
    },

    // Learn section
    learnView: 'tutorial'
};

// Preferences that should be persisted
const PERSISTED_KEYS = [
    'theme',
    'uiSoundsEnabled',
    'gameplaySoundsEnabled',
    'animationsEnabled',
    'showValidMoves',
    'showPreviousMove',
    'lobby',
    'aiDifficulty'
];

// Private state
let currentState = null;
const subscribers = new Set();

/**
 * Load preferences from localStorage
 */
function loadPreferences() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (error) {
        console.warn('Failed to load preferences:', error);
    }
    return {};
}

/**
 * Save preferences to localStorage
 */
function savePreferences(state) {
    try {
        const toSave = {};
        PERSISTED_KEYS.forEach(key => {
            if (state[key] !== undefined) {
                toSave[key] = state[key];
            }
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (error) {
        console.warn('Failed to save preferences:', error);
    }
}

/**
 * Notify all subscribers of state change
 */
function notifySubscribers() {
    const state = getAppState();
    subscribers.forEach(callback => {
        try {
            callback(state);
        } catch (error) {
            console.error('Subscriber error:', error);
        }
    });
}

/**
 * Initialize the app store
 */
function initializeStore() {
    const savedPrefs = loadPreferences();
    currentState = {
        ...DEFAULT_STATE,
        ...savedPrefs,
        lobby: {
            ...DEFAULT_STATE.lobby,
            ...(savedPrefs.lobby || {})
        },
        players: {
            ...DEFAULT_STATE.players
        }
    };
}

// Initialize on module load
initializeStore();

/**
 * Get the current app state (shallow copy)
 * @returns {AppState}
 */
export function getAppState() {
    return { ...currentState };
}

/**
 * Update app state with a partial update
 * @param {Partial<AppState>} patch - Partial state update
 */
export function setAppState(patch) {
    currentState = {
        ...currentState,
        ...patch
    };
    
    // Check if any persisted keys were updated
    const shouldSave = PERSISTED_KEYS.some(key => key in patch);
    if (shouldSave) {
        savePreferences(currentState);
    }
    
    notifySubscribers();
}

/**
 * Reset app state to defaults
 */
export function resetAppState() {
    currentState = { ...DEFAULT_STATE };
    localStorage.removeItem(STORAGE_KEY);
    notifySubscribers();
}

/**
 * Subscribe to app state changes
 * @param {function(AppState): void} callback - Function to call on state change
 * @returns {function(): void} Unsubscribe function
 */
export function subscribeToAppState(callback) {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
}

/**
 * Update lobby preferences
 * @param {Partial} patch - Lobby settings patch
 */
export function updateLobbyPreferences(patch) {
    setAppState({
        lobby: {
            ...currentState.lobby,
            ...patch
        }
    });
}

/**
 * Update match settings
 * @param {Partial} patch - Match settings patch
 */
export function updateMatchSettings(patch) {
    setAppState({
        matchSettings: {
            ...currentState.matchSettings,
            ...patch
        }
    });
}

/**
 * Update player profile
 * @param {string} color - 'black' or 'white'
 * @param {Partial} patch - Player profile patch
 */
export function updatePlayerProfile(color, patch) {
    setAppState({
        players: {
            ...currentState.players,
            [color]: {
                ...currentState.players[color],
                ...patch
            }
        }
    });
}

/**
 * App Store object for default export
 */
export const appStore = {
    getState: getAppState,
    set: setAppState,
    reset: resetAppState,
    subscribe: subscribeToAppState,
    updateLobbyPreferences,
    updateMatchSettings,
    updatePlayerProfile
};

export default appStore;
