/**
 * Game State - State initialization and serialization
 * 
 * Provides functions for creating and managing game state.
 * Shared between frontend and backend.
 */

import { 
    INITIAL_TILES, 
    INITIAL_DISCS, 
    INITIAL_RINGS,
    PLAYERS 
} from './constants.js';

/**
 * Initial game state structure
 */
export const INITIAL_GAME_STATE = {
    tiles: {
        '0,0': 'black',
        '1,0': 'black',
        '-1,1': 'white',
        '0,1': 'white'
    },
    pieces: {
        '1,0': { type: 'disc', color: 'black' },
        '-1,1': { type: 'disc', color: 'white' }
    },
    inventory: {
        black: INITIAL_TILES,
        white: INITIAL_TILES
    },
    discInventory: {
        black: INITIAL_DISCS,
        white: INITIAL_DISCS
    },
    ringInventory: {
        black: INITIAL_RINGS,
        white: INITIAL_RINGS
    },
    captured: {
        black: { disc: 0, ring: 0 },
        white: { disc: 0, ring: 0 }
    },
    activePlayer: PLAYERS.BLACK,
    lastMove: null,
    metadata: {
        multiJumping: false,
        jumpHistory: [],
        moveHistory: [],
        selection: null,
        validMoves: [],
        lastJumpPath: null,
        dragState: null
    }
};

/**
 * Create a fresh initial game state
 * @returns {Object} New game state
 */
export function createInitialState() {
    return JSON.parse(JSON.stringify(INITIAL_GAME_STATE));
}

/**
 * Create initial state for server (different format)
 * @returns {Object} Server-format game state
 */
export function createServerInitialState() {
    return {
        tiles: {
            '0,0': 'black',
            '1,0': 'black',
            '-1,1': 'white',
            '0,1': 'white'
        },
        pieces: {
            '1,0': { type: 'disc', color: 'black' },
            '-1,1': { type: 'disc', color: 'white' }
        },
        inventory: {
            black: { tiles: INITIAL_TILES, discs: INITIAL_DISCS, rings: INITIAL_RINGS },
            white: { tiles: INITIAL_TILES, discs: INITIAL_DISCS, rings: INITIAL_RINGS }
        },
        captured: {
            black_discs: 0,
            black_rings: 0,
            white_discs: 0,
            white_rings: 0
        },
        activePlayer: PLAYERS.BLACK
    };
}

/**
 * Serialize game state for network transmission
 * @param {Object} state - Game state
 * @returns {Object} Serialized state
 */
export function serializeState(state) {
    return {
        tiles: state.tiles,
        pieces: state.pieces,
        inventory: state.inventory,
        discInventory: state.discInventory,
        ringInventory: state.ringInventory,
        captured: state.captured,
        activePlayer: state.activePlayer,
        lastMove: state.lastMove
    };
}

/**
 * Deserialize game state from network
 * @param {Object} data - Serialized state
 * @returns {Object} Full game state
 */
export function deserializeState(data) {
    return {
        tiles: data.tiles || {},
        pieces: data.pieces || {},
        inventory: data.inventory || { black: INITIAL_TILES, white: INITIAL_TILES },
        discInventory: data.discInventory || { black: INITIAL_DISCS, white: INITIAL_DISCS },
        ringInventory: data.ringInventory || { black: INITIAL_RINGS, white: INITIAL_RINGS },
        captured: data.captured || {
            black: { disc: 0, ring: 0 },
            white: { disc: 0, ring: 0 }
        },
        activePlayer: data.activePlayer || PLAYERS.BLACK,
        lastMove: data.lastMove || null,
        metadata: {
            multiJumping: false,
            jumpHistory: [],
            moveHistory: [],
            selection: null,
            validMoves: [],
            lastJumpPath: null,
            dragState: null
        }
    };
}

/**
 * Convert between frontend and server state formats
 * @param {Object} serverState - Server format state
 * @returns {Object} Frontend format state
 */
export function serverToFrontendState(serverState) {
    // Handle server format with nested inventory
    const inventory = serverState.inventory;
    let tileInventory, discInventory, ringInventory;

    if (typeof inventory.black === 'object') {
        // Server format: { black: { tiles, discs, rings }, white: { tiles, discs, rings } }
        tileInventory = {
            black: inventory.black.tiles,
            white: inventory.white.tiles
        };
        discInventory = {
            black: inventory.black.discs,
            white: inventory.white.discs
        };
        ringInventory = {
            black: inventory.black.rings,
            white: inventory.white.rings
        };
    } else {
        // Already frontend format
        tileInventory = inventory;
        discInventory = serverState.discInventory || { black: INITIAL_DISCS, white: INITIAL_DISCS };
        ringInventory = serverState.ringInventory || { black: INITIAL_RINGS, white: INITIAL_RINGS };
    }

    // Handle captured format
    let captured;
    if ('black_discs' in serverState.captured) {
        // Server format
        captured = {
            black: {
                disc: serverState.captured.black_discs,
                ring: serverState.captured.black_rings
            },
            white: {
                disc: serverState.captured.white_discs,
                ring: serverState.captured.white_rings
            }
        };
    } else {
        // Already frontend format
        captured = serverState.captured;
    }

    return {
        tiles: serverState.tiles,
        pieces: serverState.pieces,
        inventory: tileInventory,
        discInventory: discInventory,
        ringInventory: ringInventory,
        captured: captured,
        activePlayer: serverState.activePlayer,
        lastMove: serverState.lastMove || null,
        metadata: {
            multiJumping: false,
            jumpHistory: [],
            moveHistory: [],
            selection: null,
            validMoves: [],
            lastJumpPath: null,
            dragState: null
        }
    };
}

/**
 * Convert frontend state to server format
 * @param {Object} frontendState - Frontend format state
 * @returns {Object} Server format state
 */
export function frontendToServerState(frontendState) {
    return {
        tiles: frontendState.tiles,
        pieces: frontendState.pieces,
        inventory: {
            black: {
                tiles: frontendState.inventory.black,
                discs: frontendState.discInventory.black,
                rings: frontendState.ringInventory.black
            },
            white: {
                tiles: frontendState.inventory.white,
                discs: frontendState.discInventory.white,
                rings: frontendState.ringInventory.white
            }
        },
        captured: {
            black_discs: frontendState.captured.black.disc,
            black_rings: frontendState.captured.black.ring,
            white_discs: frontendState.captured.white.disc,
            white_rings: frontendState.captured.white.ring
        },
        activePlayer: frontendState.activePlayer
    };
}

/**
 * Check if two states are equivalent
 * @param {Object} state1 - First state
 * @param {Object} state2 - Second state
 * @returns {boolean}
 */
export function statesEqual(state1, state2) {
    return JSON.stringify(serializeState(state1)) === JSON.stringify(serializeState(state2));
}

/**
 * Get the opponent color
 * @param {string} color - Current color
 * @returns {string} Opponent color
 */
export function getOpponent(color) {
    return color === PLAYERS.BLACK ? PLAYERS.WHITE : PLAYERS.BLACK;
}

export default {
    INITIAL_GAME_STATE,
    createInitialState,
    createServerInitialState,
    serializeState,
    deserializeState,
    serverToFrontendState,
    frontendToServerState,
    statesEqual,
    getOpponent
};
