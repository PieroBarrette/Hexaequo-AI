/**
 * Hexaequo - Hex Math Module
 * 
 * Pure functions for hexagonal coordinate system math.
 * Uses axial coordinate system (q, r).
 */

// ==================== Direction Constants ====================

/**
 * The 6 axial directions for adjacent hexes
 */
export const HEX_DIRECTIONS = [
    [1, 0],   // East
    [-1, 0],  // West
    [0, 1],   // Southeast
    [0, -1],  // Northwest
    [1, -1],  // Northeast
    [-1, 1]   // Southwest
];

/**
 * The 12 ring movement directions (distance 2 in specific patterns)
 */
export const RING_DIRECTIONS = [
    [0, -2],   // North
    [1, -2],   // North-northeast
    [2, -2],   // Northeast
    [2, -1],   // East-northeast
    [2, 0],    // East
    [1, 1],    // East-southeast
    [0, 2],    // South
    [-1, 2],   // South-southwest
    [-2, 2],   // Southwest
    [-2, 1],   // West-southwest
    [-2, 0],   // West
    [-1, -1]   // West-northwest
];

// ==================== Neighbor Functions ====================

/**
 * Get the coordinates of all 6 adjacent hexes
 * @param {number} q - Axial q coordinate
 * @param {number} r - Axial r coordinate
 * @returns {Array<[number, number]>} Array of [q, r] neighbor coordinates
 */
export function getNeighbors(q, r) {
    return HEX_DIRECTIONS.map(([dq, dr]) => [q + dq, r + dr]);
}

/**
 * Get the coordinates of all 12 ring movement destinations
 * @param {number} q - Axial q coordinate
 * @param {number} r - Axial r coordinate
 * @returns {Array<[number, number]>} Array of [q, r] ring destination coordinates
 */
export function getRingDestinations(q, r) {
    return RING_DIRECTIONS.map(([dq, dr]) => [q + dq, r + dr]);
}

// ==================== Validation Functions ====================

/**
 * Check if a hex coordinate is within the board radius
 * @param {number} q - Axial q coordinate
 * @param {number} r - Axial r coordinate
 * @param {number} radius - Board radius (default 8)
 * @returns {boolean} True if within bounds
 */
export function isValidHex(q, r, radius = 8) {
    if (q < -radius || q > radius) return false;
    if (r < Math.max(-radius, -q - radius) || r > Math.min(radius, -q + radius)) return false;
    return true;
}

/**
 * Check if two hex coordinates are adjacent
 * @param {number} q1 - First hex q coordinate
 * @param {number} r1 - First hex r coordinate
 * @param {number} q2 - Second hex q coordinate
 * @param {number} r2 - Second hex r coordinate
 * @returns {boolean} True if adjacent
 */
export function areAdjacent(q1, r1, q2, r2) {
    const dq = q2 - q1;
    const dr = r2 - r1;
    return HEX_DIRECTIONS.some(([dirQ, dirR]) => dirQ === dq && dirR === dr);
}

/**
 * Check if a position is a valid ring move from another position
 * @param {number} fromQ - Starting q coordinate
 * @param {number} fromR - Starting r coordinate
 * @param {number} toQ - Target q coordinate
 * @param {number} toR - Target r coordinate
 * @returns {boolean} True if valid ring move
 */
export function isValidRingMove(fromQ, fromR, toQ, toR) {
    const dq = toQ - fromQ;
    const dr = toR - fromR;
    return RING_DIRECTIONS.some(([dirQ, dirR]) => dirQ === dq && dirR === dr);
}

// ==================== Jump Calculation ====================

/**
 * Get the jump landing position given a starting position and direction
 * @param {number} q - Starting q coordinate
 * @param {number} r - Starting r coordinate
 * @param {number} dq - Direction q component
 * @param {number} dr - Direction r component
 * @returns {Object} Jump info: { jumpOver: {q, r}, landing: {q, r} }
 */
export function getJumpInfo(q, r, dq, dr) {
    return {
        jumpOver: { q: q + dq, r: r + dr },
        landing: { q: q + 2 * dq, r: r + 2 * dr }
    };
}

/**
 * Get all possible jump destinations from a position
 * Returns the jumped-over position and landing position for each direction
 * @param {number} q - Starting q coordinate
 * @param {number} r - Starting r coordinate
 * @returns {Array<Object>} Array of { direction, jumpOver, landing }
 */
export function getAllJumpTargets(q, r) {
    return HEX_DIRECTIONS.map(([dq, dr]) => ({
        direction: [dq, dr],
        jumpOver: { q: q + dq, r: r + dr },
        landing: { q: q + 2 * dq, r: r + 2 * dr }
    }));
}

// ==================== Distance Functions ====================

/**
 * Calculate the hex distance between two positions
 * @param {number} q1 - First hex q coordinate
 * @param {number} r1 - First hex r coordinate
 * @param {number} q2 - Second hex q coordinate
 * @param {number} r2 - Second hex r coordinate
 * @returns {number} Distance in hex steps
 */
export function hexDistance(q1, r1, q2, r2) {
    return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

// ==================== Coordinate Key Helpers ====================

/**
 * Convert q, r coordinates to a string key
 * @param {number} q - Axial q coordinate
 * @param {number} r - Axial r coordinate
 * @returns {string} Key string like "0,0"
 */
export function toKey(q, r) {
    return `${q},${r}`;
}

/**
 * Parse a string key back to q, r coordinates
 * @param {string} key - Key string like "0,0"
 * @returns {Object} { q, r } coordinates
 */
export function fromKey(key) {
    const [q, r] = key.split(',').map(Number);
    return { q, r };
}

/**
 * Parse a string key to array format
 * @param {string} key - Key string like "0,0"
 * @returns {[number, number]} [q, r] array
 */
export function parseKey(key) {
    return key.split(',').map(Number);
}

// ==================== Board Iteration ====================

/**
 * Iterate over all valid hex positions within a radius
 * @param {number} radius - Board radius
 * @param {function} callback - Function to call with (q, r) for each position
 */
export function forEachHex(radius, callback) {
    for (let q = -radius; q <= radius; q++) {
        const r1 = Math.max(-radius, -q - radius);
        const r2 = Math.min(radius, -q + radius);
        for (let r = r1; r <= r2; r++) {
            callback(q, r);
        }
    }
}

/**
 * Get all valid hex positions within a radius
 * @param {number} radius - Board radius
 * @returns {Array<{q: number, r: number}>} Array of hex positions
 */
export function getAllHexPositions(radius) {
    const positions = [];
    forEachHex(radius, (q, r) => positions.push({ q, r }));
    return positions;
}

// ==================== Default Export ====================

export default {
    HEX_DIRECTIONS,
    RING_DIRECTIONS,
    getNeighbors,
    getRingDestinations,
    isValidHex,
    areAdjacent,
    isValidRingMove,
    getJumpInfo,
    getAllJumpTargets,
    hexDistance,
    toKey,
    fromKey,
    parseKey,
    forEachHex,
    getAllHexPositions
};
