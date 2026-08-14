/**
 * Rated games: what gets recorded, and how ratings move.
 *
 * Run with: node tests/ratedGame.test.js
 *
 * These run against the real database and delete everything they create. The
 * point is that a rating can only move for a real, two-sided game, and that it
 * moves symmetrically — whatever a win is worth, the same loss costs.
 */

const assert = require('assert');
const { pool, query } = require('../config/database');
const rated = require('../services/ratedGameService');
const elo = require('../services/eloService');

let passed = 0;
let failed = 0;
const users = new Set();
const games = new Set();

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

async function makeUser(tag, startingElo = 1000, gamesPlayed = 0) {
    const { rows } = await query(
        `INSERT INTO users (email, pseudo, google_id, elo, games_played, email_verified, pseudo_chosen)
         VALUES ($1,$2,$3,$4,$5,TRUE,TRUE) RETURNING *`,
        [`rated-test-${tag}@example.invalid`, `RatedTest${tag}`, `rated-test-${tag}`, startingElo, gamesPlayed]
    );
    users.add(rows[0].id);
    return rows[0];
}

/** A finished room, shaped the way socket/onlineGame.js builds them. */
function room(black, white, { code = 'TEST01', timeControl = 'rapid', moves = [] } = {}) {
    return {
        code,
        timeControl,
        state: { v: 1, tiles: [], pieces: [], turn: 0, capturedDisks: [0, 0], capturedRings: [0, 0] },
        moves,
        players: [
            black && { userId: black.id, pseudo: black.pseudo, elo: black.elo, gamesPlayed: black.games_played },
            white && { userId: white.id, pseudo: white.pseudo, elo: white.elo, gamesPlayed: white.games_played },
        ],
    };
}

const eloOf = async (id) => (await query('SELECT elo, games_played, wins, losses, draws FROM users WHERE id = $1', [id])).rows[0];

async function run() {
    console.log('\nRated games\n');

    await test('two signed-in players make a rated game', async () => {
        const black = await makeUser('a');
        const white = await makeUser('b');
        const record = await rated.recordGame(room(black, white), { winner: 0, reason: 'disks' });
        games.add(record.gameId);
        assert.strictEqual(record.rated, true);
        assert.ok(record.gameId, 'the game was written');

        const [b, w] = [await eloOf(black.id), await eloOf(white.id)];
        assert.ok(b.elo > 1000, `winner gained, got ${b.elo}`);
        assert.ok(w.elo < 1000, `loser lost, got ${w.elo}`);
        assert.strictEqual(b.wins, 1);
        assert.strictEqual(w.losses, 1);
        assert.strictEqual(b.games_played, 1);
    });

    await test('a win and the matching loss are the same size', async () => {
        const black = await makeUser('c');
        const white = await makeUser('d');
        const record = await rated.recordGame(room(black, white), { winner: 1, reason: 'rings' });
        games.add(record.gameId);
        const [b, w] = [await eloOf(black.id), await eloOf(white.id)];
        const gained = w.elo - 1000;
        const lost = 1000 - b.elo;
        assert.strictEqual(gained, lost, `asymmetric: +${gained} vs -${lost}`);
        assert.ok(gained > 0, 'the rating actually moved');
    });

    await test('a guest game moves nobody', async () => {
        const black = await makeUser('e');
        const record = await rated.recordGame(room(black, null), { winner: 0, reason: 'resigned' });
        games.add(record.gameId);
        assert.strictEqual(record.rated, false, 'not rated with an empty seat');
        const b = await eloOf(black.id);
        assert.strictEqual(b.elo, 1000, 'rating untouched');
        assert.strictEqual(b.games_played, 0, 'not counted as a game played');
    });

    await test('playing yourself through two windows changes nothing', async () => {
        const solo = await makeUser('f');
        const record = await rated.recordGame(room(solo, solo), { winner: 0, reason: 'disks' });
        games.add(record.gameId);
        assert.strictEqual(record.rated, false);
        const s = await eloOf(solo.id);
        assert.strictEqual(s.elo, 1000);
    });

    await test('a draw nudges both towards each other', async () => {
        const strong = await makeUser('g', 1400);
        const weak = await makeUser('h', 1000);
        const record = await rated.recordGame(room(strong, weak), { winner: null, reason: 'repetition' });
        games.add(record.gameId);
        const [s, w] = [await eloOf(strong.id), await eloOf(weak.id)];
        assert.ok(s.elo < 1400, 'the favourite loses ground in a draw');
        assert.ok(w.elo > 1000, 'the underdog gains');
        assert.strictEqual(1400 - s.elo, w.elo - 1000, 'and by the same amount');
        assert.strictEqual(s.draws, 1);
        assert.strictEqual(w.draws, 1);
    });

    await test('beating a much stronger player is worth more', async () => {
        const favourite = await makeUser('i', 1600, 50);
        const underdog = await makeUser('j', 1000, 50);
        const upset = await rated.recordGame(room(favourite, underdog, { code: 'TEST02' }),
            { winner: 1, reason: 'disks' });
        games.add(upset.gameId);
        const underdogGain = (await eloOf(underdog.id)).elo - 1000;

        const even1 = await makeUser('k', 1000, 50);
        const even2 = await makeUser('l', 1000, 50);
        const ordinary = await rated.recordGame(room(even1, even2, { code: 'TEST03' }),
            { winner: 0, reason: 'disks' });
        games.add(ordinary.gameId);
        const ordinaryGain = (await eloOf(even1.id)).elo - 1000;

        assert.ok(underdogGain > ordinaryGain,
            `upset ${underdogGain} should beat ordinary ${ordinaryGain}`);
    });

    await test('a new player moves faster than a seasoned one', async () => {
        assert.ok(
            elo.getKFactor(1000, 0) > elo.getKFactor(1000, 100),
            'provisional ratings should be more volatile'
        );
    });

    await test('the rating history records every change', async () => {
        const black = await makeUser('m');
        const white = await makeUser('n');
        const record = await rated.recordGame(room(black, white), { winner: 0, reason: 'cleared' });
        games.add(record.gameId);
        const { rows } = await query('SELECT * FROM elo_history WHERE game_id = $1 ORDER BY elo_change DESC',
            [record.gameId]);
        assert.strictEqual(rows.length, 2, 'one row per player');
        assert.strictEqual(rows[0].elo_after - rows[0].elo_before, rows[0].elo_change);
        assert.strictEqual(rows[0].elo_change, -rows[1].elo_change, 'zero-sum');
    });

    await test('the moves of the game are stored for replay', async () => {
        const black = await makeUser('o');
        const white = await makeUser('p');
        const moves = [
            { type: 'tile', cell: 2016 },
            { type: 'piece', cell: 2080, piece: 0 },
            { type: 'disk', path: [2144, 2080] },
        ];
        const record = await rated.recordGame(room(black, white, { moves }), { winner: 0, reason: 'disks' });
        games.add(record.gameId);
        const { rows } = await query('SELECT * FROM moves WHERE game_id = $1 ORDER BY move_number', [record.gameId]);
        assert.strictEqual(rows.length, 3);
        assert.strictEqual(rows[0].player, 'black');
        assert.strictEqual(rows[1].player, 'white');
        assert.strictEqual(rows[0].move_type, 'tile');
        assert.strictEqual(rows[2].move_type, 'disk');
    });

    await test('a rating cannot fall below the floor', async () => {
        const doomed = await makeUser('q', 105, 0);
        const crusher = await makeUser('r', 2400, 200);
        for (let i = 0; i < 3; i++) {
            const record = await rated.recordGame(
                room(doomed, crusher, { code: 'TEST0' + i }), { winner: 1, reason: 'disks' });
            games.add(record.gameId);
            const fresh = await eloOf(doomed.id);
            doomed.elo = fresh.elo;
            doomed.games_played = fresh.games_played;
        }
        assert.ok((await eloOf(doomed.id)).elo >= 100, 'the floor holds');
    });

    /* Clean-up: moves and elo_history cascade from games and users. */
    for (const id of games) await query('DELETE FROM games WHERE id = $1', [id]).catch(() => {});
    for (const id of users) await query('DELETE FROM users WHERE id = $1', [id]).catch(() => {});
    const left = await query(
        "SELECT count(*)::int AS n FROM users WHERE email LIKE 'rated-test-%@example.invalid'");
    console.log(`\ncleanup: ${left.rows[0].n} test row(s) left behind`);

    await pool.end();
    console.log(`${passed} passed, ${failed} failed\n`);
    process.exit(failed || left.rows[0].n ? 1 : 0);
}

run().catch((error) => {
    console.error('harness crashed:', error);
    process.exit(1);
});
