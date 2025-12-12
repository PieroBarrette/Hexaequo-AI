# Hexaequo Module Architecture

## Overview

The game engine has been refactored into ES modules for better maintainability, testability, and reusability. The modules are located in `hexaequo-v2/modules/`.

## Module Structure

```
hexaequo-v2/
├── modules/
│   ├── index.js           # Barrel file for convenient imports
│   ├── hexMath.js         # Hex coordinate math (pure functions)
│   ├── gameState.js       # State management and constants
│   ├── moveValidator.js   # Move validation logic
│   └── gameController.js  # Game actions and flow
├── game.js                # Original monolithic game (still works)
├── graphics.js            # Canvas rendering
├── ai.js                  # AI worker interface
├── multiplayer.js         # Socket.IO multiplayer
└── index.html             # Main entry point
```

## Module Responsibilities

### hexMath.js (~210 lines)
Pure mathematical functions for hexagonal coordinates.

**Exports:**
- `HEX_DIRECTIONS` - 6 adjacent hex directions
- `RING_DIRECTIONS` - 12 ring move directions
- `getNeighbors(q, r)` - Get 6 adjacent positions
- `getRingDestinations(q, r)` - Get 12 ring landing positions
- `isValidHex(q, r, radius)` - Check if position is on board
- `areAdjacent(q1, r1, q2, r2)` - Check adjacency
- `hexDistance(q1, r1, q2, r2)` - Calculate hex distance
- `toKey(q, r)` / `parseKey(key)` - Position serialization
- `forEachHex(radius, callback)` - Iterate all positions
- `getAllHexPositions(radius)` - Get all valid positions

### gameState.js (~280 lines)
Game state creation, serialization, and constants.

**Exports:**
- `BOARD_RADIUS` (8) - Board size constant
- `INITIAL_INVENTORY` - Starting tile counts
- `VICTORY_CONDITIONS` - Win thresholds
- `createInitialState()` - Create new game state
- `cloneState(state)` - Deep clone state
- `serializeState(state)` / `deserializeState(json)` - JSON conversion
- `getOpponent(player)` - Get opponent color
- `hasActivePieces(pieces, player)` - Check for active pieces
- `checkVictory(captured)` - Check win conditions

### moveValidator.js (~400 lines)
Move validation and legal move calculation.

**Exports:**
- `canPlaceTile(tiles, q, r, player, inventory)` - Tile placement validation
- `getValidTilePlacements(tiles, player, inventory)` - All tile options
- `canPlaceDisc(...)` / `canPlaceRing(...)` - Piece placement validation
- `getDiscAdjacentMoves(tiles, pieces, q, r)` - Adjacent moves
- `getDiscJumpMoves(tiles, pieces, q, r, player, jumpHistory)` - Jump moves
- `getRingMoves(tiles, pieces, q, r, player)` - Ring moves
- `canJumpAgain(...)` - Multi-jump continuation check
- `calculateAllValidMoves(state, player, options)` - All valid moves
- `hasAnyLegalMove(state, player)` - Stalemate detection

### gameController.js (~320 lines)
Game actions that mutate state.

**Exports:**
- `placeTile(state, q, r, player)` - Place a tile
- `placeDisc(state, q, r, player)` - Place a disc
- `placeRing(state, q, r, player)` - Place a ring (returns captured disc)
- `moveDiscAdjacent(state, from, to, player)` - Adjacent disc move
- `jumpDisc(state, from, to, over, player)` - Disc jump/capture
- `moveRing(state, from, to, player)` - Ring move/capture
- `endTurn(state)` - Switch active player
- `checkGameEnd(state)` - Detect win/stalemate
- `applyOnlineMove(state, moveData)` - Apply networked move

## Usage

### Importing in ES Modules

```javascript
// Import everything from barrel
import { createInitialState, calculateAllValidMoves, placeTile } from './modules/index.js';

// Or import specific modules
import * as HexMath from './modules/hexMath.js';
import * as GameState from './modules/gameState.js';
```

### Creating a New Game

```javascript
import { createInitialState, calculateAllValidMoves } from './modules/index.js';

const state = createInitialState();
console.log(state.activePlayer); // 'black'

const validMoves = calculateAllValidMoves(state, 'black');
console.log(validMoves); // Array of valid move positions
```

### Making Moves

```javascript
import { placeTile, placeDisc, endTurn, checkGameEnd } from './modules/index.js';

// Place a tile
const result = placeTile(state, 2, -1, 'black');
if (result.success) {
    // Check for game end
    const endResult = checkGameEnd(state);
    if (!endResult.gameOver) {
        endTurn(state);
    }
}
```

## Integration Strategy

The modules are designed for **gradual migration**:

1. **Phase 1 (Current)**: Modules exist alongside `game.js`
   - `game.js` continues to work as-is
   - Modules can be used for new features (AI, testing)

2. **Phase 2**: Update `game.js` to import from modules
   - Replace inline functions with module imports
   - Keep UI/rendering code in `game.js`

3. **Phase 3**: Split game.js further
   - Extract UI handlers to `inputHandler.js`
   - Extract animations to `animation.js`
   - Keep only orchestration in `game.js`

## Testing

The modules are pure functions (except gameController which has controlled side effects) and can be unit tested:

```javascript
import { test } from 'node:test';
import { isValidHex, getNeighbors } from './modules/hexMath.js';

test('isValidHex validates board positions', () => {
    assert(isValidHex(0, 0, 8) === true);   // Center
    assert(isValidHex(8, 0, 8) === true);   // Edge
    assert(isValidHex(9, 0, 8) === false);  // Off board
});

test('getNeighbors returns 6 positions', () => {
    const neighbors = getNeighbors(0, 0);
    assert(neighbors.length === 6);
});
```

## Benefits

1. **Testability**: Pure functions are easy to unit test
2. **Reusability**: AI worker can import validation logic
3. **Maintainability**: Smaller, focused files
4. **Performance**: Tree-shaking in bundlers
5. **Type Safety**: Easy to add TypeScript later
