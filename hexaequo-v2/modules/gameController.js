/**
 * Hexaequo - Game Controller Module
 * 
 * Game actions and flow management.
 * Contains logic for game moves, turn management, and win conditions.
 */

import { toKey, parseKey, getNeighbors, HEX_DIRECTIONS, RING_DIRECTIONS } from './hexMath.js';
import { 
    BOARD_RADIUS, 
    getOpponent, 
    cloneState, 
    checkVictory,
    hasActivePieces 
} from './gameState.js';
import { 
    canPlaceTile, 
    canPlaceDisc, 
    canPlaceRing,
    getValidMovesForPiece,
    canJumpAgain,
    hasAnyLegalMove
} from './moveValidator.js';

// ==================== Tile Actions ====================

/**
 * Place a tile on the board
 * @param {Object} state - Game state (will be mutated)
 * @param {number} q - Target q coordinate
 * @param {number} r - Target r coordinate
 * @param {string} player - Player color
 * @returns {{ success: boolean, message?: string }}
 */
export function placeTile(state, q, r, player) {
    if (!canPlaceTile(state.tiles, q, r, player, state.inventory)) {
        return { success: false, message: 'Cannot place tile here' };
    }
    
    const key = toKey(q, r);
    state.tiles[key] = player;
    state.inventory[player]--;
    
    return { success: true };
}

// ==================== Piece Placement Actions ====================

/**
 * Place a disc on the board
 * @param {Object} state - Game state (will be mutated)
 * @param {number} q - Target q coordinate
 * @param {number} r - Target r coordinate
 * @param {string} player - Player color
 * @returns {{ success: boolean, message?: string }}
 */
export function placeDisc(state, q, r, player) {
    if (!canPlaceDisc(state.tiles, state.pieces, q, r, player, state.discInventory)) {
        return { success: false, message: 'Cannot place disc here' };
    }
    
    const key = toKey(q, r);
    state.pieces[key] = { type: 'disc', color: player };
    state.discInventory[player]--;
    
    return { success: true };
}

/**
 * Place a ring on the board (returns a captured disc to opponent)
 * @param {Object} state - Game state (will be mutated)
 * @param {number} q - Target q coordinate
 * @param {number} r - Target r coordinate
 * @param {string} player - Player color
 * @returns {{ success: boolean, message?: string }}
 */
export function placeRing(state, q, r, player) {
    if (!canPlaceRing(state.tiles, state.pieces, q, r, player, state.ringInventory, state.captured)) {
        return { success: false, message: 'Cannot place ring here' };
    }
    
    const key = toKey(q, r);
    const opponent = getOpponent(player);
    
    state.pieces[key] = { type: 'ring', color: player };
    state.ringInventory[player]--;
    state.captured[player].disc--;
    state.discInventory[opponent]++;
    
    return { success: true };
}

// ==================== Piece Movement Actions ====================

/**
 * Move a disc to an adjacent empty tile
 * @param {Object} state - Game state (will be mutated)
 * @param {number} fromQ - Source q coordinate
 * @param {number} fromR - Source r coordinate
 * @param {number} toQ - Target q coordinate
 * @param {number} toR - Target r coordinate
 * @param {string} player - Player color
 * @returns {{ success: boolean, message?: string }}
 */
export function moveDiscAdjacent(state, fromQ, fromR, toQ, toR, player) {
    const fromKey = toKey(fromQ, fromR);
    const toKey_ = toKey(toQ, toR);
    const piece = state.pieces[fromKey];
    
    // Validate
    if (!piece || piece.type !== 'disc' || piece.color !== player) {
        return { success: false, message: 'No valid disc at source' };
    }
    if (!state.tiles[toKey_] || state.pieces[toKey_]) {
        return { success: false, message: 'Target is not valid' };
    }
    
    // Execute move
    delete state.pieces[fromKey];
    state.pieces[toKey_] = piece;
    
    return { success: true };
}

/**
 * Perform a disc jump (capture or friendly leap)
 * @param {Object} state - Game state (will be mutated)
 * @param {number} fromQ - Source q coordinate
 * @param {number} fromR - Source r coordinate
 * @param {number} toQ - Target q coordinate
 * @param {number} toR - Target r coordinate
 * @param {number} overQ - Jumped piece q coordinate
 * @param {number} overR - Jumped piece r coordinate
 * @param {string} player - Player color
 * @returns {{ success: boolean, captured?: Object, isCapture: boolean, message?: string }}
 */
export function jumpDisc(state, fromQ, fromR, toQ, toR, overQ, overR, player) {
    const fromKey = toKey(fromQ, fromR);
    const toKey_ = toKey(toQ, toR);
    const overKey = toKey(overQ, overR);
    
    const piece = state.pieces[fromKey];
    const jumpedPiece = state.pieces[overKey];
    
    // Validate
    if (!piece || piece.type !== 'disc' || piece.color !== player) {
        return { success: false, message: 'No valid disc at source' };
    }
    if (!jumpedPiece) {
        return { success: false, message: 'No piece to jump over' };
    }
    if (!state.tiles[toKey_] || state.pieces[toKey_]) {
        return { success: false, message: 'Landing position not valid' };
    }
    
    const isCapture = jumpedPiece.color !== player;
    let captured = null;
    
    // Execute jump
    delete state.pieces[fromKey];
    state.pieces[toKey_] = piece;
    
    // Handle capture
    if (isCapture) {
        delete state.pieces[overKey];
        state.captured[player][jumpedPiece.type]++;
        captured = { ...jumpedPiece, q: overQ, r: overR };
    }
    
    return { success: true, captured, isCapture };
}

/**
 * Move a ring
 * @param {Object} state - Game state (will be mutated)
 * @param {number} fromQ - Source q coordinate
 * @param {number} fromR - Source r coordinate
 * @param {number} toQ - Target q coordinate
 * @param {number} toR - Target r coordinate
 * @param {string} player - Player color
 * @returns {{ success: boolean, captured?: Object, message?: string }}
 */
export function moveRing(state, fromQ, fromR, toQ, toR, player) {
    const fromKey = toKey(fromQ, fromR);
    const toKey_ = toKey(toQ, toR);
    
    const piece = state.pieces[fromKey];
    
    // Validate
    if (!piece || piece.type !== 'ring' || piece.color !== player) {
        return { success: false, message: 'No valid ring at source' };
    }
    if (!state.tiles[toKey_]) {
        return { success: false, message: 'Target is not a valid tile' };
    }
    
    const targetPiece = state.pieces[toKey_];
    let captured = null;
    
    // Cannot land on friendly pieces
    if (targetPiece && targetPiece.color === player) {
        return { success: false, message: 'Cannot capture own piece' };
    }
    
    // Handle capture
    if (targetPiece) {
        state.captured[player][targetPiece.type]++;
        captured = { ...targetPiece, q: toQ, r: toR };
    }
    
    // Execute move
    delete state.pieces[fromKey];
    state.pieces[toKey_] = piece;
    
    return { success: true, captured };
}

// ==================== Turn Management ====================

/**
 * End the current player's turn
 * @param {Object} state - Game state (will be mutated)
 * @returns {{ nextPlayer: string }}
 */
export function endTurn(state) {
    state.activePlayer = getOpponent(state.activePlayer);
    return { nextPlayer: state.activePlayer };
}

/**
 * Reset multi-jump state
 * @param {Object} multiJumpState - Multi-jump tracking state
 */
export function resetMultiJumpState(multiJumpState) {
    multiJumpState.isMultiJumping = false;
    multiJumpState.multiJumpPos = null;
    multiJumpState.jumpHistory = [];
    multiJumpState.turnStartPos = null;
    multiJumpState.hasCaptured = false;
}

// ==================== Game End Detection ====================

/**
 * Check if the game has ended
 * @param {Object} state - Game state
 * @returns {{ gameOver: boolean, winner?: string, reason?: string }}
 */
export function checkGameEnd(state) {
    const { activePlayer } = state;
    const opponent = getOpponent(activePlayer);
    
    // Check victory conditions (captured pieces)
    const victory = checkVictory(state.captured);
    if (victory.winner) {
        return { gameOver: true, winner: victory.winner, reason: 'capture' };
    }
    
    // Check if opponent has no pieces left
    if (!hasActivePieces(state.pieces, opponent)) {
        return { gameOver: true, winner: activePlayer, reason: 'elimination' };
    }
    
    // Check stalemate (active player has no legal moves)
    if (!hasAnyLegalMove(state, activePlayer)) {
        return { gameOver: true, winner: opponent, reason: 'stalemate' };
    }
    
    return { gameOver: false };
}

// ==================== Move History ====================

/**
 * Create a move record for history
 * @param {string} type - Move type: 'tile', 'disc', 'ring', 'move', 'jump', 'capture'
 * @param {Object} details - Move details
 * @returns {Object} Move record
 */
export function createMoveRecord(type, details) {
    return {
        type,
        timestamp: Date.now(),
        ...details
    };
}

// ==================== Position Hash for Repetition ====================

/**
 * Calculate position hash for threefold repetition detection
 * @param {Object} state - Game state
 * @returns {string} Position hash
 */
export function getPositionHash(state) {
    const { tiles, pieces, activePlayer } = state;
    
    // Sort for consistent hashing
    const tileEntries = Object.entries(tiles).sort((a, b) => a[0].localeCompare(b[0]));
    const pieceEntries = Object.entries(pieces).sort((a, b) => a[0].localeCompare(b[0]));
    
    const tileStr = tileEntries.map(([k, v]) => `${k}:${v}`).join('|');
    const pieceStr = pieceEntries.map(([k, v]) => `${k}:${v.type}:${v.color}`).join('|');
    
    return `${activePlayer}|${tileStr}|${pieceStr}`;
}

/**
 * Check for threefold repetition
 * @param {Array<string>} positionHistory - Array of position hashes
 * @param {string} currentHash - Current position hash
 * @returns {boolean} True if position has appeared 3+ times
 */
export function checkThreefoldRepetition(positionHistory, currentHash) {
    const count = positionHistory.filter(h => h === currentHash).length;
    return count >= 3;
}

// ==================== State Transitions ====================

/**
 * Apply an online move to the state
 * @param {Object} state - Game state (will be mutated)
 * @param {Object} moveData - Move data from server
 * @returns {{ success: boolean, message?: string }}
 */
export function applyOnlineMove(state, moveData) {
    const { moveType, player } = moveData;
    
    switch (moveType) {
        case 'placeTile': {
            const { q, r } = moveData;
            return placeTile(state, q, r, player);
        }
        case 'placeDisc': {
            const { q, r } = moveData;
            return placeDisc(state, q, r, player);
        }
        case 'placeRing': {
            const { q, r } = moveData;
            return placeRing(state, q, r, player);
        }
        case 'moveDisc': {
            const { fromQ, fromR, toQ, toR } = moveData;
            return moveDiscAdjacent(state, fromQ, fromR, toQ, toR, player);
        }
        case 'jumpDisc': {
            const { fromQ, fromR, toQ, toR, overQ, overR } = moveData;
            return jumpDisc(state, fromQ, fromR, toQ, toR, overQ, overR, player);
        }
        case 'moveRing': {
            const { fromQ, fromR, toQ, toR } = moveData;
            return moveRing(state, fromQ, fromR, toQ, toR, player);
        }
        case 'endTurn': {
            return endTurn(state);
        }
        default:
            return { success: false, message: `Unknown move type: ${moveType}` };
    }
}

// ==================== Default Export ====================

export default {
    // Tile actions
    placeTile,
    // Piece placement
    placeDisc,
    placeRing,
    // Piece movement
    moveDiscAdjacent,
    jumpDisc,
    moveRing,
    // Turn management
    endTurn,
    resetMultiJumpState,
    // Game end
    checkGameEnd,
    // History
    createMoveRecord,
    getPositionHash,
    checkThreefoldRepetition,
    // State transitions
    applyOnlineMove
};
