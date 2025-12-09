// Shared constants for Hexaequo board math and directional vectors.
// Kept separate so both legacy and new modules can import without duplication.

export const HEX_DIRECTIONS = Object.freeze([
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, -1],
    [-1, 1]
]);

export const RING_DIRECTIONS = Object.freeze([
    [0, -2],
    [1, -2],
    [2, -2],
    [2, -1],
    [2, 0],
    [1, 1],
    [0, 2],
    [-1, 2],
    [-2, 2],
    [-2, 1],
    [-2, 0],
    [-1, -1]
]);

export const DEFAULT_BOARD_RADIUS = 8;
