/**
 * Game Constants
 * 
 * Shared constants used across frontend and backend.
 */

// Board configuration
export const BOARD_RADIUS = 8;

// Initial inventories
export const INITIAL_TILES = 7;
export const INITIAL_DISCS = 5;
export const INITIAL_RINGS = 3;

// Victory conditions
export const DISC_CAPTURE_WIN = 6;
export const RING_CAPTURE_WIN = 3;

// Piece types
export const PIECE_TYPES = {
    DISC: 'disc',
    RING: 'ring'
};

// Player colors
export const PLAYERS = {
    BLACK: 'black',
    WHITE: 'white'
};

// Game status
export const GAME_STATUS = {
    WAITING: 'waiting',
    PLAYING: 'playing',
    FINISHED: 'finished'
};

// Room status
export const ROOM_STATUS = {
    WAITING: 'waiting',
    PLAYING: 'playing'
};

// Timer modes
export const TIMER_MODES = {
    NONE: 'none',
    CLASSIC: 'classic',    // 15|0
    RAPID: 'rapid',        // 10|5
    BLITZ: 'blitz'         // 5|3
};

// Timer configurations (in seconds)
export const TIMER_CONFIGS = {
    none: { initial: null, increment: 0 },
    classic: { initial: 15 * 60, increment: 0 },
    rapid: { initial: 10 * 60, increment: 5 },
    blitz: { initial: 5 * 60, increment: 3 }
};

// AI difficulty levels
export const AI_DIFFICULTY = {
    EASY: 2,
    MEDIUM: 3,
    HARD: 4
};

// Hex directions (axial coordinates)
export const HEX_DIRECTIONS = [
    [1, 0],   // East
    [-1, 0],  // West
    [0, 1],   // Southeast
    [0, -1],  // Northwest
    [1, -1],  // Northeast
    [-1, 1]   // Southwest
];

// Ring move directions (specific positions for ring movement)
export const RING_DIRECTIONS = [
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
    [2, -2],
    [-2, 2]
];

// Animation settings
export const ANIMATION = {
    DEFAULT_DURATION: 250,
    MIN_DURATION: 100,
    MAX_DURATION: 500
};

// Move types for history/replay
export const MOVE_TYPES = {
    TILE_PLACEMENT: 'tile-placement',
    PIECE_PLACEMENT: 'piece-placement',
    MOVE: 'move',
    JUMP: 'jump',
    MULTI_JUMP: 'multi-jump',
    CAPTURE: 'capture'
};

// Connection status
export const CONNECTION_STATUS = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting'
};

// Error codes
export const ERROR_CODES = {
    ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
    ROOM_FULL: 'ROOM_FULL',
    INVALID_PLAYER: 'INVALID_PLAYER',
    NOT_YOUR_TURN: 'NOT_YOUR_TURN',
    INVALID_MOVE: 'INVALID_MOVE',
    CONNECTION_ERROR: 'CONNECTION_ERROR'
};

export default {
    BOARD_RADIUS,
    INITIAL_TILES,
    INITIAL_DISCS,
    INITIAL_RINGS,
    DISC_CAPTURE_WIN,
    RING_CAPTURE_WIN,
    PIECE_TYPES,
    PLAYERS,
    GAME_STATUS,
    ROOM_STATUS,
    TIMER_MODES,
    TIMER_CONFIGS,
    AI_DIFFICULTY,
    HEX_DIRECTIONS,
    RING_DIRECTIONS,
    ANIMATION,
    MOVE_TYPES,
    CONNECTION_STATUS,
    ERROR_CODES
};
