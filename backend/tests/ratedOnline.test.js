/**
 * The whole rated path, end to end over real sockets.
 *
 * Run with: node tests/ratedOnline.test.js
 *
 * Two accounts, two socket.io clients, two real session tokens, one complete
 * game — and the ratings that come out the other side. This is the test that
 * would catch a break between signing in and the leaderboard.
 */

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { pool, query } = require('../config/database');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/env');
const { attachOnlineGames } = require('../socket/onlineGame');

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

function waitFor(socket, event, ms = 8000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${event}`)), ms);
        socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
    });
}

async function makeUser(tag, elo = 1000) {
    // Clear the way first: an interrupted run leaves its rows behind, and every
    // later run would then fail on the unique address rather than on the code.
    await query('DELETE FROM users WHERE email = $1', [`online-test-${tag}@example.invalid`]);
    const { rows } = await query(
        `INSERT INTO users (email, pseudo, google_id, elo, email_verified, pseudo_chosen)
         VALUES ($1,$2,$3,$4,TRUE,TRUE) RETURNING *`,
        [`online-test-${tag}@example.invalid`, `OnlineTest${tag}`, `online-test-${tag}`, elo]
    );
    users.add(rows[0].id);
    const token = jwt.sign(
        { userId: rows[0].id, email: rows[0].email, pseudo: rows[0].pseudo },
        JWT_SECRET, { expiresIn: JWT_EXPIRES_IN || '1h' }
    );
    return { user: rows[0], token };
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

    console.log('\nRated games over sockets\n');
    const { state, moves } = await sharedEngine();

    await test('an unidentified socket plays an unrated game', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', {});
        const joined = await ask(b, 'hx:join', { code: created.code });
        assert.strictEqual(joined.rated, false, 'nobody is signed in');
        assert.deepStrictEqual(joined.players, [null, null]);
        a.disconnect();
        b.disconnect();
    });

    await test('identifying both sockets makes the game rated', async () => {
        const black = await makeUser('a');
        const white = await makeUser('b');
        const a = await open();
        const b = await open();

        const idA = await ask(a, 'hx:identify', { token: black.token });
        assert.ok(idA.ok, idA.error);
        assert.strictEqual(idA.user.pseudo, black.user.pseudo);
        await ask(b, 'hx:identify', { token: white.token });

        const created = await ask(a, 'hx:create', { timeControl: 'rapid' });
        const joined = await ask(b, 'hx:join', { code: created.code });
        assert.strictEqual(joined.rated, true, 'two signed-in players');
        assert.strictEqual(joined.players[0].pseudo, black.user.pseudo);
        assert.strictEqual(joined.players[1].pseudo, white.user.pseudo);
        assert.ok(!('email' in joined.players[0]), 'the opponent never learns the address');
        a.disconnect();
        b.disconnect();
    });

    await test('the player already seated is told who arrived', async () => {
        const black = await makeUser('g');
        const white = await makeUser('h');
        const a = await open();
        const b = await open();
        await ask(a, 'hx:identify', { token: black.token });
        await ask(b, 'hx:identify', { token: white.token });

        const created = await ask(a, 'hx:create', {});
        assert.strictEqual(created.rated, false, 'alone in the room, nothing counts yet');
        // Waiting alone, the creator must learn the opponent's name and that the
        // game has become rated — without it the panel sits on "unrated" for the
        // whole game.
        const heard = waitFor(a, 'hx:seats');
        await ask(b, 'hx:join', { code: created.code });
        const event = await heard;
        assert.strictEqual(event.rated, true);
        assert.strictEqual(event.players[1].pseudo, white.user.pseudo);
        assert.strictEqual(event.players[0].pseudo, black.user.pseudo);
        a.disconnect();
        b.disconnect();
    });

    await test('a forged token identifies nobody', async () => {
        const a = await open();
        const response = await ask(a, 'hx:identify', { token: 'not.a.real.token' });
        assert.strictEqual(response.ok, false);
        assert.strictEqual(response.error, 'BAD_TOKEN');
        const created = await ask(a, 'hx:create', {});
        assert.strictEqual(created.rated, false, 'and the game stays unrated');
        a.disconnect();
    });

    await test('signing in mid-room upgrades the game to rated', async () => {
        const black = await makeUser('c');
        const white = await makeUser('d');
        const a = await open();
        const b = await open();
        await ask(a, 'hx:identify', { token: black.token });
        const created = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: created.code });          // still a guest

        const heard = waitFor(a, 'hx:seats');
        await ask(b, 'hx:identify', { token: white.token });      // signs in now
        const event = await heard;
        assert.strictEqual(event.rated, true, 'the room re-evaluates');
        assert.strictEqual(event.players[1].pseudo, white.user.pseudo);
        a.disconnect();
        b.disconnect();
    });

    await test('a full rated game moves both ratings and lands on the leaderboard', async () => {
        const black = await makeUser('e');
        const white = await makeUser('f');
        const a = await open();
        const b = await open();
        await ask(a, 'hx:identify', { token: black.token });
        await ask(b, 'hx:identify', { token: white.token });

        const created = await ask(a, 'hx:create', { timeControl: 'none' });
        await ask(b, 'hx:join', { code: created.code });

        /* Catch the event whenever it lands. A random game can run to a few
           hundred plies, so a timer started here would be measuring the game
           rather than the rating; the budget below starts once it is over. */
        let ratedLanded;
        const ratedEvent = new Promise((resolve) => { ratedLanded = resolve; });
        a.once('hx:rated', ratedLanded);
        const seats = [a, b];
        let view = created;
        let plies = 0;
        while (plies < 400) {
            const position = state.deserializeState(view.state);
            const legal = moves.generateMoves(position);
            if (!legal.length) break;
            const intent = moves.moveIntent(legal[Math.floor(Math.random() * legal.length)]);
            await new Promise((r) => setTimeout(r, MIN_WAIT));
            const response = await ask(seats[view.state.turn], 'hx:move', { code: created.code, intent });
            if (!response.ok) throw new Error(`move refused: ${response.error}`);
            plies++;
            view = response;
            if (response.result) break;
        }
        assert.ok(view.result, `no result after ${plies} plies`);

        const payload = await Promise.race([ratedEvent, new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error('no hx:rated after the game ended')), 15000);
        })]);
        assert.strictEqual(payload.ratings.length, 2);
        const [blackRating, whiteRating] = payload.ratings;
        assert.strictEqual(blackRating.change, -whiteRating.change, 'symmetric, to the point');
        assert.notStrictEqual(blackRating.change, 0, 'the rating actually moved');

        const stored = await query('SELECT elo, games_played FROM users WHERE id = ANY($1)',
            [[black.user.id, white.user.id]]);
        assert.strictEqual(stored.rows.length, 2);
        for (const row of stored.rows) assert.strictEqual(row.games_played, 1, 'counted once');

        const game = await query('SELECT * FROM games WHERE room_code = $1', [created.code]);
        assert.strictEqual(game.rows.length, 1, 'the game was recorded');
        assert.ok(game.rows[0].black_elo_after !== null, 'with the ratings after');

        const User = require('../models/userModel');
        const board = await User.getLeaderboard({ page: 1, limit: 100 });
        const names = board.players.map((p) => p.pseudo);
        assert.ok(names.includes(black.user.pseudo), 'the winner appears on the leaderboard');
        assert.ok(names.includes(white.user.pseudo), 'and so does the loser');

        a.disconnect();
        b.disconnect();
    });

    await test('resigning a rated game still settles the ratings', async () => {
        const black = await makeUser('g');
        const white = await makeUser('h');
        const a = await open();
        const b = await open();
        await ask(a, 'hx:identify', { token: black.token });
        await ask(b, 'hx:identify', { token: white.token });
        const created = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: created.code });

        const ratedEvent = waitFor(b, 'hx:rated', 10000);
        await ask(a, 'hx:resign', { code: created.code });
        const payload = await ratedEvent;
        assert.ok(payload.ratings[1].change > 0, 'the player who stayed gains');
        assert.ok(payload.ratings[0].change < 0, 'the one who resigned loses');
        a.disconnect();
        b.disconnect();
    });

    for (const id of users) await query('DELETE FROM users WHERE id = $1', [id]).catch(() => {});
    await query("DELETE FROM games WHERE black_pseudo LIKE 'OnlineTest%' OR white_pseudo LIKE 'OnlineTest%'")
        .catch(() => {});
    const left = await query(
        "SELECT count(*)::int AS n FROM users WHERE email LIKE 'online-test-%@example.invalid'");
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
