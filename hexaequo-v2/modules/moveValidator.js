/**
 * Hexaequo - Move Validator Module
 * 
 * Pure functions for move validation and legal move calculation.
 * No side effects - takes state as input, returns results.
 */

import { 
    getNeighbors, 
    HEX_DIRECTIONS, 
    RING_DIRECTIONS, 
    toKey, 
    parseKey,
    isValidHex,
    forEachHex
} from './hexMath.js';

import { BOARD_RADIUS, getOpponent } from './gameState.js';

// ==================== Tile Placement ====================

/**
 * Check if a tile can be placed at a position
 * @param {Object} tiles - Current tiles map
 * @param {number} q - Target q coordinate
 * @param {number} r - Target r coordinate
 * @param {string} player - Player color
 * @param {Object} inventory - Inventory { black: n, white: n }
 * @returns {boolean} True if tile can be placed
 */
export function canPlaceTile(tiles, q, r, player, inventory) {
    const key = toKey(q, r);
    
    // Must have tiles in inventory
    if (inventory[player] <= 0) return false;
    
    // Position must be empty
    if (tiles[key]) return false;
    
    // Must be within board
    if (!isValidHex(q, r, BOARD_RADIUS)) return false;
    
    // Must be adjacent to at least 2 tiles
    let adjacent = 0;
    for (const [nq, nr] of getNeighbors(q, r)) {
        if (tiles[toKey(nq, nr)]) adjacent++;
    }
    
    return adjacent >= 2;
}

/**
 * Get all valid tile placement positions for a player
 * @param {Object} tiles - Current tiles map
 * @param {string} player - Player color
 * @param {Object} inventory - Inventory { black: n, white: n }
 * @returns {Array<{q: number, r: number}>} Valid positions
 */
export function getValidTilePlacements(tiles, player, inventory) {
    if (inventory[player] <= 0) return [];
    
    const positions = [];
    forEachHex(BOARD_RADIUS, (q, r) => {
        if (canPlaceTile(tiles, q, r, player, inventory)) {
            positions.push({ q, r });
        }
    });
    
    return positions;
}

// ==================== Piece Placement ====================

/**
 * Check if a disc can be placed at a position
 * @param {Object} tiles - Current tiles map
 * @param {Object} pieces - Current pieces map
 * @param {number} q - Target q coordinate
 * @param {number} r - Target r coordinate
 * @param {string} player - Player color
 * @param {Object} discInventory - Disc inventory { black: n, white: n }
 * @returns {boolean} True if disc can be placed
 */
export function canPlaceDisc(tiles, pieces, q, r, player, discInventory) {
    const key = toKey(q, r);
    
    // Must have discs in inventory
    if (discInventory[player] <= 0) return false;
    
    // Must be on player's tile
    if (tiles[key] !== player) return false;
    
    // Tile must be empty
    if (pieces[key]) return false;
    
    return true;
}

/**
 * Check if a ring can be placed at a position
 * @param {Object} tiles - Current tiles map
 * @param {Object} pieces - Current pieces map
 * @param {number} q - Target q coordinate
 * @param {number} r - Target r coordinate
 * @param {string} player - Player color
 * @param {Object} ringInventory - Ring inventory { black: n, white: n }
 * @param {Object} captured - Captured pieces { black: { disc, ring }, white: { disc, ring } }
 * @returns {boolean} True if ring can be placed
 */
export function canPlaceRing(tiles, pieces, q, r, player, ringInventory, captured) {
    const key = toKey(q, r);
    
    // Must have rings in inventory
    if (ringInventory[player] <= 0) return false;
    
    // Must have captured at least 1 disc to return
    if (captured[player].disc <= 0) return false;
    
    // Must be on player's tile
    if (tiles[key] !== player) return false;
    
    // Tile must be empty
    if (pieces[key]) return false;
    
    return true;
}

/**
 * Get all valid piece placement positions for a player
 * @param {Object} tiles - Current tiles map
 * @param {Object} pieces - Current pieces map
 * @param {string} player - Player color
 * @param {Object} discInventory - Disc inventory
 * @param {Object} ringInventory - Ring inventory
 * @param {Object} captured - Captured pieces
 * @returns {Array<{q: number, r: number, canDisc: boolean, canRing: boolean}>}
 */
export function getValidPiecePlacements(tiles, pieces, player, discInventory, ringInventory, captured) {
    const positions = [];
    
    for (const [key, owner] of Object.entries(tiles)) {
        if (owner !== player || pieces[key]) continue;
        
        const [q, r] = parseKey(key);
        const canDisc = discInventory[player] > 0;
        const canRing = ringInventory[player] > 0 && captured[player].disc > 0;
        
        if (canDisc || canRing) {
            positions.push({ q, r, canDisc, canRing });
        }
    }
    
    return positions;
}

// ==================== Disc Movement ====================

/**
 * Get valid adjacent moves for a disc
 * @param {Object} tiles - Current tiles map
 * @param {Object} pieces - Current pieces map
 * @param {number} q - Disc q coordinate
 * @param {number} r - Disc r coordinate
 * @param {boolean} isMultiJumping - Whether currently in multi-jump sequence
 * @returns {Array<{q: number, r: number, type: string}>} Valid moves
 */
export function getDiscAdjacentMoves(tiles, pieces, q, r, isMultiJumping = false) {
    // No adjacent moves during multi-jump
    if (isMultiJumping) return [];
    
    const moves = [];
    for (const [nq, nr] of getNeighbors(q, r)) {
        const key = toKey(nq, nr);
        if (tiles[key] && !pieces[key]) {
            moves.push({ q: nq, r: nr, type: 'adjacent' });
        }
    }
    return moves;
}

/**
 * Get valid jump moves for a disc
 * @param {Object} tiles - Current tiles map
 * @param {Object} pieces - Current pieces map
 * @param {number} q - Disc q coordinate
 * @param {number} r - Disc r coordinate
 * @param {string} player - Player color
 * @param {Array<{q: number, r: number}>} jumpHistory - Positions jumped over (friendly pieces only)
 * @param {Object|null} turnStartPos - Starting position of multi-jump { q, r }
 * @param {boolean} hasCaptured - Whether a capture has been made in this sequence
 * @returns {Array<{q: number, r: number, jumpOver: {q: number, r: number}, type: string}>}
 */
export function getDiscJumpMoves(tiles, pieces, q, r, player, jumpHistory = [], turnStartPos = null, hasCaptured = false) {
    const moves = [];
    
    for (const [dq, dr] of HEX_DIRECTIONS) {
        const jq = q + dq;
        const jr = r + dr;
        const landingQ = q + 2 * dq;
        const landingR = r + 2 * dr;
        const jumpKey = toKey(jq, jr);
        const landingKey = toKey(landingQ, landingR);
        
        // Must jump over a piece
        if (!pieces[jumpKey]) continue;
        
        // Must land on an empty tile
        if (!tiles[landingKey] || pieces[landingKey]) continue;
        
        // Prevent jumping over same friendly piece twice
        if (pieces[jumpKey].color === player) {
            if (jumpHistory.some(h => h.q === jq && h.r === jr)) {
                continue;
            }
        }
        
        // Prevent returning to origin without captures (invalid loop)
        if (turnStartPos && landingQ === turnStartPos.q && landingR === turnStartPos.r && !hasCaptured) {
            continue;
        }
        
        const isCapture = pieces[jumpKey].color !== player;
        moves.push({
            q: landingQ,
            r: landingR,
            jumpOver: { q: jq, r: jr },
            type: isCapture ? 'capture' : 'jump'
        });
    }
    
    return moves;
}

/**
 * Check if a disc can make another jump from a position
 * @param {Object} tiles - Current tiles map
 * @param {Object} pieces - Current pieces map
 * @param {number} q - Current q coordinate
 * @param {number} r - Current r coordinate
 * @param {string} player - Player color
 * @param {Array<{q: number, r: number}>} jumpHistory - Positions jumped over
 * @param {Object|null} turnStartPos - Starting position of multi-jump
 * @param {boolean} hasCaptured - Whether a capture has been made
 * @returns {boolean} True if another jump is available
 */
export function canJumpAgain(tiles, pieces, q, r, player, jumpHistory = [], turnStartPos = null, hasCaptured = false) {
    const moves = getDiscJumpMoves(tiles, pieces, q, r, player, jumpHistory, turnStartPos, hasCaptured);
    return moves.length > 0;
}

// ==================== Ring Movement ====================

/**
 * Get valid ring moves from a position
 * @param {Object} tiles - Current tiles map
 * @param {Object} pieces - Current pieces map
 * @param {number} q - Ring q coordinate
 * @param {number} r - Ring r coordinate
 * @param {string} player - Player color
 * @returns {Array<{q: number, r: number, type: string, capture: boolean}>}
 */
export function getRingMoves(tiles, pieces, q, r, player) {
    const moves = [];
    
    for (const [dq, dr] of RING_DIRECTIONS) {
        const landingQ = q + dq;
        const landingR = r + dr;
        const landingKey = toKey(landingQ, landingR);
        
        // Must land on a tile
        if (!tiles[landingKey]) continue;
        
        const targetPiece = pieces[landingKey];
        
        if (targetPiece) {
            // Can capture enemy pieces
            if (targetPiece.color !== player) {
                moves.push({
                    q: landingQ,
                    r: landingR,
                    type: 'capture',
                    capture: true
                });
            }
            // Cannot land on friendly pieces
        } else {
            // Can move to empty tiles
            moves.push({
                q: landingQ,
                r: landingR,
                type: 'move',
                capture: false
            });
        }
    }
    
    return moves;
}

// ==================== Combined Valid Moves ====================

/**
 * Get all valid moves for a specific piece
 * @param {Object} state - Game state with tiles, pieces
 * @param {number} q - Piece q coordinate
 * @param {number} r - Piece r coordinate
 * @param {string} player - Player color
 * @param {Object} options - Optional: { isMultiJumping, jumpHistory, turnStartPos, hasCaptured }
 * @returns {Array<{q: number, r: number, type: string}>}
 */
export function getValidMovesForPiece(state, q, r, player, options = {}) {
    const { tiles, pieces } = state;
    const key = toKey(q, r);
    const piece = pieces[key];
    
    if (!piece || piece.color !== player) return [];
    
    if (piece.type === 'disc') {
        const { isMultiJumping = false, jumpHistory = [], turnStartPos = null, hasCaptured = false } = options;
        const adjacent = getDiscAdjacentMoves(tiles, pieces, q, r, isMultiJumping);
        const jumps = getDiscJumpMoves(tiles, pieces, q, r, player, jumpHistory, turnStartPos, hasCaptured);
        return [...adjacent, ...jumps];
    } else if (piece.type === 'ring') {
        return getRingMoves(tiles, pieces, q, r, player);
    }
    
    return [];
}

/**
 * Calculate all valid moves for a player (for hints display)
 * @param {Object} state - Game state
 * @param {string} player - Player color
 * @param {Object} options - Optional: { isMultiJumping, multiJumpPos }
 * @returns {Array<{q: number, r: number, type: string}>} Highlights array
 */
export function calculateAllValidMoves(state, player, options = {}) {
    const { tiles, pieces, inventory, discInventory, ringInventory, captured } = state;
    const { isMultiJumping = false, multiJumpPos = null, jumpHistory = [], turnStartPos = null, hasCaptured = false } = options;
    
    const highlights = [];
    const addedPieces = new Set();
    
    // In multi-jump, only the jumping piece can move
    if (isMultiJumping && multiJumpPos) {
        const key = toKey(multiJumpPos.q, multiJumpPos.r);
        const moves = getValidMovesForPiece(state, multiJumpPos.q, multiJumpPos.r, player, {
            isMultiJumping: true,
            jumpHistory,
            turnStartPos,
            hasCaptured
        });
        if (moves.length > 0 && !addedPieces.has(key)) {
            highlights.push({ q: multiJumpPos.q, r: multiJumpPos.r, type: 'piece' });
            addedPieces.add(key);
        }
        return highlights;
    }
    
    // 1. Pieces that can move
    for (const [key, piece] of Object.entries(pieces)) {
        if (piece.color !== player) continue;
        
        const [q, r] = parseKey(key);
        const moves = getValidMovesForPiece(state, q, r, player, { isMultiJumping: false });
        
        if (moves.length > 0 && !addedPieces.has(key)) {
            highlights.push({ q, r, type: 'piece' });
            addedPieces.add(key);
        }
    }
    
    // 2. Valid tile placements
    const tilePlacements = getValidTilePlacements(tiles, player, inventory);
    for (const pos of tilePlacements) {
        highlights.push({ q: pos.q, r: pos.r, type: 'tile' });
    }
    
    // 3. Valid piece placements
    const piecePlacements = getValidPiecePlacements(tiles, pieces, player, discInventory, ringInventory, captured);
    for (const pos of piecePlacements) {
        highlights.push({ q: pos.q, r: pos.r, type: 'placement' });
    }
    
    return highlights;
}

// ==================== Stalemate Detection ====================

/**
 * Check if a player has any legal move available
 * @param {Object} state - Game state
 * @param {string} player - Player color
 * @returns {boolean} True if player has at least one legal move
 */
export function hasAnyLegalMove(state, player) {
    const { tiles, pieces, inventory, discInventory, ringInventory, captured } = state;
    
    // 1. Can place a tile?
    if (inventory[player] > 0) {
        const placements = getValidTilePlacements(tiles, player, inventory);
        if (placements.length > 0) return true;
    }
    
    // 2. Can place a disc or ring?
    for (const [key, owner] of Object.entries(tiles)) {
        if (owner === player && !pieces[key]) {
            if (discInventory[player] > 0) return true;
            if (ringInventory[player] > 0 && captured[player].disc > 0) return true;
        }
    }
    
    // 3. Can move any piece?
    for (const [key, piece] of Object.entries(pieces)) {
        if (piece.color !== player) continue;
        
        const [q, r] = parseKey(key);
        const moves = getValidMovesForPiece(state, q, r, player, { isMultiJumping: false });
        if (moves.length > 0) return true;
    }
    
    return false;
}

// ==================== Default Export ====================

export default {
    // Tile placement
    canPlaceTile,
    getValidTilePlacements,
    // Piece placement
    canPlaceDisc,
    canPlaceRing,
    getValidPiecePlacements,
    // Disc movement
    getDiscAdjacentMoves,
    getDiscJumpMoves,
    canJumpAgain,
    // Ring movement
    getRingMoves,
    // Combined
    getValidMovesForPiece,
    calculateAllValidMoves,
    // Stalemate
    hasAnyLegalMove
};
