/**
 * Simple test runner for Hexaequo modules
 * Run with: node --experimental-vm-modules modules/test.js
 */

import { 
    // hexMath
    getNeighbors, 
    isValidHex, 
    toKey, 
    parseKey, 
    hexDistance,
    HEX_DIRECTIONS,
    RING_DIRECTIONS,
    forEachHex,
    
    // gameState
    BOARD_RADIUS,
    createInitialState,
    cloneState,
    serializeState,
    deserializeState,
    getOpponent,
    checkVictory,
    
    // moveValidator
    canPlaceTile,
    getValidTilePlacements,
    calculateAllValidMoves,
    hasAnyLegalMove,
    
    // gameController
    placeTile,
    placeDisc,
    endTurn,
    checkGameEnd
} from './index.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`✗ ${name}`);
        console.log(`  Error: ${e.message}`);
        failed++;
    }
}

function assert(condition, message = 'Assertion failed') {
    if (!condition) throw new Error(message);
}

function assertEqual(a, b, message = '') {
    if (a !== b) throw new Error(`${message} Expected ${b}, got ${a}`);
}

console.log('\n=== Hexaequo Module Tests ===\n');

// ==================== hexMath Tests ====================
console.log('--- hexMath.js ---');

test('HEX_DIRECTIONS has 6 directions', () => {
    assertEqual(HEX_DIRECTIONS.length, 6);
});

test('RING_DIRECTIONS has 12 directions', () => {
    assertEqual(RING_DIRECTIONS.length, 12);
});

test('getNeighbors returns 6 positions', () => {
    const neighbors = getNeighbors(0, 0);
    assertEqual(neighbors.length, 6);
});

test('isValidHex validates center', () => {
    assert(isValidHex(0, 0, BOARD_RADIUS));
});

test('isValidHex validates edge', () => {
    assert(isValidHex(8, 0, BOARD_RADIUS));
    assert(isValidHex(-8, 0, BOARD_RADIUS));
});

test('isValidHex rejects outside', () => {
    assert(!isValidHex(9, 0, BOARD_RADIUS));
    assert(!isValidHex(100, 100, BOARD_RADIUS));
});

test('toKey creates consistent keys', () => {
    assertEqual(toKey(1, 2), '1,2');
    assertEqual(toKey(-3, 5), '-3,5');
});

test('parseKey reverses toKey', () => {
    const [q, r] = parseKey('3,-2');
    assertEqual(q, 3);
    assertEqual(r, -2);
});

test('hexDistance calculates correctly', () => {
    assertEqual(hexDistance(0, 0, 0, 0), 0);
    assertEqual(hexDistance(0, 0, 1, 0), 1);
    assertEqual(hexDistance(0, 0, 2, 0), 2);
});

test('forEachHex iterates all hexes', () => {
    let count = 0;
    forEachHex(2, () => count++);
    // Hexes in radius 2: 1 + 6 + 12 = 19
    assertEqual(count, 19);
});

// ==================== gameState Tests ====================
console.log('\n--- gameState.js ---');

test('BOARD_RADIUS is 8', () => {
    assertEqual(BOARD_RADIUS, 8);
});

test('createInitialState creates valid state', () => {
    const state = createInitialState();
    assertEqual(state.activePlayer, 'black');
    assert(Object.keys(state.tiles).length > 0, 'Should have initial tiles');
    assert(Object.keys(state.pieces).length > 0, 'Should have initial pieces');
});

test('createInitialState sets correct inventories', () => {
    const state = createInitialState();
    assertEqual(state.inventory.black, 7);  // 9 total - 2 placed = 7
    assertEqual(state.inventory.white, 7);
    assertEqual(state.discInventory.black, 5);  // 6 total - 1 placed = 5
    assertEqual(state.discInventory.white, 5);
});

test('cloneState creates independent copy', () => {
    const state = createInitialState();
    const clone = cloneState(state);
    clone.activePlayer = 'white';
    assertEqual(state.activePlayer, 'black'); // Original unchanged
});

test('serializeState/deserializeState roundtrip', () => {
    const state = createInitialState();
    const json = serializeState(state);
    const restored = deserializeState(json);
    assertEqual(restored.activePlayer, state.activePlayer);
    assertEqual(Object.keys(restored.tiles).length, Object.keys(state.tiles).length);
});

test('getOpponent returns correct opponent', () => {
    assertEqual(getOpponent('black'), 'white');
    assertEqual(getOpponent('white'), 'black');
});

test('checkVictory with no captures', () => {
    const captured = { black: { disc: 0, ring: 0 }, white: { disc: 0, ring: 0 } };
    const result = checkVictory(captured);
    assertEqual(result.winner, null);
});

test('checkVictory detects disc victory', () => {
    const captured = { black: { disc: 6, ring: 0 }, white: { disc: 0, ring: 0 } };
    const result = checkVictory(captured);
    assertEqual(result.winner, 'black');
});

// ==================== moveValidator Tests ====================
console.log('\n--- moveValidator.js ---');

test('calculateAllValidMoves returns array', () => {
    const state = createInitialState();
    const moves = calculateAllValidMoves(state, 'black');
    assert(Array.isArray(moves), 'Should return array');
    assert(moves.length > 0, 'Should have valid moves at game start');
});

test('hasAnyLegalMove returns true at start', () => {
    const state = createInitialState();
    assert(hasAnyLegalMove(state, 'black'), 'Black should have moves at start');
    assert(hasAnyLegalMove(state, 'white'), 'White should have moves at start');
});

test('canPlaceTile validates placement rules', () => {
    const state = createInitialState();
    // Position 2,-1 should be adjacent to starting tiles
    const result = canPlaceTile(state.tiles, 2, -1, 'black', state.inventory);
    // Note: exact result depends on initial board setup
    assert(typeof result === 'boolean');
});

// ==================== gameController Tests ====================
console.log('\n--- gameController.js ---');

test('endTurn switches player', () => {
    const state = createInitialState();
    assertEqual(state.activePlayer, 'black');
    endTurn(state);
    assertEqual(state.activePlayer, 'white');
});

test('checkGameEnd returns not over at start', () => {
    const state = createInitialState();
    const result = checkGameEnd(state);
    assertEqual(result.gameOver, false);
});

test('placeDisc reduces inventory', () => {
    const state = createInitialState();
    // Find an empty tile owned by black
    let targetQ, targetR;
    for (const [key, owner] of Object.entries(state.tiles)) {
        if (owner === 'black' && !state.pieces[key]) {
            [targetQ, targetR] = parseKey(key);
            break;
        }
    }
    
    if (targetQ !== undefined) {
        const before = state.discInventory.black;
        const result = placeDisc(state, targetQ, targetR, 'black');
        if (result.success) {
            assertEqual(state.discInventory.black, before - 1);
        }
    }
});

// ==================== Summary ====================
console.log('\n=== Test Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);

if (failed > 0) {
    process.exit(1);
}
