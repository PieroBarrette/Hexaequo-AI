/**
 * What the engine says about a position, rather than what it plays.
 *
 * Run with: node tests/judge.test.js
 *
 * The bar and the curve in a review are `judge` and nothing else, so what it
 * says about a finished game is what a player reads about their own. These
 * cover the three ways a game ends, and the fact that going round in circles
 * is worth nothing to whoever is ahead.
 *
 * No database and no server: the AI is a module in web/src/game, shared with
 * the browser and pulled in the same way the rules are.
 */

// Before anything else: this suite writes nothing, so it gets nothing to
// write to. See tests/database.js.
require('./database').none();

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_DIR = path.join(__dirname, '..', '..', 'web', 'src', 'game');
const load = (file) => import(pathToFileURL(path.join(GAME_DIR, file)).href);

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

async function run() {
    const [ai, state, moves] = await Promise.all([
        load('ai.js'), load('state.js'), load('moves.js'),
    ]);
    const { judge, DECISIVE } = ai;
    const { createState, cloneState, applyMove, undoMove, DISKS_PER_PLAYER, RINGS_PER_PLAYER } = state;
    const { generateMoves } = moves;

    console.log('\njudge\n');

    /* The counters are what the rule reads — checkWinner is defined on them —
       so a position is put into each of the three finished shapes by setting
       them. What is being tested is the boundary, not how a game gets there. */
    const won = (fill) => {
        const s = createState();
        fill(s);
        return s;
    };

    await test('six disks taken ends it, and the bar says so', async () => {
        const s = won((g) => { g.capturedDisks[0] = DISKS_PER_PLAYER; g.turn = 1; });
        const verdict = judge(s, { ms: 50, maxDepth: 3 });
        assert.ok(verdict.decisive, 'the game is over, not merely good for somebody');
        assert.ok(verdict.score > DECISIVE, 'and it is Black who won, got ' + verdict.score);
    });

    await test('three rings taken ends it', async () => {
        const s = won((g) => { g.capturedRings[1] = RINGS_PER_PLAYER; g.turn = 0; });
        const verdict = judge(s, { ms: 50, maxDepth: 3 });
        assert.ok(verdict.decisive, 'the game is over');
        assert.ok(verdict.score < -DECISIVE, 'and it is White who won, got ' + verdict.score);
    });

    await test('a player with nothing left on the board has lost', async () => {
        const s = won((g) => { g.piecesOnBoard[1] = 0; g.turn = 1; });
        const verdict = judge(s, { ms: 50, maxDepth: 3 });
        assert.ok(verdict.decisive, 'the game is over');
        assert.ok(verdict.score > DECISIVE, 'Black cleared the board, got ' + verdict.score);
    });

    await test('a game that is over is over, however shallow the look', async () => {
        /* The one that was wrong. Black completes the sixth disk and wins, but
           White is far ahead on material and was a move from winning too — so
           a search that does not reach the second ply scores the position on
           the pieces and hands the game to White. On the curve of a review
           that is a white spike on the last move of a game Black won.

           Depth one is not a contrivance: the curve gives each ply about a
           tenth of a second, and the last position of a long game is the one
           most likely to spend it before the second ply is done. */
        const s = won((g) => {
            g.capturedDisks[0] = DISKS_PER_PLAYER;   // Black has won
            g.capturedDisks[1] = 5;                  // White was one short
            g.capturedRings[1] = 2;                  // and well ahead on material
            g.turn = 1;
        });
        for (const maxDepth of [1, 2, 5]) {
            const verdict = judge(s, { ms: 120, maxDepth });
            assert.ok(verdict.decisive, `decided, at depth ${maxDepth}`);
            assert.ok(verdict.score > DECISIVE,
                `Black won it, at depth ${maxDepth}, got ${verdict.score}`);
        }
    });

    await test('a finished game is not searched for a move to play in it', async () => {
        const s = won((g) => { g.capturedDisks[0] = DISKS_PER_PLAYER; g.turn = 1; });
        assert.strictEqual(judge(s, { ms: 50, maxDepth: 3 }).move, null,
            'there is nothing to play once it is over');
    });

    await test('a position already played twice is a draw, and worth nothing', async () => {
        const s = createState();
        /* Every reply leads somewhere the game has already been twice over, so
           every reply is the third occurrence and the position is a draw
           whatever is on the board. */
        const history = [];
        for (const move of generateMoves(s)) {
            applyMove(s, move);
            history.push(cloneState(s), cloneState(s));
            undoMove(s, move);
        }
        const drawn = judge(s, { ms: 200, maxDepth: 1, history });
        assert.strictEqual(drawn.score, 0, 'nowhere to go but a draw, got ' + drawn.score);

        const open = judge(s, { ms: 200, maxDepth: 1 });
        assert.notStrictEqual(open.score, drawn.score,
            'and without that history the same position is not a draw');
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run().catch((error) => {
    console.error('harness crashed:', error);
    process.exit(1);
});
