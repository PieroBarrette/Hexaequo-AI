/**
 * Game Store - Centralized Game State Management
 * 
 * Manages the canonical game state with observable pattern.
 * Provides immutable updates and previous state tracking.
 */

import { INITIAL_GAME_STATE, createInitialState } from '../../shared/game/gameState.js';

/**
 * @typedef {Object} GameState
 * @property {Object.<string, string>} tiles - Map of "q,r" -> "black"|"white"
 * @property {Object.<string, {type: string, color: string}>} pieces - Map of "q,r" -> piece
 * @property {Object.<string, number>} inventory - Tile inventory per player
 * @property {Object.<string, number>} discInventory - Disc inventory per player
 * @property {Object.<string, number>} ringInventory - Ring inventory per player
 * @property {Object} captured - Captured pieces count
 * @property {string} activePlayer - Current player ("black"|"white")
 * @property {Object|null} lastMove - Last move made
 * @property {Object} metadata - Additional game metadata
 */

// Private state
let currentState = null;
let previousState = null;
const subscribers = new Set();

/**
 * Deep clone an object
 */
function deepClone(obj) {
    if (typeof structuredClone === 'function') {
        return structuredClone(obj);
    }
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Notify all subscribers of state change
 */
function notifySubscribers() {
    const state = getGameState();
    subscribers.forEach(callback => {
        try {
            callback(state);
        } catch (error) {
            console.error('Subscriber error:', error);
        }
    });
}

/**
 * Initialize the game store with default state
 */
function initializeStore() {
    currentState = createInitialState();
    previousState = null;
}

// Initialize on module load
initializeStore();

/**
 * Get the current game state (immutable copy)
 * @returns {GameState}
 */
export function getGameState() {
    return deepClone(currentState);
}

/**
 * Get the previous game state (immutable copy)
 * @returns {GameState|null}
 */
export function getPreviousGameState() {
    return previousState ? deepClone(previousState) : null;
}

/**
 * Update game state with an update function
 * @param {function(GameState): GameState} updateFn - Function that receives state and returns new state
 * @param {boolean} [skipNotify=false] - Skip notifying subscribers
 */
export function updateGameState(updateFn, skipNotify = false) {
    previousState = deepClone(currentState);
    const newState = updateFn(deepClone(currentState));
    currentState = newState;
    
    if (!skipNotify) {
        notifySubscribers();
    }
}

/**
 * Set the entire game state
 * @param {GameState} newState - New state to set
 * @param {boolean} [skipNotify=false] - Skip notifying subscribers
 */
export function setGameState(newState, skipNotify = false) {
    previousState = deepClone(currentState);
    currentState = deepClone(newState);
    
    if (!skipNotify) {
        notifySubscribers();
    }
}

/**
 * Reset game state to initial values
 */
export function resetGameState() {
    previousState = deepClone(currentState);
    currentState = createInitialState();
    notifySubscribers();
}

/**
 * Apply a serialized state from network/storage
 * @param {Object} snapshot - Serialized game state
 */
export function applySerializedState(snapshot) {
    previousState = deepClone(currentState);
    currentState = {
        tiles: snapshot.tiles || {},
        pieces: snapshot.pieces || {},
        inventory: snapshot.inventory || { black: 7, white: 7 },
        discInventory: snapshot.discInventory || { black: 5, white: 5 },
        ringInventory: snapshot.ringInventory || { black: 3, white: 3 },
        captured: {
            black: { disc: 0, ring: 0 },
            white: { disc: 0, ring: 0 },
            ...snapshot.captured
        },
        activePlayer: snapshot.activePlayer || 'black',
        lastMove: snapshot.lastMove || null,
        metadata: {
            multiJumping: false,
            jumpHistory: [],
            moveHistory: [],
            selection: null,
            validMoves: [],
            lastJumpPath: null,
            dragState: null,
            ...snapshot.metadata
        }
    };
    notifySubscribers();
}

/**
 * Serialize current state for network/storage
 * @returns {Object}
 */
export function serializeCurrentState() {
    return {
        tiles: currentState.tiles,
        pieces: currentState.pieces,
        inventory: currentState.inventory,
        discInventory: currentState.discInventory,
        ringInventory: currentState.ringInventory,
        captured: currentState.captured,
        activePlayer: currentState.activePlayer,
        lastMove: currentState.lastMove
    };
}

/**
 * Subscribe to state changes
 * @param {function(GameState): void} callback - Function to call on state change
 * @returns {function(): void} Unsubscribe function
 */
export function subscribeToGameState(callback) {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
}

/**
 * Game Store object for default export
 */
export const gameStore = {
    getState: getGameState,
    getPreviousState: getPreviousGameState,
    update: updateGameState,
    set: setGameState,
    reset: resetGameState,
    applySerializedState,
    serialize: serializeCurrentState,
    subscribe: subscribeToGameState
};

export default gameStore;
