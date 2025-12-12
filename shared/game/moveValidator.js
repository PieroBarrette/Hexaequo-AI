/**
 * Move Validator - Game move validation logic
 * 
 * Validates all types of moves: tile placement, piece placement, movement, jumps.
 * Shared between frontend and backend.
 */

import { HEX_DIRECTIONS, RING_DIRECTIONS, PIECE_TYPES } from './constants.js';

/**
 * Get neighboring hexes
 * @param {number} q - Column coordinate
 * @param {number} r - Row coordinate
 * @returns {Array<[number, number]>}
 */
export function getNeighbors(q, r) {
    return HEX_DIRECTIONS.map(([dq, dr]) => [q + dq, r + dr]);
}

/**
 * Get hex key from coordinates
 * @param {number} q 
 * @param {number} r 
 * @returns {string}
 */
export function hexKey(q, r) {
    return `${q},${r}`;
}

/**
 * Parse hex key to coordinates
 * @param {string} key 
 * @returns {{q: number, r: number}}
 */
export function parseHexKey(key) {
    const [q, r] = key.split(',').map(Number);
    return { q, r };
}

/**
 * Check if a position is within the board radius
 * @param {number} q 
 * @param {number} r 
 * @param {number} radius 
 * @returns {boolean}
 */
export function isWithinBoard(q, r, radius = 8) {
    return Math.abs(q) <= radius && Math.abs(r) <= radius && Math.abs(q + r) <= radius;
}

/**
 * Check if a tile placement is valid
 * A tile can be placed if:
 * 1. The position is empty (no tile exists)
 * 2. The position is within board bounds
 * 3. The position is adjacent to at least 2 existing tiles
 * 
 * @param {Object} tiles - Current tiles map
 * @param {number} q - Target column
 * @param {number} r - Target row
 * @param {string} color - Player color
 * @param {number} inventory - Player's tile inventory
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateTilePlacement(tiles, q, r, color, inventory) {
    const key = hexKey(q, r);

    // Check inventory
    if (inventory <= 0) {
        return { valid: false, reason: 'No tiles remaining' };
    }

    // Check if position is empty
    if (tiles[key]) {
        return { valid: false, reason: 'Position already has a tile' };
    }

    // Check board bounds
    if (!isWithinBoard(q, r)) {
        return { valid: false, reason: 'Position is outside board' };
    }

    // Count adjacent tiles
    const neighbors = getNeighbors(q, r);
    let adjacentCount = 0;
    for (const [nq, nr] of neighbors) {
        if (tiles[hexKey(nq, nr)]) {
            adjacentCount++;
        }
    }

    if (adjacentCount < 2) {
        return { valid: false, reason: 'Must be adjacent to at least 2 tiles' };
    }

    return { valid: true };
}

/**
 * Check if a piece placement is valid
 * A disc can be placed on an empty tile owned by the player.
 * A ring can only be placed if it would capture at least one disc.
 * 
 * @param {Object} tiles - Current tiles map
 * @param {Object} pieces - Current pieces map
 * @param {number} q - Target column
 * @param {number} r - Target row
 * @param {string} pieceType - 'disc' or 'ring'
 * @param {string} color - Player color
 * @param {number} inventory - Player's piece inventory for this type
 * @returns {{valid: boolean, reason?: string, captures?: Array}}
 */
export function validatePiecePlacement(tiles, pieces, q, r, pieceType, color, inventory) {
    const key = hexKey(q, r);

    // Check inventory
    if (inventory <= 0) {
        return { valid: false, reason: `No ${pieceType}s remaining` };
    }

    // Check if tile exists and is owned by player
    if (tiles[key] !== color) {
        return { valid: false, reason: 'Must place on your own tile' };
    }

    // Check if tile is empty
    if (pieces[key]) {
        return { valid: false, reason: 'Tile is occupied' };
    }

    // Ring placement requires capturing at least one disc
    if (pieceType === PIECE_TYPES.RING) {
        const captures = getRingCaptures(pieces, q, r, color);
        if (captures.length === 0) {
            return { valid: false, reason: 'Ring must capture at least one disc' };
        }
        return { valid: true, captures };
    }

    return { valid: true };
}

/**
 * Get pieces that would be captured by placing a ring
 * @param {Object} pieces - Current pieces map
 * @param {number} q - Ring position column
 * @param {number} r - Ring position row
 * @param {string} color - Ring color
 * @returns {Array<{q: number, r: number, piece: Object}>}
 */
export function getRingCaptures(pieces, q, r, color) {
    const captures = [];
    const neighbors = getNeighbors(q, r);

    for (const [nq, nr] of neighbors) {
        const piece = pieces[hexKey(nq, nr)];
        if (piece && piece.color !== color && piece.type === PIECE_TYPES.DISC) {
            captures.push({ q: nq, r: nr, piece });
        }
    }

    return captures;
}

/**
 * Check if a piece move is valid
 * @param {Object} tiles - Current tiles map
 * @param {Object} pieces - Current pieces map
 * @param {number} fromQ - Start column
 * @param {number} fromR - Start row
 * @param {number} toQ - Target column
 * @param {number} toR - Target row
 * @param {string} color - Player color
 * @param {Array} jumpHistory - Positions already visited in multi-jump
 * @returns {{valid: boolean, reason?: string, isJump?: boolean, captured?: Object}}
 */
export function validateMove(tiles, pieces, fromQ, fromR, toQ, toR, color, jumpHistory = []) {
    const fromKey = hexKey(fromQ, fromR);
    const toKey = hexKey(toQ, toR);

    // Check if source has a piece
    const piece = pieces[fromKey];
    if (!piece) {
        return { valid: false, reason: 'No piece at source' };
    }

    // Check if piece belongs to player
    if (piece.color !== color) {
        return { valid: false, reason: 'Not your piece' };
    }

    // Check if destination has a tile
    if (!tiles[toKey]) {
        return { valid: false, reason: 'No tile at destination' };
    }

    // Check if destination is empty
    if (pieces[toKey]) {
        return { valid: false, reason: 'Destination is occupied' };
    }

    // Check if already visited in jump sequence (circular path)
    const alreadyVisited = jumpHistory.some(pos => pos.q === toQ && pos.r === toR);
    if (alreadyVisited) {
        return { valid: false, reason: 'Cannot revisit position in jump sequence' };
    }

    // Disc movement
    if (piece.type === PIECE_TYPES.DISC) {
        return validateDiscMove(tiles, pieces, fromQ, fromR, toQ, toR, color);
    }

    // Ring movement
    if (piece.type === PIECE_TYPES.RING) {
        return validateRingMove(tiles, pieces, fromQ, fromR, toQ, toR, color);
    }

    return { valid: false, reason: 'Unknown piece type' };
}

/**
 * Validate disc movement
 * Discs can move to adjacent empty tiles or jump over pieces
 */
function validateDiscMove(tiles, pieces, fromQ, fromR, toQ, toR, color) {
    const dq = toQ - fromQ;
    const dr = toR - fromR;

    // Check for simple adjacency move
    const isAdjacent = HEX_DIRECTIONS.some(([dirQ, dirR]) => dirQ === dq && dirR === dr);
    if (isAdjacent) {
        return { valid: true, isJump: false };
    }

    // Check for jump (2 spaces in a direction)
    const isJumpDistance = HEX_DIRECTIONS.some(([dirQ, dirR]) => dirQ * 2 === dq && dirR * 2 === dr);
    if (isJumpDistance) {
        // Check if there's a piece to jump over
        const midQ = fromQ + dq / 2;
        const midR = fromR + dr / 2;
        const midKey = hexKey(midQ, midR);
        const jumpedPiece = pieces[midKey];

        if (jumpedPiece) {
            // Check if it's a capture (opponent's piece)
            if (jumpedPiece.color !== color) {
                return { 
                    valid: true, 
                    isJump: true, 
                    captured: { q: midQ, r: midR, piece: jumpedPiece } 
                };
            }
            // Jumping over own piece (no capture)
            return { valid: true, isJump: true };
        }
    }

    return { valid: false, reason: 'Invalid move distance' };
}

/**
 * Validate ring movement
 * Rings move to specific positions and capture when landing on opponent
 */
function validateRingMove(tiles, pieces, fromQ, fromR, toQ, toR, color) {
    const dq = toQ - fromQ;
    const dr = toR - fromR;

    // Check if move matches ring directions
    const isValidDirection = RING_DIRECTIONS.some(([dirQ, dirR]) => dirQ === dq && dirR === dr);
    if (!isValidDirection) {
        return { valid: false, reason: 'Invalid ring move direction' };
    }

    // Rings capture opponent discs they land on
    const toKey = hexKey(toQ, toR);
    if (pieces[toKey]) {
        const targetPiece = pieces[toKey];
        if (targetPiece.color !== color && targetPiece.type === PIECE_TYPES.DISC) {
            return {
                valid: true,
                isJump: false,
                captured: { q: toQ, r: toR, piece: targetPiece }
            };
        }
        return { valid: false, reason: 'Cannot land on this piece' };
    }

    return { valid: true, isJump: false };
}

/**
 * Get all valid moves for a piece
 * @param {Object} tiles - Current tiles map
 * @param {Object} pieces - Current pieces map
 * @param {number} q - Piece column
 * @param {number} r - Piece row
 * @param {string} color - Player color
 * @param {Array} jumpHistory - Positions already visited
 * @returns {Array<{q: number, r: number, isJump: boolean, captured?: Object}>}
 */
export function getValidMoves(tiles, pieces, q, r, color, jumpHistory = []) {
    const validMoves = [];
    const piece = pieces[hexKey(q, r)];

    if (!piece || piece.color !== color) {
        return validMoves;
    }

    if (piece.type === PIECE_TYPES.DISC) {
        // Check all possible disc moves (adjacent and jumps)
        for (const [dq, dr] of HEX_DIRECTIONS) {
            // Adjacent move
            const adjQ = q + dq;
            const adjR = r + dr;
            const adjResult = validateMove(tiles, pieces, q, r, adjQ, adjR, color, jumpHistory);
            if (adjResult.valid) {
                validMoves.push({ q: adjQ, r: adjR, ...adjResult });
            }

            // Jump move (2 spaces)
            const jumpQ = q + dq * 2;
            const jumpR = r + dr * 2;
            const jumpResult = validateMove(tiles, pieces, q, r, jumpQ, jumpR, color, jumpHistory);
            if (jumpResult.valid && jumpResult.isJump) {
                validMoves.push({ q: jumpQ, r: jumpR, ...jumpResult });
            }
        }
    } else if (piece.type === PIECE_TYPES.RING) {
        // Check ring directions
        for (const [dq, dr] of RING_DIRECTIONS) {
            const targetQ = q + dq;
            const targetR = r + dr;
            const result = validateMove(tiles, pieces, q, r, targetQ, targetR, color, jumpHistory);
            if (result.valid) {
                validMoves.push({ q: targetQ, r: targetR, ...result });
            }
        }
    }

    return validMoves;
}

/**
 * Check if a jump move is available from current position
 * @param {Object} tiles - Current tiles map
 * @param {Object} pieces - Current pieces map
 * @param {number} q - Current column
 * @param {number} r - Current row
 * @param {string} color - Player color
 * @param {Array} jumpHistory - Positions already visited
 * @returns {boolean}
 */
export function hasAvailableJump(tiles, pieces, q, r, color, jumpHistory = []) {
    const moves = getValidMoves(tiles, pieces, q, r, color, jumpHistory);
    return moves.some(move => move.isJump);
}

/**
 * Get all valid tile placement positions
 * @param {Object} tiles - Current tiles map
 * @param {string} color - Player color
 * @param {number} inventory - Player's tile inventory
 * @returns {Array<{q: number, r: number}>}
 */
export function getValidTilePlacements(tiles, color, inventory) {
    if (inventory <= 0) return [];

    const placements = [];
    const checked = new Set();

    // Check positions adjacent to existing tiles
    for (const key of Object.keys(tiles)) {
        const { q, r } = parseHexKey(key);
        for (const [nq, nr] of getNeighbors(q, r)) {
            const nKey = hexKey(nq, nr);
            if (!checked.has(nKey)) {
                checked.add(nKey);
                const result = validateTilePlacement(tiles, nq, nr, color, inventory);
                if (result.valid) {
                    placements.push({ q: nq, r: nr });
                }
            }
        }
    }

    return placements;
}

/**
 * Get all valid piece placement positions
 * @param {Object} tiles - Current tiles map
 * @param {Object} pieces - Current pieces map
 * @param {string} pieceType - 'disc' or 'ring'
 * @param {string} color - Player color
 * @param {number} inventory - Player's inventory for this piece type
 * @returns {Array<{q: number, r: number, captures?: Array}>}
 */
export function getValidPiecePlacements(tiles, pieces, pieceType, color, inventory) {
    if (inventory <= 0) return [];

    const placements = [];

    for (const key of Object.keys(tiles)) {
        if (tiles[key] !== color) continue;

        const { q, r } = parseHexKey(key);
        const result = validatePiecePlacement(tiles, pieces, q, r, pieceType, color, inventory);
        if (result.valid) {
            placements.push({ q, r, captures: result.captures });
        }
    }

    return placements;
}

export default {
    getNeighbors,
    hexKey,
    parseHexKey,
    isWithinBoard,
    validateTilePlacement,
    validatePiecePlacement,
    validateMove,
    getValidMoves,
    hasAvailableJump,
    getValidTilePlacements,
    getValidPiecePlacements,
    getRingCaptures
};
