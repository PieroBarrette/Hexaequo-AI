/**
 * Hexaequo - Game Engine Modules
 * 
 * Barrel file for convenient imports.
 * 
 * Usage:
 *   import { createInitialState, getNeighbors, calculateAllValidMoves } from './modules/index.js';
 * 
 * Or import specific modules:
 *   import * as HexMath from './modules/hexMath.js';
 *   import * as GameState from './modules/gameState.js';
 *   import * as MoveValidator from './modules/moveValidator.js';
 *   import * as GameController from './modules/gameController.js';
 */

// Re-export all from hexMath
export {
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
} from './hexMath.js';

// Re-export all from gameState
export {
    BOARD_RADIUS,
    INITIAL_INVENTORY,
    VICTORY_CONDITIONS,
    INITIAL_TILES,
    INITIAL_PIECES,
    createInitialState,
    cloneState,
    serializeState,
    deserializeState,
    getOpponent,
    hasActivePieces,
    countPieces,
    getPlayerPieces,
    getEmptyPlayerTiles,
    getPositionHash,
    checkVictory
} from './gameState.js';

// Re-export all from moveValidator
export {
    canPlaceTile,
    getValidTilePlacements,
    canPlaceDisc,
    canPlaceRing,
    getValidPiecePlacements,
    getDiscAdjacentMoves,
    getDiscJumpMoves,
    canJumpAgain,
    getRingMoves,
    getValidMovesForPiece,
    calculateAllValidMoves,
    hasAnyLegalMove
} from './moveValidator.js';

// Re-export all from gameController
export {
    placeTile,
    placeDisc,
    placeRing,
    moveDiscAdjacent,
    jumpDisc,
    moveRing,
    endTurn,
    resetMultiJumpState,
    checkGameEnd,
    createMoveRecord,
    checkThreefoldRepetition,
    applyOnlineMove
} from './gameController.js';

// Also export the modules as namespaces for more explicit usage
import * as HexMath from './hexMath.js';
import * as GameState from './gameState.js';
import * as MoveValidator from './moveValidator.js';
import * as GameController from './gameController.js';

export { HexMath, GameState, MoveValidator, GameController };
