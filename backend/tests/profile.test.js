/**
 * A player's record, their game list, and replaying one of those games.
 *
 * Run with: node tests/profile.test.js
 *
 * The replay assertion is the point of this suite: a game is only worth
 * storing if it can be played back move for move, and the columns it used to
 * be stored in could not do that.
 */

// Before anything else: a database of its own, or nothing at all.
// See tests/database.js.
require('./database').requireThrowaway('profile.test.js');


const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { pool, query } = require('../config/database');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/env');
const { attachOnlineGames } = require('../socket/onlineGame');
const profile = require('../services/profileService');

let passed = 0;
let failed = 0;
const users = new Set();

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

function ask(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 8000);
        socket.emit(event, payload, (response) => { clearTimeout(timer); resolve(response); });
    });
}

async function makeUser(tag, elo = 1000) {
    await query('DELETE FROM users WHERE email = $1', [`profile-test-${tag}@example.invalid`]);
    const { rows } = await query(
        `INSERT INTO users (email, pseudo, google_id, elo, email_verified, pseudo_chosen)
         VALUES ($1,$2,$3,$4,TRUE,TRUE) RETURNING *`,
        [`profile-test-${tag}@example.invalid`, `ProfileTest${tag}`, `profile-test-${tag}`, elo]
    );
    users.add(rows[0].id);
    return {
        user: rows[0],
        token: jwt.sign({ userId: rows[0].id, email: rows[0].email, pseudo: rows[0].pseudo },
            JWT_SECRET, { expiresIn: JWT_EXPIRES_IN || '1h' }),
    };
}

async function sharedEngine() {
    const { pathToFileURL } = require('url');
    const path = require('path');
    const dir = path.join(__dirname, '..', '..', 'web', 'src', 'game');
    const url = (f) => pathToFileURL(path.join(dir, f)).href;
    const [state, moves] = await Promise.all([import(url('state.js')), import(url('moves.js'))]);
    return { state, moves };
}

const MIN_WAIT = 170;

/** Poll until `probe` returns something truthy, or give up. */
async function waitFor(probe, tries = 60, gap = 250) {
    for (let i = 0; i < tries; i++) {
        const value = await probe();
        if (value) return value;
        await new Promise((r) => setTimeout(r, gap));
    }
    return null;
}

async function run() {
    const server = http.createServer();
    const io = new Server(server, { cors: { origin: '*' } });
    attachOnlineGames(io);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const open = () => new Promise((resolve, reject) => {
        const socket = connect(url, { transports: ['websocket'], forceNew: true });
        socket.on('connect', () => resolve(socket));
        socket.on('connect_error', reject);
    });

    console.log('\nProfile: record, history and replay\n');
    const { state, moves } = await sharedEngine();

    /* One real game, played to a real finish, shared by everything below. */
    const black = await makeUser('a', 1000);
    const white = await makeUser('b', 1000);
    const a = await open();
    const b = await open();
    await ask(a, 'hx:identify', { token: black.token });
    await ask(b, 'hx:identify', { token: white.token });
    const created = await ask(a, 'hx:create', { timeControl: 'rapid' });
    await ask(b, 'hx:join', { code: created.code });

    const seats = [a, b];
    let view = created;
    const played = [];
    while (played.length < 400) {
        const position = state.deserializeState(view.state);
        const legal = moves.generateMoves(position);
        if (!legal.length) break;
        /* Lean towards captures. A purely random game rarely produces a
           multi-jump, and a multi-jump is the move whose storage used to be
           lossy — the one this suite exists to check. */
        const chains = legal.filter((m) => m.type === 'disk' && m.path.length > 2);
        const takes = legal.filter((m) => (m.type === 'disk' && m.captures.length)
            || (m.type === 'ring' && m.capture));
        const pool = chains.length ? chains : (takes.length && Math.random() < 0.8 ? takes : legal);
        const move = pool[Math.floor(Math.random() * pool.length)];
        await new Promise((r) => setTimeout(r, MIN_WAIT));
        const response = await ask(seats[view.state.turn], 'hx:move',
            { code: created.code, intent: moves.moveIntent(move) });
        if (!response.ok) throw new Error(`move refused: ${response.error}`);
        played.push(response.move);
        view = response;
        if (response.result) break;
    }
    /*
     * The result reaches the players before it reaches the database, on
     * purpose: nobody should wait on a write to learn they have won. So the
     * row appears first and the ratings land a moment later — wait for the
     * ratings, not just the row, or every assertion below reads a half-written
     * game.
     */
    const settled = await waitFor(async () => {
        const found = await query(
            'SELECT id, black_elo_after FROM games WHERE room_code = $1', [created.code]);
        return found.rows.length && found.rows[0].black_elo_after !== null ? found.rows[0] : null;
    });
    const stored = settled && settled.id;
    assert.ok(stored, 'the game was recorded');
    a.disconnect();
    b.disconnect();

    await test('the game appears in the history of both players', async () => {
        for (const person of [black, white]) {
            const list = await profile.history(person.user.id);
            assert.strictEqual(list.total, 1, `${person.user.pseudo} has one game`);
            const game = list.games[0];
            assert.strictEqual(game.id, stored);
            assert.strictEqual(game.rated, true);
            assert.strictEqual(game.timeControl, 'rapid');
            assert.strictEqual(game.plies, played.length, 'every ply is accounted for');
        }
    });

    await test('each player sees the result from their own side', async () => {
        const forBlack = (await profile.history(black.user.id)).games[0];
        const forWhite = (await profile.history(white.user.id)).games[0];
        assert.strictEqual(forBlack.colour, 0);
        assert.strictEqual(forWhite.colour, 1);
        assert.strictEqual(forBlack.opponent.pseudo, white.user.pseudo);
        assert.strictEqual(forWhite.opponent.pseudo, black.user.pseudo);
        if (forBlack.outcome !== 'draw') {
            assert.notStrictEqual(forBlack.outcome, forWhite.outcome, 'one won, one lost');
        }
        // Sum rather than negate: a drawn game between equals moves nobody,
        // and strictEqual(0, -0) is false.
        assert.strictEqual(forBlack.ratingChange + forWhite.ratingChange, 0, 'symmetric, as ever');
    });

    await test('the record counts what was played', async () => {
        const record = await profile.stats(black.user.id);
        assert.strictEqual(record.all.played, 1);
        assert.strictEqual(record.rated.played, 1);
        assert.strictEqual(record.all.wins + record.all.losses + record.all.draws, 1);
        assert.strictEqual(record.byCadence.rapid.played, 1, 'and under the right cadence');
        assert.ok(record.peakElo >= record.elo, 'the peak is never below the present');
        assert.strictEqual(record.curve.length, 1, 'one rated game, one point on the curve');
    });

    await test('a stored game replays move for move', async () => {
        const game = await profile.replay(stored, black.user.id);
        assert.ok(game.replayable, 'the moves were kept in full');
        assert.strictEqual(game.moves.length, played.length);
        assert.strictEqual(game.notations.length, played.length);
        assert.ok(game.notations.every((text) => typeof text === 'string' && text.length),
            'every ply has its notation');

        // Replay it through the same engine both players used. What is stored
        // is an intent, so each one is resolved back into the move it names.
        const position = state.createState();
        for (const intent of game.moves) {
            const move = moves.findLegalMove(position, intent);
            assert.ok(move, `ply ${game.moves.indexOf(intent) + 1} is not a legal move here`);
            state.applyMove(position, move);
        }
        const finished = state.serializeState(position);
        assert.deepStrictEqual(finished, game.finalState,
            'the replay lands exactly on the position the server stored');
    });

    await test('a jump comes back with the pieces it took', async () => {
        const game = await profile.replay(stored, black.user.id);
        /* A stored intent names the squares a disk visited and says nothing
           about what it captured — the captures are regenerated from the
           position. This is the case the old columns got wrong, keeping only
           the landing square, so a jump replayed as a move that took nothing. */
        const position = state.createState();
        let jumps = 0;
        let taken = 0;
        let longest = 0;
        for (const intent of game.moves) {
            const move = moves.findLegalMove(position, intent);
            if (move.type === 'disk' && move.path.length > 1) {
                jumps++;
                taken += move.captures.length;
                longest = Math.max(longest, move.path.length - 1);
            }
            state.applyMove(position, move);
        }
        assert.ok(jumps > 0, 'the game contained disk jumps');
        assert.ok(taken > 0, 'and at least one of them took something');
        console.log(`        (${jumps} jumps, ${taken} pieces taken, longest chain ${longest})`);
    });

    await test('an unrated game is listed but marked', async () => {
        const guest = await open();
        const solo = await open();
        await ask(solo, 'hx:identify', { token: black.token });
        const room = await ask(solo, 'hx:create', { timeControl: 'none' });
        await ask(guest, 'hx:join', { code: room.code });
        await ask(solo, 'hx:resign', { code: room.code });
        await waitFor(async () => {
            const found = await query('SELECT id FROM games WHERE room_code = $1', [room.code]);
            return found.rows.length ? found.rows[0] : null;
        });

        const list = await profile.history(black.user.id);
        assert.strictEqual(list.total, 2, 'the friendly is kept too');
        const friendly = list.games.find((g) => g.timeControl === 'none');
        assert.ok(friendly, 'and it is there');
        assert.strictEqual(friendly.rated, false, 'but it does not count');
        assert.strictEqual(friendly.ratingChange, null);

        const record = await profile.stats(black.user.id);
        assert.strictEqual(record.all.played, 2, 'the record counts both');
        assert.strictEqual(record.rated.played, 1, 'the rated record counts one');
        guest.disconnect();
        solo.disconnect();
    });

    await test("a friendly is yours to see and nobody else's", async () => {
        /* Unrated means it never touched the leaderboard, so there is nothing
           in it for a visitor to check and no reason for them to be reading
           it. The player who played it still has all of it. */
        const mine = await profile.history(black.user.id, {}, black.user.id);
        const theirs = await profile.history(black.user.id, {}, white.user.id);
        const anonymous = await profile.history(black.user.id, {}, null);

        assert.strictEqual(mine.total, 2, 'my own history keeps the friendly');
        assert.ok(mine.games.some((g) => !g.rated), 'and it is in the list');

        assert.strictEqual(theirs.total, 1, 'a visitor is shown only the rated game');
        assert.ok(theirs.games.every((g) => g.rated), 'nothing unrated leaks into the list');
        assert.strictEqual(anonymous.total, 1, 'and signed out sees the same');

        /* The count is what the pager trusts. A filtered list under an
           unfiltered total would page into emptiness. */
        assert.strictEqual(theirs.total, theirs.games.length,
            'the total counts the same games the list shows');
    });

    await test('a visitor is not even told how many friendlies there were', async () => {
        /* Withholding the games while leaving the honest total in place would
           have said exactly how many were being kept back, which is most of
           what was being kept back. */
        const mine = await profile.stats(black.user.id, black.user.id);
        const theirs = await profile.stats(black.user.id, white.user.id);

        assert.strictEqual(mine.all.played, 2, 'my own page counts both');
        assert.strictEqual(mine.rated.played, 1);
        assert.strictEqual(mine.countsEverything, true);

        assert.strictEqual(theirs.all.played, 1, 'a visitor counts only the rated one');
        assert.strictEqual(theirs.rated.played, 1);
        assert.strictEqual(theirs.countsEverything, false,
            'and the page is told so, rather than printing the same line twice');

        /* By cadence too: the friendly was played without a clock, and a
           cadence appearing with games under it is the same leak by another
           route. */
        assert.ok(mine.byCadence.none, 'my own breakdown keeps the clockless game');
        assert.ok(!theirs.byCadence.none, "a visitor's breakdown does not");

        const anonymous = await profile.stats(black.user.id, null);
        assert.strictEqual(anonymous.all.played, 1, 'signed out sees what a visitor sees');

        /* The rating curve is drawn from elo_history, which only gets a row
           when the rating moved — so it never held a friendly to begin with. */
        assert.strictEqual(mine.curve.length, theirs.curve.length,
            'the curve was always rated-only and is unchanged');
    });

    await test('a friendly cannot be replayed by someone who was not in it', async () => {
        const friendly = (await profile.history(black.user.id, {}, black.user.id))
            .games.find((g) => !g.rated);
        assert.ok(friendly, 'there is a friendly to ask for');

        assert.ok(await profile.replay(friendly.id, black.user.id),
            'the player who played it can read it back');
        assert.strictEqual(await profile.replay(friendly.id, white.user.id), null,
            'another player cannot, even knowing the id');
        assert.strictEqual(await profile.replay(friendly.id, null), null,
            'nor can a signed-out reader');

        /* Hiding it from the list while still serving it by id would be a
           curtain rather than a door: that id travels in the review link. */
        assert.ok(await profile.replay(stored, white.user.id),
            'a rated game stays readable — the record has to be checkable');
        assert.ok(await profile.replay(stored, null),
            'by anyone at all, signed in or not');
    });

    await test('two players can see how they have fared against each other', async () => {
        /* The head-to-head is the same story told from two sides: what one
           won, the other lost. Only their games against each other count —
           the friendly against a guest is between neither of them. */
        const mine = await profile.versus(black.user.id, white.user.id);
        const theirs = await profile.versus(white.user.id, black.user.id);
        assert.ok(mine, 'they have met');
        assert.strictEqual(mine.played, 1, 'once, in the rated game');
        assert.strictEqual(mine.wins + mine.losses + mine.draws, mine.played);
        assert.strictEqual(theirs.played, mine.played);
        assert.strictEqual(theirs.wins, mine.losses, 'my loss is their win');
        assert.strictEqual(theirs.losses, mine.wins);
        assert.strictEqual(theirs.draws, mine.draws);
    });

    await test('a stranger, and yourself, have no head-to-head', async () => {
        const stranger = '00000000-0000-0000-0000-000000000000';
        assert.strictEqual(await profile.versus(black.user.id, stranger), null,
            'never met is null, not a row of zeroes');
        assert.strictEqual(await profile.versus(black.user.id, black.user.id), null,
            'and you do not play yourself');
        assert.strictEqual(await profile.versus(null, white.user.id), null,
            'nor does a signed-out reader have a record');
    });

    await test('the record and games of another player are public', async () => {
        // Public by design: a leaderboard whose names lead nowhere is a list.
        const record = await profile.stats(white.user.id);
        assert.ok(record, 'the record is readable without being that player');
        assert.strictEqual(record.pseudo, white.user.pseudo);
        const list = await profile.history(white.user.id);
        assert.ok(list.games.length >= 1, 'and so are their games');
        assert.ok(list.games.every((g) => g.opponent),
            'each one naming who it was against');
    });

    await test('an id nobody owns finds nothing', async () => {
        assert.strictEqual(await profile.stats('00000000-0000-0000-0000-000000000000'), null);
        assert.strictEqual(await profile.replay('00000000-0000-0000-0000-000000000000', null), null);
    });

    for (const id of users) await query('DELETE FROM users WHERE id = $1', [id]).catch(() => {});
    const left = await query(
        "SELECT count(*)::int AS n FROM users WHERE email LIKE 'profile-test-%@example.invalid'");
    console.log(`\ncleanup: ${left.rows[0].n} test row(s) left behind`);

    io.close();
    server.close();
    await pool.end();
    console.log(`${passed} passed, ${failed} failed\n`);
    process.exit(failed || left.rows[0].n ? 1 : 0);
}

run().catch((error) => {
    console.error('harness crashed:', error);
    process.exit(1);
});
