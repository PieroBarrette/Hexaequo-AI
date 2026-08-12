/**
 * Server-side rules authority.
 *
 * Run with: node tests/engine.test.js
 *
 * The point of these tests is not that legal moves work — the engine's own
 * suite covers that — but that a client cannot make the server believe
 * something false: not about whose turn it is, not about what is legal, and
 * above all not about what it captured.
 */

const assert = require('assert');
const engine = require('../game/engine');

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ok    ${name}`);
    } catch (error) {
        failed++;
        console.log(`  FAIL  ${name}`);
        console.log(`        ${error.message}`);
    }
}

/** Load the engine directly too, so tests can reason about legal moves. */
async function sharedEngine() {
    const { pathToFileURL } = require('url');
    const path = require('path');
    const dir = path.join(__dirname, '..', '..', 'web', 'src', 'game');
    const url = (f) => pathToFileURL(path.join(dir, f)).href;
    const [state, moves, hex] = await Promise.all([
        import(url('state.js')), import(url('moves.js')), import(url('hex.js')),
    ]);
    return { state, moves, hex };
}

async function run() {
    const { state, moves } = await sharedEngine();
    console.log('\nServer-side rules authority\n');

    await test('a new game is the opening position', async () => {
        const snapshot = await engine.createGame();
        assert.strictEqual(snapshot.tiles.length, 8, 'four tiles, as key/colour pairs');
        assert.strictEqual(snapshot.pieces.length, 4, 'two disks');
        assert.strictEqual(snapshot.turn, engine.BLACK, 'Black moves first');
        assert.deepStrictEqual(snapshot.capturedDisks, [0, 0]);
    });

    await test('serialise then deserialise is lossless', async () => {
        const position = state.createState();
        for (let i = 0; i < 40; i++) {
            const legal = moves.generateMoves(position);
            if (!legal.length) break;
            state.applyMove(position, legal[Math.floor(Math.random() * legal.length)]);
            if (moves.checkWinner(position)) break;
        }
        const restored = state.deserializeState(state.serializeState(position));
        assert.strictEqual(restored.h1, position.h1, 'hash word 1');
        assert.strictEqual(restored.h2, position.h2, 'hash word 2');
        assert.strictEqual(state.positionKey(restored), state.positionKey(position));
        assert.deepStrictEqual(Array.from(restored.diskReserve), Array.from(position.diskReserve));
        assert.deepStrictEqual(Array.from(restored.ringReserve), Array.from(position.ringReserve));
        assert.deepStrictEqual(Array.from(restored.tileReserve), Array.from(position.tileReserve));
    });

    await test('a legal move is accepted and hands over the turn', async () => {
        const snapshot = await engine.createGame();
        const position = state.deserializeState(snapshot);
        const move = moves.generateMoves(position)[0];
        const outcome = await engine.applyIntent(snapshot, moves.moveIntent(move), engine.BLACK);
        assert.ok(outcome.ok, `expected acceptance, got ${outcome.error}`);
        assert.strictEqual(outcome.state.turn, engine.WHITE);
        assert.ok(outcome.notation.length > 0);
    });

    await test('playing out of turn is refused', async () => {
        const snapshot = await engine.createGame();
        const position = state.deserializeState(snapshot);
        const intent = moves.moveIntent(moves.generateMoves(position)[0]);
        const outcome = await engine.applyIntent(snapshot, intent, engine.WHITE);
        assert.strictEqual(outcome.ok, false);
        assert.strictEqual(outcome.error, 'NOT_YOUR_TURN');
    });

    await test('a tile on a cell touching only one tile is refused', async () => {
        const snapshot = await engine.createGame();
        // (2,0) touches just one opening tile, so it is never a legal placement.
        const outcome = await engine.applyIntent(snapshot, { type: 'tile', cell: (2 + 32) * 64 + 32 }, engine.BLACK);
        assert.strictEqual(outcome.ok, false);
        assert.strictEqual(outcome.error, 'ILLEGAL_MOVE');
    });

    await test('a piece on an enemy-coloured tile is refused', async () => {
        const snapshot = await engine.createGame();
        const position = state.deserializeState(snapshot);
        const whiteTile = position.tileKeys.find((k) => position.tileAt[k] === engine.WHITE && position.pieceAt[k] < 0);
        const outcome = await engine.applyIntent(snapshot, { type: 'piece', cell: whiteTile, piece: 0 }, engine.BLACK);
        assert.strictEqual(outcome.ok, false);
        assert.strictEqual(outcome.error, 'ILLEGAL_MOVE');
    });

    await test('a disk cannot move onto a cell with no tile', async () => {
        const snapshot = await engine.createGame();
        const position = state.deserializeState(snapshot);
        const disk = position.tileKeys.find((k) => position.pieceAt[k] === 0);
        const empty = (5 + 32) * 64 + (5 + 32);          // far outside the four-tile opening
        assert.strictEqual(position.tileAt[empty], -1, 'the target must really be bare');
        const outcome = await engine.applyIntent(snapshot, { type: 'disk', path: [disk, empty] }, engine.BLACK);
        assert.strictEqual(outcome.ok, false);
        assert.strictEqual(outcome.error, 'ILLEGAL_MOVE');
    });

    await test('a disk cannot land on an occupied tile', async () => {
        const snapshot = await engine.createGame();
        const position = state.deserializeState(snapshot);
        const black = position.tileKeys.find((k) => position.pieceAt[k] === 0);
        const white = position.tileKeys.find((k) => position.pieceAt[k] === 2);
        const outcome = await engine.applyIntent(snapshot, { type: 'disk', path: [black, white] }, engine.BLACK);
        assert.strictEqual(outcome.ok, false);
        assert.strictEqual(outcome.error, 'ILLEGAL_MOVE');
    });

    await test('captures come from the server, never from the client', async () => {
        // Walk a real game until a capturing jump exists, then send only the path.
        let position = state.createState();
        let snapshot = state.serializeState(position);
        let jump = null;
        for (let i = 0; i < 200 && !jump; i++) {
            const legal = moves.generateMoves(position);
            if (!legal.length) break;
            jump = legal.find((m) => m.type === 'disk' && m.captures.length > 0);
            if (jump) break;
            state.applyMove(position, legal[Math.floor(Math.random() * legal.length)]);
            snapshot = state.serializeState(position);
            if (moves.checkWinner(position)) { position = state.createState(); snapshot = state.serializeState(position); }
        }
        assert.ok(jump, 'no capturing jump appeared in 200 plies');

        const honest = { type: 'disk', path: jump.path.slice() };
        // A hostile client bolts on invented captures; they are simply not part
        // of the intent the server matches against.
        const hostile = { ...honest, captures: [{ cell: 9999, code: 3 }, { cell: 1, code: 3 }] };

        const outcome = await engine.applyIntent(snapshot, hostile, position.turn);
        assert.ok(outcome.ok, `expected acceptance, got ${outcome.error}`);
        assert.strictEqual(outcome.captures.length, jump.captures.length, 'server derived its own captures');
        for (const c of outcome.captures) {
            assert.notStrictEqual(c.cell, 9999, 'invented capture must not survive');
        }
    });

    await test('a state that does not conserve material is refused', async () => {
        const snapshot = await engine.createGame();
        // Claim seven captured white disks: more than exist in the game.
        const forged = { ...snapshot, capturedDisks: [7, 0] };
        const outcome = await engine.applyIntent(forged, { type: 'tile', cell: 0 }, engine.BLACK);
        assert.strictEqual(outcome.ok, false);
        assert.strictEqual(outcome.error, 'CORRUPT_STATE');
    });

    await test('a duplicated piece in a snapshot is refused', async () => {
        const snapshot = await engine.createGame();
        const forged = { ...snapshot, pieces: snapshot.pieces.concat([snapshot.pieces[0], 0]) };
        const outcome = await engine.applyIntent(forged, { type: 'tile', cell: 0 }, engine.BLACK);
        assert.strictEqual(outcome.ok, false);
        assert.strictEqual(outcome.error, 'CORRUPT_STATE');
    });

    await test('replaying a game reproduces it exactly', async () => {
        const position = state.createState();
        const intents = [];
        for (let i = 0; i < 60; i++) {
            const legal = moves.generateMoves(position);
            if (!legal.length) break;
            const move = legal[Math.floor(Math.random() * legal.length)];
            intents.push(moves.moveIntent(move));
            state.applyMove(position, move);
            if (moves.checkWinner(position)) break;
        }
        const replayed = await engine.replay(intents);
        assert.ok(replayed.ok, `replay failed at move ${replayed.atMove}: ${replayed.error}`);
        assert.deepStrictEqual(replayed.state, state.serializeState(position));
    });

    await test('a replay containing an illegal move is rejected at that move', async () => {
        const snapshot = await engine.createGame();
        const position = state.deserializeState(snapshot);
        const first = moves.moveIntent(moves.generateMoves(position)[0]);
        const replayed = await engine.replay([first, { type: 'tile', cell: (9 + 32) * 64 + 32 }]);
        assert.strictEqual(replayed.ok, false);
        assert.strictEqual(replayed.atMove, 1);
    });

    await test('a finished game accepts no further move', async () => {
        // Play to the end, then try to move again.
        let position = state.createState();
        for (let i = 0; i < 400; i++) {
            const legal = moves.generateMoves(position);
            if (!legal.length) break;
            state.applyMove(position, legal[Math.floor(Math.random() * legal.length)]);
            if (moves.checkWinner(position)) break;
        }
        assert.ok(moves.checkWinner(position), 'expected a finished game');
        const snapshot = state.serializeState(position);
        const outcome = await engine.applyIntent(snapshot, { type: 'tile', cell: 2080 }, position.turn);
        assert.strictEqual(outcome.ok, false);
        assert.strictEqual(outcome.error, 'GAME_OVER');
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run().catch((error) => {
    console.error('harness crashed:', error);
    process.exit(1);
});
