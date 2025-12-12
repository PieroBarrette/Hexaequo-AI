/**
 * Hexaequo - Game State Module
 * 
 * Manages game state creation, serialization, and constants.
 * Pure functions with no side effects.
 */

// ==================== Game Constants ====================

/**
 * Board configuration
 */
export const BOARD_RADIUS = 8;

/**
 * Initial inventory counts
 */
export const INITIAL_INVENTORY = {
    tiles: 7,
    discs: 5,
    rings: 3
};

/**
 * Victory conditions
 */
export const VICTORY_CONDITIONS = {
    capturedDiscs: 6,
    capturedRings: 3
};

/**
 * Initial tile positions
 */
export const INITIAL_TILES = {
    '0,0': 'black',
    '1,0': 'black',
    '-1,1': 'white',
    '0,1': 'white'
};

/**
 * Initial piece positions
 */
export const INITIAL_PIECES = {
    '1,0': { type: 'disc', color: 'black' },
    '-1,1': { type: 'disc', color: 'white' }
};

// ==================== State Creation ====================

/**
 * Create a fresh initial game state
 * @returns {Object} Initial game state
 */
export function createInitialState() {
    return {
        tiles: { ...INITIAL_TILES },
        pieces: JSON.parse(JSON.stringify(INITIAL_PIECES)),
        inventory: {
            black: INITIAL_INVENTORY.tiles,
            white: INITIAL_INVENTORY.tiles
        },
        discInventory: {
            black: INITIAL_INVENTORY.discs,
            white: INITIAL_INVENTORY.discs
        },
        ringInventory: {
            black: INITIAL_INVENTORY.rings,
            white: INITIAL_INVENTORY.rings
        },
        captured: {
            black: { disc: 0, ring: 0 },
            white: { disc: 0, ring: 0 }
        },
        activePlayer: 'black',
        selectedPiece: null,
        lastMove: null,
        multiJumping: false,
        multiJumpPos: null
    };
}

/**
 * Deep clone a game state
 * @param {Object} state - Game state to clone
 * @returns {Object} Deep cloned state
 */
export function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
}

// ==================== Serialization ====================

/**
 * Serialize game state for network/storage (compact format)
 * @param {Object} state - Internal game state
 * @returns {Object} Serialized state for transmission
 */
export function serializeState(state) {
    return {
        tiles: { ...state.tiles },
        pieces: JSON.parse(JSON.stringify(state.pieces)),
        inventory: {
            black: {
                tiles: state.inventory.black,
                discs: state.discInventory.black,
                rings: state.ringInventory.black
            },
            white: {
                tiles: state.inventory.white,
                discs: state.discInventory.white,
                rings: state.ringInventory.white
            }
        },
        captured: {
            black_discs: state.captured.black.disc,
            black_rings: state.captured.black.ring,
            white_discs: state.captured.white.disc,
            white_rings: state.captured.white.ring
        },
        activePlayer: state.activePlayer
    };
}

/**
 * Deserialize network/storage format back to internal state
 * @param {Object} serialized - Serialized state from network/storage
 * @returns {Object} Internal game state format
 */
export function deserializeState(serialized) {
    return {
        tiles: { ...serialized.tiles },
        pieces: JSON.parse(JSON.stringify(serialized.pieces)),
        inventory: {
            black: serialized.inventory.black.tiles,
            white: serialized.inventory.white.tiles
        },
        discInventory: {
            black: serialized.inventory.black.discs,
            white: serialized.inventory.white.discs
        },
        ringInventory: {
            black: serialized.inventory.black.rings,
            white: serialized.inventory.white.rings
        },
        captured: {
            black: {
                disc: serialized.captured.black_discs,
                ring: serialized.captured.black_rings
            },
            white: {
                disc: serialized.captured.white_discs,
                ring: serialized.captured.white_rings
            }
        },
        activePlayer: serialized.activePlayer,
        selectedPiece: null,
        lastMove: null,
        multiJumping: false,
        multiJumpPos: null
    };
}

// ==================== State Queries ====================

/**
 * Get the opponent color
 * @param {string} player - Current player color
 * @returns {string} Opponent color
 */
export function getOpponent(player) {
    return player === 'black' ? 'white' : 'black';
}

/**
 * Check if a player has any pieces on the board
 * @param {Object} pieces - Pieces map
 * @param {string} player - Player color
 * @returns {boolean} True if player has pieces
 */
export function hasActivePieces(pieces, player) {
    return Object.values(pieces).some(piece => piece.color === player);
}

/**
 * Count pieces for a player
 * @param {Object} pieces - Pieces map
 * @param {string} player - Player color
 * @returns {Object} { discs, rings, total }
 */
export function countPieces(pieces, player) {
    let discs = 0;
    let rings = 0;
    for (const piece of Object.values(pieces)) {
        if (piece.color === player) {
            if (piece.type === 'disc') discs++;
            else if (piece.type === 'ring') rings++;
        }
    }
    return { discs, rings, total: discs + rings };
}

/**
 * Get all pieces for a player
 * @param {Object} pieces - Pieces map
 * @param {string} player - Player color
 * @returns {Array<{key: string, q: number, r: number, type: string}>}
 */
export function getPlayerPieces(pieces, player) {
    const result = [];
    for (const [key, piece] of Object.entries(pieces)) {
        if (piece.color === player) {
            const [q, r] = key.split(',').map(Number);
            result.push({ key, q, r, type: piece.type });
        }
    }
    return result;
}

/**
 * Get all empty tiles owned by a player
 * @param {Object} tiles - Tiles map
 * @param {Object} pieces - Pieces map
 * @param {string} player - Player color
 * @returns {Array<{key: string, q: number, r: number}>}
 */
export function getEmptyPlayerTiles(tiles, pieces, player) {
    const result = [];
    for (const [key, owner] of Object.entries(tiles)) {
        if (owner === player && !pieces[key]) {
            const [q, r] = key.split(',').map(Number);
            result.push({ key, q, r });
        }
    }
    return result;
}

// ==================== Position Hash ====================

/**
 * Generate a hash string for threefold repetition detection
 * @param {Object} serializedState - Serialized game state
 * @returns {string} Position hash
 */
export function getPositionHash(serializedState) {
    // Sort keys for consistent ordering
    const tilesStr = Object.keys(serializedState.tiles).sort()
        .map(k => `${k}:${serializedState.tiles[k]}`).join('|');
    
    const piecesStr = Object.keys(serializedState.pieces).sort()
        .map(k => {
            const p = serializedState.pieces[k];
            return `${k}:${p.type}:${p.color}`;
        }).join('|');
    
    const inv = serializedState.inventory;
    const inventoryStr = `b:${inv.black.tiles},${inv.black.discs},${inv.black.rings}|w:${inv.white.tiles},${inv.white.discs},${inv.white.rings}`;
    
    return `${serializedState.activePlayer}#${tilesStr}#${piecesStr}#${inventoryStr}`;
}

// ==================== Victory Detection ====================

/**
 * Check if a player has won
 * @param {Object} captured - Captured pieces { black: { disc, ring }, white: { disc, ring } }
 * @param {Object} pieces - Current pieces on board (optional for capture-only check)
 * @returns {{ winner: string|null, reason?: string }}
 */
export function checkVictory(captured, pieces = null) {
    // Check capture victories
    if (captured.black.disc >= VICTORY_CONDITIONS.capturedDiscs) {
        return { winner: 'black', reason: 'capturing 6 discs' };
    }
    if (captured.black.ring >= VICTORY_CONDITIONS.capturedRings) {
        return { winner: 'black', reason: 'capturing 3 rings' };
    }
    if (pieces && !hasActivePieces(pieces, 'white')) {
        return { winner: 'black', reason: 'eliminating all opponent pieces' };
    }
    
    if (captured.white.disc >= VICTORY_CONDITIONS.capturedDiscs) {
        return { winner: 'white', reason: 'capturing 6 discs' };
    }
    if (captured.white.ring >= VICTORY_CONDITIONS.capturedRings) {
        return { winner: 'white', reason: 'capturing 3 rings' };
    }
    if (pieces && !hasActivePieces(pieces, 'black')) {
        return { winner: 'white', reason: 'eliminating all opponent pieces' };
    }
    
    return { winner: null };
}

// ==================== Default Export ====================

export default {
    // Constants
    BOARD_RADIUS,
    INITIAL_INVENTORY,
    VICTORY_CONDITIONS,
    INITIAL_TILES,
    INITIAL_PIECES,
    // State creation
    createInitialState,
    cloneState,
    // Serialization
    serializeState,
    deserializeState,
    // Queries
    getOpponent,
    hasActivePieces,
    countPieces,
    getPlayerPieces,
    getEmptyPlayerTiles,
    getPositionHash,
    checkVictory
};
