/**
 * ELO Service Tests - Phase 0
 * 
 * Tests pour valider:
 * 1. DEFAULT_ELO = 1000
 * 2. Multiplicateurs de cadence fonctionnent correctement
 * 3. Parties sans timer (none) ont multiplicateur 0
 * 
 * Usage: node backend/tests/eloService.test.js
 */

// Before anything else: this suite writes nothing, so it gets nothing to
// write to. See tests/database.js.
require('./database').none();


const { calculateNewRatings, CONFIG, getKFactor, expectedScore } = require('../services/eloService');

// Test utilities
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
    testsRun++;
    try {
        fn();
        testsPassed++;
        console.log(`  ✅ ${name}`);
    } catch (error) {
        testsFailed++;
        console.log(`  ❌ ${name}`);
        console.log(`     Error: ${error.message}`);
    }
}

function assertEqual(actual, expected, message = '') {
    if (actual !== expected) {
        throw new Error(`${message} Expected ${expected}, got ${actual}`);
    }
}

function assertInRange(actual, min, max, message = '') {
    if (actual < min || actual > max) {
        throw new Error(`${message} Expected between ${min} and ${max}, got ${actual}`);
    }
}

function assertTrue(condition, message = '') {
    if (!condition) {
        throw new Error(message || 'Expected true, got false');
    }
}

// ============================================
// TEST SUITE
// ============================================

console.log('\n🧪 ELO Service Tests - Phase 0\n');
console.log('=' .repeat(50));

// Test 1: DEFAULT_ELO value
console.log('\n📋 Test Group: DEFAULT_ELO Configuration');

test('DEFAULT_ELO should be 1000', () => {
    assertEqual(CONFIG.DEFAULT_ELO, 1000);
});

test('ELO_MULTIPLIERS should exist', () => {
    assertTrue(CONFIG.ELO_MULTIPLIERS !== undefined);
    assertTrue(typeof CONFIG.ELO_MULTIPLIERS === 'object');
});

test('ELO_MULTIPLIERS.none should be 0', () => {
    assertEqual(CONFIG.ELO_MULTIPLIERS.none, 0);
});

test('ELO_MULTIPLIERS.classic should be 1.2', () => {
    assertEqual(CONFIG.ELO_MULTIPLIERS.classic, 1.2);
});

test('ELO_MULTIPLIERS.rapid should be 1.0', () => {
    assertEqual(CONFIG.ELO_MULTIPLIERS.rapid, 1.0);
});

test('ELO_MULTIPLIERS.blitz should be 0.9', () => {
    assertEqual(CONFIG.ELO_MULTIPLIERS.blitz, 0.9);
});

test('ELO_MULTIPLIERS.bullet should be 0.75', () => {
    assertEqual(CONFIG.ELO_MULTIPLIERS.bullet, 0.75);
});

// Test 2: K-Factor calculation
console.log('\n📋 Test Group: K-Factor Calculation');

test('New player (<30 games) should have K=40', () => {
    assertEqual(getKFactor(1000, 10), 40);
});

test('Established player should have K=20', () => {
    assertEqual(getKFactor(1500, 50), 20);
});

test('High-rated player (>2400) should have K=10', () => {
    assertEqual(getKFactor(2500, 100), 10);
});

// Test 3: Expected score calculation
console.log('\n📋 Test Group: Expected Score');

test('Equal ratings should give 0.5 expected score', () => {
    const expected = expectedScore(1200, 1200);
    assertInRange(expected, 0.499, 0.501);
});

test('Higher rated player should have higher expected score', () => {
    const expected = expectedScore(1400, 1200);
    assertTrue(expected > 0.5, `Expected > 0.5, got ${expected}`);
});

test('Lower rated player should have lower expected score', () => {
    const expected = expectedScore(1000, 1200);
    assertTrue(expected < 0.5, `Expected < 0.5, got ${expected}`);
});

// Test 4: Friendly games (timeMode = 'none')
console.log('\n📋 Test Group: Friendly Games (timeMode=none)');

test('Friendly game should have no ELO change', () => {
    const playerA = { rating: 1200, gamesPlayed: 50 };
    const playerB = { rating: 1000, gamesPlayed: 50 };
    
    const result = calculateNewRatings(playerA, playerB, 1, 'none');
    
    assertEqual(result.changeA, 0, 'Player A change');
    assertEqual(result.changeB, 0, 'Player B change');
    assertEqual(result.multiplier, 0, 'Multiplier');
    assertEqual(result.reason, 'friendly_mode', 'Reason');
});

test('Friendly game should preserve ratings', () => {
    const playerA = { rating: 1500, gamesPlayed: 30 };
    const playerB = { rating: 1300, gamesPlayed: 40 };
    
    const result = calculateNewRatings(playerA, playerB, 0, 'none');
    
    assertEqual(result.newRatingA, 1500);
    assertEqual(result.newRatingB, 1300);
});

// Test 5: Time mode multipliers
console.log('\n📋 Test Group: Time Mode Multipliers');

test('Classic game should give more ELO than rapid (multiplier 1.2)', () => {
    const playerA = { rating: 1200, gamesPlayed: 50 };
    const playerB = { rating: 1200, gamesPlayed: 50 };
    
    const classicResult = calculateNewRatings(playerA, playerB, 1, 'classic');
    const rapidResult = calculateNewRatings(playerA, playerB, 1, 'rapid');
    
    assertTrue(
        Math.abs(classicResult.changeA) > Math.abs(rapidResult.changeA),
        `Classic change (${classicResult.changeA}) should be > rapid change (${rapidResult.changeA})`
    );
    assertEqual(classicResult.multiplier, 1.2);
    assertEqual(rapidResult.multiplier, 1.0);
});

test('Blitz game should give less ELO than rapid (multiplier 0.9)', () => {
    const playerA = { rating: 1200, gamesPlayed: 50 };
    const playerB = { rating: 1200, gamesPlayed: 50 };
    
    const blitzResult = calculateNewRatings(playerA, playerB, 1, 'blitz');
    const rapidResult = calculateNewRatings(playerA, playerB, 1, 'rapid');
    
    assertTrue(
        Math.abs(blitzResult.changeA) < Math.abs(rapidResult.changeA),
        `Blitz change (${blitzResult.changeA}) should be < rapid change (${rapidResult.changeA})`
    );
    assertEqual(blitzResult.multiplier, 0.9);
});

test('Bullet game should give least ELO (multiplier 0.75)', () => {
    const playerA = { rating: 1200, gamesPlayed: 50 };
    const playerB = { rating: 1200, gamesPlayed: 50 };
    
    const bulletResult = calculateNewRatings(playerA, playerB, 1, 'bullet');
    const blitzResult = calculateNewRatings(playerA, playerB, 1, 'blitz');
    
    assertTrue(
        Math.abs(bulletResult.changeA) < Math.abs(blitzResult.changeA),
        `Bullet change (${bulletResult.changeA}) should be < blitz change (${blitzResult.changeA})`
    );
    assertEqual(bulletResult.multiplier, 0.75);
});

// Test 6: Realistic game scenarios
console.log('\n📋 Test Group: Realistic Game Scenarios');

test('New players equal rating - winner gains, loser loses', () => {
    const playerA = { rating: 1000, gamesPlayed: 5 };
    const playerB = { rating: 1000, gamesPlayed: 5 };
    
    const result = calculateNewRatings(playerA, playerB, 1, 'rapid');
    
    assertTrue(result.changeA > 0, `Winner should gain ELO, got ${result.changeA}`);
    assertTrue(result.changeB < 0, `Loser should lose ELO, got ${result.changeB}`);
    assertEqual(result.newRatingA, 1000 + result.changeA);
    assertEqual(result.newRatingB, 1000 + result.changeB);
});

test('Draw should give small changes towards average', () => {
    const playerA = { rating: 1200, gamesPlayed: 50 };
    const playerB = { rating: 1000, gamesPlayed: 50 };
    
    const result = calculateNewRatings(playerA, playerB, 0.5, 'rapid');
    
    // Higher rated player should lose a bit, lower rated should gain a bit
    assertTrue(result.changeA < 0, `Higher rated should lose on draw, got ${result.changeA}`);
    assertTrue(result.changeB > 0, `Lower rated should gain on draw, got ${result.changeB}`);
});

test('Upset win should give more ELO to underdog', () => {
    const underdog = { rating: 1000, gamesPlayed: 50 };
    const favorite = { rating: 1400, gamesPlayed: 50 };
    
    // Underdog wins
    const result = calculateNewRatings(underdog, favorite, 1, 'rapid');
    
    // Underdog should gain significant ELO
    assertTrue(result.changeA > 15, `Underdog should gain significant ELO, got ${result.changeA}`);
    assertTrue(result.changeB < -15, `Favorite should lose significant ELO, got ${result.changeB}`);
});

test('Classic game ELO changes should be ~20% higher than rapid', () => {
    const playerA = { rating: 1200, gamesPlayed: 50 };
    const playerB = { rating: 1000, gamesPlayed: 50 };
    
    const classicResult = calculateNewRatings(playerA, playerB, 1, 'classic');
    const rapidResult = calculateNewRatings(playerA, playerB, 1, 'rapid');
    
    const ratio = classicResult.changeA / rapidResult.changeA;
    assertInRange(ratio, 1.15, 1.25, 'Classic/Rapid ratio');
});

test('Bullet game ELO changes should be ~75% of rapid', () => {
    const playerA = { rating: 1200, gamesPlayed: 50 };
    const playerB = { rating: 1000, gamesPlayed: 50 };
    
    const bulletResult = calculateNewRatings(playerA, playerB, 1, 'bullet');
    const rapidResult = calculateNewRatings(playerA, playerB, 1, 'rapid');
    
    const ratio = bulletResult.changeA / rapidResult.changeA;
    assertInRange(ratio, 0.70, 0.80, 'Bullet/Rapid ratio');
});

// ============================================
// SUMMARY
// ============================================

console.log('\n' + '=' .repeat(50));
console.log(`\n📊 Test Results: ${testsPassed}/${testsRun} passed`);

if (testsFailed > 0) {
    console.log(`❌ ${testsFailed} test(s) failed\n`);
    process.exit(1);
} else {
    console.log('✅ All tests passed!\n');
    process.exit(0);
}
