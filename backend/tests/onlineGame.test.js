/**
 * Authoritative online games, exercised through real socket.io clients.
 *
 * Run with: node tests/onlineGame.test.js
 *
 * No database and no Express app: the module under test only needs an io
 * instance, so the test stands up a bare HTTP server and connects two genuine
 * clients to it. What is being checked is that a hostile client gets nowhere.
 */

const assert = require('assert');
const http = require('http');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { attachOnlineGames, RECONNECT_GRACE_MS, TIME_CONTROLS } = require('../socket/onlineGame');

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

/** Promise wrapper around socket.io acknowledgements. */
function ask(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 5000);
        socket.emit(event, payload, (response) => {
            clearTimeout(timer);
            resolve(response);
        });
    });
}

function waitFor(socket, event, ms = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${event}`)), ms);
        socket.once(event, (payload) => {
            clearTimeout(timer);
            resolve(payload);
        });
    });
}

async function sharedEngine() {
    const { pathToFileURL } = require('url');
    const path = require('path');
    const dir = path.join(__dirname, '..', '..', 'web', 'src', 'game');
    const url = (f) => pathToFileURL(path.join(dir, f)).href;
    const [state, moves] = await Promise.all([import(url('state.js')), import(url('moves.js'))]);
    return { state, moves };
}

/** A legal intent for whoever is to move in `snapshot`. */
async function legalIntent(snapshot, index = 0) {
    const { state, moves } = await sharedEngine();
    const position = state.deserializeState(snapshot);
    const legal = moves.generateMoves(position);
    return moves.moveIntent(legal[index % legal.length]);
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

    console.log('\nAuthoritative online games\n');

    const black = await open();
    const white = await open();

    let code = null;

    await test('a room can be opened and joined', async () => {
        const created = await ask(black, 'hx:create', { name: 'Noir' });
        assert.ok(created.ok, created.error);
        assert.strictEqual(created.colour, 0, 'the opener takes Black');
        assert.match(created.code, /^[ACDEFGHJKLMNPQRTUVWXY34679]{6}$/, 'readable room code');
        code = created.code;

        const joined = await ask(white, 'hx:join', { code, name: 'Blanc' });
        assert.ok(joined.ok, joined.error);
        assert.strictEqual(joined.colour, 1, 'the joiner takes White');
        assert.deepStrictEqual(joined.state, created.state, 'both see the same position');
    });

    await test('a third player is turned away', async () => {
        const third = await open();
        const response = await ask(third, 'hx:join', { code });
        assert.strictEqual(response.ok, false);
        assert.strictEqual(response.error, 'ROOM_FULL');
        third.disconnect();
    });

    await test('an unknown code is refused', async () => {
        const response = await ask(white, 'hx:join', { code: 'ZZZZZZ' });
        assert.strictEqual(response.ok, false);
        assert.strictEqual(response.error, 'NO_SUCH_ROOM');
    });

    await test('a legal move reaches the opponent', async () => {
        const view = await ask(black, 'hx:sync', { code });
        const intent = await legalIntent(view.state);
        const heard = waitFor(white, 'hx:moved');
        const response = await ask(black, 'hx:move', { code, intent });
        assert.ok(response.ok, response.error);
        const event = await heard;
        assert.strictEqual(event.by, 0);
        assert.strictEqual(event.state.turn, 1, 'the turn passes to White');
        assert.deepStrictEqual(event.state, response.state, 'broadcast matches the acknowledgement');
    });

    await test('playing out of turn is refused', async () => {
        // Wait past the anti-spam guard, which would otherwise answer first and
        // hide the check we are actually testing.
        await new Promise((r) => setTimeout(r, MIN_WAIT));
        const view = await ask(black, 'hx:sync', { code });
        const intent = await legalIntent(view.state);
        const response = await ask(black, 'hx:move', { code, intent });   // still White to move
        assert.strictEqual(response.ok, false);
        assert.strictEqual(response.error, 'NOT_YOUR_TURN');
    });

    await test('an illegal move is refused and the position is untouched', async () => {
        const before = await ask(white, 'hx:sync', { code });
        await new Promise((r) => setTimeout(r, 200));
        const response = await ask(white, 'hx:move', { code, intent: { type: 'tile', cell: 4095 } });
        assert.strictEqual(response.ok, false);
        assert.strictEqual(response.error, 'ILLEGAL_MOVE');
        const after = await ask(white, 'hx:sync', { code });
        assert.deepStrictEqual(after.state, before.state, 'a refused move must change nothing');
    });

    await test('a client cannot dictate the position', async () => {
        // There is no event that accepts a state: the only way in is an intent.
        const before = await ask(white, 'hx:sync', { code });
        await new Promise((r) => setTimeout(r, 200));
        const response = await ask(white, 'hx:move', {
            code,
            intent: { type: 'tile', cell: 4095 },
            state: { v: 1, tiles: [], pieces: [], turn: 0, capturedDisks: [6, 0], capturedRings: [0, 0] },
        });
        assert.strictEqual(response.ok, false);
        const after = await ask(white, 'hx:sync', { code });
        assert.deepStrictEqual(after.state, before.state);
        assert.deepStrictEqual(after.state.capturedDisks, [0, 0], 'no forged captures');
    });

    await test('a spectator socket cannot move', async () => {
        const stranger = await open();
        const response = await ask(stranger, 'hx:move', { code, intent: { type: 'tile', cell: 2080 } });
        assert.strictEqual(response.ok, false);
        assert.strictEqual(response.error, 'NOT_A_PLAYER');
        stranger.disconnect();
    });

    await test('moves fired faster than a human can play are throttled', async () => {
        const view = await ask(white, 'hx:sync', { code });
        const intent = await legalIntent(view.state);
        const first = await ask(white, 'hx:move', { code, intent });
        assert.ok(first.ok, first.error);
        const view2 = await ask(black, 'hx:sync', { code });
        const intent2 = await legalIntent(view2.state);
        const immediate = await ask(black, 'hx:move', { code, intent: intent2 });
        // Black has not moved recently, so this one is allowed; the guard is
        // per socket. Fire a second one straight away from the same socket.
        assert.ok(immediate.ok, immediate.error);
        const view3 = await ask(white, 'hx:sync', { code });
        const intent3 = await legalIntent(view3.state);
        const tooSoon = await ask(white, 'hx:move', { code, intent: intent3 });
        assert.strictEqual(tooSoon.ok, false);
        assert.strictEqual(tooSoon.error, 'TOO_FAST');
    });

    await test('a full game plays to a server-declared result', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', {});
        const room = created.code;
        await ask(b, 'hx:join', { code: room });

        let view = created;
        let plies = 0;
        let result = null;
        const seats = [a, b];
        while (plies < 400) {
            const mover = seats[view.state.turn];
            const intent = await legalIntent(view.state, Math.floor(Math.random() * 8));
            await new Promise((r) => setTimeout(r, MIN_WAIT));
            const response = await ask(mover, 'hx:move', { code: room, intent });
            if (!response.ok) throw new Error(`move refused: ${response.error}`);
            plies++;
            view = response;
            if (response.result) { result = response.result; break; }
        }
        assert.ok(result, `no result after ${plies} plies`);
        assert.ok(plies > 10, 'a real game, not an instant end');
        const final = await ask(a, 'hx:sync', { code: room });
        assert.ok(final.result, 'the room remembers the result');
        assert.strictEqual(final.moves.length, plies, 'every move was recorded');
        a.disconnect();
        b.disconnect();
    });

    await test('resigning ends the game for both sides', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: created.code });
        const heard = waitFor(b, 'hx:ended');
        const response = await ask(a, 'hx:resign', { code: created.code });
        assert.ok(response.ok, response.error);
        const event = await heard;
        assert.strictEqual(event.result.winner, 1, 'the opponent wins');
        assert.strictEqual(event.result.reason, 'resigned');
        const after = await ask(a, 'hx:move', { code: created.code, intent: { type: 'tile', cell: 2080 } });
        assert.strictEqual(after.ok, false);
        assert.strictEqual(after.error, 'GAME_OVER');
        a.disconnect();
        b.disconnect();
    });

    await test('an untimed room has no clock', async () => {
        const a = await open();
        const created = await ask(a, 'hx:create', { timeControl: 'none' });
        assert.strictEqual(created.clock, null);
        a.disconnect();
    });

    await test('a cadence sets both clocks and starts them when both are seated', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', { timeControl: 'blitz' });
        assert.ok(created.clock, 'the room has a clock');
        assert.strictEqual(created.clock.control, 'blitz');
        assert.strictEqual(created.clock.initialMs, TIME_CONTROLS.blitz.initialMs);
        assert.strictEqual(created.clock.running, false, 'not running with one player');
        assert.deepStrictEqual(created.clock.remaining,
            [TIME_CONTROLS.blitz.initialMs, TIME_CONTROLS.blitz.initialMs]);

        const joined = await ask(b, 'hx:join', { code: created.code });
        assert.strictEqual(joined.clock.running, true, 'the clock starts on the second arrival');
        await new Promise((r) => setTimeout(r, 300));
        const later = await ask(b, 'hx:sync', { code: created.code });
        assert.ok(later.clock.remaining[0] < TIME_CONTROLS.blitz.initialMs, "Black's time is ticking");
        assert.strictEqual(later.clock.remaining[1], TIME_CONTROLS.blitz.initialMs, "White's is not");
        a.disconnect();
        b.disconnect();
    });

    await test('the waiting player is told the clock has started', async () => {
        // Without this, whoever opened the room keeps showing the full time
        // while the server is already counting down.
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', { timeControl: 'blitz' });
        assert.strictEqual(created.clock.running, false);
        const heard = waitFor(a, 'hx:opponent');
        await ask(b, 'hx:join', { code: created.code });
        const event = await heard;
        assert.strictEqual(event.joined, true);
        assert.ok(event.clock, 'the arrival carries the clock');
        assert.strictEqual(event.clock.running, true, 'and says it is running');
        a.disconnect();
        b.disconnect();
    });

    await test('a move charges the mover and grants the increment', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', { timeControl: 'blitz' });
        await ask(b, 'hx:join', { code: created.code });
        await new Promise((r) => setTimeout(r, 400));
        const intent = await legalIntent(created.state);
        const response = await ask(a, 'hx:move', { code: created.code, intent });
        assert.ok(response.ok, response.error);
        const { initialMs, incrementMs } = TIME_CONTROLS.blitz;
        const black = response.clock.remaining[0];
        assert.ok(black < initialMs + incrementMs, 'time was spent');
        assert.ok(black > initialMs - 2000, 'but only what was actually used');
        assert.ok(black > initialMs - 400 + incrementMs - 200, 'the increment was granted');
        assert.strictEqual(response.clock.turn, 1, 'the clock now runs for White');
        a.disconnect();
        b.disconnect();
    });

    await test('running out of time loses the game', async () => {
        const original = TIME_CONTROLS.bullet.initialMs;
        TIME_CONTROLS.bullet.initialMs = 400;              // flag almost immediately
        try {
            const a = await open();
            const b = await open();
            const created = await ask(a, 'hx:create', { timeControl: 'bullet' });
            const ended = waitFor(a, 'hx:ended', 4000);
            await ask(b, 'hx:join', { code: created.code });   // starts the clock
            const event = await ended;
            assert.strictEqual(event.result.reason, 'timeout');
            assert.strictEqual(event.result.winner, 1, 'the player who did not flag wins');
            assert.strictEqual(event.clock.remaining[0], 0, "the flagged side's clock reads zero");
            const after = await ask(a, 'hx:move', { code: created.code, intent: { type: 'tile', cell: 2080 } });
            assert.strictEqual(after.ok, false);
            assert.strictEqual(after.error, 'GAME_OVER');
            a.disconnect();
            b.disconnect();
        } finally {
            TIME_CONTROLS.bullet.initialMs = original;
        }
    });

    await test('a clock does not start while a seat is empty', async () => {
        const original = TIME_CONTROLS.bullet.initialMs;
        TIME_CONTROLS.bullet.initialMs = 300;
        try {
            const a = await open();
            const created = await ask(a, 'hx:create', { timeControl: 'bullet' });
            await new Promise((r) => setTimeout(r, 700));    // longer than the whole clock
            const view = await ask(a, 'hx:sync', { code: created.code });
            assert.strictEqual(view.result, null, 'nobody flags in an empty room');
            assert.strictEqual(view.clock.remaining[0], 300, 'no time was spent');
            a.disconnect();
        } finally {
            TIME_CONTROLS.bullet.initialMs = original;
        }
    });

    await test('a disconnection starts an abandonment countdown', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: created.code });
        const heard = waitFor(a, 'hx:opponent');
        b.disconnect();
        const event = await heard;
        assert.strictEqual(event.joined, false);
        assert.strictEqual(event.graceMs, RECONNECT_GRACE_MS.none, 'grace matches the time control');
        assert.ok(event.msLeft > 0 && event.msLeft <= event.graceMs, 'a countdown is running');
        const view = await ask(a, 'hx:sync', { code: created.code });
        assert.ok(view.awaitingReturn, 'the room reports who it is waiting for');
        assert.strictEqual(view.awaitingReturn.seat, 1);
        a.disconnect();
    });

    await test('the countdown is called off when the player returns', async () => {
        const a = await open();
        let b = await open();
        const created = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: created.code });
        b.disconnect();
        await new Promise((r) => setTimeout(r, 120));
        b = await open();
        const back = await ask(b, 'hx:join', { code: created.code });
        assert.ok(back.ok, back.error);
        assert.strictEqual(back.awaitingReturn, null, 'no countdown left running');
        // And the game is still playable, not awarded away.
        await new Promise((r) => setTimeout(r, 350));
        const view = await ask(a, 'hx:sync', { code: created.code });
        assert.strictEqual(view.result, null, 'the game survived the round trip');
        a.disconnect();
        b.disconnect();
    });

    await test('running the countdown out awards the game to the opponent', async () => {
        const original = RECONNECT_GRACE_MS.none;
        RECONNECT_GRACE_MS.none = 250;                  // keep the test quick
        try {
            const a = await open();
            const b = await open();
            const created = await ask(a, 'hx:create', {});
            await ask(b, 'hx:join', { code: created.code });
            const ended = waitFor(a, 'hx:ended', 3000);
            b.disconnect();
            const event = await ended;
            assert.strictEqual(event.result.reason, 'abandoned');
            assert.strictEqual(event.result.winner, 0, 'the player still present wins');
            const after = await ask(a, 'hx:move', { code: created.code, intent: { type: 'tile', cell: 2080 } });
            assert.strictEqual(after.ok, false);
            assert.strictEqual(after.error, 'GAME_OVER');
            a.disconnect();
        } finally {
            RECONNECT_GRACE_MS.none = original;
        }
    });

    await test('leaving before the opponent arrives abandons nothing', async () => {
        const original = RECONNECT_GRACE_MS.none;
        RECONNECT_GRACE_MS.none = 200;
        try {
            const a = await open();
            const created = await ask(a, 'hx:create', {});   // nobody ever joined
            a.disconnect();
            await new Promise((r) => setTimeout(r, 500));
            const watcher = await open();
            const view = await ask(watcher, 'hx:sync', { code: created.code });
            assert.strictEqual(view.result, null, 'a game that never started cannot be abandoned');
            watcher.disconnect();
        } finally {
            RECONNECT_GRACE_MS.none = original;
        }
    });

    await test('a disconnection frees the seat and the player can return', async () => {
        const a = await open();
        let b = await open();
        const created = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: created.code });
        const heard = waitFor(a, 'hx:opponent');
        b.disconnect();
        const event = await heard;
        assert.strictEqual(event.joined, false);
        assert.strictEqual(event.seat, 1);
        b = await open();
        const back = await ask(b, 'hx:join', { code: created.code });
        assert.ok(back.ok, back.error);
        assert.strictEqual(back.colour, 1, 'the same seat is available again');
        assert.deepStrictEqual(back.state, created.state, 'the position survived');
        a.disconnect();
        b.disconnect();
    });

    black.disconnect();
    white.disconnect();
    io.close();
    server.close();

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

const MIN_WAIT = 160;   // just over the server's per-socket move throttle

run().catch((error) => {
    console.error('harness crashed:', error);
    process.exit(1);
});
